"""Build an isolated, resource-bound PDF text-repair candidate.

The worker never writes the source PDF or production extraction artifacts.  It
patches a cloned PDF in memory only, then replays the production-selected text
engine while using PyMuPDF solely for renderer geometry provenance.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher

import pymupdf
import pypdf
import fontTools
from fontTools.cffLib import CFFFontSet
from fontTools.encodings.MacRoman import MacRoman
from fontTools.encodings.StandardEncoding import StandardEncoding
from fontTools.pens.recordingPen import RecordingPen
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, DecodedStreamObject, NameObject


class RepairError(RuntimeError):
    pass


def fail(code: str, detail: str) -> None:
    raise RepairError(f"{code}: {detail}")


def object_key(value) -> str:
    if hasattr(value, "idnum"):
        return f"{value.idnum}:{value.generation}"
    obj = value.get_object() if hasattr(value, "get_object") else value
    reference = getattr(obj, "indirect_reference", None)
    if reference is not None:
        return f"{reference.idnum}:{reference.generation}"
    fail("direct_font_object_unsupported", "the target font must be an indirect PDF object")


def original_bytes(value) -> bytes:
    if hasattr(value, "original_bytes"):
        return bytes(value.original_bytes)
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    fail("raw_text_operand_unavailable", f"cannot recover original bytes from {type(value).__name__}")


def encoding_differences(font) -> dict[int, str]:
    encoding = font.get("/Encoding")
    if encoding is None or isinstance(encoding, str):
        fail("encoding_differences_missing", "target font has no explicit /Encoding/Differences dictionary")
    encoding = encoding.get_object() if hasattr(encoding, "get_object") else encoding
    differences = encoding.get("/Differences")
    if not differences:
        fail("encoding_differences_missing", "target font has no explicit /Encoding/Differences array")
    result: dict[int, str] = {}
    current = None
    for item in differences:
        if isinstance(item, int):
            current = int(item)
            continue
        if current is None:
            fail("encoding_differences_invalid", "glyph name appears before a character code")
        result[current] = str(item)
        current += 1
    return result


def font_stream_identity(font, stream_key: str) -> tuple[str, int]:
    descriptor = font.get("/FontDescriptor")
    if descriptor is None:
        fail("font_descriptor_missing", "target font has no /FontDescriptor")
    descriptor = descriptor.get_object()
    stream = descriptor.get(stream_key)
    if stream is None:
        fail("font_stream_missing", f"target font has no {stream_key}")
    data = stream.get_object().get_data()
    return hashlib.sha256(data).hexdigest(), len(data)


def font_stream_data(font, stream_key: str) -> tuple[bytes, object]:
    descriptor = font.get("/FontDescriptor")
    if descriptor is None:
        fail("font_descriptor_missing", "target font has no /FontDescriptor")
    descriptor = descriptor.get_object()
    stream = descriptor.get(stream_key)
    if stream is None:
        fail("font_stream_missing", f"target font has no {stream_key}")
    stream_object = stream.get_object()
    return stream_object.get_data(), stream_object


def canonical_json_sha256(value) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def cff_font_evidence(font, resource: dict, mappings: list[dict]) -> dict[int, str]:
    evidence = resource.get("encodingEvidence")
    if not isinstance(evidence, dict) or evidence.get("kind") != "named-cff":
        fail("named_encoding_evidence_missing", resource.get("fontResourceTag", "unknown"))
    if resource.get("fontStreamKey") != "/FontFile3":
        fail("named_encoding_font_stream_unsupported", "named CFF evidence requires /FontFile3")
    encoding_name = str(font.get("/Encoding") or "")
    if encoding_name != evidence.get("encodingName"):
        fail(
            "named_encoding_mismatch",
            f"observed {encoding_name!r}; expected {evidence.get('encodingName')!r}",
        )
    encoding_tables = {
        "/MacRomanEncoding": MacRoman,
        "/StandardEncoding": StandardEncoding,
    }
    table = encoding_tables.get(encoding_name)
    if table is None:
        fail("named_encoding_unsupported", encoding_name)
    encoding_map = [[code, f"/{glyph_name}"] for code, glyph_name in enumerate(table)]
    observed_encoding_sha = canonical_json_sha256(encoding_map)
    if observed_encoding_sha != evidence.get("encodingMapSha256"):
        fail(
            "named_encoding_map_hash_mismatch",
            f"observed {observed_encoding_sha}; expected {evidence.get('encodingMapSha256')}",
        )

    stream_data, stream_object = font_stream_data(font, resource["fontStreamKey"])
    if str(stream_object.get("/Subtype")) != "/Type1C":
        fail("named_encoding_font_subtype_unsupported", repr(stream_object.get("/Subtype")))
    cff = CFFFontSet()
    try:
        cff.decompile(io.BytesIO(stream_data), None)
    except Exception as error:
        fail("cff_parse_failed", type(error).__name__)
    if len(cff.fontNames) != 1:
        fail("cff_font_count_unsupported", str(len(cff.fontNames)))
    top_dict = cff[cff.fontNames[0]]
    charset = [f"/{glyph_name}" for glyph_name in top_dict.charset]
    observed_charset_sha = canonical_json_sha256(charset)
    if observed_charset_sha != evidence.get("cffCharsetSha256"):
        fail(
            "cff_charset_hash_mismatch",
            f"observed {observed_charset_sha}; expected {evidence.get('cffCharsetSha256')}",
        )
    charset_set = set(charset)
    glyph_map = {code: glyph_name for code, glyph_name in encoding_map if glyph_name != "/.notdef"}
    for mapping in mappings:
        code = int(mapping_code_hex(mapping), 16)
        glyph_name = mapping["glyphName"]
        if glyph_map.get(code) != glyph_name:
            fail(
                "named_encoding_glyph_mismatch",
                f"0x{code:02X} resolves to {glyph_map.get(code)!r}; mapping declares {glyph_name!r}",
            )
        if glyph_name not in charset_set:
            fail("cff_charset_glyph_missing", glyph_name)
        pen = RecordingPen()
        try:
            top_dict.CharStrings[glyph_name[1:]].draw(pen)
        except Exception as error:
            fail("cff_glyph_outline_failed", f"{glyph_name}: {type(error).__name__}")
        outline = []
        for operator, points in pen.value:
            if operator == "addComponent":
                fail("cff_composite_outline_unsupported", glyph_name)
            outline.append([
                operator,
                [[round(float(x), 6), round(float(y), 6)] for x, y in points],
            ])
        observed_outline_sha = canonical_json_sha256(outline)
        # Diagnostic marker mappings are generated internally after the
        # authorized spec mappings have already passed this exact outline
        # check. They intentionally carry no spec-only evidence fields.
        expected_outline_sha = mapping.get("glyphOutlineSha256")
        if expected_outline_sha is not None and observed_outline_sha != expected_outline_sha:
            fail(
                "cff_glyph_outline_hash_mismatch",
                f"{glyph_name} observed {observed_outline_sha}; expected {expected_outline_sha}",
            )
    return glyph_map


def resource_encoding_glyphs(font, resource: dict, mappings: list[dict]) -> dict[int, str]:
    if resource.get("encodingEvidence") is not None:
        return cff_font_evidence(font, resource, mappings)
    if any(mapping.get("glyphOutlineSha256") is not None for mapping in mappings):
        fail("glyph_outline_evidence_without_named_encoding", resource.get("fontResourceTag", "unknown"))
    return encoding_differences(font)


def minimal_one_byte_to_unicode_cmap() -> bytes:
    return (
        b"/CIDInit /ProcSet findresource begin\n"
        b"12 dict begin\n"
        b"begincmap\n"
        b"/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
        b"/CMapName /AtlasRepair def\n"
        b"/CMapType 2 def\n"
        b"1 begincodespacerange\n"
        b"<00><FF>\n"
        b"endcodespacerange\n"
        b"endcmap\n"
        b"CMapName currentdict /CMap defineresource pop\n"
        b"end\n"
        b"end\n"
    )


def text_operands(operands, operator: bytes):
    if operator == b"TJ":
        for index, value in enumerate(operands[0]):
            if isinstance(value, (str, bytes, bytearray)):
                yield index, value
        return
    if operator in (b"Tj", b"'", b'"'):
        yield len(operands) - 1, operands[-1]


def mapping_code_hex(mapping: dict) -> str:
    return str(mapping.get("rawCodeHex", mapping.get("charCodeHex", ""))).upper()


def unicode_cmap_hex(value: str) -> str:
    return value.encode("utf-16-be").hex().upper()


def cmap_with_mappings(cmap_bytes: bytes, mappings: list[dict]) -> bytes:
    if re.search(rb"\busecmap\b", cmap_bytes):
        fail("to_unicode_cmap_ambiguity", "inherited usecmap mappings are unsupported")
    codespaces = []
    for block in re.findall(rb"begincodespacerange(.*?)endcodespacerange", cmap_bytes, flags=re.S):
        for start, end in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            if len(start) == len(end):
                codespaces.append((bytes.fromhex(start.decode("ascii")), bytes.fromhex(end.decode("ascii"))))
    additions = []
    replacements = []
    for mapping in mappings:
        source = mapping_code_hex(mapping)
        source_bytes = bytes.fromhex(source)
        matching_codespaces = [item for item in codespaces if len(item[0]) == len(source_bytes) and item[0] <= source_bytes <= item[1]]
        if len(matching_codespaces) != 1:
            fail("to_unicode_cmap_ambiguity", f"0x{source} matches {len(matching_codespaces)} codespaces")
        target_bytes = bytes.fromhex(unicode_cmap_hex(mapping["unicode"]))
        existing = []
        for block_match in re.finditer(rb"beginbfchar(.*?)endbfchar", cmap_bytes, flags=re.S):
            block = block_match.group(1)
            block_start = block_match.start(1)
            for row in re.finditer(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
                if bytes.fromhex(row.group(1).decode("ascii")) == source_bytes:
                    existing.append(
                        (
                            block_start + row.start(2),
                            block_start + row.end(2),
                            bytes.fromhex(row.group(2).decode("ascii")),
                            "bfchar",
                        )
                    )
        for block_match in re.finditer(rb"beginbfrange(.*?)endbfrange", cmap_bytes, flags=re.S):
            block = block_match.group(1)
            block_start = block_match.start(1)
            for row in re.finditer(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
                start_bytes = bytes.fromhex(row.group(1).decode("ascii"))
                end_bytes = bytes.fromhex(row.group(2).decode("ascii"))
                if len(start_bytes) == len(source_bytes) and start_bytes <= source_bytes <= end_bytes:
                    if start_bytes != end_bytes or start_bytes != source_bytes:
                        fail("to_unicode_cmap_ambiguity", f"0x{source} is covered by a multi-code bfrange")
                    existing.append(
                        (
                            block_start + row.start(3),
                            block_start + row.end(3),
                            bytes.fromhex(row.group(3).decode("ascii")),
                            "singleton-bfrange",
                        )
                    )
            for row in re.finditer(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[", block):
                start_bytes = bytes.fromhex(row.group(1).decode("ascii"))
                end_bytes = bytes.fromhex(row.group(2).decode("ascii"))
                if len(start_bytes) == len(source_bytes) and start_bytes <= source_bytes <= end_bytes:
                    fail("to_unicode_cmap_ambiguity", f"0x{source} is covered by an array bfrange")
        if len(existing) > 1:
            fail("to_unicode_cmap_ambiguity", f"0x{source} has {len(existing)} CMap mappings")
        if existing:
            start, end, observed, _kind = existing[0]
            if observed != target_bytes:
                replacements.append((start, end, target_bytes.hex().upper().encode("ascii")))
            continue
        additions.append(f"<{source}><{target_bytes.hex().upper()}>")
    result = cmap_bytes
    for start, end, replacement in sorted(replacements, reverse=True):
        result = result[:start] + replacement + result[end:]
    if not additions:
        return result
    marker = re.search(rb"endcodespacerange\s*", result)
    if marker is None:
        fail("to_unicode_codespace_missing", "cannot safely extend the target font CMap")
    block = (f"{len(additions)} beginbfchar\n" + "\n".join(additions) + "\nendbfchar\n").encode("ascii")
    insertion = marker.end()
    return result[:insertion] + b"\n" + block + result[insertion:]


def flatten_raw_chars(page) -> tuple[list[dict], str]:
    result = []
    text_parts: list[str] = []
    scalar_offset = 0
    payload = page.get_text("rawdict")
    for block_index, block in enumerate(payload.get("blocks", [])):
        if block.get("type", 0) != 0:
            continue
        for line_index, line in enumerate(block.get("lines", [])):
            for span_index, span in enumerate(line.get("spans", [])):
                for char_index, character in enumerate(span.get("chars", [])):
                    value = character.get("c", "")
                    result.append(
                        {
                            "character": value,
                            "bbox": [round(float(value), 6) for value in character.get("bbox", ())],
                            "origin": [round(float(value), 6) for value in character.get("origin", ())],
                            "font": span.get("font", ""),
                            "rawTextUnicodeScalarOffset": scalar_offset,
                            "blockIndex": block_index,
                            "lineIndex": line_index,
                            "spanIndex": span_index,
                            "charIndex": char_index,
                        }
                    )
                    text_parts.append(value)
                    scalar_offset += len(value)
            text_parts.append("\n")
            scalar_offset += 1
    return result, "".join(text_parts)


def bind_page_text_offsets(entries: list[dict], raw_text: str, page_text: str, page_number: int) -> None:
    matcher = SequenceMatcher(None, raw_text, page_text, autojunk=False)
    raw_to_page: dict[int, int] = {}
    for tag, raw_start, raw_end, page_start, page_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        inserted = page_text[page_start:page_end]
        if tag != "insert" or any(unicodedata.combining(character) == 0 for character in inserted):
            fail(
                "renderer_text_offset_alignment_ambiguous",
                f"page {page_number} opcode={tag} raw={raw_start}:{raw_end} text={page_start}:{page_end}",
            )
    for raw_start, page_start, size in matcher.get_matching_blocks():
        for offset in range(size):
            raw_to_page[raw_start + offset] = page_start + offset
    for entry in entries:
        raw_offset = entry["rawTextUnicodeScalarOffset"]
        character = entry["character"]
        if len(character) != 1 or raw_to_page.get(raw_offset) is None:
            fail(
                "renderer_text_offset_alignment_failed",
                f"page {page_number} raw offset {raw_offset} character {character!r}",
            )
        page_offset = raw_to_page[raw_offset]
        if page_text[page_offset : page_offset + 1] != character:
            fail("renderer_text_offset_character_mismatch", f"page {page_number} offset {page_offset}")
        entry["pageTextUnicodeScalarOffset"] = page_offset


def bbox_equal(left: list[float], right: list[float], tolerance: float = 0.0001) -> bool:
    return len(left) == len(right) and all(abs(a - b) <= tolerance for a, b in zip(left, right))


def union_bbox(values: list[list[float]]) -> list[float]:
    if not values:
        return []
    return [
        round(min(value[0] for value in values), 6),
        round(min(value[1] for value in values), 6),
        round(max(value[2] for value in values), 6),
        round(max(value[3] for value in values), 6),
    ]


def glyph_identity(value: dict) -> tuple[str, str, int, str]:
    return (
        value["fontResourceTag"],
        value["fontStreamSha256"],
        int(value.get("charCodeHex", value.get("originalCharCodeHex")), 16),
        value["glyphName"],
    )


def source_event_key(event: dict) -> tuple[int, int, str, int, int]:
    return (
        event["page"],
        event["contentOperatorIndex"],
        event["textOperator"],
        event["stringOperandIndex"],
        event["byteOffset"],
    )


def font_advance_width(font, code: int) -> float:
    first = int(font.get("/FirstChar", 0))
    widths = font.get("/Widths")
    if widths is None or code < first or code - first >= len(widths):
        fail("font_advance_width_missing", f"no explicit width for character code 0x{code:02X}")
    return round(float(widths[code - first]), 6)


def write_variant_pdf(reader, font_objects: dict[str, dict], mappings: list[dict]) -> bytes:
    try:
        for key, value in font_objects.items():
            applicable = []
            for mapping in mappings:
                code = int(mapping["charCodeHex"], 16)
                glyph_name = value["differences"].get(code)
                if mapping["glyphName"] == glyph_name:
                    applicable.append(mapping)
            cmap = value["cmap"]
            cmap.set_data(cmap_with_mappings(value["cmapBytes"], applicable))
        writer = PdfWriter()
        writer.clone_document_from_reader(reader)
        output = io.BytesIO()
        writer.write(output)
        return output.getvalue()
    finally:
        for value in font_objects.values():
            value["cmap"].set_data(value["cmapBytes"])


def resource_identity(value: dict) -> tuple[str, str, str]:
    return (
        value["fontResourceTag"],
        value["fontStreamKey"],
        value["fontStreamSha256"],
    )


def resource_glyph_identity(value: dict) -> tuple[str, str, str, int, str]:
    return (
        value["fontResourceTag"],
        value["fontStreamKey"],
        value["fontStreamSha256"],
        int(value.get("rawCodeHex", value.get("originalCharCodeHex")), 16),
        value["glyphName"],
    )


def write_variant_pdf_v2(source_path: str, resources: list[dict], mappings: list[dict]) -> bytes:
    resource_by_tag = {resource["fontResourceTag"]: resource for resource in resources}
    writer = PdfWriter(source_path, incremental=True, strict=False)
    changed_fonts = set()
    for page in writer.pages:
        resources_dictionary = page.get("/Resources", {})
        resources_dictionary = resources_dictionary.get_object() if hasattr(resources_dictionary, "get_object") else resources_dictionary
        fonts = resources_dictionary.get("/Font", {})
        fonts = fonts.get_object() if hasattr(fonts, "get_object") else fonts
        for tag, resource in resource_by_tag.items():
            reference = fonts.get(tag)
            if reference is None:
                continue
            key = object_key(reference)
            if key in changed_fonts:
                continue
            changed_fonts.add(key)
            font = reference.get_object()
            stream_sha, _stream_bytes = font_stream_identity(font, resource["fontStreamKey"])
            if stream_sha != resource["fontStreamSha256"]:
                fail("font_stream_hash_mismatch", f"incremental writer {tag} has {stream_sha}")
            resource_mappings = [
                mapping for mapping in mappings
                if resource_identity(mapping) == resource_identity(resource)
            ]
            differences = resource_encoding_glyphs(font, resource, resource_mappings)
            cmap_reference = font.get("/ToUnicode")
            if cmap_reference is None:
                cmap = DecodedStreamObject()
                cmap.set_data(minimal_one_byte_to_unicode_cmap())
                cmap_reference = writer._add_object(cmap)
                font[NameObject("/ToUnicode")] = cmap_reference
            cmap = cmap_reference.get_object()
            applicable = []
            for mapping in resource_mappings:
                code = int(mapping_code_hex(mapping), 16)
                if mapping["glyphName"] == differences.get(code):
                    applicable.append(mapping)
            cmap.set_data(cmap_with_mappings(cmap.get_data(), applicable))
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def selected_engine(payload: dict, *, require_explicit: bool) -> tuple[str, str]:
    selected = payload.get("selectedEngine")
    if selected is None and not require_explicit:
        return "pymupdf", pymupdf.__version__
    if not isinstance(selected, dict) or selected.get("name") not in {"pypdf", "pymupdf"}:
        fail("selected_engine_invalid", repr(selected))
    name = selected["name"]
    version = selected.get("version")
    installed = pypdf.__version__ if name == "pypdf" else pymupdf.__version__
    if version != installed:
        fail("selected_engine_version_mismatch", f"requested {name} {version}; installed {installed}")
    return name, version


def extract_selected_pages(source, engine_name: str) -> list[str]:
    if engine_name == "pypdf":
        reader = PdfReader(io.BytesIO(source), strict=False) if isinstance(source, (bytes, bytearray)) else PdfReader(source, strict=False)
        return [(page.extract_text() or "") for page in reader.pages]
    document = pymupdf.open(stream=source, filetype="pdf") if isinstance(source, (bytes, bytearray)) else pymupdf.open(source)
    try:
        return [(page.get_text() or "") for page in document]
    finally:
        document.close()


def geometry_key(entry: dict, character: str | None = None) -> tuple:
    return (
        character if character is not None else entry["character"],
        tuple(entry["bbox"]),
        tuple(entry["origin"]),
        entry["font"],
    )


def transformed_offset(offset: int, edits: list[dict]) -> int | None:
    delta = 0
    for edit in edits:
        if offset < edit["start"]:
            break
        if edit["start"] <= offset < edit["end"]:
            return None
        delta += len(edit["replacement"]) - (edit["end"] - edit["start"])
    return offset + delta


def build_v1(payload: dict) -> dict:
    source_path = payload["sourcePath"]
    base_pages = payload["basePages"]
    strategy = payload["repairSpec"]["strategy"]
    selected_name, selected_version = selected_engine(payload, require_explicit=False)
    if selected_name != "pymupdf":
        fail("selected_engine_requires_strategy_v2", "pypdf replay requires ordered-resources strategy v2")
    resource = strategy["resource"]
    mappings = strategy["glyphMap"]
    composites = strategy.get("compositeGlyphMap", [])
    target_tag = resource["fontResourceTag"]
    expected_stream_key = resource["fontStreamKey"]
    expected_stream_sha = resource["fontStreamSha256"]

    if not mappings:
        fail("glyph_map_empty", "at least one explicitly authorized mapping is required")

    logging.getLogger("pypdf").setLevel(logging.ERROR)
    reader = PdfReader(source_path, strict=False)
    if len(reader.pages) != len(base_pages):
        fail("base_page_count_mismatch", f"source has {len(reader.pages)} pages; base has {len(base_pages)}")

    font_objects: dict[str, dict] = {}
    aliases: defaultdict[str, set[str]] = defaultdict(set)
    page_fonts: dict[int, tuple] = {}
    crop_boxes: dict[int, list[float]] = {}
    for page_number, page in enumerate(reader.pages, 1):
        crop_boxes[page_number] = [round(float(value), 6) for value in page.cropbox]
        fonts = page.get("/Resources", {}).get("/Font", {})
        for tag, reference in fonts.items():
            aliases[object_key(reference)].add(str(tag))
        reference = fonts.get(target_tag)
        if reference is None:
            continue
        font = reference.get_object()
        key = object_key(reference)
        stream_sha, stream_bytes = font_stream_identity(font, expected_stream_key)
        if stream_sha != expected_stream_sha:
            fail(
                "font_stream_hash_mismatch",
                f"page {page_number} {target_tag} has {stream_sha}; expected {expected_stream_sha}",
            )
        differences = encoding_differences(font)
        page_fonts[page_number] = (reference, font, key, differences, stream_bytes)
        cmap_reference = font.get("/ToUnicode")
        if cmap_reference is None:
            fail("to_unicode_stream_missing", f"font object {key} has no /ToUnicode stream")
        cmap = cmap_reference.get_object()
        font_objects[key] = {
            "reference": reference,
            "font": font,
            "differences": differences,
            "streamBytes": stream_bytes,
            "cmap": cmap,
            "cmapBytes": cmap.get_data(),
        }

    if not page_fonts:
        fail("font_resource_missing", f"no page exposes the exact resource tag {target_tag}")
    for key in font_objects:
        if aliases[key] != {target_tag}:
            fail("font_resource_alias", f"target font object {key} is also exposed as {sorted(aliases[key])}")

    mapping_index = {}
    for mapping in mappings:
        if mapping.get("fontResourceTag") != target_tag or mapping.get("fontStreamSha256") != expected_stream_sha:
            fail("mapping_resource_mismatch", repr(mapping.get("charCodeHex")))
        if not re.fullmatch(r"[0-9A-Fa-f]{2}", str(mapping.get("charCodeHex", ""))):
            fail("mapping_character_code_invalid", repr(mapping.get("charCodeHex")))
        if len(mapping.get("unicode", "")) != 1:
            fail("mapping_unicode_invalid", "each mapping must contain exactly one Unicode scalar")
        expected_point = f"U+{ord(mapping['unicode']):04X}"
        if mapping.get("unicodeCodePoint") != expected_point:
            fail("mapping_unicode_codepoint_invalid", repr(mapping.get("charCodeHex")))
        code = int(mapping["charCodeHex"], 16)
        key = (
            mapping["fontResourceTag"],
            mapping["fontStreamSha256"],
            code,
            mapping["glyphName"],
        )
        if key in mapping_index:
            fail("duplicate_glyph_mapping", repr(key))
        mapping_index[key] = mapping

    composite_index = {}
    overlay_to_composite = {}
    for composite in composites:
        if composite.get("name") != "zero-width-overlay-prefix" or composite.get("version") != 1:
            fail("composite_strategy_invalid", "only zero-width-overlay-prefix v1 is supported")
        composite_id = composite.get("id")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", str(composite_id or "")):
            fail("composite_id_invalid", repr(composite_id))
        if composite_id in composite_index:
            fail("duplicate_composite_id", composite_id)
        overlay_key = glyph_identity(composite["overlay"])
        anchor_key = glyph_identity(composite["anchor"])
        if overlay_key[:2] != (target_tag, expected_stream_sha) or anchor_key[:2] != (target_tag, expected_stream_sha):
            fail("composite_resource_mismatch", composite_id)
        if overlay_key in mapping_index:
            fail("composite_overlay_simple_mapping_conflict", composite_id)
        anchor_mapping = mapping_index.get(anchor_key)
        if anchor_mapping is None:
            fail("composite_anchor_mapping_missing", composite_id)
        if len(composite.get("unicode", "")) != 1:
            fail("composite_unicode_invalid", composite_id)
        expected_point = f"U+{ord(composite['unicode']):04X}"
        if composite.get("unicodeCodePoint") != expected_point:
            fail("composite_unicode_codepoint_invalid", composite_id)
        placement = composite.get("placement", {})
        if (
            placement.get("requireSingleByteTj") is not True
            or not isinstance(placement.get("maxContentOperatorGap"), int)
            or placement["maxContentOperatorGap"] < 1
            or not isinstance(placement.get("maxAbsBaselineDelta"), (int, float))
            or placement["maxAbsBaselineDelta"] < 0
            or not isinstance(placement.get("maxAbsOriginDelta"), (int, float))
            or placement["maxAbsOriginDelta"] <= 0
            or placement.get("requireOverlayAdvanceWidth") != 0
        ):
            fail("composite_placement_invalid", composite_id)
        transform = composite.get("textTransform", {})
        expected_text = transform.get("expected", "")
        replacement = transform.get("replacement", "")
        offsets = [
            transform.get("overlayScalarOffset"),
            transform.get("anchorScalarOffset"),
            transform.get("compositeScalarOffset"),
        ]
        if (
            not expected_text
            or len(expected_text) > 8
            or not replacement
            or len(replacement) > 8
            or any(not isinstance(value, int) or value < 0 for value in offsets)
            or offsets[0] >= len(expected_text)
            or offsets[1] >= len(expected_text)
            or offsets[2] >= len(replacement)
            or expected_text[offsets[1]] != anchor_mapping["unicode"]
            or replacement[offsets[2]] != composite["unicode"]
            or replacement.strip() != composite["unicode"]
        ):
            fail("composite_text_transform_invalid", composite_id)
        occurrences = composite.get("expectedOccurrences")
        if not isinstance(occurrences, list) or not occurrences:
            fail("composite_occurrences_missing", composite_id)
        if overlay_key in overlay_to_composite:
            fail("composite_overlay_reused", repr(overlay_key))
        overlay_to_composite[overlay_key] = composite
        composite_index[composite_id] = composite

    events = []
    observed = Counter()
    observed_pages: defaultdict[tuple, set[int]] = defaultdict(set)
    events_by_identity_page: defaultdict[tuple, list[dict]] = defaultdict(list)
    operator_names = {b"Tj", b"TJ", b"'", b'"'}
    for page_number, page in enumerate(reader.pages, 1):
        if page_number not in page_fonts:
            continue
        reference, font, key, differences, stream_bytes = page_fonts[page_number]
        content = ContentStream(page.get_contents(), reader)
        current_font = ""
        current_font_size = None
        current_text_matrix = None
        for operation_index, (operands, operator) in enumerate(content.operations):
            if operator == b"BT":
                current_font = ""
                current_font_size = None
                current_text_matrix = None
                continue
            if operator == b"ET":
                current_font = ""
                current_font_size = None
                current_text_matrix = None
                continue
            if operator == b"Tm":
                if len(operands) != 6:
                    fail("text_matrix_invalid", f"page {page_number} operation {operation_index}")
                current_text_matrix = [round(float(value), 6) for value in operands]
                continue
            if operator == b"Tf":
                current_font = str(operands[0])
                current_font_size = round(float(operands[1]), 6)
                continue
            if current_font != target_tag or operator not in operator_names:
                continue
            for operand_index, value in text_operands(operands, operator):
                raw = original_bytes(value)
                for byte_offset, code in enumerate(raw):
                    glyph_name = differences.get(code)
                    observed_key = (code, glyph_name or "")
                    observed[observed_key] += 1
                    observed_pages[observed_key].add(page_number)
                    lookup = (target_tag, expected_stream_sha, code, glyph_name)
                    mapping = mapping_index.get(lookup)
                    composite = overlay_to_composite.get(lookup)
                    event = {
                        "page": page_number,
                        "contentOperatorIndex": operation_index,
                        "textOperator": operator.decode("latin-1"),
                        "stringOperandIndex": operand_index,
                        "byteOffset": byte_offset,
                        "rawStringByteLength": len(raw),
                        "fontResourceTag": target_tag,
                        "fontObject": key,
                        "fontStreamKey": expected_stream_key,
                        "fontStreamSha256": expected_stream_sha,
                        "originalCharCodeHex": f"{code:02X}",
                        "glyphName": glyph_name,
                        "fontAdvanceWidth": font_advance_width(font, code),
                        "fontSizeOperand": current_font_size,
                        "textMatrix": current_text_matrix,
                        "mappingStatus": "mapped" if (mapping or composite) else "unmapped",
                        "mappingKind": "simple" if mapping else ("composite-component" if composite else "unmapped"),
                    }
                    if mapping:
                        event["mappedUnicode"] = mapping["unicode"]
                        event["mappedUnicodeCodePoint"] = mapping["unicodeCodePoint"]
                    elif composite:
                        event["compositeId"] = composite["id"]
                    events_by_identity_page[(lookup, page_number)].append(event)
                    events.append(event)

    for mapping in mappings:
        matching = [
            event
            for event in events
            if event["originalCharCodeHex"] == mapping["charCodeHex"].upper()
            and event["glyphName"] == mapping["glyphName"]
            and event["fontResourceTag"] == mapping["fontResourceTag"]
            and event["fontStreamSha256"] == mapping["fontStreamSha256"]
        ]
        if not matching:
            fail(
                "authorized_mapping_not_observed",
                f"{mapping['fontResourceTag']} 0x{mapping['charCodeHex']} {mapping['glyphName']}",
            )

    recognized_identities = list(mapping_index)
    for overlay_key in overlay_to_composite:
        if overlay_key not in recognized_identities:
            recognized_identities.append(overlay_key)
    if len(recognized_identities) > 256:
        fail("diagnostic_marker_capacity_exceeded", str(len(recognized_identities)))
    marker_by_identity = {
        identity: chr(0xE000 + index)
        for index, identity in enumerate(recognized_identities)
    }
    diagnostic_mappings = []
    for identity, marker in marker_by_identity.items():
        diagnostic_mappings.append(
            {
                "fontResourceTag": identity[0],
                "fontStreamSha256": identity[1],
                "charCodeHex": f"{identity[2]:02X}",
                "glyphName": identity[3],
                "unicode": marker,
                "unicodeCodePoint": f"U+{ord(marker):04X}",
            }
        )

    standard_pdf_bytes = write_variant_pdf(reader, font_objects, mappings)
    diagnostic_pdf_bytes = write_variant_pdf(reader, font_objects, diagnostic_mappings)

    original_document = pymupdf.open(source_path)
    repaired_document = pymupdf.open(stream=standard_pdf_bytes, filetype="pdf")
    diagnostic_document = pymupdf.open(stream=diagnostic_pdf_bytes, filetype="pdf")
    try:
        page_state = {}
        for page_index in range(original_document.page_count):
            page_number = page_index + 1
            base_text = base_pages[page_index]["text"]
            original_text = original_document[page_index].get_text() or ""
            if original_text != base_text:
                fail(
                    "base_engine_reproduction_mismatch",
                    f"page {page_number} no longer reproduces the production pages artifact",
                )
            candidate_text = repaired_document[page_index].get_text() or ""
            if len(candidate_text) != len(base_text):
                fail("layout_text_length_changed", f"page {page_number} changed text length")
            text_diffs = [
                {"unicodeScalarOffset": index, "baseCharacter": left, "candidateCharacter": right}
                for index, (left, right) in enumerate(zip(base_text, candidate_text))
                if left != right
            ]

            original_chars, original_raw_text = flatten_raw_chars(original_document[page_index])
            repaired_chars, repaired_raw_text = flatten_raw_chars(repaired_document[page_index])
            diagnostic_chars, diagnostic_raw_text = flatten_raw_chars(diagnostic_document[page_index])
            bind_page_text_offsets(original_chars, original_raw_text, original_text, page_number)
            bind_page_text_offsets(repaired_chars, repaired_raw_text, candidate_text, page_number)
            diagnostic_text = diagnostic_document[page_index].get_text() or ""
            bind_page_text_offsets(diagnostic_chars, diagnostic_raw_text, diagnostic_text, page_number)
            if len(original_chars) != len(repaired_chars):
                fail("layout_character_count_changed", f"page {page_number} raw character count changed")
            render_diffs = []
            for char_offset, (left, right) in enumerate(zip(original_chars, repaired_chars)):
                if left["character"] == right["character"]:
                    if not bbox_equal(left["bbox"], right["bbox"]):
                        fail("layout_bbox_changed", f"page {page_number} unchanged character bbox moved")
                    continue
                if not bbox_equal(left["bbox"], right["bbox"]):
                    fail("mapped_glyph_bbox_changed", f"page {page_number} repaired glyph bbox moved")
                render_diffs.append(
                    {
                        "renderCharacterOffset": char_offset,
                        "baseCharacter": left["character"],
                        "candidateCharacter": right["character"],
                        "bbox": right["bbox"],
                        "origin": right["origin"],
                        "rendererFontLabel": right["font"],
                    }
                )

            page_state[page_number] = {
                "baseText": base_text,
                "standardText": candidate_text,
                "textDiffs": text_diffs,
                "renderDiffs": render_diffs,
                "originalChars": original_chars,
                "standardChars": repaired_chars,
                "diagnosticChars": diagnostic_chars,
            }

        for identity, marker in marker_by_identity.items():
            for page_number in range(1, original_document.page_count + 1):
                source_events = events_by_identity_page.get((identity, page_number), [])
                marker_chars = [
                    (index, entry)
                    for index, entry in enumerate(page_state[page_number]["diagnosticChars"])
                    if entry["character"] == marker
                ]
                if len(source_events) != len(marker_chars):
                    fail(
                        "diagnostic_marker_alignment_failed",
                        f"page {page_number} {identity[2]:02X}: source={len(source_events)}, markers={len(marker_chars)}",
                    )
                for event, (marker_index, marker_entry) in zip(source_events, marker_chars):
                    event.update(
                        {
                            "diagnosticMarkerCodePoint": f"U+{ord(marker):04X}",
                            "diagnosticTextUnicodeScalarOffset": marker_entry["pageTextUnicodeScalarOffset"],
                            "diagnosticRenderCharacterOffset": marker_index,
                            "diagnosticBbox": marker_entry["bbox"],
                            "diagnosticOrigin": marker_entry["origin"],
                            "rendererFontLabelObservation": marker_entry["font"],
                        }
                    )

        simple_provenance_by_key = {}
        for event in events:
            if event["mappingKind"] != "simple":
                continue
            state = page_state[event["page"]]
            marker_geometry = (
                event["diagnosticBbox"],
                event["diagnosticOrigin"],
                event["rendererFontLabelObservation"],
            )
            original_matches = [
                (index, entry) for index, entry in enumerate(state["originalChars"])
                if (entry["bbox"], entry["origin"], entry["font"]) == marker_geometry
            ]
            standard_matches = [
                (index, entry) for index, entry in enumerate(state["standardChars"])
                if entry["character"] == event["mappedUnicode"]
                and (entry["bbox"], entry["origin"], entry["font"]) == marker_geometry
            ]
            if len(original_matches) != 1 or len(standard_matches) != 1:
                fail(
                    "simple_mapping_geometry_alignment_failed",
                    f"page {event['page']} operation {event['contentOperatorIndex']}: original={len(original_matches)}, candidate={len(standard_matches)}",
                )
            original_index, original_entry = original_matches[0]
            standard_index, standard_entry = standard_matches[0]
            event.update(
                {
                    "mappingMode": "verified-noop" if original_entry["character"] == event["mappedUnicode"] else "substitution",
                    "baseExtractedCharacter": original_entry["character"],
                    "baseTextUnicodeScalarOffset": original_entry["pageTextUnicodeScalarOffset"],
                    "standardCandidateTextUnicodeScalarOffset": standard_entry["pageTextUnicodeScalarOffset"],
                    "standardRenderCharacterOffset": standard_index,
                    "bbox": standard_entry["bbox"],
                    "origin": standard_entry["origin"],
                }
            )
            simple_provenance_by_key[source_event_key(event)] = event

        expected_text_diffs = []
        expected_render_diffs = []
        for event in simple_provenance_by_key.values():
            if event["mappingMode"] != "substitution":
                continue
            expected_text_diffs.append(
                (
                    event["page"],
                    event["standardCandidateTextUnicodeScalarOffset"],
                    event["baseExtractedCharacter"],
                    event["mappedUnicode"],
                )
            )
            expected_render_diffs.append(
                (
                    event["page"],
                    event["standardRenderCharacterOffset"],
                    event["baseExtractedCharacter"],
                    event["mappedUnicode"],
                    tuple(event["bbox"]),
                )
            )
        actual_text_diffs = [
            (page, item["unicodeScalarOffset"], item["baseCharacter"], item["candidateCharacter"])
            for page, state in page_state.items() for item in state["textDiffs"]
        ]
        actual_render_diffs = [
            (page, item["renderCharacterOffset"], item["baseCharacter"], item["candidateCharacter"], tuple(item["bbox"]))
            for page, state in page_state.items() for item in state["renderDiffs"]
        ]
        if sorted(expected_text_diffs) != sorted(actual_text_diffs):
            fail("simple_mapping_text_diff_alignment_failed", "standard extraction contains an unauthorized text change")
        if sorted(expected_render_diffs) != sorted(actual_render_diffs):
            fail("simple_mapping_render_diff_alignment_failed", "standard extraction contains an unauthorized renderer change")

        event_by_page_operation = defaultdict(list)
        for event in events:
            event_by_page_operation[(event["page"], event["contentOperatorIndex"])].append(event)
        composite_edits_by_page: defaultdict[int, list[dict]] = defaultdict(list)
        composite_provenance = []
        used_component_keys = set()
        for composite in composites:
            overlay_identity = glyph_identity(composite["overlay"])
            anchor_identity = glyph_identity(composite["anchor"])
            declared_overlay_keys = set()
            for occurrence_index, occurrence in enumerate(composite["expectedOccurrences"]):
                page_number = occurrence["page"]
                overlay_candidates = event_by_page_operation[(page_number, occurrence["overlayContentOperatorIndex"])]
                anchor_candidates = event_by_page_operation[(page_number, occurrence["anchorContentOperatorIndex"])]
                overlay_events = [event for event in overlay_candidates if glyph_identity(event) == overlay_identity]
                anchor_events = [event for event in anchor_candidates if glyph_identity(event) == anchor_identity]
                if len(overlay_events) != 1 or len(anchor_events) != 1:
                    fail("composite_occurrence_not_found", f"{composite['id']} occurrence {occurrence_index}")
                overlay_event = overlay_events[0]
                anchor_event = anchor_events[0]
                overlay_key = source_event_key(overlay_event)
                anchor_key = source_event_key(anchor_event)
                if overlay_key in used_component_keys or anchor_key in used_component_keys:
                    fail("composite_component_reused", f"{composite['id']} occurrence {occurrence_index}")
                used_component_keys.update([overlay_key, anchor_key])
                declared_overlay_keys.add(overlay_key)
                placement = composite["placement"]
                operator_gap = anchor_event["contentOperatorIndex"] - overlay_event["contentOperatorIndex"]
                if (
                    overlay_event["textOperator"] != "Tj"
                    or anchor_event["textOperator"] != "Tj"
                    or overlay_event["rawStringByteLength"] != 1
                    or anchor_event["rawStringByteLength"] != 1
                    or overlay_event["byteOffset"] != 0
                    or anchor_event["byteOffset"] != 0
                    or operator_gap < 1
                    or operator_gap > placement["maxContentOperatorGap"]
                ):
                    fail("composite_source_order_invalid", f"{composite['id']} occurrence {occurrence_index}")
                overlay_matrix = overlay_event.get("textMatrix")
                anchor_matrix = anchor_event.get("textMatrix")
                if not isinstance(overlay_matrix, list) or len(overlay_matrix) != 6 or not isinstance(anchor_matrix, list) or len(anchor_matrix) != 6:
                    fail("composite_text_matrix_missing", f"{composite['id']} occurrence {occurrence_index}")
                for expected_field, observed_matrix in [
                    ("overlayTextMatrix", overlay_matrix),
                    ("anchorTextMatrix", anchor_matrix),
                ]:
                    expected_matrix = occurrence.get(expected_field)
                    if not isinstance(expected_matrix, list) or len(expected_matrix) != 6 or any(
                        abs(float(left) - float(right)) > 0.000001
                        for left, right in zip(expected_matrix, observed_matrix)
                    ):
                        fail("composite_expected_text_matrix_mismatch", f"{composite['id']} occurrence {occurrence_index} {expected_field}")
                if any(abs(overlay_matrix[index] - anchor_matrix[index]) > 0.000001 for index in range(4)):
                    fail("composite_text_matrix_scale_mismatch", f"{composite['id']} occurrence {occurrence_index}")
                origin_delta = [
                    round(anchor_matrix[4] - overlay_matrix[4], 6),
                    round(anchor_matrix[5] - overlay_matrix[5], 6),
                ]
                if abs(origin_delta[0]) > placement["maxAbsOriginDelta"] or abs(origin_delta[1]) > placement["maxAbsBaselineDelta"]:
                    fail("composite_text_matrix_delta_exceeded", f"{composite['id']} occurrence {occurrence_index}: {origin_delta}")
                if overlay_event["fontAdvanceWidth"] != placement["requireOverlayAdvanceWidth"]:
                    fail("composite_overlay_advance_width_mismatch", f"{composite['id']} occurrence {occurrence_index}")
                transform = composite["textTransform"]
                anchor_standard_offset = anchor_event["standardCandidateTextUnicodeScalarOffset"]
                start = anchor_standard_offset - transform["anchorScalarOffset"]
                end = start + len(transform["expected"])
                standard_text = page_state[page_number]["standardText"]
                if start < 0 or standard_text[start:end] != transform["expected"]:
                    fail("composite_expected_text_sequence_mismatch", f"{composite['id']} occurrence {occurrence_index}")
                overlay_standard_offset = start + transform["overlayScalarOffset"]
                overlay_text_matches = [
                    (index, entry) for index, entry in enumerate(page_state[page_number]["standardChars"])
                    if entry["pageTextUnicodeScalarOffset"] == overlay_standard_offset
                    and entry["character"] == transform["expected"][transform["overlayScalarOffset"]]
                ]
                if len(overlay_text_matches) != 1:
                    fail("composite_overlay_text_provenance_missing", f"{composite['id']} occurrence {occurrence_index}")
                overlay_render_index, overlay_source_entry = overlay_text_matches[0]
                overlay_event.update(
                    {
                        "mappingKind": "composite-component",
                        "compositeId": composite["id"],
                        "compositeRole": "overlay",
                        "baseExtractedCharacter": overlay_source_entry["character"],
                        "baseTextUnicodeScalarOffset": overlay_standard_offset,
                        "standardCandidateTextUnicodeScalarOffset": overlay_standard_offset,
                        "standardRenderCharacterOffset": overlay_render_index,
                        "sourceExtractedBbox": overlay_source_entry["bbox"],
                        "sourceExtractedOrigin": overlay_source_entry["origin"],
                        "bbox": overlay_event["diagnosticBbox"],
                        "origin": overlay_event["diagnosticOrigin"],
                    }
                )
                anchor_event.update(
                    {
                        "mappingKind": "composite-component",
                        "compositeId": composite["id"],
                        "compositeRole": "anchor",
                    }
                )
                edit = {
                    "page": page_number,
                    "compositeId": composite["id"],
                    "occurrenceIndex": occurrence_index,
                    "start": start,
                    "end": end,
                    "replacement": transform["replacement"],
                    "expected": transform["expected"],
                    "compositeScalarOffset": transform["compositeScalarOffset"],
                    "unicode": composite["unicode"],
                    "unicodeCodePoint": composite["unicodeCodePoint"],
                    "overlayEvent": overlay_event,
                    "anchorEvent": anchor_event,
                    "operatorGap": operator_gap,
                    "textMatrixOriginDelta": origin_delta,
                }
                composite_edits_by_page[page_number].append(edit)
            observed_overlay_keys = {
                source_event_key(event)
                for event in events
                if glyph_identity(event) == overlay_identity
            }
            if observed_overlay_keys != declared_overlay_keys:
                fail(
                    "composite_occurrence_coverage_mismatch",
                    f"{composite['id']}: observed={len(observed_overlay_keys)}, declared={len(declared_overlay_keys)}",
                )

        candidate_pages = []
        for page_number, state in page_state.items():
            edits = sorted(composite_edits_by_page.get(page_number, []), key=lambda item: item["start"])
            for previous, current in zip(edits, edits[1:]):
                if previous["end"] > current["start"]:
                    fail("composite_text_edits_overlap", f"page {page_number}")
            candidate_text = state["standardText"]
            delta = 0
            for edit in edits:
                final_start = edit["start"] + delta
                final_end = edit["end"] + delta
                if candidate_text[final_start:final_end] != edit["expected"]:
                    fail("composite_precommit_text_drift", f"page {page_number} {edit['compositeId']}")
                candidate_text = candidate_text[:final_start] + edit["replacement"] + candidate_text[final_end:]
                candidate_offset = final_start + edit["compositeScalarOffset"]
                if candidate_text[candidate_offset] != edit["unicode"]:
                    fail("composite_candidate_character_missing", f"page {page_number} {edit['compositeId']}")
                edit["candidateTextUnicodeScalarOffset"] = candidate_offset
                delta += len(edit["replacement"]) - (edit["end"] - edit["start"])
            candidate_pages.append({"page": page_number, "text": candidate_text})
            if any(marker in candidate_text for marker in marker_by_identity.values()):
                fail("diagnostic_marker_leaked", f"page {page_number}")

        edits_flat = [edit for edits in composite_edits_by_page.values() for edit in edits]
        edits_by_component_key = {}
        for edit in edits_flat:
            for role in ["overlayEvent", "anchorEvent"]:
                event = edit[role]
                edits_by_component_key[source_event_key(event)] = edit
                event["candidateCharacter"] = edit["unicode"]
                event["unicode"] = edit["unicode"]
                event["unicodeCodePoint"] = edit["unicodeCodePoint"]
                event["candidateTextUnicodeScalarOffset"] = edit["candidateTextUnicodeScalarOffset"]

        for event in events:
            if event["mappingStatus"] != "mapped" or event["mappingKind"] == "composite-component":
                continue
            page_edits = sorted(composite_edits_by_page.get(event["page"], []), key=lambda item: item["start"])
            final_offset = transformed_offset(event["standardCandidateTextUnicodeScalarOffset"], page_edits)
            if final_offset is None:
                fail("simple_mapping_consumed_without_composite_role", repr(source_event_key(event)))
            candidate_text = candidate_pages[event["page"] - 1]["text"]
            if candidate_text[final_offset] != event["mappedUnicode"]:
                fail("simple_mapping_final_offset_mismatch", repr(source_event_key(event)))
            event["candidateCharacter"] = event["mappedUnicode"]
            event["unicode"] = event["mappedUnicode"]
            event["unicodeCodePoint"] = event["mappedUnicodeCodePoint"]
            event["candidateTextUnicodeScalarOffset"] = final_offset
            event["renderCharacterOffset"] = event["standardRenderCharacterOffset"]

        provenance = []
        page_ordinals = defaultdict(int)
        for event in events:
            if event["mappingStatus"] != "mapped":
                continue
            if event["mappingKind"] == "composite-component":
                if event["compositeRole"] == "overlay":
                    event["renderCharacterOffset"] = event["diagnosticRenderCharacterOffset"]
                else:
                    event["renderCharacterOffset"] = event["standardRenderCharacterOffset"]
            ordinal = page_ordinals[event["page"]]
            page_ordinals[event["page"]] += 1
            provenance.append({**event, "pageEventOrdinal": ordinal})

        for edit in edits_flat:
            overlay_event = edit["overlayEvent"]
            anchor_event = edit["anchorEvent"]
            composite_provenance.append(
                {
                    "id": edit["compositeId"],
                    "occurrenceIndex": edit["occurrenceIndex"],
                    "page": edit["page"],
                    "unicode": edit["unicode"],
                    "unicodeCodePoint": edit["unicodeCodePoint"],
                    "candidateTextUnicodeScalarOffset": edit["candidateTextUnicodeScalarOffset"],
                    "standardTextRange": [edit["start"], edit["end"]],
                    "standardTextSequence": page_state[edit["page"]]["standardText"][edit["start"]:edit["end"]],
                    "replacementText": edit["replacement"],
                    "contentOperatorGap": edit["operatorGap"],
                    "textMatrixOriginDelta": edit["textMatrixOriginDelta"],
                    "components": [
                        {
                            "role": "overlay",
                            "sourceEventKey": "|".join(map(str, source_event_key(overlay_event))),
                            "contentOperatorIndex": overlay_event["contentOperatorIndex"],
                            "textMatrix": overlay_event["textMatrix"],
                            "fontAdvanceWidth": overlay_event["fontAdvanceWidth"],
                            "baseTextUnicodeScalarOffset": overlay_event["baseTextUnicodeScalarOffset"],
                            "baseExtractedCharacter": overlay_event["baseExtractedCharacter"],
                            "sourceExtractedBbox": overlay_event["sourceExtractedBbox"],
                            "diagnosticTextUnicodeScalarOffset": overlay_event["diagnosticTextUnicodeScalarOffset"],
                            "diagnosticRenderCharacterOffset": overlay_event["diagnosticRenderCharacterOffset"],
                            "bbox": overlay_event["bbox"],
                            "origin": overlay_event["origin"],
                        },
                        {
                            "role": "anchor",
                            "sourceEventKey": "|".join(map(str, source_event_key(anchor_event))),
                            "contentOperatorIndex": anchor_event["contentOperatorIndex"],
                            "textMatrix": anchor_event["textMatrix"],
                            "fontAdvanceWidth": anchor_event["fontAdvanceWidth"],
                            "baseTextUnicodeScalarOffset": anchor_event["baseTextUnicodeScalarOffset"],
                            "baseExtractedCharacter": anchor_event["baseExtractedCharacter"],
                            "standardCandidateTextUnicodeScalarOffset": anchor_event["standardCandidateTextUnicodeScalarOffset"],
                            "standardRenderCharacterOffset": anchor_event["standardRenderCharacterOffset"],
                            "bbox": anchor_event["bbox"],
                            "origin": anchor_event["origin"],
                        },
                    ],
                }
            )

        observed_glyphs = []
        unmapped_glyphs = []
        events_by_identity = defaultdict(list)
        for event in events:
            events_by_identity[glyph_identity(event)].append(event)
        for (code, glyph_name), count in sorted(observed.items()):
            identity = (target_tag, expected_stream_sha, code, glyph_name or None)
            matching_events = events_by_identity[identity]
            mapped_count = sum(event["mappingStatus"] == "mapped" for event in matching_events)
            mapping_kinds = Counter(
                event["mappingKind"] for event in matching_events if event["mappingStatus"] == "mapped"
            )
            item = {
                "fontResourceTag": target_tag,
                "fontStreamSha256": expected_stream_sha,
                "originalCharCodeHex": f"{code:02X}",
                "glyphName": glyph_name or None,
                "count": count,
                "pages": sorted(observed_pages[(code, glyph_name)]),
                "mappingStatus": "mapped" if mapped_count == count else ("partially-mapped" if mapped_count else "unmapped"),
                "mappedCount": mapped_count,
                "mappingKinds": dict(sorted(mapping_kinds.items())),
            }
            mapping = mapping_index.get(identity)
            composite = overlay_to_composite.get(identity)
            if mapping:
                item["unicode"] = mapping["unicode"]
                item["unicodeCodePoint"] = mapping["unicodeCodePoint"]
            elif composite:
                item["unicode"] = composite["unicode"]
                item["unicodeCodePoint"] = composite["unicodeCodePoint"]
            if mapped_count != count:
                unknown = {
                    **item,
                    "count": count - mapped_count,
                    "pages": sorted({event["page"] for event in matching_events if event["mappingStatus"] != "mapped"}),
                    "reason": "no_explicit_four_tuple_or_occurrence_bound_composite_mapping",
                }
                unmapped_glyphs.append(unknown)
            observed_glyphs.append(item)

        page_requirements = []
        for page_number in range(1, original_document.page_count + 1):
            page_events = [event for event in events if event["page"] == page_number and event["mappingStatus"] == "mapped"]
            if not page_events:
                continue
            page_bboxes = [event["bbox"] for event in page_events]
            has_composite = any(event["mappingKind"] == "composite-component" for event in page_events)
            checks = ["operators", "subscripts", "superscripts", "delimiters", "order"]
            if has_composite:
                checks.extend(["signs", "geometry"])
            page_requirements.append(
                {
                    "page": page_number,
                    "cropBox": crop_boxes[page_number],
                    "bbox": union_bbox(page_bboxes),
                    "affectedBboxes": page_bboxes,
                    "affectedSpanCount": len(page_events),
                    "requiredRegionTypes": ["formula"],
                    "requiredChecks": checks,
                }
            )
    finally:
        original_document.close()
        repaired_document.close()
        diagnostic_document.close()

    return {
        "engine": {
            "name": "pypdf-cmap-overlay+pymupdf-text",
            "pypdfVersion": pypdf.__version__,
            "pymupdfVersion": pymupdf.__version__,
            "selectedTextEngine": selected_name,
            "selectedTextEngineVersion": selected_version,
        },
        "candidatePages": candidate_pages,
        "observedGlyphs": observed_glyphs,
        "unmappedGlyphs": unmapped_glyphs,
        "glyphEvents": events,
        "mappedGlyphProvenance": provenance,
        "compositeGlyphProvenance": composite_provenance,
        "visualReviewRequirements": page_requirements,
        "layoutVerification": {
            "policy": "same-page-count-and-text-order; exact simple mappings plus occurrence-bound zero-width composites; unchanged rendered glyph geometry fixed",
            "basePageCount": len(base_pages),
            "candidatePageCount": len(candidate_pages),
            "mappedEventCount": len(provenance),
            "compositeOccurrenceCount": len(composite_provenance),
            "changedPageCount": len(page_requirements),
        },
    }


def build_v2(payload: dict) -> dict:
    source_path = payload["sourcePath"]
    base_pages = payload["basePages"]
    strategy = payload["repairSpec"]["strategy"]
    selected_name, selected_version = selected_engine(payload, require_explicit=True)
    resources = strategy.get("resources")
    mappings = strategy.get("glyphMap")
    allowed_strategy_fields = {"name", "version", "resources", "glyphMap", "compositeGlyphMap"}
    unsupported_strategy_fields = sorted(set(strategy) - allowed_strategy_fields)
    if unsupported_strategy_fields:
        fail("strategy_fields_unsupported", repr(unsupported_strategy_fields))
    if not isinstance(resources, list) or not resources:
        fail("resources_empty", "ordered resources[] is required")
    if strategy.get("resource") is not None:
        fail("resource_alias_unsupported", "v2 must not carry the v1 resource alias")
    if strategy.get("compositeGlyphMap"):
        fail("occurrence_transcription_unsupported", "v2 composite/occurrence transcription is not implemented")
    if any(strategy.get(field) for field in ["visualRequirements", "figureGeometry", "occurrenceTranscriptions"]) \
        or payload.get("repairSpec", {}).get("visualEvidence", {}).get("visualRequirements"):
        fail("figure_geometry_unsupported", "independent visual/figure/occurrence requirements are not implemented")
    if not isinstance(mappings, list) or not mappings:
        fail("glyph_map_empty", "at least one explicitly authorized mapping is required")

    resource_by_tag = {}
    resource_order = {}
    resource_identities = set()
    for index, resource in enumerate(resources):
        unsupported_resource_fields = sorted(
            set(resource) - {"fontResourceTag", "fontStreamKey", "fontStreamSha256", "encodingEvidence"}
        )
        if unsupported_resource_fields:
            fail("resource_fields_unsupported", repr(unsupported_resource_fields))
        tag = resource.get("fontResourceTag")
        stream_key = resource.get("fontStreamKey")
        stream_sha = resource.get("fontStreamSha256")
        if not re.fullmatch(r"/[A-Za-z0-9_.-]+", str(tag or "")):
            fail("font_resource_tag_invalid", repr(tag))
        if stream_key not in {"/FontFile", "/FontFile2", "/FontFile3"}:
            fail("font_stream_key_invalid", repr(stream_key))
        if not re.fullmatch(r"[a-f0-9]{64}", str(stream_sha or "")):
            fail("font_stream_sha_invalid", repr(stream_sha))
        encoding_evidence = resource.get("encodingEvidence")
        if encoding_evidence is not None:
            if not isinstance(encoding_evidence, dict):
                fail("encoding_evidence_invalid", repr(encoding_evidence))
            unsupported_evidence_fields = sorted(
                set(encoding_evidence) - {"kind", "encodingName", "encodingMapSha256", "cffCharsetSha256"}
            )
            if unsupported_evidence_fields:
                fail("encoding_evidence_fields_unsupported", repr(unsupported_evidence_fields))
            if encoding_evidence.get("kind") != "named-cff":
                fail("encoding_evidence_kind_unsupported", repr(encoding_evidence.get("kind")))
            if encoding_evidence.get("encodingName") not in {"/MacRomanEncoding", "/StandardEncoding"}:
                fail("named_encoding_unsupported", repr(encoding_evidence.get("encodingName")))
            for field in ["encodingMapSha256", "cffCharsetSha256"]:
                if not re.fullmatch(r"[a-f0-9]{64}", str(encoding_evidence.get(field) or "")):
                    fail("encoding_evidence_hash_invalid", field)
        if tag in resource_by_tag:
            fail("font_resource_tag_ambiguous", tag)
        identity = resource_identity(resource)
        if identity in resource_identities:
            fail("font_resource_identity_duplicate", repr(identity))
        resource_by_tag[tag] = resource
        resource_order[identity] = index
        resource_identities.add(identity)

    mapping_index = {}
    for mapping in mappings:
        unsupported_mapping_fields = sorted(
            set(mapping) - {
                "fontResourceTag", "fontStreamKey", "fontStreamSha256", "rawCodeHex",
                "glyphName", "unicode", "unicodeCodePoint", "glyphOutlineSha256",
            }
        )
        if unsupported_mapping_fields:
            fail("mapping_fields_unsupported", repr(unsupported_mapping_fields))
        try:
            identity = resource_identity(mapping)
        except KeyError as error:
            fail("mapping_resource_binding_missing", str(error))
        if identity not in resource_identities:
            fail("mapping_resource_mismatch", repr(identity))
        mapped_resource = resource_by_tag[mapping["fontResourceTag"]]
        outline_sha = mapping.get("glyphOutlineSha256")
        if mapped_resource.get("encodingEvidence") is not None:
            if not re.fullmatch(r"[a-f0-9]{64}", str(outline_sha or "")):
                fail("cff_glyph_outline_hash_missing", repr(identity))
        elif outline_sha is not None:
            fail("glyph_outline_evidence_without_named_encoding", repr(identity))
        raw_code = str(mapping.get("rawCodeHex", ""))
        if not re.fullmatch(r"[0-9A-Fa-f]{2}", raw_code):
            fail("variable_width_code_unsupported", repr(raw_code))
        if not re.fullmatch(r"/[A-Za-z0-9_.-]+", str(mapping.get("glyphName", ""))):
            fail("outline_glyph_evidence_unsupported", repr(mapping.get("glyphName")))
        if len(mapping.get("unicode", "")) != 1:
            fail("mapping_unicode_invalid", "each mapping must contain exactly one Unicode scalar")
        expected_point = f"U+{ord(mapping['unicode']):04X}"
        if mapping.get("unicodeCodePoint") != expected_point:
            fail("mapping_unicode_codepoint_invalid", raw_code)
        glyph_key = resource_glyph_identity(mapping)
        if glyph_key in mapping_index:
            fail("duplicate_glyph_mapping", repr(glyph_key))
        mapping_index[glyph_key] = mapping

    logging.getLogger("pypdf").setLevel(logging.ERROR)
    reader = PdfReader(source_path, strict=False)
    if len(reader.pages) != len(base_pages):
        fail("base_page_count_mismatch", f"source has {len(reader.pages)} pages; base has {len(base_pages)}")

    font_objects: dict[str, dict] = {}
    aliases: defaultdict[str, set[str]] = defaultdict(set)
    cmap_owners: defaultdict[str, set[tuple[str, str, str]]] = defaultdict(set)
    page_fonts: dict[tuple[int, str], dict] = {}
    crop_boxes: dict[int, list[float]] = {}
    seen_resources = set()
    cmap_hashes: defaultdict[tuple[str, str, str], set[str]] = defaultdict(set)
    difference_snapshots: defaultdict[tuple[str, str, str], set[str]] = defaultdict(set)
    for page_number, page in enumerate(reader.pages, 1):
        crop_boxes[page_number] = [round(float(value), 6) for value in page.cropbox]
        resources_dictionary = page.get("/Resources", {})
        resources_dictionary = resources_dictionary.get_object() if hasattr(resources_dictionary, "get_object") else resources_dictionary
        fonts = resources_dictionary.get("/Font", {})
        fonts = fonts.get_object() if hasattr(fonts, "get_object") else fonts
        for tag, reference in fonts.items():
            aliases[object_key(reference)].add(str(tag))
        for tag, resource in resource_by_tag.items():
            reference = fonts.get(tag)
            if reference is None:
                continue
            font = reference.get_object()
            if str(font.get("/Subtype")) == "/Type0":
                fail("variable_width_font_unsupported", f"page {page_number} {tag} is Type0")
            key = object_key(reference)
            stream_sha, stream_bytes = font_stream_identity(font, resource["fontStreamKey"])
            if stream_sha != resource["fontStreamSha256"]:
                fail(
                    "font_stream_hash_mismatch",
                    f"page {page_number} {tag} {resource['fontStreamKey']} has {stream_sha}; expected {resource['fontStreamSha256']}",
                )
            resource_mappings = [
                mapping for mapping in mappings
                if resource_identity(mapping) == resource_identity(resource)
            ]
            differences = resource_encoding_glyphs(font, resource, resource_mappings)
            cmap_reference = font.get("/ToUnicode")
            identity = resource_identity(resource)
            if cmap_reference is None:
                cmap = None
                cmap_bytes = None
                cmap_hashes[identity].add("missing")
            else:
                cmap = cmap_reference.get_object()
                cmap_key = object_key(cmap_reference)
                cmap_owners[cmap_key].add(identity)
                cmap_bytes = cmap.get_data()
                cmap_hashes[identity].add(hashlib.sha256(cmap_bytes).hexdigest())
            difference_snapshots[identity].add(json.dumps(sorted(differences.items()), separators=(",", ":")))
            info = {
                "reference": reference,
                "font": font,
                "resource": resource,
                "differences": differences,
                "streamBytes": stream_bytes,
                "cmap": cmap,
                "cmapBytes": cmap_bytes,
            }
            if key in font_objects:
                previous = font_objects[key]
                if resource_identity(previous["resource"]) != identity or previous["cmapBytes"] != cmap_bytes:
                    fail("font_resource_object_ambiguity", f"font object {key}")
            else:
                font_objects[key] = info
            page_fonts[(page_number, tag)] = info
            seen_resources.add(identity)

    for resource in resources:
        identity = resource_identity(resource)
        if identity not in seen_resources:
            fail("font_resource_missing", f"no page exposes {resource['fontResourceTag']} with the bound stream")
        if len(cmap_hashes[identity]) != 1 or len(difference_snapshots[identity]) != 1:
            fail("to_unicode_cmap_ambiguity", f"resource {resource['fontResourceTag']} is not stable across pages")
    for key, value in font_objects.items():
        expected_tag = value["resource"]["fontResourceTag"]
        if aliases[key] != {expected_tag}:
            fail("font_resource_alias", f"target font object {key} is exposed as {sorted(aliases[key])}")
    for cmap_key, owners in cmap_owners.items():
        if len(owners) != 1:
            fail("to_unicode_cmap_ambiguity", f"ToUnicode stream {cmap_key} is shared by {sorted(owners)}")

    events = []
    observed = Counter()
    observed_pages: defaultdict[tuple, set[int]] = defaultdict(set)
    events_by_identity_page: defaultdict[tuple, list[dict]] = defaultdict(list)
    operator_names = {b"Tj", b"TJ", b"'", b'"'}
    for page_number, page in enumerate(reader.pages, 1):
        content = ContentStream(page.get_contents(), reader)
        current_font = ""
        current_font_size = None
        current_text_matrix = None
        for operation_index, (operands, operator) in enumerate(content.operations):
            if operator == b"BT":
                current_font = ""
                current_font_size = None
                current_text_matrix = None
                continue
            if operator == b"ET":
                current_font = ""
                current_font_size = None
                current_text_matrix = None
                continue
            if operator == b"Tm":
                if len(operands) != 6:
                    fail("text_matrix_invalid", f"page {page_number} operation {operation_index}")
                current_text_matrix = [round(float(value), 6) for value in operands]
                continue
            if operator == b"Tf":
                current_font = str(operands[0])
                current_font_size = round(float(operands[1]), 6)
                continue
            if current_font not in resource_by_tag or operator not in operator_names:
                continue
            info = page_fonts.get((page_number, current_font))
            if info is None:
                fail("page_font_binding_missing", f"page {page_number} {current_font}")
            resource = info["resource"]
            for operand_index, value in text_operands(operands, operator):
                raw = original_bytes(value)
                for byte_offset, code in enumerate(raw):
                    glyph_name = info["differences"].get(code)
                    if not re.fullmatch(r"/[A-Za-z0-9_.-]+", str(glyph_name or "")):
                        fail(
                            "outline_glyph_evidence_unsupported",
                            f"page {page_number} {current_font} raw 0x{code:02X} lacks an explicit glyph name",
                        )
                    identity = (
                        current_font,
                        resource["fontStreamKey"],
                        resource["fontStreamSha256"],
                        code,
                        glyph_name,
                    )
                    mapping = mapping_index.get(identity)
                    observed[identity] += 1
                    observed_pages[identity].add(page_number)
                    event = {
                        "page": page_number,
                        "contentOperatorIndex": operation_index,
                        "textOperator": operator.decode("latin-1"),
                        "stringOperandIndex": operand_index,
                        "byteOffset": byte_offset,
                        "rawStringByteLength": len(raw),
                        "fontResourceTag": current_font,
                        "fontObject": object_key(info["reference"]),
                        "fontStreamKey": resource["fontStreamKey"],
                        "fontStreamSha256": resource["fontStreamSha256"],
                        "rawCodeHex": f"{code:02X}",
                        "rawCodeByteLength": 1,
                        "originalCharCodeHex": f"{code:02X}",
                        "glyphName": glyph_name,
                        "fontAdvanceWidth": font_advance_width(info["font"], code),
                        "fontSizeOperand": current_font_size,
                        "textMatrix": current_text_matrix,
                        "mappingStatus": "mapped" if mapping else "unmapped",
                        "mappingKind": "simple" if mapping else "unmapped",
                    }
                    if mapping:
                        event["mappedUnicode"] = mapping["unicode"]
                        event["mappedUnicodeCodePoint"] = mapping["unicodeCodePoint"]
                    events_by_identity_page[(identity, page_number)].append(event)
                    events.append(event)

    for identity, mapping in mapping_index.items():
        if not any(resource_glyph_identity(event) == identity for event in events):
            fail(
                "authorized_mapping_not_observed",
                f"{mapping['fontResourceTag']} {mapping['fontStreamKey']} 0x{mapping['rawCodeHex']} {mapping['glyphName']}",
            )

    recognized_identities = sorted(
        observed,
        key=lambda item: (resource_order[item[:3]], item[3], item[4]),
    )
    unavailable_markers = {character for page in base_pages for character in page["text"]}
    available_markers = (chr(value) for value in range(0xE000, 0xF900) if chr(value) not in unavailable_markers)
    marker_by_identity = {}
    for identity in recognized_identities:
        try:
            marker_by_identity[identity] = next(available_markers)
        except StopIteration:
            fail("diagnostic_marker_capacity_exceeded", str(len(recognized_identities)))
    diagnostic_mappings = []
    for identity, marker in marker_by_identity.items():
        diagnostic_mappings.append(
            {
                "fontResourceTag": identity[0],
                "fontStreamKey": identity[1],
                "fontStreamSha256": identity[2],
                "rawCodeHex": f"{identity[3]:02X}",
                "glyphName": identity[4],
                "unicode": marker,
                "unicodeCodePoint": f"U+{ord(marker):04X}",
            }
        )

    standard_pdf_bytes = write_variant_pdf_v2(source_path, resources, mappings)
    diagnostic_pdf_bytes = write_variant_pdf_v2(source_path, resources, diagnostic_mappings)
    original_selected_pages = extract_selected_pages(source_path, selected_name)
    repaired_selected_pages = extract_selected_pages(standard_pdf_bytes, selected_name)
    diagnostic_selected_pages = extract_selected_pages(diagnostic_pdf_bytes, selected_name)
    if not (len(original_selected_pages) == len(repaired_selected_pages) == len(diagnostic_selected_pages) == len(base_pages)):
        fail("selected_engine_page_count_changed", selected_name)

    original_document = pymupdf.open(source_path)
    repaired_document = pymupdf.open(stream=standard_pdf_bytes, filetype="pdf")
    diagnostic_document = pymupdf.open(stream=diagnostic_pdf_bytes, filetype="pdf")
    try:
        page_state = {}
        for page_index in range(original_document.page_count):
            page_number = page_index + 1
            if base_pages[page_index].get("page") != page_number:
                fail("base_page_number_mismatch", str(page_number))
            base_text = base_pages[page_index]["text"]
            original_text = original_selected_pages[page_index]
            if original_text != base_text:
                fail(
                    "base_engine_reproduction_mismatch",
                    f"page {page_number} no longer reproduces the production pages artifact with {selected_name}",
                )
            candidate_text = repaired_selected_pages[page_index]
            diagnostic_selected_text = diagnostic_selected_pages[page_index]
            if len(candidate_text) != len(base_text):
                fail("layout_text_length_changed", f"page {page_number} changed selected-engine text length")
            # PyMuPDF can add or remove inferred spaces when the diagnostic
            # CMap substitutes a private-use marker for punctuation, even
            # though the PDF operators and every glyph bbox are unchanged.
            # In that selected-engine mode we bind the production offset below
            # through the uniquely matching original/candidate renderer
            # geometry.  Other engines retain the exact diagnostic-length
            # requirement because their text order cannot be inferred from
            # PyMuPDF geometry.
            if selected_name != "pymupdf" and len(diagnostic_selected_text) != len(base_text):
                fail("layout_text_length_changed", f"page {page_number} changed selected-engine diagnostic text length")
            if any(marker in base_text or marker in candidate_text for marker in marker_by_identity.values()):
                fail("diagnostic_marker_collision", f"page {page_number}")
            text_diffs = [
                {"unicodeScalarOffset": index, "baseCharacter": left, "candidateCharacter": right}
                for index, (left, right) in enumerate(zip(base_text, candidate_text))
                if left != right
            ]

            renderer_original_text = original_document[page_index].get_text() or ""
            renderer_candidate_text = repaired_document[page_index].get_text() or ""
            renderer_diagnostic_text = diagnostic_document[page_index].get_text() or ""
            original_chars, original_raw_text = flatten_raw_chars(original_document[page_index])
            repaired_chars, repaired_raw_text = flatten_raw_chars(repaired_document[page_index])
            diagnostic_chars, diagnostic_raw_text = flatten_raw_chars(diagnostic_document[page_index])
            bind_page_text_offsets(original_chars, original_raw_text, renderer_original_text, page_number)
            bind_page_text_offsets(repaired_chars, repaired_raw_text, renderer_candidate_text, page_number)
            bind_page_text_offsets(diagnostic_chars, diagnostic_raw_text, renderer_diagnostic_text, page_number)
            page_state[page_number] = {
                "baseText": base_text,
                "standardText": candidate_text,
                "diagnosticSelectedText": diagnostic_selected_text,
                "textDiffs": text_diffs,
                "originalChars": original_chars,
                "standardChars": repaired_chars,
                "diagnosticChars": diagnostic_chars,
                "rendererRawCharacterCountBefore": len(original_chars),
                "rendererRawCharacterCountAfter": len(repaired_chars),
            }

        for identity, marker in marker_by_identity.items():
            for page_number in range(1, original_document.page_count + 1):
                source_events = events_by_identity_page.get((identity, page_number), [])
                selected_marker_offsets = [
                    index for index, character in enumerate(page_state[page_number]["diagnosticSelectedText"])
                    if character == marker
                ]
                renderer_marker_chars = [
                    (index, entry)
                    for index, entry in enumerate(page_state[page_number]["diagnosticChars"])
                    if entry["character"] == marker
                ]
                if len(source_events) != len(selected_marker_offsets) or len(source_events) != len(renderer_marker_chars):
                    fail(
                        "diagnostic_marker_alignment_failed",
                        f"page {page_number} {identity[0]} {identity[3]:02X}: source={len(source_events)}, selected={len(selected_marker_offsets)}, renderer={len(renderer_marker_chars)}",
                    )
                for event, selected_offset, (marker_index, marker_entry) in zip(
                    source_events, selected_marker_offsets, renderer_marker_chars
                ):
                    event.update(
                        {
                            "diagnosticMarkerCodePoint": f"U+{ord(marker):04X}",
                            "diagnosticTextUnicodeScalarOffset": selected_offset,
                            "diagnosticRenderTextUnicodeScalarOffset": marker_entry["pageTextUnicodeScalarOffset"],
                            "diagnosticRenderCharacterOffset": marker_index,
                            "diagnosticBbox": marker_entry["bbox"],
                            "diagnosticOrigin": marker_entry["origin"],
                            "rendererFontLabelObservation": marker_entry["font"],
                            "alignmentMode": "resource-identity-page-occurrence-order",
                        }
                    )

        for event in events:
            state = page_state[event["page"]]
            marker_geometry = (
                event["diagnosticBbox"],
                event["diagnosticOrigin"],
                event["rendererFontLabelObservation"],
            )
            original_matches = [
                (index, entry) for index, entry in enumerate(state["originalChars"])
                if (entry["bbox"], entry["origin"], entry["font"]) == marker_geometry
            ]
            standard_matches = [
                (index, entry) for index, entry in enumerate(state["standardChars"])
                if (entry["bbox"], entry["origin"], entry["font"]) == marker_geometry
            ]
            if len(original_matches) != 1 or len(standard_matches) != 1:
                fail(
                    "occurrence_transcription_geometry_ambiguous",
                    f"page {event['page']} operation {event['contentOperatorIndex']}: original={len(original_matches)}, candidate={len(standard_matches)}",
                )
            original_index, original_entry = original_matches[0]
            standard_index, standard_entry = standard_matches[0]
            if not bbox_equal(original_entry["bbox"], standard_entry["bbox"]):
                fail("mapped_glyph_bbox_changed", repr(source_event_key(event)))
            if selected_name == "pymupdf":
                if event["diagnosticTextUnicodeScalarOffset"] != event["diagnosticRenderTextUnicodeScalarOffset"]:
                    fail("diagnostic_selected_renderer_offset_mismatch", repr(source_event_key(event)))
                original_offset = original_entry["pageTextUnicodeScalarOffset"]
                selected_offset = standard_entry["pageTextUnicodeScalarOffset"]
                if original_offset != selected_offset:
                    fail("selected_engine_geometry_offset_changed", repr(source_event_key(event)))
            else:
                selected_offset = event["diagnosticTextUnicodeScalarOffset"]
            base_character = state["baseText"][selected_offset]
            candidate_character = state["standardText"][selected_offset]
            if event["mappingStatus"] == "mapped":
                if candidate_character != event["mappedUnicode"]:
                    fail("simple_mapping_selected_engine_alignment_failed", repr(source_event_key(event)))
            elif candidate_character != base_character:
                fail("unmapped_selected_text_changed", repr(source_event_key(event)))
            if event["mappingStatus"] == "mapped":
                if standard_entry["character"] != event["mappedUnicode"]:
                    fail("simple_mapping_renderer_alignment_failed", repr(source_event_key(event)))
            elif standard_entry["character"] != original_entry["character"]:
                fail("unmapped_renderer_character_changed", repr(source_event_key(event)))
            event.update(
                {
                    "mappingMode": (
                        "unmapped" if event["mappingStatus"] == "unmapped"
                        else ("verified-noop" if base_character == candidate_character else "substitution")
                    ),
                    "rendererMappingMode": (
                        "unmapped" if event["mappingStatus"] == "unmapped"
                        else ("verified-noop" if original_entry["character"] == standard_entry["character"] else "substitution")
                    ),
                    "baseExtractedCharacter": base_character,
                    "candidateCharacter": candidate_character,
                    "baseTextUnicodeScalarOffset": selected_offset,
                    "standardCandidateTextUnicodeScalarOffset": selected_offset,
                    "candidateTextUnicodeScalarOffset": selected_offset,
                    "rendererBaseCharacter": original_entry["character"],
                    "rendererCandidateCharacter": standard_entry["character"],
                    "standardRenderTextUnicodeScalarOffset": standard_entry["pageTextUnicodeScalarOffset"],
                    "standardRenderCharacterOffset": standard_index,
                    "renderCharacterOffset": standard_index,
                    "bbox": standard_entry["bbox"],
                    "origin": standard_entry["origin"],
                }
            )
            if event["mappingStatus"] == "mapped":
                event["unicode"] = event["mappedUnicode"]
                event["unicodeCodePoint"] = event["mappedUnicodeCodePoint"]

        expected_text_diffs = sorted(
            (
                event["page"],
                event["candidateTextUnicodeScalarOffset"],
                event["baseExtractedCharacter"],
                event["candidateCharacter"],
            )
            for event in events
            if event["mappingStatus"] == "mapped" and event["mappingMode"] == "substitution"
        )
        actual_text_diffs = sorted(
            (page, item["unicodeScalarOffset"], item["baseCharacter"], item["candidateCharacter"])
            for page, state in page_state.items() for item in state["textDiffs"]
        )
        if expected_text_diffs != actual_text_diffs:
            fail("simple_mapping_text_diff_alignment_failed", "selected extraction contains an unauthorized text change")
        candidate_pages = [
            {"page": page_number, "text": page_state[page_number]["standardText"]}
            for page_number in range(1, len(base_pages) + 1)
        ]
        provenance = []
        unmapped_provenance = []
        mapped_ordinals = defaultdict(int)
        unmapped_ordinals = defaultdict(int)
        for event in events:
            if event["mappingStatus"] == "mapped":
                ordinal = mapped_ordinals[event["page"]]
                mapped_ordinals[event["page"]] += 1
                provenance.append({**event, "pageEventOrdinal": ordinal})
            else:
                ordinal = unmapped_ordinals[event["page"]]
                unmapped_ordinals[event["page"]] += 1
                unmapped_provenance.append({**event, "pageEventOrdinal": ordinal})

        observed_glyphs = []
        unmapped_glyphs = []
        events_by_identity = defaultdict(list)
        for event in events:
            events_by_identity[resource_glyph_identity(event)].append(event)
        for identity in recognized_identities:
            matching_events = events_by_identity[identity]
            count = observed[identity]
            mapped_count = sum(event["mappingStatus"] == "mapped" for event in matching_events)
            item = {
                "resourceIndex": resource_order[identity[:3]],
                "fontResourceTag": identity[0],
                "fontStreamKey": identity[1],
                "fontStreamSha256": identity[2],
                "rawCodeHex": f"{identity[3]:02X}",
                "rawCodeByteLength": 1,
                "originalCharCodeHex": f"{identity[3]:02X}",
                "glyphName": identity[4],
                "count": count,
                "pages": sorted(observed_pages[identity]),
                "mappingStatus": "mapped" if mapped_count == count else "unmapped",
                "mappedCount": mapped_count,
                "mappingKinds": {"simple": mapped_count} if mapped_count else {},
            }
            mapping = mapping_index.get(identity)
            if mapping:
                item["unicode"] = mapping["unicode"]
                item["unicodeCodePoint"] = mapping["unicodeCodePoint"]
            else:
                unmapped_glyphs.append(
                    {
                        **item,
                        "reason": "no_explicit_resource_stream_raw_code_glyph_mapping",
                    }
                )
            observed_glyphs.append(item)

        page_requirements = []
        for page_number in range(1, original_document.page_count + 1):
            page_events = [event for event in events if event["page"] == page_number and event["mappingStatus"] == "mapped"]
            if not page_events:
                continue
            page_bboxes = [event["bbox"] for event in page_events]
            page_requirements.append(
                {
                    "page": page_number,
                    "cropBox": crop_boxes[page_number],
                    "bbox": union_bbox(page_bboxes),
                    "affectedBboxes": page_bboxes,
                    "affectedSpanCount": len(page_events),
                    "requiredRegionTypes": ["formula"],
                    "requiredChecks": ["operators", "subscripts", "superscripts", "delimiters", "order"],
                }
            )
    finally:
        original_document.close()
        repaired_document.close()
        diagnostic_document.close()

    return {
        "engine": {
            "name": "pypdf-resource-cmap-overlay+selected-text-replay+pymupdf-geometry",
            "pypdfVersion": pypdf.__version__,
            "pymupdfVersion": pymupdf.__version__,
            "fontToolsVersion": fontTools.__version__,
            "selectedTextEngine": selected_name,
            "selectedTextEngineVersion": selected_version,
        },
        "candidatePages": candidate_pages,
        "observedGlyphs": observed_glyphs,
        "unmappedGlyphs": unmapped_glyphs,
        "glyphEvents": events,
        "mappedGlyphProvenance": provenance,
        "unmappedGlyphProvenance": unmapped_provenance,
        "compositeGlyphProvenance": [],
        "visualReviewRequirements": page_requirements,
        "layoutVerification": {
            "policy": "production-selected text replay; exact scalar mappings only; unchanged PyMuPDF renderer bboxes",
            "selectedTextEngine": selected_name,
            "selectedTextEngineVersion": selected_version,
            "basePageCount": len(base_pages),
            "candidatePageCount": len(candidate_pages),
            "mappedEventCount": len(provenance),
            "unmappedEventCount": len(unmapped_provenance),
            "rendererGeometryVerifiedEventCount": len(events),
            "rendererRawCharacterCountDeltas": [
                {
                    "page": page,
                    "before": state["rendererRawCharacterCountBefore"],
                    "after": state["rendererRawCharacterCountAfter"],
                }
                for page, state in page_state.items()
                if state["rendererRawCharacterCountBefore"] != state["rendererRawCharacterCountAfter"]
            ],
            "compositeOccurrenceCount": 0,
            "changedPageCount": len(page_requirements),
        },
    }


def build(payload: dict) -> dict:
    strategy = payload.get("repairSpec", {}).get("strategy", {})
    if strategy.get("name") != "font-resource-cmap-overlay":
        fail("repair_strategy_invalid", repr(strategy.get("name")))
    version = strategy.get("version")
    if version == 1:
        return build_v1(payload)
    if version == 2:
        return build_v2(payload)
    fail("repair_strategy_version_unsupported", repr(version))


def main() -> None:
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if payload.get("command") == "versions":
        sys.stdout.buffer.write(
            json.dumps(
                {
                    "python": sys.version.split()[0],
                    "pypdf": pypdf.__version__,
                    "pymupdf": pymupdf.__version__,
                    "fontTools": fontTools.__version__,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        )
        return
    result = build(payload)
    sys.stdout.buffer.write(
        json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # deterministic, machine-readable failure boundary
        sys.stderr.write(f"{type(error).__name__}: {error}\n")
        raise
