import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const galaxy = require("../assets/galaxy.js");
const topics = require("../assets/topics.js");
const { records } = JSON.parse(await readFile(new URL("../data/atlas_articles.json", import.meta.url), "utf8"));
const layout = galaxy.createSemanticLayout(records);

const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
const coordinates = (nodes) => nodes.map(({ id, categoryId, x, y, z }) => ({ id, categoryId, x, y, z }));
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const spiralResidual = (node) => Math.abs(wrapAngle(
  Math.atan2(node.z, node.x) - (node.spiralArm * Math.PI + Math.hypot(node.x, node.z) * 0.58 - 1.4)
));

function sceneFor(context, { width = 1440, height = 900, reducedMotion = false, onSelect, onZoomChange } = {}) {
  const originals = new Map();
  const replace = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  replace("window", {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: reducedMotion }),
    addEventListener() {},
    removeEventListener() {}
  });
  replace("document", { hidden: false, addEventListener() {}, removeEventListener() {} });
  replace("requestAnimationFrame", () => 1);
  replace("cancelAnimationFrame", () => {});
  const draws = [];
  const styles = [];
  const gradients = [];
  const drawing = new Proxy({}, {
    get: (_, key) => (...args) => {
      if (["arc", "moveTo", "lineTo", "clearRect", "setTransform", "createRadialGradient"].includes(key)) {
        assert.ok(args.every(Number.isFinite), `${key} uses finite canvas coordinates`);
      }
      draws.push([key, ...args]);
      if (key === "createRadialGradient") {
        const stops = [];
        gradients.push(stops);
        return { addColorStop: (offset, color) => stops.push([offset, color]) };
      }
    },
    set: (target, key, value) => {
      styles.push([key, value]);
      target[key] = value;
      return true;
    }
  });
  const listeners = new Map();
  const captures = new Set();
  const canvas = {
    width,
    height,
    getContext: () => drawing,
    getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }),
    addEventListener: (name, callback, options) => listeners.set(name, { callback, options }),
    removeEventListener: (name, callback) => {
      if (listeners.get(name)?.callback === callback) listeners.delete(name);
    },
    setPointerCapture: (id) => captures.add(id),
    releasePointerCapture: (id) => captures.delete(id),
    classList: { toggle() {} }
  };
  const dispatch = (name, attributes = {}) => {
    const event = { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
      deltaY: 0, deltaMode: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...attributes };
    listeners.get(name)?.callback(event);
    return event;
  };
  const scene = new galaxy.GalaxyScene(canvas, { dustCount: 24, onSelect, onZoomChange });
  scene.nodes = layout;
  scene.nodeById = new Map(layout.map((node) => [node.id, node]));
  context.after(() => {
    scene.destroy();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { scene, draws, styles, gradients, listeners, captures, dispatch };
}

test("semantic layout is finite, deterministic, and preserves all paper identities", () => {
  const again = galaxy.createSemanticLayout(records);
  assert.deepEqual(coordinates(again), coordinates(layout));
  const reordered = galaxy.createSemanticLayout([...records].reverse());
  const reorderedById = new Map(coordinates(reordered).map((node) => [node.id, node]));
  assert.deepEqual(coordinates(layout), coordinates(layout).map((node) => reorderedById.get(node.id)), "coordinates do not depend on catalog order");
  assert.deepEqual(layout.map((node) => node.id), records.map((record) => record.id));
  for (const node of layout) {
    assert.ok([node.x, node.y, node.z, ...node.vector].every(Number.isFinite));
    assert.equal(node.categoryId, topics.classifyPaper(node.record));
    assert.ok(node.spiralArm === 0 || node.spiralArm === 1);
    assert.ok(Math.hypot(node.x, node.z) < 7);
    for (const neighbor of node.neighbors) {
      assert.notEqual(neighbor.id, node.id);
      assert.ok(neighbor.similarity > 0 && neighbor.similarity <= 1.000001);
    }
  }
});

test("paper stars follow the same two spiral arms as the background galaxy", () => {
  const radii = layout.map((node) => Math.hypot(node.x, node.z));
  assert.ok(Math.min(...radii) < 0.25, "the collection reaches the galactic core");
  assert.ok(Math.max(...radii) > 6.2, "the collection reaches the outer arms");
  const armCounts = [0, 1].map((arm) => layout.filter((node) => node.spiralArm === arm).length);
  assert.ok(armCounts.every((count) => count > layout.length * 0.35), "both arms carry a substantial share of papers");
  const residuals = layout.map(spiralResidual).sort((left, right) => left - right);
  assert.ok(residuals[Math.floor(residuals.length * 0.9)] < 0.2, "at least 90% of papers sit close to an arm centerline");
  assert.ok(residuals[Math.floor(residuals.length * 0.99)] < 0.35, "arm width remains restrained at the tails");
});

test("subjects form contiguous neighborhoods and semantic neighbors remain locally close", () => {
  let within = 0;
  let withinCount = 0;
  let between = 0;
  let betweenCount = 0;
  for (let left = 0; left < layout.length; left += 1) {
    for (let right = left + 1; right < layout.length; right += 1) {
      if (layout[left].categoryId === layout[right].categoryId) {
        within += distance(layout[left], layout[right]);
        withinCount += 1;
      } else {
        between += distance(layout[left], layout[right]);
        betweenCount += 1;
      }
    }
  }
  assert.ok(within / withinCount < (between / betweenCount) * 0.5, "papers sharing a subject are materially closer");
  const expectedRoutes = [
    ["mechanisms", "pricing", "platforms", "innovation"],
    ["information", "organizations", "supply-chains", "policy"]
  ];
  expectedRoutes.forEach((route, arm) => {
    let previousMeanRadius = -Infinity;
    route.forEach((categoryId) => {
      const members = layout.filter((node) => node.categoryId === categoryId);
      assert.ok(members.every((node) => node.spiralArm === arm), `${categoryId}: stays on its assigned arm`);
      const meanRadius = members.reduce((sum, node) => sum + Math.hypot(node.x, node.z), 0) / members.length;
      assert.ok(meanRadius > previousMeanRadius, `${categoryId}: follows the neighboring subject ribbon`);
      previousMeanRadius = meanRadius;
    });
  });
  for (const definition of topics.DEFINITIONS) {
    const members = layout.filter((node) => node.categoryId === definition.id);
    assert.ok(members.length > 0);
    const radii = members.map((node) => Math.hypot(node.x, node.z));
    assert.ok(Math.max(...radii) - Math.min(...radii) > 0.75, `${definition.id}: reads as a ribbon rather than a point cluster`);
    assert.ok(Math.max(...radii) - Math.min(...radii) < 2.5, `${definition.id}: remains a local neighborhood`);
  }

  const byId = new Map(layout.map((node) => [node.id, node]));
  let neighborDistance = 0;
  let neighborCount = 0;
  layout.forEach((node) => node.neighbors.forEach((neighbor) => {
    neighborDistance += distance(node, byId.get(neighbor.id));
    neighborCount += 1;
  }));
  let baselineDistance = 0;
  let baselineCount = 0;
  for (let left = 0; left < layout.length; left += 17) {
    for (let right = left + 1; right < layout.length; right += 29) {
      baselineDistance += distance(layout[left], layout[right]);
      baselineCount += 1;
    }
  }
  assert.ok(neighborDistance / neighborCount < baselineDistance / baselineCount * 0.6,
    "semantic neighbors are closer than a stable cross-corpus baseline");
});

test("empty collections and sparse metadata produce valid layouts", () => {
  assert.deepEqual(galaxy.createSemanticLayout([]), []);
  const sparse = galaxy.createSemanticLayout([{ id: "one" }, { id: "two" }, { id: "three" }]);
  assert.equal(sparse.length, 3);
  assert.ok(sparse.every((node) => [node.x, node.y, node.z, ...node.vector].every(Number.isFinite)));
  assert.deepEqual(coordinates(sparse), coordinates(galaxy.createSemanticLayout([{ id: "one" }, { id: "two" }, { id: "three" }])));
  const indexed = galaxy.createSemanticLayout([{ id: "fixed-subject", primary_topic: "pricing", subject_id: "policy" }]);
  assert.equal(indexed[0].categoryId, "policy", "the Subject Index remains authoritative after note enrichment");
});

test("selection targets the actual 3D centroid without reshuffling the galaxy", (context) => {
  const { scene } = sceneFor(context);
  const before = coordinates(scene.nodes);
  const active = layout.filter((node) => node.categoryId === "information");
  scene.setActivePapers(active.map((node) => node.id));
  scene.setMode("browse");
  const center = active.reduce((sum, node) => ({
    x: sum.x + node.x / active.length,
    y: sum.y + node.y / active.length,
    z: sum.z + node.z / active.length
  }), { x: 0, y: 0, z: 0 });
  assert.deepEqual(scene.targetFocus, center);
  assert.notDeepEqual(scene.focus, center, "camera movement eases instead of snapping");
  assert.ok(scene.targetZoom >= 0.82 && scene.targetZoom <= 1.78);
  assert.deepEqual(coordinates(scene.nodes), before);
  scene.setActivePapers([]);
  assert.deepEqual(scene.targetFocus, { x: 0, y: 0, z: 0 });
  assert.equal(scene.targetZoom, 0.92);
  assert.equal(scene.spinBoost, 0);
});

test("home and browse hover target active paper stars and remain disabled behind Panels", (context) => {
  const { scene } = sceneFor(context);
  const [active, inactive] = layout;
  scene.setActivePapers([active.id]);
  scene.setMode("browse");
  scene.screenNodes = [
    { node: active, x: 100, y: 100, scale: 30 },
    { node: inactive, x: 200, y: 200, scale: 30 }
  ];
  scene.pointer = { inside: true, dragging: false, coarse: false, x: 100, y: 100 };
  scene.updateHover();
  assert.equal(scene.hovered.id, active.id);
  scene.pointer.x = 200;
  scene.pointer.y = 200;
  scene.updateHover();
  assert.equal(scene.hovered, null);
  scene.pointer.x = 100;
  scene.pointer.y = 100;
  scene.setPanelOpen(true);
  scene.updateHover();
  assert.equal(scene.hovered, null);
  scene.setPanelOpen(false);
  scene.setMode("home");
  scene.setActivePapers([active.id, inactive.id]);
  scene.updateHover();
  assert.equal(scene.hovered.id, active.id);
  scene.pointer.x = 200;
  scene.pointer.y = 200;
  scene.updateHover();
  assert.equal(scene.hovered.id, inactive.id, "every active real paper star is selectable on the home galaxy");
});

test("selected groups remain in frame through a full 3D rotation", (context) => {
  const { scene } = sceneFor(context);
  scene.setMode("browse");
  for (const definition of topics.DEFINITIONS) {
    const active = layout.filter((node) => node.categoryId === definition.id);
    scene.setActivePapers(active.map((node) => node.id));
    scene.focus = { ...scene.targetFocus };
    scene.zoom = scene.targetZoom;
    for (let step = 0; step < 24; step += 1) {
      scene.rotation = step / 24 * Math.PI * 2;
      for (const node of active) {
        const point = scene.project(node);
        assert.ok(point && point.x > scene.width * 0.4 && point.x < scene.width * 0.96, `${definition.id}: fits right-hand diagram`);
        assert.ok(point.y > scene.height * 0.2 && point.y < scene.height * 0.82, `${definition.id}: fits height`);
      }
    }
  }
});

test("mobile framing preserves space for top search and bottom topic controls", (context) => {
  const { scene } = sceneFor(context, { width: 390, height: 844 });
  scene.setMode("browse");
  scene.setActivePapers(layout.filter((node) => node.categoryId === "platforms").map((node) => node.id));
  scene.focus = { ...scene.targetFocus };
  scene.zoom = scene.targetZoom;
  for (const node of scene.nodes.filter((entry) => scene.activeIds.has(entry.id))) {
    const point = scene.project(node);
    assert.ok(point.x > 20 && point.x < 370);
    assert.ok(point.y > 220 && point.y < 560);
  }
});

test("deep-space rendering uses cool starlight and restrained amber nebulae, and respects reduced motion", (context) => {
  const { scene, draws, styles, gradients } = sceneFor(context, { reducedMotion: true });
  scene.setActivePapers(layout.filter((node) => node.categoryId === "platforms").map((node) => node.id));
  scene.setMode("browse");
  const rotation = scene.rotation;
  scene.draw(scene.lastTime + 16);
  assert.equal(scene.rotation, rotation);
  assert.deepEqual(scene.focus, scene.targetFocus);
  assert.ok(draws.some(([kind]) => kind === "arc"));
  assert.ok(draws.some(([kind]) => kind === "lineTo"));
  assert.ok(gradients.length > 0);
  assert.ok(!styles.some(([key, value]) => key === "globalCompositeOperation" && value === "lighter"));
  assert.ok(!styles.some(([key, value]) => key === "shadowBlur" && value > 0));
  for (const [key, value] of styles) {
    if ((key === "fillStyle" || key === "strokeStyle") && typeof value === "string") {
      assert.match(value, /^rgba\((?:225, 235, 250|133, 169, 227|77, 111, 176|111, 89, 154|241, 199, 138), /);
    }
  }
  assert.ok(gradients.flat().some(([, color]) => color.startsWith("rgba(241, 199, 138,")));
  assert.ok(gradients.flat().some(([, color]) => color.startsWith("rgba(77, 111, 176,")));
});

test("canvas wheel zoom normalizes pixel, line and page deltas and leaves browser zoom alone", (context) => {
  const states = [];
  const { scene, dispatch, listeners } = sceneFor(context, { onZoomChange: (state) => states.push(state) });
  assert.equal(listeners.get("wheel").options.passive, false);
  const pixel = dispatch("wheel", { deltaY: -32 });
  assert.equal(pixel.defaultPrevented, true);
  const pixelScale = scene.getZoomState().scale;
  assert.ok(pixelScale > 1);
  assert.equal(scene.zoom, 0.92, "wheel updates the target and lets animation ease the camera");
  scene.resetZoom();
  dispatch("wheel", { deltaY: -2, deltaMode: 1 });
  assert.equal(scene.getZoomState().scale, pixelScale);
  scene.resetZoom();
  dispatch("wheel", { deltaY: -32 / 900, deltaMode: 2 });
  assert.equal(scene.getZoomState().scale, pixelScale);
  for (const attributes of [{ ctrlKey: true }, { metaKey: true }, { deltaY: NaN }, { deltaY: 0 }]) {
    const event = dispatch("wheel", { deltaY: -100, ...attributes });
    assert.equal(event.defaultPrevented, false);
    assert.equal(scene.getZoomState().scale, pixelScale);
  }
  assert.ok(states.length >= 5);
});

test("manual zoom is bounded, invalid factors are ignored, and Fit preserves the selected centroid", (context) => {
  const { scene } = sceneFor(context);
  scene.setMode("browse");
  scene.setActivePapers(layout.filter((node) => node.categoryId === "information").map((node) => node.id));
  const focus = { ...scene.targetFocus };
  const fittedZoom = scene.targetZoom;
  const { min, max } = scene.getZoomState();
  scene.zoomBy(1e6);
  assert.equal(scene.getZoomState().scale, max);
  assert.equal(scene.targetZoom, fittedZoom * max);
  scene.zoomBy(1e-6);
  assert.equal(scene.getZoomState().scale, min);
  for (const invalid of [0, -1, NaN, Infinity, undefined]) {
    scene.zoomBy(invalid);
    assert.equal(scene.getZoomState().scale, min);
  }
  scene.resetZoom();
  assert.equal(scene.getZoomState().scale, 1);
  assert.equal(scene.targetZoom, fittedZoom);
  assert.deepEqual(scene.targetFocus, focus);
  assert.notDeepEqual(focus, { x: 0, y: 0, z: 0 });
  scene.setActivePapers([]);
  assert.equal(scene.getZoomState().scale, 1);
  assert.equal(scene.targetZoom, 0.92);
});

test("search, detail, loading, errors, and Panels do not accept map gestures", (context) => {
  const { scene, dispatch, captures } = sceneFor(context);
  for (const mode of ["search", "detail", "boot", "error"]) {
    scene.setMode(mode);
    const target = scene.targetZoom;
    const rotation = scene.targetUserRotation;
    assert.equal(dispatch("wheel", { deltaY: -100 }).defaultPrevented, false);
    dispatch("pointerdown");
    dispatch("pointermove", { clientX: 200 });
    scene.zoomBy(2);
    scene.resetZoom();
    assert.equal(scene.targetZoom, target, mode);
    assert.equal(scene.targetUserRotation, rotation, mode);
    assert.equal(captures.size, 0);
  }
  scene.setMode("results");
  scene.setPanelOpen(true);
  const target = scene.targetZoom;
  dispatch("pointerdown");
  scene.zoomBy(2);
  assert.equal(dispatch("wheel", { deltaY: -100 }).defaultPrevented, false);
  assert.equal(scene.targetZoom, target);
  assert.equal(captures.size, 0);
});

test("two-finger pinch zooms without rotating or selecting a paper, including after one finger lifts", (context) => {
  const selected = [];
  const { scene, dispatch, captures } = sceneFor(context, { onSelect: (paper) => selected.push(paper.id) });
  scene.setMode("browse");
  scene.setActivePapers([layout[0].id]);
  scene.screenNodes = [{ node: layout[0], x: 100, y: 100, scale: 30 }];
  dispatch("pointerdown", { pointerId: 1, pointerType: "touch" });
  assert.equal(scene.hovered.id, layout[0].id);
  dispatch("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 200 });
  assert.equal(scene.hovered, null);
  dispatch("pointermove", { pointerId: 2, pointerType: "touch", clientX: 300 });
  assert.equal(scene.getZoomState().scale, 2);
  assert.equal(scene.targetUserRotation, 0);
  assert.equal(scene.targetUserTilt, 0);
  dispatch("pointerup", { pointerId: 2, pointerType: "touch", clientX: 300 });
  dispatch("pointermove", { pointerId: 1, pointerType: "touch", clientX: 160 });
  assert.equal(scene.targetUserRotation, 0);
  dispatch("pointerup", { pointerId: 1, pointerType: "touch", clientX: 160 });
  assert.equal(selected.length, 0);
  assert.equal(scene.activePointers.size, 0);
  assert.equal(captures.size, 0);
  assert.equal(scene.pointer.down, false);
  dispatch("pointerdown", { pointerType: "touch" });
  dispatch("pointerup", { pointerType: "touch" });
  assert.deepEqual(selected, [layout[0].id], "a fresh tap still opens a selected paper");
});

test("single-pointer drag, cancellation, capture loss, and mode changes clean up gesture state", (context) => {
  const { scene, dispatch, captures } = sceneFor(context);
  dispatch("pointerdown", { button: 2 });
  assert.equal(scene.activePointers.size, 0, "secondary click does not start a drag");
  dispatch("pointerdown");
  dispatch("pointermove", { clientX: 150, clientY: 110 });
  assert.ok(scene.targetUserRotation > 0);
  assert.ok(scene.targetUserTilt > 0);
  dispatch("pointerleave");
  assert.equal(scene.pointer.down, true, "captured drags survive leaving canvas bounds");
  dispatch("pointercancel");
  assert.equal(scene.pointer.down, false);
  assert.equal(captures.size, 0);
  dispatch("pointerdown", { pointerType: "touch" });
  dispatch("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 200 });
  dispatch("lostpointercapture", { pointerId: 2 });
  assert.equal(scene.activePointers.size, 0);
  assert.equal(scene.pinch, null);
  assert.equal(captures.size, 0);
  dispatch("pointerdown");
  scene.setMode("search");
  assert.equal(scene.activePointers.size, 0);
  assert.equal(captures.size, 0);
});

test("reduced-motion zoom snaps on the next frame and disposal removes all listeners and captures", (context) => {
  const { scene, dispatch, listeners, captures, draws } = sceneFor(context, { reducedMotion: true });
  scene.zoomBy(1.5);
  scene.draw(scene.lastTime + 16);
  assert.equal(scene.zoom, scene.targetZoom);
  dispatch("pointerdown");
  assert.equal(captures.size, 1);
  scene.destroy();
  assert.equal(captures.size, 0);
  assert.equal(listeners.size, 0);
  const drawCount = draws.length;
  scene.draw(scene.lastTime + 16);
  assert.equal(draws.length, drawCount, "a stale animation callback cannot restart a disposed scene");
});
