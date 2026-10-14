"use strict";

const assert = require("node:assert/strict");
const renderer = require("../ui/graph-renderer.js");

assert.equal(renderer.HOVER_LENS_DELAY_MS, 80);
assert.equal(renderer.ZOOM_WHEEL_SENSITIVITY, 0.0022);

assert.equal(renderer.normalizedWheelDelta(3, 1, 800), 120, "three line-wheel units should match one conventional mouse notch");
assert.equal(renderer.normalizedWheelDelta(1, 2, 900), 180, "page-wheel input must be bounded before zooming");
assert.equal(renderer.normalizedWheelDelta(-999, 0, 800), -180, "large pixel deltas must be bounded symmetrically");
assert.ok(renderer.zoomFactorForWheel(-3, 1, 800) > 1.30, "mouse-wheel zoom-in should remain responsive");
assert.ok(renderer.zoomFactorForWheel(-10, 0, 800) < 1.04, "small trackpad deltas should remain smooth");
assert.equal(renderer.semanticHeatFloor({ nodes: Array.from({ length: 50 }) }), 0.40, "ordinary focused graphs need the stronger semantic floor");
assert.equal(renderer.semanticHeatFloor({ nodes: Array.from({ length: 61 }) }), 0.30, "dense graphs must retain the stable lower floor");

const movingPositions = new Map([["M", { x: 1, y: 2, vx: 3, vy: -4 }]]);
assert.deepEqual(renderer.clonePositionMap(movingPositions).get("M"), { x: 1, y: 2, vx: 3, vy: -4 });
assert.deepEqual(renderer.clonePositionMap(movingPositions, true).get("M"), { x: 1, y: 2, vx: 0, vy: 0 });

const modeSwitchContext = {
  mode: "galaxy",
  frame: 1,
  reducedTimer: null,
  alpha: 0.5,
  positions: movingPositions,
  viewport: { x: 0, y: 0, k: 1 },
  componentCenters: new Map(),
  modePositionState: new Map(),
  topologySignature: () => "MODE-SIGNATURE",
  signature: "",
  render() {},
};
renderer.Renderer.prototype.setMode.call(modeSwitchContext, "timeline");
assert.deepEqual(modeSwitchContext.modePositionState.get("galaxy").positions.get("M"), { x: 1, y: 2, vx: 3, vy: -4 }, "an interrupted galaxy layout must retain momentum");
modeSwitchContext.positions = new Map([["T", { x: 9, y: 9, vx: 0, vy: 0 }]]);
modeSwitchContext.frame = null;
modeSwitchContext.alpha = 0;
renderer.Renderer.prototype.setMode.call(modeSwitchContext, "galaxy");
assert.deepEqual(modeSwitchContext.positions.get("M"), { x: 1, y: 2, vx: 3, vy: -4 }, "returning to an interrupted galaxy layout must restore momentum");
assert.equal(modeSwitchContext.resumeModeSimulationAlpha, 0.5);

assert.equal(renderer.citationCountOf(null), null, "unknown citation counts must not collapse to zero");
assert.equal(renderer.citationCountOf(0), 0, "a verified zero citation count must remain distinct from unknown");
const citationNodes = Array.from({ length: 19 }, (_, citationCount) => ({ citationCount }));
citationNodes.push({ citationCount: 10000 }, { citationCount: null });
const citationStats = renderer.citationScaleStats(citationNodes);
assert.deepEqual(citationStats, { knownCount: 20, unknownCount: 1, min: 0, max: 10000, p95: 18 });
assert.equal(renderer.nodeRadius({ citationCount: null }, 12, "citations", 100), 8);
assert.equal(renderer.nodeRadius({ citationCount: 0 }, 12, "citations", 100), 8);
assert.equal(renderer.nodeRadius({ citationCount: 100 }, 12, "citations", 100), 17);
assert.equal(renderer.nodeRadius({ citationCount: 10000 }, 12, "citations", 100), 17, "citation outliers must be capped at P95");
assert.ok(renderer.nodeRadius({ citationCount: 10 }, 12, "citations", 100) > 8);
assert.equal(renderer.nodeRadius({ citationCount: 10 }, 0, "uniform", 100), 10);
assert.ok(renderer.nodeRadius({ citationCount: 10 }, 16, "degree", 100) > renderer.nodeRadius({ citationCount: 10 }, 1, "degree", 100));

const defaultActions = renderer.nodeActionSpecs({ isSeed: false, isPinned: false, candidateState: "unreviewed" });
assert.deepEqual(defaultActions.map(action => action.label), [
  "加入队列", "加入稍后阅读", "收起相邻节点", "保持显示", "标记不相关", "隐藏",
]);
const activeActions = renderer.nodeActionSpecs({ isSeed: true, isPinned: true, isCollapsed: true, candidateState: "reading-list" });
assert.deepEqual(activeActions.map(action => action.label), [
  "加入队列", "移出稍后阅读", "展开相邻节点", "取消保持显示", "标记不相关", "隐藏",
]);
assert.equal(activeActions.at(-1).disabled, true, "an active seed must be removed from the seed set before it can be hidden");
assert.equal(activeActions[4].disabled, true, "an active seed must be removed from the seed set before it can be excluded");
assert.equal(renderer.nodeActionSpecs({ isSeed: true, isQueued: true })[0].label, "移出队列", "queued search origins can be removed independently from the current result seeds");
assert.equal(renderer.nodeActionSpecs({ candidateState: "excluded" })[4].label, "恢复候选");
const queuedCandidateActions = renderer.nodeActionSpecs({ isQueued: true, isSeed: false });
assert.equal(queuedCandidateActions[4].disabled, true, "queued candidates must stay protected from exclusion");
assert.equal(queuedCandidateActions[5].disabled, true, "queued candidates must stay protected from hiding");
assert.match(queuedCandidateActions[4].title, /先移出队列/);
assert.match(queuedCandidateActions[5].title, /先移出队列/);
const queuedExcludedActions = renderer.nodeActionSpecs({ isQueued: true, candidateState: "excluded" });
assert.equal(queuedExcludedActions[4].label, "恢复候选");
assert.equal(queuedExcludedActions[4].disabled, false, "excluded queued candidates must remain recoverable");
const resultSeedActions = renderer.nodeActionSpecs({ isSeed: true, isQueued: false });
assert.match(resultSeedActions[4].title, /不能隐藏或排除/);
assert.match(resultSeedActions[5].title, /不能隐藏或排除/);
const protectedNeighbourActions = renderer.nodeActionSpecs({}, { hasNeighbors: false });
assert.equal(protectedNeighbourActions[2].disabled, true);
assert.match(protectedNeighbourActions[2].title, /暂无可收起/);
const collapsedWithoutVisibleNeighbours = renderer.nodeActionSpecs({ isCollapsed: true }, { hasNeighbors: false });
assert.equal(collapsedWithoutVisibleNeighbours[2].label, "展开相邻节点");
assert.equal(collapsedWithoutVisibleNeighbours[2].disabled, false);
assert.equal(renderer.nodeActionSpecs({ isActionPending: true }).every(action => action.disabled), true, "pending async actions must disable all commands for the node");

const collectionForwardAction = renderer.collectionReadingAction(
  renderer.nodeActionSpecs({ candidateState: "unreviewed" }).filter(action => action.group === "explore" && action.action !== "seed"),
);
const collectionReverseAction = renderer.collectionReadingAction(
  renderer.nodeActionSpecs({ candidateState: "reading-list" }).filter(action => action.group === "explore" && action.action !== "seed"),
);
assert.equal(collectionForwardAction.action, "reading-list", "collection add-to-reading action should be shown directly");
assert.equal(collectionReverseAction.action, "unreviewed", "collection remove-from-reading action should remain directly available");
assert.equal(renderer.collectionReadingAction([{ action: "pin" }, { action: "reading-list" }]), null, "direct collection action applies only when reading action is the sole action");

assert.deepEqual(renderer.actionMenuPosition(
  { left: 100, top: 100, bottom: 130 }, { width: 140, height: 100 }, { width: 400, height: 300 },
), { left: 100, top: 138, placement: "below" }, "menu should open below its trigger when there is room");
assert.deepEqual(renderer.actionMenuPosition(
  { left: 100, top: 250, bottom: 280 }, { width: 140, height: 100 }, { width: 400, height: 300 },
), { left: 100, top: 142, placement: "above" }, "menu should flip above its trigger when below space is insufficient");
assert.deepEqual(renderer.actionMenuPosition(
  { left: 350, top: 30, bottom: 50 }, { width: 200, height: 80 }, { width: 400, height: 200 },
), { left: 188, top: 58, placement: "below" }, "menu position should remain within the viewport horizontally");

assert.equal(renderer.dragThresholdExceeded(2, 2), false, "small pointer jitter must remain a click");
assert.equal(renderer.dragThresholdExceeded(5, 0), true, "deliberate movement must start a transient drag");
assert.equal(renderer.selectionRevealDelta({
  visibleLeft: 0, visibleRight: 500,
  haloLeft: 650, haloRight: 700,
  labelLeft: 620, labelRight: 780,
}), -240, "an overlay-obscured node must shift left enough to reveal its halo and 75% of its label");
assert.equal(renderer.selectionRevealDelta({
  visibleLeft: 214, visibleRight: 860,
  haloLeft: 803.25, haloRight: 853.65,
  labelLeft: 852.82, labelRight: 870.60,
  labelCoverage: Math.sqrt(0.75),
}).toFixed(2), "-8.22", "a bottom-edge label must shift upward while keeping the complete halo visible");
assert.equal(renderer.selectionRevealDelta({
  visibleLeft: 0, visibleRight: 500,
  haloLeft: 200, haloRight: 240,
  labelLeft: 170, labelRight: 330,
}), 0, "a visible selection must not move the viewport");
assert.equal(renderer.selectionRevealDelta({
  visibleLeft: 0, visibleRight: 500,
  haloLeft: -10, haloRight: 20,
  labelLeft: -100, labelRight: 100,
}), 50, "left-edge selections must keep the halo and at least 75% of the label visible");

const stationaryPressNode = { workKey: "POINTER-NODE", title: "Pointer selection" };
const stationaryPressGroup = { isConnected: true, focus() {} };
let stationaryPressSelection = null;
const stationaryPressContext = {
  dragState: { pointerId: 41, key: stationaryPressNode.workKey, moved: false },
  panState: null,
  positions: new Map([[stationaryPressNode.workKey, { x: 10, y: 20, fixed: true }]]),
  nodeElements: new Map([[stationaryPressNode.workKey, { node: stationaryPressNode, group: stationaryPressGroup }]]),
  data: { nodes: [stationaryPressNode] },
  svg: { releasePointerCapture() {} },
  lockedLensKey: null,
  selectNode(node, options) { stationaryPressSelection = { node, options }; },
};
renderer.Renderer.prototype.endPointer.call(stationaryPressContext, { type: "pointerup", pointerId: 41 });
assert.equal(stationaryPressSelection?.node, stationaryPressNode, "a stationary physical pointer release must select the captured node");
assert.deepEqual(stationaryPressSelection?.options, { lockLens: true, notify: true, focusReturn: stationaryPressGroup });
assert.equal(stationaryPressContext.positions.get(stationaryPressNode.workKey).fixed, false);
assert.equal(stationaryPressContext.dragState, null);
assert.ok(stationaryPressContext.suppressStageClickUntil > Date.now(), "the retargeted SVG click must not immediately clear the selection");

let cancelledPressSelections = 0;
const cancelledPressContext = {
  dragState: { pointerId: 42, key: stationaryPressNode.workKey, moved: false },
  panState: null,
  positions: new Map([[stationaryPressNode.workKey, { x: 10, y: 20, fixed: true }]]),
  nodeElements: new Map([[stationaryPressNode.workKey, { node: stationaryPressNode, group: stationaryPressGroup }]]),
  data: { nodes: [stationaryPressNode] },
  svg: { releasePointerCapture() {} },
  lockedLensKey: null,
  selectNode() { cancelledPressSelections++; },
};
renderer.Renderer.prototype.endPointer.call(cancelledPressContext, { type: "pointercancel", pointerId: 42 });
assert.equal(cancelledPressSelections, 0, "pointercancel must clear drag state without selecting a node");
assert.equal(cancelledPressContext.dragState, null);
assert.equal(cancelledPressContext.positions.get(stationaryPressNode.workKey).fixed, false);

const twelveSeedGeometry = renderer.seedLayoutGeometry(12);
const thirteenSeedGeometry = renderer.seedLayoutGeometry(13);
assert.equal(twelveSeedGeometry.dense, false);
assert.equal(thirteenSeedGeometry.dense, true);
assert.ok(thirteenSeedGeometry.extent >= thirteenSeedGeometry.clusterOrbit + thirteenSeedGeometry.maxLocalRadius);
assert.ok(thirteenSeedGeometry.extent > twelveSeedGeometry.extent, "the 12→13 seed layout transition must not underestimate dense cluster bounds");

const semanticSignatureContext = { mode: "galaxy" };
const semanticEdges = [{ edgeKey: "SIG-E", sourceWorkKey: "SIG-A", targetWorkKey: "SIG-B", type: "cites" }];
const ordinarySignature = renderer.Renderer.prototype.topologySignature.call(semanticSignatureContext, {
  nodes: [{ workKey: "SIG-A" }, { workKey: "SIG-B" }], edges: semanticEdges,
});
const seedSignature = renderer.Renderer.prototype.topologySignature.call(semanticSignatureContext, {
  nodes: [{ workKey: "SIG-A", isSeed: true }, { workKey: "SIG-B" }], edges: semanticEdges,
});
assert.notEqual(ordinarySignature, seedSignature, "changing the active seed set must invalidate the semantic layout");

const activeSetNodes = [
  { workKey: "AS-A", isSeed: true },
  { workKey: "AS-N1", isSeed: true },
  { workKey: "AS-N2", isSeed: true },
  { workKey: "AS-C" },
];
const activeSetTopology = renderer.buildPhysicsTopology(activeSetNodes, [
  { edgeKey: "AS-E", sourceWorkKey: "AS-A", targetWorkKey: "AS-C", type: "cites" },
]);
const activeSetPositions = new Map([
  ["AS-A", { x: 0, y: 0, vx: 0, vy: 0 }],
  ["AS-N1", { x: 60, y: -10, vx: 0, vy: 0 }],
  ["AS-N2", { x: 60, y: 10, vx: 0, vy: 0 }],
  ["AS-C", { x: 90, y: 0, vx: 1, vy: -1 }],
]);
const activeSetBefore = new Map([...activeSetPositions].map(([key, value]) => [key, { ...value }]));
const activeSetRepair = renderer.repairSeedProximityViolations(
  activeSetPositions,
  activeSetTopology,
  new Map(activeSetNodes.map(node => [node.workKey, 5])),
);
assert.equal(activeSetRepair.repairedCandidates, 1, "buffered Voronoi repair must resolve a switching nearest-nonincident active set");
assert.deepEqual(activeSetRepair.unresolved, []);
assert.equal(activeSetRepair.repaired[0].candidateKey, "AS-C");
assert.ok(activeSetRepair.repaired[0].passes <= 8);
assert.ok(activeSetRepair.repaired[0].semanticMargin >= 8);
assert.equal(renderer.seedProximityDiagnostics(activeSetPositions, activeSetTopology).exact, true);
for (const key of ["AS-A", "AS-N1", "AS-N2"]) assert.deepEqual(activeSetPositions.get(key), activeSetBefore.get(key));

function twoSeedRepairFixture(prefix, seedB, candidate, options = {}, reverse = false) {
  const nodes = [
    { workKey: `${prefix}-A`, isSeed: true },
    { workKey: `${prefix}-B`, isSeed: true },
    { workKey: `${prefix}-C` },
  ];
  if (reverse) nodes.reverse();
  const edges = [{
    edgeKey: `${prefix}-E`,
    sourceWorkKey: `${prefix}-A`,
    targetWorkKey: `${prefix}-C`,
    type: "cites",
  }];
  let positions = new Map([
    [`${prefix}-A`, { x: 0, y: 0, vx: 0, vy: 0 }],
    [`${prefix}-B`, { x: seedB.x, y: seedB.y, vx: 0, vy: 0 }],
    [`${prefix}-C`, { x: candidate.x, y: candidate.y, vx: 0, vy: 0 }],
  ]);
  if (reverse) positions = new Map([...positions].reverse());
  const topology = renderer.buildPhysicsTopology(nodes, reverse ? [...edges].reverse() : edges);
  const radii = new Map(nodes.map(node => [node.workKey, 1]));
  const result = renderer.repairSeedProximityViolations(positions, topology, radii, options);
  return { result, positions, topology };
}

const offAxisRepair = twoSeedRepairFixture("OA", { x: 40, y: 0 }, { x: 21, y: 100 });
assert.equal(offAxisRepair.result.repairedCandidates, 1, "repair must use exact Euclidean distance off the seed axis");
assert.deepEqual(offAxisRepair.result.unresolved, []);
assert.ok(offAxisRepair.result.repaired[0].semanticMargin >= 8);
assert.ok(offAxisRepair.result.repaired[0].minimumClearance >= 0);
assert.ok(offAxisRepair.result.repaired[0].pathLength <= 120);
assert.equal(renderer.seedProximityDiagnostics(offAxisRepair.positions, offAxisRepair.topology).exact, true);
const offAxisReverse = twoSeedRepairFixture("OA", { x: 40, y: 0 }, { x: 21, y: 100 }, {}, true);
assert.ok(Math.hypot(
  offAxisRepair.positions.get("OA-C").x - offAxisReverse.positions.get("OA-C").x,
  offAxisRepair.positions.get("OA-C").y - offAxisReverse.positions.get("OA-C").y,
) < 0.01, "Euclidean repair must be independent of provider ordering");

const curvedRepair = twoSeedRepairFixture(
  "CURVE",
  { x: 51.6338169, y: 25.3304861 },
  { x: 62.7440841, y: 39.6405563 },
);
assert.equal(curvedRepair.result.repairedCandidates, 1, "a curved gradient path must not exhaust its budget on one stale ray");
assert.deepEqual(curvedRepair.result.unresolved, []);
assert.ok(curvedRepair.result.repaired[0].semanticMargin >= 8);
assert.ok(curvedRepair.result.repaired[0].minimumClearance >= 0);
assert.ok(curvedRepair.result.repaired[0].pathLength <= 120);
assert.equal(renderer.seedProximityDiagnostics(curvedRepair.positions, curvedRepair.topology).exact, true);

const collisionAwareRepair = twoSeedRepairFixture(
  "COLL",
  { x: 27.53047181, y: -3.15017342 },
  { x: 17.92148582, y: -1.70037130 },
);
assert.equal(collisionAwareRepair.result.repairedCandidates, 1, "repair must route around the incident seed collision disk");
assert.equal(collisionAwareRepair.result.repaired[0].collisionAwareFallback, true);
assert.ok(collisionAwareRepair.result.repaired[0].displacement <= 12);
assert.ok(collisionAwareRepair.result.repaired[0].semanticMargin >= 8);
assert.ok(collisionAwareRepair.result.repaired[0].minimumClearance >= 0);
const collisionAwareReverse = twoSeedRepairFixture(
  "COLL",
  { x: 27.53047181, y: -3.15017342 },
  { x: 17.92148582, y: -1.70037130 },
  {},
  true,
);
assert.ok(Math.hypot(
  collisionAwareRepair.positions.get("COLL-C").x - collisionAwareReverse.positions.get("COLL-C").x,
  collisionAwareRepair.positions.get("COLL-C").y - collisionAwareReverse.positions.get("COLL-C").y,
) < 0.01, "collision-aware fallback must be independent of provider ordering");
const collisionAwareMirror = twoSeedRepairFixture(
  "COLL-M",
  { x: 27.53047181, y: 3.15017342 },
  { x: 17.92148582, y: 1.70037130 },
);
assert.equal(collisionAwareMirror.result.repairedCandidates, 1, "collision-aware fallback must also resolve the mirrored route");

const boundaryRepair = twoSeedRepairFixture(
  "BOUNDARY",
  { x: 24.21128346, y: 6.85115666 },
  { x: 120.23748151, y: 18.98788562 },
);
assert.equal(boundaryRepair.result.repairedCandidates, 1, "bounded fallback must find a feasible route near the displacement boundary");
assert.ok(boundaryRepair.result.repaired[0].displacement <= 120);
assert.ok(boundaryRepair.result.repaired[0].semanticMargin >= 8);
assert.ok(boundaryRepair.result.repaired[0].minimumClearance >= 0);
const hardCappedRepair = twoSeedRepairFixture(
  "HARD-CAP",
  { x: 24.21128346, y: 6.85115666 },
  { x: 120.23748151, y: 18.98788562 },
  { maxDisplacement: 200 },
);
assert.equal(hardCappedRepair.result.maxDisplacement, 120, "explicit options must not raise the hard displacement cap");
assert.ok(hardCappedRepair.result.repaired[0].displacement <= 120);
const budgetedFallback = twoSeedRepairFixture(
  "FALLBACK-BUDGET",
  { x: 27.53047181, y: -3.15017342 },
  { x: 17.92148582, y: -1.70037130 },
  { maxFallbackEvaluations: 120 },
);
assert.ok(budgetedFallback.result.fallbackEvaluations <= 120, "collision-aware fallback must honor its global evaluation budget");
assert.equal(budgetedFallback.result.maxFallbackEvaluations, 120);

const boundedRepair = twoSeedRepairFixture(
  "BOUND",
  { x: 51.6338169, y: 25.3304861 },
  { x: 62.7440841, y: 39.6405563 },
  { maxDisplacement: 10 },
);
assert.equal(boundedRepair.result.repairedCandidates, 0);
assert.deepEqual(boundedRepair.result.unresolved, ["BOUND-C"]);
assert.deepEqual(boundedRepair.positions.get("BOUND-C"), { x: 62.7440841, y: 39.6405563, vx: 0, vy: 0 });
assert.equal(boundedRepair.result.maxDisplacement, 10, "repair must expose and honor its hard displacement budget");
const exhaustedRepair = twoSeedRepairFixture(
  "EXHAUSTED",
  { x: 51.6338169, y: 25.3304861 },
  { x: 62.7440841, y: 39.6405563 },
  { maxDisplacement: 10, maxFallbackEvaluations: 120 },
);
assert.equal(exhaustedRepair.result.fallbackBudgetExhausted, true);
assert.equal(exhaustedRepair.result.fallbackCandidateBudgetExhaustions, 1, "per-candidate fallback exhaustion must be explicit");

const fixedNodes = [
  { workKey: "FIXED-A", isSeed: true },
  { workKey: "FIXED-B", isSeed: true },
  { workKey: "FIXED-C" },
];
const fixedTopology = renderer.buildPhysicsTopology(fixedNodes, [{
  edgeKey: "FIXED-E", sourceWorkKey: "FIXED-A", targetWorkKey: "FIXED-C", type: "cites",
}]);
const fixedPositions = new Map([
  ["FIXED-A", { x: 0, y: 0, vx: 0, vy: 0 }],
  ["FIXED-B", { x: 40, y: 0, vx: 0, vy: 0 }],
  ["FIXED-C", { x: 21, y: 100, vx: 0, vy: 0, fixed: true }],
]);
const fixedResult = renderer.repairSeedProximityViolations(
  fixedPositions,
  fixedTopology,
  new Map([["FIXED-A", 1], ["FIXED-B", 1], ["FIXED-C", 1]]),
);
assert.deepEqual(fixedResult.unresolved, ["FIXED-C"], "a pinned semantic violation must be reported instead of silently skipped");

assert.equal(renderer.semanticLayoutSatisfied({ total: 150, rate: 0.9467, violations: 7, worstRank: 4 }, 200), true);
assert.equal(renderer.semanticLayoutSatisfied({ total: 150, rate: 0.9467, violations: 9, worstRank: 4 }, 200), true);
assert.equal(renderer.semanticLayoutSatisfied({ total: 150, rate: 0.9467, violations: 10, worstRank: 4 }, 200), false);
assert.match(
  renderer.semanticWarningText({ total: 150, rate: 0.89, violations: 8, worstRank: 5 }, 200),
  /密集图.*以连线关系为准/,
);
assert.equal(renderer.semanticWarningText({ total: 150, rate: 0.95, violations: 7, worstRank: 4 }, 200), "");
const degradedWarning = { hidden: true, textContent: "" };
const degradedContainer = { dataset: {} };
const degradedContext = {
  positions: new Map([
    ["FIXED-A", { x: 0, y: 0 }],
    ["FIXED-B", { x: 40, y: 0 }],
    ["FIXED-C", { x: 39, y: 0 }],
  ]),
  physicsTopology: fixedTopology,
  data: { nodes: Array.from({ length: 61 }) },
  container: degradedContainer,
  semanticWarning: degradedWarning,
};
const degradedReport = renderer.Renderer.prototype.updateSemanticDiagnostics.call(degradedContext);
assert.equal(degradedReport.satisfied, false);
assert.equal(degradedContainer.dataset.semanticState, "degraded");
assert.match(degradedWarning.textContent, /以连线关系为准/);
assert.equal(renderer.semanticWarningForRender(degradedContext.lastSemanticReport, "galaxy"), degradedWarning.textContent, "a resize-only galaxy render must preserve the degraded warning");
assert.equal(renderer.semanticWarningForRender(degradedContext.lastSemanticReport, "timeline"), "", "timeline must not display galaxy-distance diagnostics");

const hitElements = new Map([
  ["lower", { radius: 10 }],
  ["upper", { radius: 10 }],
]);
const overlappedDisplay = new Map([
  ["lower", { x: 50, y: 50 }],
  ["upper", { x: 50, y: 50 }],
]);
assert.deepEqual(
  renderer.orderedHitKeys(hitElements, overlappedDisplay, { x: 50, y: 50 }, ["lower", "upper"]),
  ["upper", "lower"],
  "overlap cycling must start with the visually topmost SVG node",
);
const diffusedDisplay = new Map([
  ["lower", { x: 50, y: 50 }],
  ["upper", { x: 130, y: 50 }],
]);
assert.deepEqual(
  renderer.orderedHitKeys(hitElements, diffusedDisplay, { x: 130, y: 50 }, ["lower", "upper"]),
  ["upper"],
  "hit testing must follow the current diffused display positions",
);

const keyboardPositions = new Map([
  ["center", { x: 0, y: 0 }],
  ["right-near", { x: 20, y: 2 }],
  ["right-far", { x: 60, y: 0 }],
  ["down", { x: 0, y: 30 }],
]);
assert.equal(renderer.nearestDirectionalKey(keyboardPositions, "center", "ArrowRight"), "right-near");
assert.equal(renderer.nearestDirectionalKey(keyboardPositions, "center", "ArrowDown"), "down");
assert.equal(renderer.nearestDirectionalKey(keyboardPositions, "center", "ArrowLeft"), null);

assert.equal(renderer.keyOf({ workKey: "openalex:W1" }), "openalex:W1");
assert.equal(renderer.keyOf({ libraryID: 1, itemKey: "ABC" }), "1:ABC");
assert.deepEqual(renderer.edgeKeys({ sourceWorkKey: "openalex:W2", targetWorkKey: "openalex:W1" }), {
  source: "openalex:W2",
  target: "openalex:W1",
});
const backwardsTimelineCitation = renderer.edgeLineGeometry({ x: 900, y: 100 }, { x: 70, y: 100 }, 10, 10);
assert.ok(backwardsTimelineCitation.endX < backwardsTimelineCitation.startX, "a newer paper citing an older paper must keep its real right-to-left source→target direction");
assert.equal(renderer.hashUnit("graph"), renderer.hashUnit("graph"));
assert.ok(renderer.hashUnit("graph") >= 0 && renderer.hashUnit("graph") <= 1);
assert.notEqual(renderer.hashUnit("graph"), renderer.hashUnit("methods"));
assert.ok(renderer.estimatedLabelWidth("水合物", 10) > renderer.estimatedLabelWidth("abc", 10));

const signatureFor = data => renderer.Renderer.prototype.dataSignature.call({ data, mode: "galaxy", nodeSizeMode: "citations" });
const signatureNodes = [
  { workKey: "W1", title: "First", year: 2020, localKeys: ["A"], authors: [{ name: "Author A" }] },
  { workKey: "W2", title: "Second", year: 2021, localKeys: [], authors: [{ name: "Author B" }] },
];
const signatureEdges = [{ edgeKey: "E1", sourceWorkKey: "W1", targetWorkKey: "W2", type: "cites" }];
assert.equal(
  signatureFor({ nodes: signatureNodes, edges: signatureEdges }),
  signatureFor({ nodes: [...signatureNodes].reverse(), edges: [...signatureEdges].reverse() }),
  "visual signatures must be independent of provider return order",
);
assert.notEqual(
  signatureFor({ nodes: signatureNodes, edges: signatureEdges }),
  signatureFor({ nodes: [{ ...signatureNodes[0], isRetracted: true }, signatureNodes[1]], edges: signatureEdges }),
  "metadata that changes SVG semantics or accessible text must invalidate the visual signature",
);
assert.notEqual(
  signatureFor({ nodes: [{ ...signatureNodes[0], isQueued: true }, signatureNodes[1]], edges: signatureEdges }),
  signatureFor({ nodes: signatureNodes, edges: signatureEdges }),
  "queue state changes must invalidate the visual signature and refresh selected-node details",
);
assert.equal(
  signatureFor({ nodes: signatureNodes, edges: signatureEdges }),
  signatureFor({
    nodes: signatureNodes,
    edges: [{ ...signatureEdges[0], status: "verified", provider: "openalex", comment: "detail only", evidence: [{ source: "PDF" }] }],
  }),
  "detail-only edge evidence must not force an identical SVG topology to rebuild",
);
assert.notEqual(
  signatureFor({ nodes: signatureNodes, edges: signatureEdges }),
  signatureFor({ nodes: signatureNodes, edges: [{ ...signatureEdges[0], type: "similar" }] }),
  "an edge-type change must still invalidate the SVG visual signature",
);

const classList = initial => {
  const values = new Set(initial || []);
  return {
    values,
    toggle(name, force) {
      if (force) values.add(name);
      else values.delete(name);
      return Boolean(force);
    },
    contains(name) { return values.has(name); },
  };
};
const highlightGroup = () => ({ classList: classList(), attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } });
const focusSvg = { classList: classList() };
const focusGroups = new Map([
  ["A", { group: highlightGroup() }],
  ["B", { group: highlightGroup() }],
  ["C", { group: highlightGroup() }],
]);
const focusContext = {
  selection: { kind: "node", value: { workKey: "A" } },
  svg: focusSvg,
  neighbors: new Map([["A", new Set(["B"])], ["C", new Set(["B"])]]),
  nodeElements: focusGroups,
  edgeElements: new Map(),
  keyboardFocusKey: "A",
};
renderer.Renderer.prototype.updateHighlight.call(focusContext);
assert.equal(focusSvg.classList.contains("has-locked-focus"), true);
assert.equal(focusGroups.get("B").group.classList.contains("is-related"), true, "one-hop nodes need an explicit related style");
assert.equal(focusGroups.get("C").group.classList.contains("is-dimmed"), true);
renderer.Renderer.prototype.updateHighlight.call(focusContext, "C");
assert.equal(focusSvg.classList.contains("has-hover-focus"), true);
assert.equal(focusGroups.get("A").group.classList.contains("is-dimmed"), false, "the locked selection must remain visible while another node is hovered");
assert.equal(focusGroups.get("B").group.classList.contains("is-related"), true);

const backingOldNode = { ...signatureNodes[0], discovery: { rank: 1 } };
const backingNextNode = { ...signatureNodes[0], discovery: { rank: 2 } };
const backingOldEdge = { ...signatureEdges[0], comment: "old" };
const backingNextEdge = { ...signatureEdges[0], comment: "new" };
const nodeBacking = { node: backingOldNode };
const edgeBacking = { edge: backingOldEdge };
let backingRendered = false;
const backingContext = {
  data: { nodes: [backingOldNode], edges: [backingOldEdge] },
  mode: "galaxy",
  nodeSizeMode: "citations",
  signature: signatureFor({ nodes: [backingOldNode], edges: [backingOldEdge] }),
  selection: null,
  pendingGeometrySimulation: false,
  nodeElements: new Map([["W1", nodeBacking]]),
  edgeElements: new Map([["E1", edgeBacking]]),
  dataSignature: renderer.Renderer.prototype.dataSignature,
  geometrySignature: renderer.Renderer.prototype.geometrySignature,
  positionTopologySignature: renderer.Renderer.prototype.positionTopologySignature,
  updateCounts() {},
  updateHighlight() {},
  render() { backingRendered = true; },
  restoreSelectionViewport() {},
};
renderer.Renderer.prototype.setData.call(backingContext, { nodes: [backingNextNode], edges: [backingNextEdge] });
assert.equal(backingRendered, false, "detail-only data updates must preserve the SVG instance");
assert.equal(nodeBacking.node, backingNextNode, "preserved node DOM must receive the newest backing data");
assert.equal(edgeBacking.edge, backingNextEdge, "preserved edge DOM must receive the newest backing data");

const sparsePoints = Array.from({ length: 100 }, (_, index) => ({ x: index * 1000, y: 0 }));
const sparsePairs = renderer.forEachNearbyPair(sparsePoints, 360, 120);
assert.equal(sparsePairs, 0, "spatial grid must skip distant all-pairs work");
const clusteredPoints = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 500, y: 0 }];
const visited = [];
assert.equal(renderer.forEachNearbyPair(clusteredPoints, 100, 40, (left, right) => visited.push([left, right])), 1);
assert.deepEqual(visited, [[0, 1]]);

const collisionLeft = { x: 0, y: 0, fixed: false };
const collisionRight = { x: 10, y: 0, fixed: false };
const overlapBefore = renderer.resolveCollisionPair(collisionLeft, collisionRight, 30, 1);
assert.equal(overlapBefore, 20);
assert.ok(
  Math.hypot(collisionLeft.x - collisionRight.x, collisionLeft.y - collisionRight.y) > 26,
  "collision relaxation should resolve most of a core overlap in one high-alpha step",
);
const fixedCollision = { x: 0, y: 0, fixed: true };
const movingCollision = { x: 4, y: 0, fixed: false };
renderer.resolveCollisionPair(fixedCollision, movingCollision, 20, 1);
assert.deepEqual(fixedCollision, { x: 0, y: 0, fixed: true }, "dragged/fixed nodes must remain anchored during collision relaxation");
assert.ok(movingCollision.x > 17, "the movable node should absorb the full collision correction against a fixed node");

const base = { x: 20, y: 0 };
const diffused = renderer.diffusePoint(base, { x: 0, y: 0 }, { radius: 100, push: 50, strength: 1 });
assert.ok(diffused.x > base.x, "diffusion lens must move a nearby node away from the pointer");
assert.deepEqual(base, { x: 20, y: 0 }, "diffusion lens must not mutate the stable graph position");
assert.deepEqual(renderer.diffusePoint(base, { x: 0, y: 0 }, { radius: 100, push: 50, strength: 1, anchored: true }), base);
assert.deepEqual(renderer.diffusePoint({ x: 200, y: 0 }, { x: 0, y: 0 }, { radius: 100, push: 50, strength: 1 }), { x: 200, y: 0 });

const lensPositions = new Map([["focus", { x: 0, y: 0 }]]);
for (let index = 1; index <= 16; index++) lensPositions.set(`n${index}`, { x: index * 12, y: 0 });
const galaxyLens = renderer.adaptiveLensParameters(lensPositions, "focus", 1, "galaxy");
const timelineLens = renderer.adaptiveLensParameters(lensPositions, "focus", 1, "timeline");
assert.equal(galaxyLens.targetCount, 12);
assert.equal(timelineLens.targetCount, 10);
assert.ok(galaxyLens.radiusScreen >= 180 && galaxyLens.radiusScreen <= 260);
assert.ok(timelineLens.radiusScreen >= 210 && timelineLens.radiusScreen <= 330);
const stronger = renderer.diffusePoint({ x: 60, y: 0 }, { x: 0, y: 0 }, { radius: 180, push: 96, strength: 1, exponent: galaxyLens.exponent });
assert.ok(stronger.x - 60 > 45, "adaptive lens should create a clearly visible displacement for nearby context nodes");

const timelineNodes = [
  { workKey: "W1999A", year: 1999, citationCount: 10 },
  { workKey: "W1999B", year: 1999, citationCount: 5 },
  { workKey: "W2000A", year: 2000, citationCount: 8 },
  { workKey: "W2001A", year: 2001, citationCount: 4 },
];
const timeline = renderer.timelineLaneLayout(timelineNodes, 1000, 600);
assert.equal(timeline.size, timelineNodes.length);
assert.equal(timeline.get("W1999A").x, timeline.get("W1999B").x, "same-year nodes must remain on the same time coordinate");
assert.equal(timeline.get("W1999A").x, 70, "the earliest observed year must use the left edge instead of reserving an artificial 1950 gap");
assert.equal(timeline.get("W2001A").x, 930, "the latest observed year must use the right edge");
assert.notEqual(timeline.get("W1999A").y, timeline.get("W1999B").y, "same-year nodes should use different lanes when capacity is available");
assert.ok(timeline.get("W2001A").x > timeline.get("W2000A").x, "time coordinates must remain ordered");

const topologyNodes = [
  { workKey: "S1", isSeed: true }, { workKey: "S2", isSeed: true },
  { workKey: "C1" }, { workKey: "C2" }, { workKey: "ISO1", isSeed: true }, { workKey: "ISO2", isSeed: true },
];
const topologyEdges = [
  { edgeKey: "E1", sourceWorkKey: "S1", targetWorkKey: "C1", type: "cites" },
  { edgeKey: "E2", sourceWorkKey: "S2", targetWorkKey: "C1", type: "similar" },
  { edgeKey: "E3", sourceWorkKey: "C1", targetWorkKey: "C2", type: "cites" },
  { edgeKey: "E4", sourceWorkKey: "S1", targetWorkKey: "C1", type: "similar" },
];
const topology = renderer.buildPhysicsTopology(topologyNodes, topologyEdges);
assert.equal(topology.links.length, 3, "multiple display edges for one pair must become one physics spring");
assert.equal(topology.links.find(link => link.pairKey === "C1\0S1").primaryType, "cites", "citation semantics must win over a duplicate recommendation spring");
assert.equal(topology.links.find(link => link.pairKey === "C1\0S1").multiplicity, 1, "a recommendation edge must not inflate citation spring strength");
assert.equal(topology.components.length, 3);

function runDeterministicLayout(nodes, edges, steps = 51, decay = 0.925) {
  const layout = renderer.topologyInitialPositions(nodes, edges, 1000, 700);
  const context = {
    data: { nodes, edges },
    positions: layout.positions,
    physicsTopology: layout.topology,
    componentCenters: layout.centers,
    nodeElements: new Map(nodes.map(node => [node.workKey, { radius: 10 }])),
    alpha: 0.82,
    dimensions: () => ({ width: 1000, height: 700 }),
    relaxCollisions: renderer.Renderer.prototype.relaxCollisions,
    settleLayoutConstraints: renderer.Renderer.prototype.settleLayoutConstraints,
  };
  for (let step = 0; step < steps; step++) {
    renderer.Renderer.prototype.simulationStep.call(context);
    context.alpha *= decay;
  }
  renderer.Renderer.prototype.settleLayoutConstraints.call(context, 2);
  return context.positions;
}

const forwardLayout = runDeterministicLayout(topologyNodes, topologyEdges);
const reverseLayout = runDeterministicLayout([...topologyNodes].reverse(), [...topologyEdges].reverse());
for (const node of topologyNodes) {
  const forward = forwardLayout.get(node.workKey);
  const reverse = reverseLayout.get(node.workKey);
  assert.ok(Math.hypot(forward.x - reverse.x, forward.y - reverse.y) < 0.01, `layout must ignore input order for ${node.workKey}`);
}
const mainKeys = new Set(["S1", "S2", "C1", "C2"]);
const mainPositions = [...mainKeys].map(key => forwardLayout.get(key));
const mainBox = {
  left: Math.min(...mainPositions.map(value => value.x)) - 10,
  right: Math.max(...mainPositions.map(value => value.x)) + 10,
  top: Math.min(...mainPositions.map(value => value.y)) - 10,
  bottom: Math.max(...mainPositions.map(value => value.y)) + 10,
};
for (const key of ["ISO1", "ISO2"]) {
  const value = forwardLayout.get(key);
  assert.ok(value.x < mainBox.left || value.x > mainBox.right || value.y < mainBox.top || value.y > mainBox.bottom, `${key} must not imply membership in the main component`);
}

const manySeeds = Array.from({ length: 37 }, (_, index) => ({ workKey: `MS${String(index).padStart(2, "0")}`, isSeed: true }));
const manyCandidates = Array.from({ length: 13 }, (_, index) => ({ workKey: `MC${String(index).padStart(2, "0")}` }));
const manyEdges = manyCandidates.flatMap((candidate, index) => [0, 1, 2].map(offset => ({
  edgeKey: `ME${index}-${offset}`,
  sourceWorkKey: manySeeds[(index * 7 + offset * 11) % manySeeds.length].workKey,
  targetWorkKey: candidate.workKey,
  type: "cites",
})));
const manyPositions = runDeterministicLayout([...manySeeds, ...manyCandidates], manyEdges);
let nearestIncidentHits = 0;
for (const candidate of manyCandidates) {
  const candidatePosition = manyPositions.get(candidate.workKey);
  const nearestSeed = [...manySeeds].sort((left, right) => {
    const leftPosition = manyPositions.get(left.workKey);
    const rightPosition = manyPositions.get(right.workKey);
    return Math.hypot(candidatePosition.x - leftPosition.x, candidatePosition.y - leftPosition.y)
      - Math.hypot(candidatePosition.x - rightPosition.x, candidatePosition.y - rightPosition.y);
  })[0].workKey;
  const incident = manyEdges.some(edge => edge.targetWorkKey === candidate.workKey && edge.sourceWorkKey === nearestSeed);
  nearestIncidentHits += Number(incident);
}

const pairSeeds = Array.from({ length: 14 }, (_, index) => ({ workKey: `PS${String(index).padStart(2, "0")}`, isSeed: true }));
const pairCandidates = [];
const pairEdges = [];
for (let left = 0; left < pairSeeds.length; left++) {
  for (let right = left + 1; right < pairSeeds.length; right++) {
    const candidate = { workKey: `PC${String(left).padStart(2, "0")}-${String(right).padStart(2, "0")}` };
    pairCandidates.push(candidate);
    pairEdges.push(
      { edgeKey: `PE${left}-${right}-L`, sourceWorkKey: pairSeeds[left].workKey, targetWorkKey: candidate.workKey, type: "cites" },
      { edgeKey: `PE${left}-${right}-R`, sourceWorkKey: pairSeeds[right].workKey, targetWorkKey: candidate.workKey, type: "cites" },
    );
  }
}
const pairPositions = runDeterministicLayout([...pairSeeds, ...pairCandidates], pairEdges);
let pairNearestIncidentHits = 0;
for (const candidate of pairCandidates) {
  const candidatePosition = pairPositions.get(candidate.workKey);
  const nearestSeed = [...pairSeeds].sort((left, right) => {
    const leftPosition = pairPositions.get(left.workKey);
    const rightPosition = pairPositions.get(right.workKey);
    return Math.hypot(candidatePosition.x - leftPosition.x, candidatePosition.y - leftPosition.y)
      - Math.hypot(candidatePosition.x - rightPosition.x, candidatePosition.y - rightPosition.y);
  })[0].workKey;
  pairNearestIncidentHits += Number(pairEdges.some(edge => edge.targetWorkKey === candidate.workKey && edge.sourceWorkKey === nearestSeed));
}
const pairNearestIncidentRate = pairNearestIncidentHits / pairCandidates.length;
assert.ok(pairNearestIncidentRate >= 0.80, `dense multi-seed hypergraph must preserve nearest-incident semantics; got ${pairNearestIncidentRate.toFixed(3)}`);
const pairReducedPositions = runDeterministicLayout([...pairSeeds, ...pairCandidates], pairEdges, 40, 0.92);
let pairReducedHits = 0;
for (const candidate of pairCandidates) {
  const candidatePosition = pairReducedPositions.get(candidate.workKey);
  const nearestSeed = [...pairSeeds].sort((left, right) => {
    const leftPosition = pairReducedPositions.get(left.workKey);
    const rightPosition = pairReducedPositions.get(right.workKey);
    return Math.hypot(candidatePosition.x - leftPosition.x, candidatePosition.y - leftPosition.y)
      - Math.hypot(candidatePosition.x - rightPosition.x, candidatePosition.y - rightPosition.y);
  })[0].workKey;
  pairReducedHits += Number(pairEdges.some(edge => edge.targetWorkKey === candidate.workKey && edge.sourceWorkKey === nearestSeed));
}
const pairReducedRate = pairReducedHits / pairCandidates.length;
assert.ok(pairReducedRate >= 0.75, `reduced-motion warm-up must retain usable nearest-incident semantics; got ${pairReducedRate.toFixed(3)}`);
assert.ok(nearestIncidentHits / manyCandidates.length >= 0.90, "multi-seed layout must place candidates nearest to an actually connected seed");
const manyTopology = renderer.buildPhysicsTopology([...manySeeds, ...manyCandidates], manyEdges);
for (const candidate of manyCandidates) {
  const primarySeed = manyTopology.primarySeedByKey.get(candidate.workKey);
  assert.ok(manyEdges.some(edge => edge.targetWorkKey === candidate.workKey && edge.sourceWorkKey === primarySeed), "a layout anchor must always be a real incident seed");
}
const unrelatedCandidate = { workKey: "AAA-UNRELATED-CANDIDATE" };
const unrelatedEdges = [0, 1, 2].map(index => ({
  edgeKey: `AAA-UNRELATED-E${index}`,
  sourceWorkKey: manySeeds[index].workKey,
  targetWorkKey: unrelatedCandidate.workKey,
  type: "cites",
}));
const augmentedTopology = renderer.buildPhysicsTopology(
  [...manySeeds, ...manyCandidates, unrelatedCandidate],
  [...manyEdges, ...unrelatedEdges],
);
for (const candidate of manyCandidates) {
  assert.equal(
    augmentedTopology.primarySeedByKey.get(candidate.workKey),
    manyTopology.primarySeedByKey.get(candidate.workKey),
    "adding an unrelated candidate must not reassign an existing candidate owner",
  );
}

const packedIsolates = Array.from({ length: 11 }, (_, index) => ({ workKey: `ISO-MANY-${index}`, isSeed: true }));
const packedNodes = [...manySeeds, ...manyCandidates, ...packedIsolates];
const packedTopology = renderer.buildPhysicsTopology(packedNodes, manyEdges);
const packedPositions = runDeterministicLayout(packedNodes, manyEdges);
const packedMain = packedTopology.components[0].keys.map(key => packedPositions.get(key));
const packedMainBox = {
  left: Math.min(...packedMain.map(value => value.x - 10)),
  right: Math.max(...packedMain.map(value => value.x + 10)),
  top: Math.min(...packedMain.map(value => value.y - 10)),
  bottom: Math.max(...packedMain.map(value => value.y + 10)),
};
for (const component of packedTopology.components.filter(value => value.keys.length === 1)) {
  const value = packedPositions.get(component.keys[0]);
  assert.ok(
    value.x < packedMainBox.left || value.x > packedMainBox.right || value.y < packedMainBox.top || value.y > packedMainBox.bottom,
    `${component.keys[0]} must remain outside the main component box in a dense multi-seed graph`,
  );
}

const fitContext = {
  positions: new Map([
    ["MAIN-A", { x: 0, y: 0 }], ["MAIN-B", { x: 160, y: 100 }], ["TRAY", { x: 2100, y: 100 }],
  ]),
  physicsTopology: { components: [{ keys: ["MAIN-A", "MAIN-B"] }, { keys: ["TRAY"] }] },
  isolateTrayExpanded: false,
  viewportGroup: {}, viewport: { x: 0, y: 0, k: 1 }, lens: { strength: 0 },
  dimensions: () => ({ width: 1000, height: 700 }), applyViewport() {},
};
renderer.Renderer.prototype.fit.call(fitContext);
const mainOnlyScale = fitContext.viewport.k;
fitContext.isolateTrayExpanded = true;
renderer.Renderer.prototype.fit.call(fitContext);
assert.ok(Math.abs(mainOnlyScale - fitContext.viewport.k) < 0.001, "opening the current-unconnected drawer must not change the main component fit");
fitContext.data = { workspace: "collection" };
renderer.Renderer.prototype.fit.call(fitContext);
assert.ok(fitContext.viewport.k < mainOnlyScale, "Collection fit must include unconnected papers on the canvas");

const captionBounds = { left: 6, right: 994, top: 6, bottom: 694 };
const edgeCaption = renderer.captionPlacement({ x: 8, y: 80 }, 10, 180, 62, captionBounds);
assert.ok(edgeCaption && edgeCaption.left >= 6, "edge labels must try another side before being hidden");
const crowded = [{ left: 0, right: 1000, top: 0, bottom: 700 }];
assert.equal(renderer.captionPlacement({ x: 500, y: 80 }, 10, 180, 62, captionBounds, crowded), null);
assert.ok(renderer.captionPlacement({ x: 500, y: 80 }, 10, 180, 62, captionBounds, crowded, [], true), "selected labels remain visible in a crowded graph");
assert.equal(renderer.captionPlacement({x:500,y:200},10,180,62,captionBounds,[],[],true,{x:20,y:-30}).left,520,"hovered captions must retain their position under the pointer");
const wrappedTitle = renderer.wrapNodeTitle("Mechanical response of porous materials under sustained loading");
assert.equal(wrappedTitle.length, 2);
assert.ok(wrappedTitle[1].endsWith("…"));
assert.ok(wrappedTitle.every(line => renderer.estimatedLabelWidth(line, 13) <= 168));
assert.deepEqual(renderer.wrapNodeTitle("短标题"), ["短标题"]);
assert.equal(renderer.nodeAuthorYear({authors:[{name:"De La Fuente et al."}],year:2020}), "De La Fuente · 2020");
assert.equal(renderer.nodeAuthorYear({authors:[{name:"张三"}],year:2025}), "张三 · 2025");

const wheelEvents = [];
const wheelContext = {
  hideHoverPreview() {}, zoomAtPoint: () => wheelEvents.push("zoom"),
  stackForWheel: () => ({ keys: ["A", "B"], index: 0 }),
  nodeElements: new Map([["B", {node:{workKey:"B"}}]]),
  selectNode: node => wheelEvents.push(node.workKey), showStackBadge() {},
};
const wheel = {clientX:100,clientY:100,deltaY:120,ctrlKey:false,preventDefault(){},stopPropagation(){}};
renderer.Renderer.prototype.onWheel.call(wheelContext, wheel);
assert.deepEqual(wheelEvents, ["zoom"], "ordinary wheel must zoom even above overlapping nodes");
renderer.Renderer.prototype.onWheel.call(wheelContext, {...wheel,ctrlKey:true});
assert.deepEqual(wheelEvents, ["zoom","B"], "Ctrl+wheel must select an overlapping paper without zooming");
wheelContext.stackForWheel=()=>null;
renderer.Renderer.prototype.onWheel.call(wheelContext, {...wheel,ctrlKey:true});
assert.deepEqual(wheelEvents, ["zoom","B"], "Ctrl+wheel on empty space must not change graph or application zoom");

function runIncrementalLayout(existingPositions, nodes, edges, newKeys, alpha) {
  const retained = new Map([...existingPositions].map(([key, value]) => [key, { ...value, vx: 0, vy: 0 }]));
  const layout = renderer.topologyInitialPositions(nodes, edges, 1000, 700, retained, false);
  const anchors = new Map([...retained].map(([key, value]) => [key, { x: value.x, y: value.y }]));
  const movable = new Set(newKeys);
  for (const key of newKeys) for (const neighbor of layout.topology.adjacency.get(key) || []) movable.add(neighbor);
  const context = {
    data: { nodes, edges }, positions: layout.positions, physicsTopology: layout.topology,
    componentCenters: layout.centers,
    nodeElements: new Map(nodes.map(node => [node.workKey, { radius: 10 }])),
    alpha, dimensions: () => ({ width: 1000, height: 700 }),
    relaxCollisions: renderer.Renderer.prototype.relaxCollisions,
    incrementalLayoutActive: true, incrementalAnchors: anchors, incrementalMovableKeys: movable,
  };
  for (let step = 0; step < 51; step++) {
    renderer.Renderer.prototype.simulationStep.call(context);
    context.alpha *= 0.925;
  }
  return context.positions;
}

for (const addedCount of [1, 10, 20, 40]) {
  const addedNodes = Array.from({ length: addedCount }, (_, index) => ({ workKey: `ADD${addedCount}-${index}` }));
  const addedEdges = addedNodes.map((node, index) => ({
    edgeKey: `ADDE${addedCount}-${index}`,
    sourceWorkKey: manySeeds[(index * 5 + 3) % manySeeds.length].workKey,
    targetWorkKey: node.workKey,
    type: "cites",
  }));
  const alpha = addedCount <= 2 ? 0.24 : addedCount <= 10 ? 0.30 : addedCount <= 20 ? 0.34 : 0.38;
  const incremented = runIncrementalLayout(
    manyPositions,
    [...manySeeds, ...manyCandidates, ...addedNodes],
    [...manyEdges, ...addedEdges],
    new Set(addedNodes.map(node => node.workKey)),
    alpha,
  );
  const deltas = [...manyPositions].map(([key, prior]) => Math.hypot(incremented.get(key).x - prior.x, incremented.get(key).y - prior.y));
  const rms = Math.sqrt(deltas.reduce((sum, value) => sum + value * value, 0) / deltas.length);
  assert.ok(rms <= 15, `${addedCount} new nodes moved the old mental map by RMS ${rms.toFixed(2)} px`);
  assert.ok(Math.max(...deltas) <= 35, `${addedCount} new nodes moved an old node more than 35 px`);
}

console.log("renderer.test.js: all assertions passed");
