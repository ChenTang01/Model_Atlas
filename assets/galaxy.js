((root, factory) => {
  const topics = root.AtlasTopics || (typeof module === "object" && module.exports ? require("./topics.js") : null);
  const api = factory(topics);
  root.AtlasGalaxy = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis, (topics) => {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;
  const STAR_WHITE = [225, 235, 250];
  const STAR_BLUE = [133, 169, 227];
  const NEBULA_BLUE = [77, 111, 176];
  const NEBULA_INDIGO = [111, 89, 154];
  const STAR_AMBER = [241, 199, 138];
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 3.5;
  const HOME_FIT = 0.92;
  const GALAXY_RADIUS = 6.45;
  const SPIRAL_PITCH = 0.58;
  const SPIRAL_PHASE = -1.4;
  // Each subject owns a neighboring ribbon of one of the two visible arms.
  // The order keeps closely related lenses beside one another without drawing
  // hard borders or putting a taxonomy into eight separate containers.
  const SUBJECT_ARM_ROUTES = Object.freeze([
    Object.freeze({ id: "mechanisms", arm: 0 }),
    Object.freeze({ id: "pricing", arm: 0 }),
    Object.freeze({ id: "platforms", arm: 0 }),
    Object.freeze({ id: "innovation", arm: 0 }),
    Object.freeze({ id: "information", arm: 1 }),
    Object.freeze({ id: "organizations", arm: 1 }),
    Object.freeze({ id: "supply-chains", arm: 1 }),
    Object.freeze({ id: "policy", arm: 1 })
  ]);

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value ?? "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(random) {
    const first = Math.max(random(), 1e-7);
    const second = random();
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(TAU * second);
  }

  function normalizeText(value) {
    return String(value ?? "")
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const semanticStopwords = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is",
    "it", "model", "of", "on", "or", "paper", "the", "their", "to", "under", "when", "with"
  ]);

  function semanticTerms(value) {
    return normalizeText(value)
      .split(/\s+/)
      .filter((term) => term.length > 2 && !semanticStopwords.has(term));
  }

  function featureMap(record) {
    const features = new Map();
    const addFeature = (feature, weight) => {
      const normalized = normalizeText(feature);
      if (!normalized) return;
      features.set(normalized, (features.get(normalized) || 0) + weight);
    };
    const addPhrase = (prefix, phrase, phraseWeight, tokenWeight = phraseWeight * 0.26) => {
      const normalized = normalizeText(phrase);
      if (!normalized) return;
      addFeature(`${prefix} ${normalized}`, phraseWeight);
      semanticTerms(normalized).forEach((term) => addFeature(`word ${term}`, tokenWeight));
    };
    const addList = (prefix, list, weight) => {
      (Array.isArray(list) ? list : []).forEach((value) => addPhrase(prefix, value, weight));
    };

    addList("topic family", record.topic_families, 5.2);
    addList("topic", record.topics, 4.1);
    addPhrase("primary", record.primary_topic, 4.6, 1.15);
    addPhrase("model topic", record.model_topic, 3.7, 1.05);
    addList("equilibrium", record.equilibrium_families, 2.8);
    addList("method", record.method_families, 2.35);
    addList("architecture", record.architecture_families, 2.25);
    addList("information", record.information_families, 2.05);
    addList("evidence", record.evidence_families, 1.2);
    addPhrase("question", record.business_question, 1.35, 0.52);
    return features;
  }

  function buildSemanticVectors(records, dimensions = 64) {
    const featureMaps = records.map(featureMap);
    const documentFrequency = new Map();
    featureMaps.forEach((features) => {
      features.forEach((_, feature) => {
        documentFrequency.set(feature, (documentFrequency.get(feature) || 0) + 1);
      });
    });

    return featureMaps.map((features) => {
      const vector = new Float64Array(dimensions);
      features.forEach((termWeight, feature) => {
        const frequency = documentFrequency.get(feature) || 1;
        const inverseFrequency = Math.log((records.length + 1) / (frequency + 1)) + 1;
        const hash = hashString(feature);
        const index = hash % dimensions;
        const sign = (hashString(`${feature}:sign`) & 1) === 0 ? 1 : -1;
        vector[index] += termWeight * inverseFrequency * sign;
      });
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
      for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
      return vector;
    });
  }

  function cosineSimilarity(left, right) {
    let score = 0;
    for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
    return score;
  }

  function projection(vector, axis) {
    let value = 0;
    for (let index = 0; index < vector.length; index += 1) {
      const frequency = (axis + 1) * 0.731 + (index + 1) * 1.217;
      value += vector[index] * Math.sin(frequency * (axis + 1.37));
    }
    return value;
  }

  function createSemanticLayout(records, options = {}) {
    if (!records.length) return [];
    const neighborCount = options.neighborCount || 7;
    const count = records.length;
    const largeCollection = count > 800;
    const vectors = buildSemanticVectors(records, options.dimensions || 64);
    const categoryIds = records.map((record) => record.subject_id || topics?.classifyPaper(record) || "platforms");
    // Small collections keep the original dense matrix and full stable sort so
    // their established coordinates remain byte-for-byte deterministic. Large
    // collections retain only each paper's strongest candidates while scores
    // are streamed, avoiding an O(n²) matrix and n full O(n log n) sorts.
    const similarity = largeCollection ? null : Array.from({ length: count }, () => new Float32Array(count));
    const sparseNeighbors = largeCollection ? Array.from({ length: count }, () => []) : null;
    const sparseScores = largeCollection ? Array.from({ length: count }, () => new Map()) : null;
    const neighbors = Array.from({ length: count }, () => []);

    const retainSparseNeighbor = (owner, candidate, score) => {
      if (score <= 0.035) return;
      const entries = sparseNeighbors[owner];
      let position = entries.length;
      for (let index = 0; index < entries.length; index += 1) {
        if (score > entries[index].score || (score === entries[index].score && candidate < entries[index].candidate)) {
          position = index;
          break;
        }
      }
      if (position >= neighborCount && entries.length >= neighborCount) return;
      entries.splice(position, 0, { candidate, score });
      if (entries.length > neighborCount) entries.pop();
    };

    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        const score = Math.max(0, cosineSimilarity(vectors[left], vectors[right]));
        if (largeCollection) {
          retainSparseNeighbor(left, right, score);
          retainSparseNeighbor(right, left, score);
        } else {
          similarity[left][right] = score;
          similarity[right][left] = score;
        }
      }
    }

    if (largeCollection) {
      sparseNeighbors.forEach((entries, index) => {
        neighbors[index] = entries.map((entry) => entry.candidate);
        entries.forEach((entry) => sparseScores[index].set(entry.candidate, entry.score));
      });
    } else {
      for (let index = 0; index < count; index += 1) {
        neighbors[index] = Array.from({ length: count }, (_, candidate) => candidate)
          .filter((candidate) => candidate !== index)
          .sort((left, right) => similarity[index][right] - similarity[index][left])
          .slice(0, neighborCount)
          .filter((candidate) => similarity[index][candidate] > 0.035);
      }
    }

    const similarityFor = (left, right) => largeCollection
      ? sparseScores[left].get(right) ?? 0
      : similarity[left][right];

    // Use the same two-arm equation as the background dust and nebula. Subjects
    // occupy contiguous, softly overlapping radial ribbons; within a ribbon,
    // deterministic semantic projections decide along-arm and cross-arm order.
    // This makes a selected subject read as a neighborhood while preserving one
    // continuous spiral galaxy instead of eight circular or cylindrical bins.
    const membersByCategory = new Map();
    categoryIds.forEach((categoryId, index) => {
      if (!membersByCategory.has(categoryId)) membersByCategory.set(categoryId, []);
      membersByCategory.get(categoryId).push(index);
    });
    const configuredCategories = new Set(SUBJECT_ARM_ROUTES.map((route) => route.id));
    const routes = [
      ...SUBJECT_ARM_ROUTES,
      ...[...membersByCategory.keys()]
        .filter((categoryId) => !configuredCategories.has(categoryId))
        .sort()
        .map((categoryId) => ({ id: categoryId, arm: hashString(categoryId) & 1 }))
    ];
    const positions = Array(count);
    for (const arm of [0, 1]) {
      const armRoutes = routes.filter((route) => route.arm === arm && membersByCategory.get(route.id)?.length);
      if (!armRoutes.length) continue;
      const innerRadius = 0.16;
      const availableSpan = GALAXY_RADIUS - innerRadius - 0.12;
      const minimumSpan = Math.min(0.72, availableSpan / armRoutes.length * 0.72);
      const weightedSpan = Math.max(0, availableSpan - minimumSpan * armRoutes.length);
      const totalWeight = armRoutes.reduce((sum, route) => sum + Math.sqrt(membersByCategory.get(route.id).length), 0) || 1;
      let cursor = innerRadius;

      armRoutes.forEach((route, routeIndex) => {
        const members = membersByCategory.get(route.id);
        const span = minimumSpan + weightedSpan * Math.sqrt(members.length) / totalWeight;
        const semanticAxis = arm * 5 + routeIndex + 1;
        const ordered = members.map((index) => ({
          id: String(records[index].id ?? ""),
          index,
          along: projection(vectors[index], semanticAxis),
          tie: hashString(`${records[index].id}:spiral-order`)
        })).sort((left, right) => left.along - right.along || left.tie - right.tie || left.id.localeCompare(right.id));

        ordered.forEach(({ id, index }, rank) => {
          const random = mulberry32(hashString(`${id}:galaxy-position`) ^ 0xA71A5);
          const slot = (rank + 0.5 + (random() - 0.5) * 0.72) / ordered.length;
          let radius = cursor + clamp(slot, 0.002, 0.998) * span;
          radius += gaussian(random) * Math.min(0.055, span / Math.max(10, Math.sqrt(ordered.length) * 3));
          radius = clamp(radius, 0.08, GALAXY_RADIUS);
          const armWidth = 0.045 + radius * 0.014;
          const semanticCross = clamp(projection(vectors[index], semanticAxis + 7) * 0.085, -0.075, 0.075);
          const angle = arm * Math.PI + radius * SPIRAL_PITCH + SPIRAL_PHASE
            + gaussian(random) * armWidth + semanticCross;
          const thickness = 0.04 + radius * 0.012;
          positions[index] = {
            arm,
            x: Math.cos(angle) * radius,
            y: clamp(gaussian(random) * thickness + projection(vectors[index], semanticAxis + 13) * 0.035, -0.34, 0.34),
            z: Math.sin(angle) * radius
          };
        });
        cursor += span;
      });
    }

    return records.map((record, index) => {
      const position = positions[index];
      return {
        id: record.id,
        record,
        vector: vectors[index],
        x: position.x,
        y: clamp(position.y, -0.52, 0.52),
        z: position.z,
        spiralArm: position.arm,
        categoryId: categoryIds[index],
        color: STAR_WHITE,
        twinkle: (hashString(`${record.id}:twinkle`) % 1000) / 1000 * TAU,
        neighbors: neighbors[index].map((neighbor) => ({
          id: records[neighbor].id,
          similarity: similarityFor(index, neighbor)
        }))
      };
    });
  }

  function createDust(count = 3400) {
    const random = mulberry32(0xA71A5206);
    const dust = [];
    const armCount = Math.floor(count * 0.83);
    for (let index = 0; index < armCount; index += 1) {
      const arm = index % 2;
      const radius = Math.pow(random(), 0.65) * 6.8 + 0.12;
      const spread = gaussian(random) * (0.06 + radius * 0.022);
      const angle = arm * Math.PI + radius * SPIRAL_PITCH + SPIRAL_PHASE + spread;
      dust.push({
        x: Math.cos(angle) * radius + gaussian(random) * 0.055,
        y: gaussian(random) * (0.035 + radius * 0.012),
        z: Math.sin(angle) * radius + gaussian(random) * 0.055,
        size: 0.38 + random() * 0.6,
        alpha: 0.18 + random() * 0.5,
        color: random() < 0.28 ? STAR_WHITE : random() < 0.68 ? STAR_BLUE : NEBULA_INDIGO,
        phase: random() * TAU
      });
    }
    while (dust.length < count) {
      const radius = Math.abs(gaussian(random)) * 0.9;
      const angle = random() * TAU;
      dust.push({
        x: Math.cos(angle) * radius,
        y: gaussian(random) * 0.24,
        z: Math.sin(angle) * radius,
        size: 0.36 + random() * 0.65,
        alpha: 0.2 + random() * 0.48,
        color: random() < 0.62 ? STAR_AMBER : STAR_WHITE,
        phase: random() * TAU
      });
    }
    return dust;
  }

  function rgb(color, alpha) {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
  }

  function createNebula() {
    const random = mulberry32(0xC05A05);
    return Array.from({ length: 36 }, (_, index) => {
      const radius = 0.7 + (index / 36) * 5.9;
      const angle = (index % 2) * Math.PI + radius * SPIRAL_PITCH + SPIRAL_PHASE;
      return {
        x: Math.cos(angle) * radius,
        y: (random() - 0.5) * 0.16,
        z: Math.sin(angle) * radius,
        radius: 0.38 + random() * 0.55,
        color: index % 3 === 0 ? NEBULA_INDIGO : NEBULA_BLUE,
        alpha: 0.039 + random() * 0.036
      };
    });
  }

  class GalaxyScene {
    constructor(canvas, options = {}) {
      if (!canvas) throw new Error("GalaxyScene requires a canvas element");
      this.canvas = canvas;
      this.context = canvas.getContext("2d", { alpha: true });
      if (!this.context) throw new Error("Atlas requires a two-dimensional canvas context");
      this.options = options;
      this.nodes = [];
      this.nodeById = new Map();
      const defaultDustCount = window.innerWidth < 520 ? 1150 : window.innerWidth < 900 ? 1900 : 3400;
      this.dust = createDust(options.dustCount || defaultDustCount);
      this.nebula = createNebula();
      const backgroundRandom = mulberry32(0x57A2F13D);
      this.backgroundStars = Array.from({ length: window.innerWidth < 760 ? 70 : 150 }, () => ({
        x: backgroundRandom(), y: backgroundRandom(),
        size: 0.25 + backgroundRandom() * 0.6, alpha: 0.08 + backgroundRandom() * 0.2
      }));
      this.activeIds = new Set();
      this.rankById = new Map();
      this.rankLabels = [];
      this.highlightedId = null;
      this.mode = "home";
      this.panelOpen = false;
      this.width = 1;
      this.height = 1;
      this.pixelRatio = 1;
      this.rotation = -0.18;
      this.userRotation = 0;
      this.userTilt = 0;
      this.targetUserRotation = 0;
      this.targetUserTilt = 0;
      this.zoom = HOME_FIT;
      this.targetZoom = HOME_FIT;
      this.fitZoom = HOME_FIT;
      this.userZoom = 1;
      this.focus = { x: 0, y: 0, z: 0 };
      this.targetFocus = { x: 0, y: 0, z: 0 };
      this.centerX = window.innerWidth < 760 ? 0.5 : 0.68;
      this.centerY = window.innerWidth < 760 ? 0.49 : 0.54;
      this.spinBoost = 0;
      this.screenNodes = [];
      this.pointer = { x: 0, y: 0, inside: false, down: false, dragging: false, coarse: false, startX: 0, startY: 0 };
      this.activePointers = new Map();
      this.pinch = null;
      this.suppressSelection = false;
      this.suppressSingleDrag = false;
      this.destroyed = false;
      this.hovered = null;
      this.lastTime = performance.now();
      this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
      this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : null;
      this.resizeObserver?.observe(canvas);
      this.onWindowResize = () => this.resize();
      if (!this.resizeObserver) window.addEventListener("resize", this.onWindowResize, { passive: true });
      this.bindEvents();
      this.resize();
      this.onVisibilityChange = () => {
        if (document.hidden) {
          if (this.frame) cancelAnimationFrame(this.frame);
          this.frame = 0;
          this.cancelInteraction();
          this.setHovered(null);
        } else if (!this.frame) {
          this.lastTime = performance.now();
          this.frame = requestAnimationFrame((time) => this.draw(time));
        }
      };
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.frame = requestAnimationFrame((time) => this.draw(time));
    }

    setRecords(records) {
      this.nodes = createSemanticLayout(records);
      this.nodeById = new Map(this.nodes.map((node) => [node.id, node]));
      this.rankById.clear();
      this.rankLabels = [];
      this.highlightedId = null;
      return this.nodes;
    }

    setMode(mode) {
      this.mode = mode;
      if (mode !== "results") this.setRankedPapers([]);
      if (!["home", "results", "browse"].includes(mode)) this.setHighlightedPaper(null);
      if (mode !== "results" && mode !== "browse") this.setHovered(null);
      if (!this.canInteract()) this.cancelInteraction();
      if (mode === "home") {
        this.setFitZoom(HOME_FIT);
        this.targetFocus = { x: 0, y: 0, z: 0 };
        this.spinBoost = 0;
      } else if (mode === "search") {
        this.targetZoom = 0.84;
      } else if (mode === "detail") {
        this.targetZoom = 0.78;
      } else if (mode === "browse" || mode === "results") {
        this.targetZoom = this.fitZoom * this.userZoom;
      }
    }

    setActivePapers(ids) {
      this.activeIds = new Set(ids || []);
      if (this.hovered && !this.activeIds.has(this.hovered.id)) this.setHovered(null);
      if (this.highlightedId && !this.activeIds.has(this.highlightedId)) this.setHighlightedPaper(null);
      for (const id of this.rankById.keys()) {
        if (!this.activeIds.has(id)) this.rankById.delete(id);
      }
      const active = this.nodes.filter((node) => this.activeIds.has(node.id));
      if (!active.length) {
        this.targetFocus = { x: 0, y: 0, z: 0 };
        this.setFitZoom(HOME_FIT);
        this.spinBoost = 0;
        return;
      }
      const center = active.reduce((total, node) => ({
        x: total.x + node.x / active.length,
        y: total.y + node.y / active.length,
        z: total.z + node.z / active.length
      }), { x: 0, y: 0, z: 0 });
      const spread = Math.max(...active.map((node) => Math.hypot(
        node.x - center.x,
        node.y - center.y,
        node.z - center.z
      )), 0.5);
      this.targetFocus = center;
      // Fit the whole 3D selection, rather than the first match. Projection is
      // deliberately conservative so rotation cannot clip an outlying paper.
      this.setFitZoom(clamp(4.2 / (spread + 0.85), 0.82, 1.78));
      this.spinBoost = 0.000055;
    }

    // Relevance is an overlay, never a positional feature or a camera command.
    setRankedPapers(entries) {
      const ranks = new Map();
      for (const entry of Array.isArray(entries) ? entries : []) {
        if (!this.nodeById.has(entry?.id) || !this.activeIds.has(entry.id)
          || !Number.isInteger(entry.rank) || entry.rank < 1 || ranks.has(entry.id)) continue;
        ranks.set(entry.id, entry.rank);
      }
      this.rankById = ranks;
      this.rankLabels = [];
    }

    // List focus is deliberately separate from canvas hit testing. In
    // particular, this must not invoke onHover or change the click target.
    setHighlightedPaper(id) {
      this.highlightedId = this.nodeById.has(id) && this.activeIds.has(id) ? id : null;
    }

    setPanelOpen(open) {
      this.panelOpen = Boolean(open);
      if (this.panelOpen) this.cancelInteraction();
    }

    canInteract() {
      return !this.destroyed && !this.panelOpen && ["home", "browse", "results"].includes(this.mode);
    }

    getZoomState() {
      return { scale: this.userZoom, min: MIN_ZOOM, max: MAX_ZOOM };
    }

    setFitZoom(zoom) {
      this.fitZoom = zoom;
      this.userZoom = 1;
      this.targetZoom = zoom;
      this.options.onZoomChange?.(this.getZoomState());
    }

    setUserZoom(scale) {
      if (!this.canInteract() || !Number.isFinite(scale) || scale <= 0) return this.getZoomState();
      const next = clamp(scale, MIN_ZOOM, MAX_ZOOM);
      if (next === this.userZoom) return this.getZoomState();
      this.userZoom = next;
      this.targetZoom = this.fitZoom * next;
      // Hover hit testing catches up to the eased camera on the next frame.
      this.setHovered(null);
      this.options.onZoomChange?.(this.getZoomState());
      return this.getZoomState();
    }

    zoomBy(factor) {
      if (!Number.isFinite(factor) || factor <= 0) return this.getZoomState();
      return this.setUserZoom(clamp(this.userZoom * factor, MIN_ZOOM, MAX_ZOOM));
    }

    resetZoom() {
      return this.setUserZoom(1);
    }

    cancelInteraction() {
      const captured = [...this.activePointers.keys()];
      this.activePointers.clear();
      this.pinch = null;
      this.pointer.down = false;
      this.pointer.dragging = false;
      this.suppressSelection = false;
      this.suppressSingleDrag = false;
      captured.forEach((id) => {
        try { this.canvas.releasePointerCapture?.(id); } catch (_) { /* Capture may already be lost. */ }
      });
      this.setHovered(null);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, rect.width || window.innerWidth);
      this.height = Math.max(1, rect.height || window.innerHeight);
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.width < 900 ? 1.5 : 2);
      this.canvas.width = Math.round(this.width * this.pixelRatio);
      this.canvas.height = Math.round(this.height * this.pixelRatio);
      this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    }

    bindEvents() {
      const position = (event) => {
        const rect = this.canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      };
      const beginPinch = () => {
        const [first, second] = [...this.activePointers.values()];
        this.pinch = { distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)), scale: this.userZoom };
        this.suppressSelection = true;
        this.suppressSingleDrag = true;
        this.pointer.dragging = true;
        this.setHovered(null);
      };
      this.onPointerMove = (event) => {
        if (!this.canInteract()) return;
        const point = position(event);
        const previous = this.activePointers.get(event.pointerId);
        if (previous) this.activePointers.set(event.pointerId, point);
        if (this.activePointers.size >= 2) {
          const [first, second] = [...this.activePointers.values()];
          const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
          this.setUserZoom(this.pinch.scale * distance / this.pinch.distance);
          return;
        }
        // A finger left after a pinch must not suddenly become a rotation drag.
        if (this.activePointers.size && (!previous || this.suppressSingleDrag)) return;
        const movementX = point.x - (previous?.x ?? this.pointer.x);
        const movementY = point.y - (previous?.y ?? this.pointer.y);
        this.pointer.x = point.x;
        this.pointer.y = point.y;
        this.pointer.coarse = Boolean(event.pointerType && event.pointerType !== "mouse");
        this.pointer.inside = true;
        if (previous && this.pointer.down) {
          const deltaX = this.pointer.x - this.pointer.startX;
          const deltaY = this.pointer.y - this.pointer.startY;
          if (Math.hypot(deltaX, deltaY) > 3) this.pointer.dragging = true;
          if (this.pointer.dragging) {
            this.targetUserRotation += movementX * 0.0035;
            this.targetUserTilt = clamp(this.targetUserTilt + movementY * 0.002, -0.16, 0.16);
          }
        }
      };
      this.onPointerDown = (event) => {
        if (!this.canInteract() || (event.button !== undefined && event.button !== 0)) return;
        const point = position(event);
        this.activePointers.set(event.pointerId, point);
        try { this.canvas.setPointerCapture?.(event.pointerId); } catch (_) { /* Pointer may have ended before capture. */ }
        this.pointer.down = true;
        if (this.activePointers.size >= 2) {
          beginPinch();
          return;
        }
        this.pointer.x = point.x;
        this.pointer.y = point.y;
        this.pointer.coarse = Boolean(event.pointerType && event.pointerType !== "mouse");
        this.pointer.inside = true;
        this.suppressSelection = false;
        this.suppressSingleDrag = false;
        this.pointer.dragging = false;
        this.updateHover();
        this.pointer.startX = this.pointer.x;
        this.pointer.startY = this.pointer.y;
      };
      this.onPointerUp = (event) => {
        if (!this.activePointers.has(event.pointerId)) return;
        const shouldSelect = this.canInteract() && this.activePointers.size === 1
          && !this.suppressSelection && !this.pointer.dragging && this.hovered;
        this.activePointers.delete(event.pointerId);
        try { this.canvas.releasePointerCapture?.(event.pointerId); } catch (_) { /* Capture may already be released. */ }
        if (this.activePointers.size >= 2) {
          beginPinch();
          return;
        }
        this.pinch = null;
        if (this.activePointers.size) return;
        this.pointer.down = false;
        this.pointer.dragging = false;
        this.suppressSelection = false;
        this.suppressSingleDrag = false;
        if (shouldSelect) this.options.onSelect?.(shouldSelect.record);
      };
      this.onPointerLeave = () => {
        this.pointer.inside = false;
        this.setHovered(null);
      };
      this.onPointerCancel = (event) => {
        if (this.activePointers.has(event.pointerId)) this.cancelInteraction();
      };
      this.onWheel = (event) => {
        // Ctrl-wheel and Meta-wheel belong to browser/OS page zoom, not the map.
        if (!this.canInteract() || event.ctrlKey || event.metaKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
        event.preventDefault();
        const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
        this.zoomBy(Math.exp(clamp(-pixels * 0.0015, -1, 1)));
      };
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointerup", this.onPointerUp);
      this.canvas.addEventListener("pointercancel", this.onPointerCancel);
      this.canvas.addEventListener("lostpointercapture", this.onPointerCancel);
      this.canvas.addEventListener("pointerleave", this.onPointerLeave);
      this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    }

    project(point) {
      const angle = this.rotation + this.userRotation;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const sourceX = point.x - this.focus.x;
      const sourceY = point.y - this.focus.y;
      const sourceZ = point.z - this.focus.z;
      const rotatedX = sourceX * cosine - sourceZ * sine;
      const rotatedZ = sourceX * sine + sourceZ * cosine;
      const tilt = 0.58 + this.userTilt;
      const tiltCosine = Math.cos(tilt);
      const tiltSine = Math.sin(tilt);
      const rotatedY = sourceY * tiltCosine - rotatedZ * tiltSine;
      const depthZ = sourceY * tiltSine + rotatedZ * tiltCosine;
      const cameraDistance = 13.8;
      const depth = cameraDistance - depthZ;
      if (depth < 2.5) return null;
      const mobile = this.width < 760;
      const homepage = this.mode === "home" || this.mode === "browse";
      const focalLength = Math.min(
        this.width * (mobile ? 0.91 : homepage ? 0.56 : this.panelOpen ? 0.64 : 0.82),
        this.height * (mobile ? 0.48 : 0.8)
      ) * 0.96;
      const scale = focalLength / depth * this.zoom;
      return {
        x: this.width * this.centerX + rotatedX * scale,
        y: this.height * this.centerY + rotatedY * scale,
        depth,
        scale,
        depthAlpha: clamp(1.58 - depth / 21, 0.4, 1)
      };
    }

    drawGuides() {
      const context = this.context;
      const selection = this.mode === "browse" || this.mode === "results";
      context.save();
      context.strokeStyle = rgb(STAR_BLUE, selection ? 0.016 : 0.032);
      context.lineWidth = 0.6;
      for (const arm of [0, 1]) {
        context.beginPath();
        for (let index = 0; index <= 160; index += 1) {
          const radius = 0.16 + index / 160 * 6.64;
          const angle = arm * Math.PI + radius * SPIRAL_PITCH + SPIRAL_PHASE;
          const point = this.project({ x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius });
          if (!point) continue;
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
        context.stroke();
      }
      context.restore();
    }

    drawNebula() {
      const context = this.context;
      const selection = this.mode === "browse" || this.mode === "results";
      const visibility = this.mode === "search" || this.mode === "detail" ? 0.2 : selection ? 0.55 : 1;
      context.save();
      this.backgroundStars.forEach((star) => {
        context.fillStyle = rgb(STAR_WHITE, star.alpha * visibility);
        context.beginPath();
        context.arc(star.x * this.width, star.y * this.height, star.size, 0, TAU);
        context.fill();
      });
      const clouds = [{ x: 0, y: 0, z: 0, radius: 1.6, color: STAR_AMBER, alpha: 0.21 }, ...this.nebula];
      clouds.forEach((cloud) => {
        const point = this.project(cloud);
        if (!point) return;
        const radius = Math.max(1, cloud.radius * point.scale);
        if (point.x + radius < 0 || point.x - radius > this.width || point.y + radius < 0 || point.y - radius > this.height) return;
        const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
        gradient.addColorStop(0, rgb(cloud.color, cloud.alpha * visibility));
        gradient.addColorStop(0.38, rgb(cloud.color, cloud.alpha * visibility * 0.38));
        gradient.addColorStop(1, rgb(cloud.color, 0));
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, TAU);
        context.fill();
      });
      context.restore();
    }

    drawDust(time) {
      const context = this.context;
      context.save();
      const selection = this.mode === "browse" || this.mode === "results";
      this.dust.forEach((star) => {
        const projected = this.project(star);
        if (!projected || projected.x < -8 || projected.x > this.width + 8 || projected.y < -8 || projected.y > this.height + 8) return;
        const alpha = star.alpha * projected.depthAlpha * (this.mode === "search" || this.mode === "detail" ? 0.2 : selection ? 0.34 : 1);
        const radius = clamp(star.size * projected.scale * 0.018, 0.24, 1.15);
        context.fillStyle = rgb(star.color, alpha);
        context.beginPath();
        context.arc(projected.x, projected.y, radius, 0, TAU);
        context.fill();
      });
      context.restore();
    }

    drawConnections() {
      if ((this.mode !== "results" && this.mode !== "browse") || this.activeIds.size < 2) return;
      const projectedById = new Map(this.screenNodes.map((entry) => [entry.node.id, entry]));
      const context = this.context;
      context.save();
      const drawn = new Set();
      this.screenNodes.forEach((entry) => {
        if (!this.activeIds.has(entry.node.id)) return;
        entry.node.neighbors.slice(0, 5).forEach((neighbor) => {
          if (!this.activeIds.has(neighbor.id) || neighbor.similarity < 0.09) return;
          const key = entry.node.id < neighbor.id ? `${entry.node.id}:${neighbor.id}` : `${neighbor.id}:${entry.node.id}`;
          if (drawn.has(key)) return;
          drawn.add(key);
          const target = projectedById.get(neighbor.id);
          if (!target) return;
          // Once subjects share the full galaxy, unconstrained semantic edges
          // become long chords through the disc. Keep only nearby relationships
          // so a lens reads as a constellation rather than a web of spokes.
          if (Math.hypot(
            entry.node.x - target.node.x,
            entry.node.y - target.node.y,
            entry.node.z - target.node.z
          ) > 2.1) return;
          context.strokeStyle = rgb(STAR_AMBER, 0.045 + neighbor.similarity * 0.14);
          context.lineWidth = 0.65;
          context.beginPath();
          context.moveTo(entry.x, entry.y);
          context.lineTo(target.x, target.y);
          context.stroke();
        });
      });
      context.restore();
    }

    drawNodes(time) {
      const context = this.context;
      this.screenNodes = this.nodes
        .map((node) => {
          const projected = this.project(node);
          return projected ? { node, ...projected } : null;
        })
        .filter(Boolean)
        .sort((left, right) => right.depth - left.depth);

      this.drawConnections();
      context.save();
      this.screenNodes.forEach((entry) => {
        const selection = this.mode === "results" || this.mode === "browse";
        const active = selection && this.activeIds.has(entry.node.id);
        const hovered = this.hovered?.id === entry.node.id;
        const highlighted = this.highlightedId === entry.node.id && this.activeIds.has(entry.node.id);
        const emphasized = hovered || highlighted;
        const rank = this.mode === "results" ? this.rankById.get(entry.node.id) : null;
        const rankStrength = rank ? 1 / Math.sqrt(rank) : 0;
        const nodeColor = active ? STAR_AMBER : STAR_WHITE;
        let alpha = 0.88;
        let radius = clamp(entry.scale * 0.025, 1.15, 2.1);
        if (this.mode === "search" || this.mode === "detail") alpha = 0.09;
        if (selection) {
          alpha = active ? rank ? 0.26 + Math.pow(rankStrength, 0.8) * 0.74 : 0.98 : 0.075;
          // Search relevance uses screen-space size, so depth cannot reverse its order.
          radius = active ? rank ? 2.2 + 5.4 / Math.pow(rank, 0.7) : clamp(entry.scale * 0.034, 1.9, 3.7) : 0.75;
        }
        alpha *= rank ? 0.9 + entry.depthAlpha * 0.1 : entry.depthAlpha;
        entry.relevanceRadius = rank ? radius : null;
        entry.relevanceAlpha = rank ? alpha : null;
        // Small, restrained optical halos keep paper stars legible without
        // flattening the field into large neon markers or expensive shadows.
        if (active || (!selection && this.mode === "home")) {
          context.fillStyle = rgb(nodeColor, alpha * (active ? 0.065 + rankStrength * 0.025 : 0.025));
          context.beginPath();
          context.arc(entry.x, entry.y, radius * (emphasized ? 5.2 : 4.2 + rankStrength * 0.65), 0, TAU);
          context.fill();
          context.fillStyle = rgb(nodeColor, alpha * 0.12);
          context.beginPath();
          context.arc(entry.x, entry.y, radius * 2, 0, TAU);
          context.fill();
        }
        context.fillStyle = rgb(nodeColor, alpha);
        context.beginPath();
        context.arc(entry.x, entry.y, emphasized ? radius * 1.34 : radius, 0, TAU);
        context.fill();

        if (rank && rank <= 3 && !this.panelOpen) {
          context.strokeStyle = rgb(STAR_AMBER, rank === 1 ? 0.9 : 0.45);
          context.lineWidth = rank === 1 ? 1.3 : 0.9;
          context.beginPath();context.arc(entry.x, entry.y, radius + 5, 0, TAU);context.stroke();
        }
        if (emphasized) {
          context.strokeStyle = rgb(STAR_AMBER, highlighted ? 0.85 : 0.55);
          context.lineWidth = 0.85;
          context.beginPath();
          context.arc(entry.x, entry.y, radius + 6, 0, TAU);
          context.stroke();
          context.strokeStyle = rgb(STAR_AMBER, 0.18);
          context.beginPath();
          context.moveTo(entry.x - radius - 10, entry.y);
          context.lineTo(entry.x - radius - 6, entry.y);
          context.moveTo(entry.x + radius + 6, entry.y);
          context.lineTo(entry.x + radius + 10, entry.y);
          context.stroke();
        }
      });
      context.restore();
      this.drawClosestMatch();
    }

    drawClosestMatch() {
      this.rankLabels = [];
      if (this.mode !== 'results' || this.panelOpen) return;
      const point = this.screenNodes.find(entry => this.rankById.get(entry.node.id) === 1);
      if (!point) return;
      const context = this.context, radius = point.relevanceRadius;
      // Draw the closest-match accent last so nearby stars cannot cover it.
      context.save();context.strokeStyle = rgb(STAR_AMBER, 0.65);context.lineWidth = 1;
      context.beginPath();context.arc(point.x, point.y, radius + 11, 0, TAU);context.stroke();
      const text = 'Closest match';context.font = '14px Arial, sans-serif';
      const width = context.measureText(text).width + 20, height = 30;
      const blocks = typeof document === 'undefined' ? [] : ['#resultsHud','#searchStage','.atlas-nav','#galaxyViewActions'].map(selector=>document.querySelector(selector)).filter(el=>el&&!el.hidden&&el.getBoundingClientRect().height).map(el=>el.getBoundingClientRect());
      const candidates = [{x:point.x+26,y:point.y-15},{x:point.x-width-26,y:point.y-15},{x:point.x-width/2,y:point.y-55},{x:point.x-width/2,y:point.y+25}];
      const box = candidates.find(box=>box.x>12&&box.y>12&&box.x+width<this.width-12&&box.y+height<this.height-12
        &&!blocks.some(b=>box.x<b.right+8&&box.x+width>b.left-8&&box.y<b.bottom+8&&box.y+height>b.top-8)
        &&!this.screenNodes.some(other=>other!==point&&this.activeIds.has(other.node.id)&&other.x>box.x-12&&other.x<box.x+width+12&&other.y>box.y-12&&other.y<box.y+height+12));
      if (box) {
        context.fillStyle = 'rgba(8,14,25,0.94)';context.fillRect(box.x,box.y,width,height);
        context.strokeStyle = rgb(STAR_AMBER,0.55);context.strokeRect(box.x,box.y,width,height);
        context.fillStyle = '#f4d6a7';context.textBaseline = 'middle';context.fillText(text,box.x+10,box.y+height/2);
        this.rankLabels.push({id:point.node.id,rank:1,text,...box,width,height});
      }
      context.restore();
    }

    setHovered(node, screenPoint) {
      if (node?.id === this.hovered?.id) {
        if (node && screenPoint) this.options.onHover?.(node.record, screenPoint);
        return;
      }
      this.hovered = node || null;
      this.canvas.classList.toggle("is-node-hovered", Boolean(node));
      this.options.onHover?.(node?.record || null, screenPoint || null);
    }

    updateHover() {
      // Mini Atlas: its 30 real paper stars are selectable on the home map too.
      if (!this.pointer.inside || this.pointer.dragging || this.activePointers.size > 1 || this.panelOpen || !["home", "results", "browse"].includes(this.mode)) {
        this.setHovered(null);
        return;
      }
      let nearest = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      this.screenNodes.forEach((entry) => {
        if (!this.activeIds.has(entry.node.id)) return;
        const distance = Math.hypot(this.pointer.x - entry.x, this.pointer.y - entry.y);
        const hitRadius = this.pointer.coarse ? 22 : clamp(entry.scale * 0.11, 11, 18);
        if (distance <= hitRadius && distance < nearestDistance) {
          nearest = entry;
          nearestDistance = distance;
        }
      });
      this.setHovered(nearest?.node || null, nearest ? { x: nearest.x, y: nearest.y } : null);
    }

    draw(time) {
      if (this.destroyed) return;
      const delta = Math.min(48, time - this.lastTime || 16);
      this.lastTime = time;
      const rotationPaused = this.mode === "search"
        || this.mode === "detail"
        || Boolean(this.hovered)
        || this.pointer.down;
      if (!this.reducedMotion && !rotationPaused) {
        const baseSpeed = this.mode === "results" || this.mode === "browse" ? 0.000018 : 0.000013;
        this.rotation += delta * (baseSpeed + this.spinBoost);
        this.spinBoost *= 0.965;
      }
      const userEase = this.reducedMotion ? 1 : 0.075;
      const zoomEase = this.reducedMotion ? 1 : 0.055;
      const focusEase = this.reducedMotion ? 1 : 0.045;
      this.userRotation = lerp(this.userRotation, this.targetUserRotation, userEase);
      this.userTilt = lerp(this.userTilt, this.targetUserTilt, userEase);
      this.zoom = lerp(this.zoom, this.targetZoom, zoomEase);
      this.focus.x = lerp(this.focus.x, this.targetFocus.x, focusEase);
      this.focus.y = lerp(this.focus.y, this.targetFocus.y, focusEase);
      this.focus.z = lerp(this.focus.z, this.targetFocus.z, focusEase);
      const mobile = this.width < 760;
      const homepage = this.mode === "home" || this.mode === "browse";
      const targetCenterX = mobile ? 0.5 : homepage ? 0.68 : this.panelOpen ? 0.39 : 0.54;
      const targetCenterY = mobile ? 0.49 : 0.54;
      this.centerX = lerp(this.centerX, targetCenterX, zoomEase);
      this.centerY = lerp(this.centerY, targetCenterY, zoomEase);

      this.context.clearRect(0, 0, this.width, this.height);
      const visualTime = this.reducedMotion ? 0 : time;
      this.drawNebula();
      this.drawGuides();
      this.drawDust(visualTime);
      this.drawNodes(visualTime);
      this.updateHover();
      this.frame = requestAnimationFrame((nextTime) => this.draw(nextTime));
    }

    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.frame);
      this.cancelInteraction();
      this.resizeObserver?.disconnect();
      if (!this.resizeObserver) window.removeEventListener("resize", this.onWindowResize);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.canvas.removeEventListener("pointermove", this.onPointerMove);
      this.canvas.removeEventListener("pointerdown", this.onPointerDown);
      this.canvas.removeEventListener("pointerup", this.onPointerUp);
      this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
      this.canvas.removeEventListener("lostpointercapture", this.onPointerCancel);
      this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
      this.canvas.removeEventListener("wheel", this.onWheel);
    }
  }

  return {
    GalaxyScene,
    buildSemanticVectors,
    cosineSimilarity,
    createSemanticLayout,
    hashString,
    normalizeText
  };
});
