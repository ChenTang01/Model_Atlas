#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ATLAS_ROOT = path.resolve(SCRIPT_DIR, "..");
const REQUIRED_ATLAS_ROOT = path.resolve("C:\\Users\\TC\\Desktop\\Web\\Atlas");
const DEFAULT_MANIFEST = "research/ledger/workspace-prune-plan.v1.json";
const PLAN_KIND = "atlas-workspace-prune-plan-v1";
const DIGEST_RE = /^research\/ledger\/artifacts\/([^/]+)\/([a-f0-9]{64})(?:\/|$)/i;

const ACTIVE_REFERENCE_PATHS = [
  "research/ledger/papers",
  "research/ledger/extraction-qa-adjudications",
  "research/ledger/extraction-repair-adjudications",
  "research/ledger/extraction-repair-candidates",
  "research/ledger/extraction-repair-promotions",
  "research/ledger/extraction-repair-quiescence",
  "research/ledger/extraction-repair-visual-qa",
  "research/ledger/safe-map-qa-provenance-rebind",
  "research/extraction-repair-specs",
  "research/model-note-safe-maps",
  "research/ledger/logs/model-note-authoring-release-v20",
  "research/ledger/authoring-plan.release-v20.json",
  "research/ledger/extraction-visual-scope-review.v1.json",
  "research/corpus/manifest.v1.json",
  "data/atlas_articles.json",
  "data/model_notes.json",
  "data/notes/release-candidate/audit.v1.json",
  "data/notes/release-candidate/model_notes.json",
];

const FOLLOWABLE_REFERENCE_PREFIXES = [
  ...ACTIVE_REFERENCE_PATHS,
  "research/ledger/extraction-qa",
  "research/ledger/artifacts",
];

const REQUIRED_RETAINED_PATHS = [
  ["mini-atlas/README.md", "file", "concise Mini documentation"],
  ["mini-atlas/data/atlas.json", "file", "canonical Mini catalog"],
  ["mini-atlas/data/math-notations.js", "file", "Mini math notation data"],
  ["mini-atlas/data/notes", "dir", "canonical Mini paper notes"],
  ["mini-atlas/research/pages", "dir", "canonical Mini research pages"],
  ["mini-atlas/research/sample.json", "file", "canonical Mini research sample"],
  ["research/ledger/.claims", "dir", "claim-lock directory structure"],
  ["research/ledger/papers", "dir", "current paper ledgers"],
  ["research/ledger/artifacts", "dir", "active extraction and reading artifacts"],
  ["research/ledger/extraction-qa", "dir", "active extraction-QA decision store"],
  ["research/ledger/authoring-plan.release-v20.json", "file", "current V20 authoring plan"],
  ["research/ledger/logs/model-note-authoring-release-v20", "dir", "current V20 logs"],
  ["data/atlas_articles.json", "file", "public catalog data"],
  ["data/model_notes.json", "file", "public model-note data"],
  ["data/notes/release-candidate/model_notes.json", "file", "release-candidate note data"],
];

const ALLOWED_TARGET_PREFIXES = [
  "tmp",
  "node_modules/.package-map.json",
  "node_modules/.pnpm-workspace-state-v1.json",
  "mini-atlas",
  "research/ledger/authoring-plan.v1.json",
  "research/ledger/authoring-plan.v2.json",
  "research/ledger/authoring-plan.v3.json",
  "research/ledger/authoring-plan.v4.json",
  "research/ledger/authoring-plan.v5.json",
  "research/ledger/logs",
  "research/ledger/attempts",
  "research/ledger/artifacts",
  "research/ledger/extraction-qa",
  "research/ledger/benchmarks",
  "research/ledger/performance",
  "research/ledger/paper-ledger-canonicalization-quarantine",
  "scripts/__pycache__",
  "data/notes/papers",
];

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function posix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function canonicalRelative(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0")) {
    throw new Error("Cleanup paths must be non-empty strings.");
  }
  const slash = relativePath.replaceAll("\\", "/");
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(slash)) {
    throw new Error(`Absolute cleanup path rejected: ${relativePath}`);
  }
  const normalized = path.posix.normalize(slash);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw new Error(`Workspace-root or escaping cleanup path rejected: ${relativePath}`);
  }
  return normalized;
}

function resolveInside(root, relativePath, { allowRoot = false } = {}) {
  const safe = canonicalRelative(relativePath);
  const absolute = path.resolve(root, ...safe.split("/"));
  const rel = path.relative(root, absolute);
  if ((!allowRoot && !rel) || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes or identifies the workspace root: ${relativePath}`);
  }
  return absolute;
}

async function maybeLstat(absolute) {
  try {
    return await lstat(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertNoSymlinkComponents(root, relativePath, { allowMissing = false, allowLeafLink = false } = {}) {
  const safe = canonicalRelative(relativePath);
  let current = path.resolve(root);
  const segments = safe.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    current = path.join(current, segment);
    const stat = await maybeLstat(current);
    if (!stat) {
      if (allowMissing) return null;
      throw Object.assign(new Error(`Path does not exist: ${safe}`), { code: "ENOENT" });
    }
    if (stat.isSymbolicLink() && !(allowLeafLink && index === segments.length - 1)) {
      throw new Error(`Symbolic link rejected: ${posix(path.relative(root, current))}`);
    }
  }
  return lstat(current);
}

async function assertPlainRoot(root) {
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Workspace root is not a plain directory: ${root}`);
  return realpath(root);
}

async function walkPlain(root, relativePath) {
  const absolute = resolveInside(root, relativePath);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${relativePath}`);
  if (stat.isFile()) return [{ path: canonicalRelative(relativePath), type: "file", bytes: stat.size }];
  if (!stat.isDirectory()) throw new Error(`Unsupported filesystem object rejected: ${relativePath}`);

  const output = [{ path: canonicalRelative(relativePath), type: "dir", bytes: 0 }];
  const entries = await readdir(absolute, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const child = `${canonicalRelative(relativePath)}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${child}`);
    output.push(...await walkPlain(root, child));
  }
  return output;
}

async function describeTarget(root, relativePath, reason) {
  const safe = canonicalRelative(relativePath);
  const absolute = resolveInside(root, safe);
  const stat = await assertNoSymlinkComponents(root, safe);
  if (stat.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${safe}`);
  if (stat.isFile()) {
    const bytes = await readFile(absolute);
    return { path: safe, type: "file", bytes: bytes.length, fileCount: 1, sha256: sha256(bytes), reason };
  }
  if (!stat.isDirectory()) throw new Error(`Unsupported cleanup target rejected: ${safe}`);
  const members = await walkPlain(root, safe);
  const fingerprints = [];
  let bytes = 0;
  let fileCount = 0;
  for (const member of members) {
    const memberRelative = member.path.slice(safe.length).replace(/^\//, "") || ".";
    if (member.type === "dir") {
      fingerprints.push({ path: memberRelative, type: "dir" });
    } else {
      const content = await readFile(resolveInside(root, member.path));
      bytes += content.length;
      fileCount += 1;
      fingerprints.push({ path: memberRelative, type: "file", bytes: content.length, sha256: sha256(content) });
    }
  }
  return { path: safe, type: "dir", bytes, fileCount, sha256: sha256(stableStringify(fingerprints)), reason };
}

async function describeLinkTarget(root, relativePath, reason) {
  const safe = canonicalRelative(relativePath);
  resolveInside(root, safe);
  const stat = await assertNoSymlinkComponents(root, safe, { allowLeafLink: true });
  if (!stat.isSymbolicLink()) throw new Error(`Expected a symbolic link or junction: ${safe}`);
  const linkTarget = await readlink(resolveInside(root, safe));
  return {
    path: safe,
    type: "link",
    bytes: 0,
    fileCount: 0,
    sha256: sha256(linkTarget),
    linkTarget,
    reason,
  };
}

function isAllowedTarget(targetPath) {
  const safe = canonicalRelative(targetPath);
  return ALLOWED_TARGET_PREFIXES.some((prefix) => safe === prefix || safe.startsWith(`${prefix}/`));
}

function isProtectedTarget(targetPath) {
  const safe = canonicalRelative(targetPath);
  return REQUIRED_RETAINED_PATHS.some(([retained]) => {
    if (safe === retained || retained.startsWith(`${safe}/`)) return true;
    if (!safe.startsWith(`${retained}/`)) return false;
    if (retained === "research/ledger/artifacts") return false;
    if (retained === "research/ledger/extraction-qa") return false;
    if (retained === "mini-atlas/data/notes") return /^mini-atlas\/data\/notes\/[^/]+\.json$/i.test(safe);
    if (retained === "mini-atlas/research/pages") return /^mini-atlas\/research\/pages\/[^/]+\.json$/i.test(safe);
    return true;
  });
}

async function existingType(root, relativePath) {
  resolveInside(root, relativePath);
  const stat = await assertNoSymlinkComponents(root, relativePath, { allowMissing: true });
  if (!stat) return null;
  if (stat.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${relativePath}`);
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "dir";
  throw new Error(`Unsupported filesystem object rejected: ${relativePath}`);
}

async function collectJsonFiles(root, relativePath) {
  const type = await existingType(root, relativePath);
  if (!type) return [];
  if (type === "file") return relativePath.toLowerCase().endsWith(".json") ? [canonicalRelative(relativePath)] : [];
  const members = await walkPlain(root, relativePath);
  return members.filter((item) => item.type === "file" && item.path.toLowerCase().endsWith(".json")).map((item) => item.path);
}

function visitStrings(value, visitor) {
  if (typeof value === "string") visitor(value);
  else if (Array.isArray(value)) value.forEach((item) => visitStrings(item, visitor));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => visitStrings(item, visitor));
}

function plausibleWorkspaceJson(value) {
  if (typeof value !== "string" || !value.toLowerCase().endsWith(".json")) return null;
  try {
    const safe = canonicalRelative(value);
    if (FOLLOWABLE_REFERENCE_PREFIXES.some((root) => safe === root || safe.startsWith(`${root}/`))) return safe;
  } catch {}
  return null;
}

async function buildReferenceGraph(root) {
  const queue = [];
  for (const referencePath of ACTIVE_REFERENCE_PATHS) queue.push(...await collectJsonFiles(root, referencePath));
  const seen = new Set();
  const files = [];
  const activeArtifactDigests = new Set();

  while (queue.length) {
    const relativePath = canonicalRelative(queue.shift());
    if (seen.has(relativePath)) continue;
    const type = await existingType(root, relativePath);
    if (type !== "file") continue;
    seen.add(relativePath);
    const content = await readFile(resolveInside(root, relativePath));
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Active JSON input is invalid (${relativePath}): ${error.message}`);
    }
    files.push({ path: relativePath, bytes: content.length, sha256: sha256(content) });
    visitStrings(parsed, (value) => {
      const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
      const digest = normalized.match(DIGEST_RE);
      if (digest) activeArtifactDigests.add(`${digest[1]}/${digest[2].toLowerCase()}`);
      const linked = plausibleWorkspaceJson(normalized);
      if (linked && !seen.has(linked)) queue.push(linked);
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const digests = [...activeArtifactDigests].sort();
  return {
    files,
    activeArtifactDigests: digests,
    summary: {
      rootPaths: ACTIVE_REFERENCE_PATHS,
      fileCount: files.length,
      bytes: files.reduce((sum, item) => sum + item.bytes, 0),
      sha256: sha256(stableStringify(files)),
      activeArtifactDigestCount: digests.length,
      activeArtifactDigestsSha256: sha256(stableStringify(digests)),
    },
  };
}

function miniPreserved(relativePath) {
  const safe = canonicalRelative(relativePath);
  return safe === "mini-atlas/README.md"
    || safe === "mini-atlas/data/atlas.json"
    || safe === "mini-atlas/data/math-notations.js"
    || /^mini-atlas\/data\/notes\/[^/]+\.json$/i.test(safe)
    || /^mini-atlas\/research\/pages\/[^/]+\.json$/i.test(safe)
    || safe === "mini-atlas/research/sample.json";
}

function miniHasPreservedDescendant(relativePath) {
  const safe = canonicalRelative(relativePath);
  const prefixes = [
    "mini-atlas/README.md",
    "mini-atlas/data/atlas.json",
    "mini-atlas/data/math-notations.js",
    "mini-atlas/data/notes/placeholder.json",
    "mini-atlas/research/pages/placeholder.json",
    "mini-atlas/research/sample.json",
  ];
  return prefixes.some((kept) => kept.startsWith(`${safe}/`));
}

async function collectMiniTargets(root, relativePath = "mini-atlas") {
  if (!await existingType(root, relativePath)) return [];
  const absolute = resolveInside(root, relativePath);
  const entries = await readdir(absolute, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const targets = [];
  for (const entry of entries) {
    const child = `${canonicalRelative(relativePath)}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${child}`);
    if (miniPreserved(child)) continue;
    if (entry.isDirectory() && miniHasPreservedDescendant(child)) {
      targets.push(...await collectMiniTargets(root, child));
    } else {
      targets.push([child, "obsolete or duplicate Mini site content"]);
    }
  }
  return targets;
}

async function collectTmpTargets(root, relativePath = "tmp", isRoot = true) {
  const type = await existingType(root, relativePath);
  if (!type) return { hasLink: false, targets: [] };
  if (type !== "dir") return { hasLink: false, targets: [[relativePath, "workspace temporary file"]] };
  const entries = await readdir(resolveInside(root, relativePath), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const targets = [];
  let hasLink = false;
  for (const entry of entries) {
    const child = `${canonicalRelative(relativePath)}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      hasLink = true;
      targets.push([child, "temporary junction or symbolic link; unlink without traversing its target", "link"]);
    } else if (entry.isDirectory()) {
      const nested = await collectTmpTargets(root, child, false);
      if (nested.hasLink) {
        hasLink = true;
        targets.push(...nested.targets);
      } else {
        targets.push([child, "workspace temporary directory"]);
      }
    } else if (entry.isFile()) {
      targets.push([child, "workspace temporary file"]);
    } else {
      throw new Error(`Unsupported filesystem object rejected: ${child}`);
    }
  }
  if (isRoot && !hasLink) return { hasLink: false, targets: [[relativePath, "workspace temporary files"]] };
  return { hasLink, targets };
}

async function collectOldPlanTargets(root) {
  const targets = [];
  for (let version = 1; version <= 5; version += 1) {
    const planPath = `research/ledger/authoring-plan.v${version}.json`;
    if (await existingType(root, planPath)) {
      const plan = JSON.parse(await readFile(resolveInside(root, planPath), "utf8"));
      targets.push([planPath, `superseded authoring plan v${version}`]);
      const logDirectory = plan?.configuration?.logDirectory;
      if (typeof logDirectory === "string") {
        const safeLog = canonicalRelative(logDirectory);
        if (!safeLog.startsWith("research/ledger/logs/") || safeLog.includes("release-v20")) {
          throw new Error(`Unsafe old-plan log directory in ${planPath}: ${logDirectory}`);
        }
        if (await existingType(root, safeLog)) targets.push([safeLog, `logs belonging to superseded authoring plan v${version}`]);
      }
    }
  }
  return targets;
}

async function collectOrphanArtifacts(root, activeDigests) {
  const artifactRoot = "research/ledger/artifacts";
  if (!await existingType(root, artifactRoot)) return [];
  const targets = [];
  const papers = await readdir(resolveInside(root, artifactRoot), { withFileTypes: true });
  for (const paper of papers.sort((a, b) => a.name.localeCompare(b.name))) {
    const paperPath = `${artifactRoot}/${paper.name}`;
    if (paper.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${paperPath}`);
    if (!paper.isDirectory()) continue;
    const digests = await readdir(resolveInside(root, paperPath), { withFileTypes: true });
    for (const digest of digests.sort((a, b) => a.name.localeCompare(b.name))) {
      const digestPath = `${paperPath}/${digest.name}`;
      if (digest.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${digestPath}`);
      if (!digest.isDirectory() || !/^[a-f0-9]{64}$/i.test(digest.name)) continue;
      const key = `${paper.name}/${digest.name.toLowerCase()}`;
      if (!activeDigests.has(key)) targets.push([digestPath, "unreferenced historical artifact digest"]);
    }
  }
  return targets;
}

async function collectUnreferencedExtractionQa(root, referencedFiles) {
  const qaRoot = "research/ledger/extraction-qa";
  if (!await existingType(root, qaRoot)) return [];
  const referenced = new Set(referencedFiles);
  const files = await collectJsonFiles(root, qaRoot);
  return files
    .filter((file) => /^research\/ledger\/extraction-qa\/[^/]+\/[a-f0-9]{64}\.json$/i.test(file) && !referenced.has(file))
    .map((file) => [file, "unreferenced historical extraction-QA decision"]);
}

async function collectTemporaryPaperNoteTargets(root) {
  const notesRoot = "data/notes/papers";
  if (!await existingType(root, notesRoot)) return [];
  const entries = await readdir(resolveInside(root, notesRoot), { withFileTypes: true });
  const targets = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = `${notesRoot}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${relativePath}`);
    if (entry.isFile() && entry.name.endsWith(".tmp")) targets.push([relativePath, "abandoned atomic-write paper-note temporary file"]);
  }
  return targets;
}

async function describeInput(root, relativePath, reason) {
  const safe = canonicalRelative(relativePath);
  const type = await existingType(root, safe);
  if (!type) return null;
  const described = await describeTarget(root, safe, reason);
  return { path: described.path, type: described.type, bytes: described.bytes, fileCount: described.fileCount, sha256: described.sha256, reason };
}

function withoutPlanHash(plan) {
  const { planSha256: _ignored, ...rest } = plan;
  return rest;
}

function signPlan(plan) {
  return { ...plan, planSha256: sha256(stableStringify(withoutPlanHash(plan))) };
}

function assertManifestIntegrity(plan) {
  if (!plan || plan.schemaVersion !== 1 || plan.kind !== PLAN_KIND) throw new Error("Unsupported cleanup manifest.");
  const expected = sha256(stableStringify(withoutPlanHash(plan)));
  if (plan.planSha256 !== expected) throw new Error("Cleanup manifest integrity hash does not match.");
}

function validateManifestPaths(plan, root, manifestRelative) {
  assertManifestIntegrity(plan);
  if (path.resolve(plan.workspaceRoot) !== path.resolve(root)) throw new Error("Cleanup manifest belongs to a different workspace.");
  if (!Array.isArray(plan.targets) || !Array.isArray(plan.retained) || !Array.isArray(plan.inputs)) {
    throw new Error("Cleanup manifest is missing required arrays.");
  }
  const manifestSafe = canonicalRelative(manifestRelative);
  const seen = new Set();
  for (const target of plan.targets) {
    if (!target || !["file", "dir", "link"].includes(target.type) || !Number.isSafeInteger(target.bytes) || target.bytes < 0
      || !Number.isSafeInteger(target.fileCount) || target.fileCount < 0 || !/^[a-f0-9]{64}$/.test(target.sha256)
      || typeof target.reason !== "string" || !target.reason) {
      throw new Error("Cleanup manifest contains an invalid target descriptor.");
    }
    const safe = canonicalRelative(target.path);
    resolveInside(root, safe);
    if (safe === manifestSafe || manifestSafe.startsWith(`${safe}/`)) throw new Error("Cleanup manifest cannot delete itself.");
    if (!isAllowedTarget(safe)) throw new Error(`Target is outside the cleanup allowlist: ${safe}`);
    if (isProtectedTarget(safe)) throw new Error(`Target overlaps a protected path: ${safe}`);
    if (target.type === "link" && !safe.startsWith("tmp/")) throw new Error(`Link cleanup is allowed only below tmp: ${safe}`);
    if (seen.has(safe)) throw new Error(`Duplicate cleanup target: ${safe}`);
    seen.add(safe);
  }
  for (const left of seen) {
    for (const right of seen) {
      if (left !== right && right.startsWith(`${left}/`)) throw new Error(`Overlapping cleanup targets: ${left} and ${right}`);
    }
  }
}

async function writeAtomicJson(root, relativePath, value) {
  const safe = canonicalRelative(relativePath);
  const absolute = resolveInside(root, safe);
  const parentRelative = posix(path.relative(root, path.dirname(absolute)));
  if (parentRelative && parentRelative !== ".") await assertNoSymlinkComponents(root, parentRelative, { allowMissing: true });
  await mkdir(path.dirname(absolute), { recursive: true });
  if (parentRelative && parentRelative !== ".") await assertNoSymlinkComponents(root, parentRelative);
  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await rename(temporary, absolute);
}

async function readManifest(root, manifestRelative) {
  await assertNoSymlinkComponents(root, manifestRelative);
  return JSON.parse(await readFile(resolveInside(root, manifestRelative), "utf8"));
}

async function createPlanCore(root, manifestRelative = DEFAULT_MANIFEST, { write = true, resume = true } = {}) {
  root = path.resolve(root);
  await assertPlainRoot(root);
  const manifestSafe = canonicalRelative(manifestRelative);
  const existingManifest = await maybeLstat(resolveInside(root, manifestSafe));
  if (existingManifest && resume) {
    if (!existingManifest.isFile() || existingManifest.isSymbolicLink()) throw new Error("Existing cleanup manifest is not a plain file.");
    const plan = await readManifest(root, manifestSafe);
    validateManifestPaths(plan, root, manifestSafe);
    return { plan, resumed: true };
  }

  const referenceGraph = await buildReferenceGraph(root);
  const activeDigests = new Set(referenceGraph.activeArtifactDigests);
  const tmp = await collectTmpTargets(root);
  const candidatePairs = [
    ...tmp.targets,
    ["node_modules/.package-map.json", "rebuildable package-manager cache"],
    ["node_modules/.pnpm-workspace-state-v1.json", "rebuildable package-manager cache"],
    ["scripts/__pycache__", "rebuildable Python bytecode cache"],
    ["research/ledger/attempts", "completed historical run-attempt records superseded by current ledgers"],
    ["research/ledger/benchmarks", "stale pre-retirement benchmark output"],
    ["research/ledger/performance", "stale pre-retirement performance snapshot"],
    ["research/ledger/paper-ledger-canonicalization-quarantine", "completed canonicalization quarantine"],
    ["research/ledger/logs/mini-parity-condition-v20-affected-papers.txt", "superseded one-time Mini parity worklist"],
    ...await collectTemporaryPaperNoteTargets(root),
    ...await collectMiniTargets(root),
    ...await collectOldPlanTargets(root),
    ...await collectUnreferencedExtractionQa(root, referenceGraph.files.map((file) => file.path)),
    ...await collectOrphanArtifacts(root, activeDigests),
  ];

  const unique = new Map();
  for (const [candidatePath, reason, targetType = "plain"] of candidatePairs) {
    const safe = canonicalRelative(candidatePath);
    if (targetType !== "link" && !await existingType(root, safe)) continue;
    if (!isAllowedTarget(safe) || isProtectedTarget(safe)) throw new Error(`Unsafe generated cleanup target: ${safe}`);
    unique.set(safe, { reason, targetType });
  }
  const paths = [...unique.keys()].sort((a, b) => a.localeCompare(b));
  for (const parent of paths) {
    for (const child of paths) {
      if (parent !== child && child.startsWith(`${parent}/`)) unique.delete(child);
    }
  }

  const targets = [];
  for (const [targetPath, descriptor] of [...unique.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    targets.push(descriptor.targetType === "link"
      ? await describeLinkTarget(root, targetPath, descriptor.reason)
      : await describeTarget(root, targetPath, descriptor.reason));
  }

  const retained = [];
  for (const [retainedPath, expectedType, reason] of REQUIRED_RETAINED_PATHS) {
    const actualType = await existingType(root, retainedPath);
    if (!actualType) throw new Error(`Required retained path is missing: ${retainedPath}`);
    if (actualType !== expectedType) throw new Error(`Required retained path has wrong type: ${retainedPath}`);
    retained.push({ path: retainedPath, type: expectedType, reason });
  }

  const inputCandidates = [
    ["research/corpus/manifest.v1.json", "current corpus manifest"],
    ["research/ledger/papers", "current paper ledger snapshot"],
    ["research/ledger/authoring-plan.release-v20.json", "current authoring plan"],
    ["research/ledger/extraction-visual-scope-review.v1.json", "current extraction QA scope"],
    ["research/ledger/safe-map-qa-provenance-rebind", "current safe-map provenance"],
    ["data/atlas_articles.json", "public catalog"],
    ["data/model_notes.json", "public notes"],
    ["data/notes/release-candidate/model_notes.json", "release-candidate notes"],
  ];
  const inputs = (await Promise.all(inputCandidates.map(([p, reason]) => describeInput(root, p, reason)))).filter(Boolean);
  const byReason = {};
  for (const target of targets) {
    const summary = byReason[target.reason] ?? { targetCount: 0, bytes: 0, files: 0 };
    summary.targetCount += 1;
    summary.bytes += target.bytes;
    summary.files += target.fileCount;
    byReason[target.reason] = summary;
  }
  const unsigned = {
    schemaVersion: 1,
    kind: PLAN_KIND,
    generatedAt: new Date().toISOString(),
    workspaceRoot: root,
    manifestPath: manifestSafe,
    inputs,
    referenceGraph: referenceGraph.summary,
    retained,
    targets,
    totals: {
      targetCount: targets.length,
      bytes: targets.reduce((sum, target) => sum + target.bytes, 0),
      files: targets.reduce((sum, target) => sum + target.fileCount, 0),
      byReason,
    },
  };
  const plan = signPlan(unsigned);
  validateManifestPaths(plan, root, manifestSafe);
  if (write) await writeAtomicJson(root, manifestSafe, plan);
  return { plan, resumed: false };
}

async function assertReferenceGraphUnchanged(root, plan) {
  const graph = await buildReferenceGraph(root);
  const current = graph.summary;
  for (const field of ["fileCount", "bytes", "sha256", "activeArtifactDigestCount", "activeArtifactDigestsSha256"]) {
    if (current[field] !== plan.referenceGraph[field]) throw new Error(`Active reference graph changed since plan (${field}). Generate a new manifest.`);
  }
  return graph;
}

async function assertImportantInputsUnchanged(root, plan) {
  for (const input of plan.inputs) {
    const current = await describeInput(root, input.path, input.reason);
    if (!current) throw new Error(`Important cleanup input disappeared since plan: ${input.path}`);
    for (const field of ["type", "bytes", "fileCount", "sha256"]) {
      if (current[field] !== input[field]) throw new Error(`Important cleanup input changed since plan: ${input.path}`);
    }
  }
}

async function describeCurrentPlannedTarget(root, target) {
  const stat = await assertNoSymlinkComponents(root, target.path, { allowMissing: true, allowLeafLink: target.type === "link" });
  if (!stat) return null;
  if (stat.isSymbolicLink()) {
    if (target.type !== "link") throw new Error(`Unexpected symbolic link at cleanup target: ${target.path}`);
    return describeLinkTarget(root, target.path, target.reason);
  }
  if (target.type === "link") throw new Error(`Planned link was replaced by a plain filesystem object: ${target.path}`);
  return describeTarget(root, target.path, target.reason);
}

async function applyPlanCore(root, manifestRelative = DEFAULT_MANIFEST, hooks = {}) {
  root = path.resolve(root);
  await assertPlainRoot(root);
  const plan = await readManifest(root, manifestRelative);
  validateManifestPaths(plan, root, manifestRelative);
  const referenceGraph = await assertReferenceGraphUnchanged(root, plan);
  await assertImportantInputsUnchanged(root, plan);

  const activeDigests = new Set(referenceGraph.activeArtifactDigests);
  for (const target of plan.targets) {
    const match = target.path.match(/^research\/ledger\/artifacts\/([^/]+)\/([a-f0-9]{64})(?:\/|$)/i);
    if (match && activeDigests.has(`${match[1]}/${match[2].toLowerCase()}`)) {
      throw new Error(`Cleanup target is an active artifact digest: ${target.path}`);
    }
  }

  const present = [];
  for (const target of plan.targets) {
    const current = await describeCurrentPlannedTarget(root, target);
    if (!current) continue;
    for (const field of ["type", "bytes", "fileCount", "sha256"]) {
      if (current[field] !== target[field]) throw new Error(`Cleanup target changed since plan: ${target.path}`);
    }
    present.push(target);
  }

  let removed = 0;
  for (const target of present.sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path))) {
    const absolute = resolveInside(root, target.path);
    const current = await describeCurrentPlannedTarget(root, target);
    if (!current) throw new Error(`Cleanup target disappeared during apply: ${target.path}`);
    for (const field of ["type", "bytes", "fileCount", "sha256"]) {
      if (current[field] !== target[field]) throw new Error(`Cleanup target changed immediately before deletion: ${target.path}`);
    }
    if (target.type === "dir") await rm(absolute, { recursive: true, force: false });
    else if (target.type === "link") await rm(absolute, { recursive: false, force: false });
    else await unlink(absolute);
    if (await maybeLstat(absolute)) throw new Error(`Cleanup target still exists after deletion: ${target.path}`);
    removed += 1;
    if (hooks.afterDelete) await hooks.afterDelete(target, removed);
  }
  return { removed, alreadyAbsent: plan.targets.length - present.length, total: plan.targets.length };
}

async function verifyPlanCore(root, manifestRelative = DEFAULT_MANIFEST) {
  root = path.resolve(root);
  await assertPlainRoot(root);
  const plan = await readManifest(root, manifestRelative);
  validateManifestPaths(plan, root, manifestRelative);
  await assertReferenceGraphUnchanged(root, plan);
  await assertImportantInputsUnchanged(root, plan);
  const failures = [];
  for (const target of plan.targets) {
    if (await maybeLstat(resolveInside(root, target.path))) failures.push(`target remains: ${target.path}`);
  }
  for (const retained of plan.retained) {
    try {
      const type = await existingType(root, retained.path);
      if (type !== retained.type) failures.push(`retained path missing or changed: ${retained.path}`);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (failures.length) throw new Error(`Workspace prune verification failed:\n${failures.join("\n")}`);
  return { verifiedTargets: plan.targets.length, verifiedRetained: plan.retained.length };
}

function assertProductionRoot() {
  if (path.resolve(ATLAS_ROOT).toLowerCase() !== REQUIRED_ATLAS_ROOT.toLowerCase()) {
    throw new Error(`This script is locked to ${REQUIRED_ATLAS_ROOT}; actual location is ${ATLAS_ROOT}`);
  }
}

export async function planWorkspace(manifestRelative = DEFAULT_MANIFEST) {
  assertProductionRoot();
  return createPlanCore(ATLAS_ROOT, manifestRelative);
}

export async function previewWorkspacePlan(manifestRelative = DEFAULT_MANIFEST) {
  assertProductionRoot();
  return createPlanCore(ATLAS_ROOT, manifestRelative, { write: false, resume: false });
}

export async function applyWorkspacePlan(manifestRelative = DEFAULT_MANIFEST) {
  assertProductionRoot();
  return applyPlanCore(ATLAS_ROOT, manifestRelative);
}

export async function verifyWorkspacePlan(manifestRelative = DEFAULT_MANIFEST) {
  assertProductionRoot();
  return verifyPlanCore(ATLAS_ROOT, manifestRelative);
}

export const __test = Object.freeze({
  createPlanCore,
  applyPlanCore,
  verifyPlanCore,
  canonicalRelative,
  resolveInside,
  signPlan,
  validateManifestPaths,
  describeLinkTarget,
});

async function main(argv) {
  assertProductionRoot();
  const [command, ...rest] = argv;
  let manifest = DEFAULT_MANIFEST;
  if (rest.length) {
    if (rest.length !== 2 || rest[0] !== "--manifest") throw new Error("Usage: prune-workspace.mjs <preview|plan|apply|verify> [--manifest relative/path.json]");
    manifest = canonicalRelative(rest[1]);
  }
  if (command === "preview") {
    const result = await previewWorkspacePlan(manifest);
    console.log(JSON.stringify({ command, manifest, persisted: false, totals: result.plan.totals }, null, 2));
  } else if (command === "plan") {
    const result = await planWorkspace(manifest);
    console.log(JSON.stringify({ command, manifest, resumed: result.resumed, totals: result.plan.totals }, null, 2));
  } else if (command === "apply") {
    console.log(JSON.stringify({ command, manifest, ...await applyWorkspacePlan(manifest) }, null, 2));
  } else if (command === "verify") {
    console.log(JSON.stringify({ command, manifest, ...await verifyWorkspacePlan(manifest) }, null, 2));
  } else {
    throw new Error("Usage: prune-workspace.mjs <preview|plan|apply|verify> [--manifest relative/path.json]");
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
