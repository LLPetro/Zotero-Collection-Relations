"use strict";

const assert = require("node:assert/strict");
const graphRenderer = require("../ui/graph-renderer.js");
const { Renderer } = graphRenderer;
const dynamicRoleFixture = require("./fixtures/synthetic-role-topology.js");

function controlledWindow() {
  let nextTimerID = 1;
  const timers = new Map();
  let clock = 0;
  return {
    performance: { now: () => ++clock },
    setTimeout(callback) {
      const id = nextTimerID++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    cancelAnimationFrame() {},
    removeEventListener() {},
    pendingTimers: () => timers.size,
    runNextTimer() {
      const entry = timers.entries().next().value;
      assert.ok(entry, "a reduced-motion batch should have yielded to a timer");
      const [id, callback] = entry;
      timers.delete(id);
      callback();
    },
  };
}

function reducedContext() {
  const win = controlledWindow();
  const state = {
    win,
    data: { nodes: [], edges: [] },
    mode: "galaxy",
    reducedMotion: true,
    alpha: 0,
    fitAfterSimulation: false,
    frame: null,
    reducedTimer: null,
    simulationFrames: 0,
    simulationSteps: 0,
    simulationPairVisits: 0,
    lastSimulationMS: 0,
    incrementalLayoutActive: false,
    incrementalAnchors: new Map(),
    incrementalMovableKeys: new Set(),
    container: { dataset: {}, replaceChildren() {} },
    stepCalls: 0,
    positionUpdates: 0,
    simulationStep() {
      this.stepCalls++;
      return 1;
    },
    settleLayoutConstraints(rounds) {
      assert.equal(rounds, 2);
      return 2;
    },
    updatePositions() { this.positionUpdates++; },
    updateCounts() {},
    fit() {},
    cancelHoverLens() {},
    hideHoverPreview: Renderer.prototype.hideHoverPreview,
  };
  return state;
}

const scheduled = reducedContext();
Renderer.prototype.startSimulation.call(scheduled, 0.82);
assert.equal(scheduled.stepCalls, 5, "the first reduced-motion batch must contain at most five physics steps");
assert.equal(scheduled.positionUpdates, 0, "reduced motion must not repaint between physics batches");
assert.equal(scheduled.win.pendingTimers(), 1, "the next batch must yield through the event loop");

let yieldedBatches = 0;
while (scheduled.container.dataset.simulationState !== "stable") {
  const before = scheduled.stepCalls;
  scheduled.win.runNextTimer();
  assert.ok(scheduled.stepCalls - before <= 5, "each resumed batch must contain at most five physics steps");
  yieldedBatches++;
  assert.ok(yieldedBatches < 20, "the reduced-motion scheduler must converge");
}
assert.ok(yieldedBatches > 1, "a dense reduced-motion run must yield more than once");
assert.equal(scheduled.positionUpdates, 1, "reduced motion must paint only the settled result");
assert.equal(scheduled.win.pendingTimers(), 0);
assert.equal(scheduled.reducedTimer, null);
assert.equal(scheduled.simulationFrames, Math.ceil(scheduled.simulationSteps / 5));

const cancelled = reducedContext();
Renderer.prototype.startSimulation.call(cancelled, 0.82);
assert.equal(cancelled.win.pendingTimers(), 1);
const stepsBeforeDestroy = cancelled.stepCalls;
Renderer.prototype.destroy.call(cancelled);
assert.equal(cancelled.win.pendingTimers(), 0, "destroy() must cancel a pending reduced-motion batch");
assert.equal(cancelled.stepCalls, stepsBeforeDestroy, "destroy() must not run additional physics work");

const continuation = reducedContext();
continuation.data.nodes = [{ workKey: "CONTINUATION" }];
continuation.physicsTopology = {};
let preconditionCalls = 0;
const originalRepair = Renderer.prototype.repairSemanticViolations;
Renderer.prototype.repairSemanticViolations = function() {
  preconditionCalls++;
  return null;
};
try {
  Renderer.prototype.startSimulation.call(continuation, 0.82, false, true);
  assert.equal(preconditionCalls, 0, "an interrupted mode continuation must not repeat the fresh-start semantic preconditioner");
  Renderer.prototype.destroy.call(continuation);
}
finally {
  Renderer.prototype.repairSemanticViolations = originalRepair;
}

const reducedLayout = graphRenderer.topologyInitialPositions(
  dynamicRoleFixture.nodes,
  dynamicRoleFixture.edges,
  650,
  725,
);
const reducedStats = graphRenderer.citationScaleStats(dynamicRoleFixture.nodes);
const semanticReduced = {
  win: controlledWindow(),
  data: { nodes: dynamicRoleFixture.nodes, edges: dynamicRoleFixture.edges },
  mode: "galaxy",
  reducedMotion: true,
  alpha: 0,
  fitAfterSimulation: false,
  frame: null,
  reducedTimer: null,
  simulationFrames: 0,
  simulationSteps: 0,
  simulationPairVisits: 0,
  lastSimulationMS: 0,
  incrementalLayoutActive: false,
  incrementalAnchors: new Map(),
  incrementalMovableKeys: new Set(),
  positions: reducedLayout.positions,
  physicsTopology: reducedLayout.topology,
  componentCenters: reducedLayout.centers,
  nodeElements: new Map(dynamicRoleFixture.nodes.map(node => [node.workKey, {
    radius: graphRenderer.nodeRadius(node, 0, "citations", reducedStats.p95),
  }])),
  container: { dataset: {} },
  semanticWarning: { hidden: true, textContent: "" },
  simulationStep: Renderer.prototype.simulationStep,
  settleLayoutConstraints: Renderer.prototype.settleLayoutConstraints,
  relaxCollisions: Renderer.prototype.relaxCollisions,
  updatePositions() {},
  updateCounts() {},
  fit() {},
};
Renderer.prototype.startSimulation.call(semanticReduced, 0.82);
let semanticBatches = 0;
while (semanticReduced.container.dataset.simulationState === "running") {
  semanticReduced.win.runNextTimer();
  semanticBatches++;
  assert.ok(semanticBatches < 20, "the synthetic reduced-motion topology must converge within its bounded scheduler");
}
const reducedSemanticReport = graphRenderer.seedProximityDiagnostics(
  semanticReduced.positions,
  semanticReduced.physicsTopology,
);
assert.ok(semanticReduced.simulationSteps > 30 && semanticReduced.simulationSteps <= 40, "reduced motion must converge within its documented 40-step physics bound");
assert.equal(semanticReduced.container.dataset.simulationState, "stable");
assert.equal(reducedSemanticReport.exact, true, "the reduced-motion path must settle the synthetic 39-seed role mutation exactly");
assert.equal(semanticReduced.semanticWarning.textContent, "");

console.log("reduced-motion.test.js: all assertions passed");
