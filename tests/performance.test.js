"use strict";

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
global.ZLGIdentity = require("../src/domain/identity-core.js");
global.ZLGDiscoveryCore = require("../src/domain/discovery-core.js");
const { SessionRepository } = require("../src/infrastructure/session-store.js");
const graphRenderer = require("../ui/graph-renderer.js");

const localRefs = Array.from({ length: 3200 }, (_, index) => ({
  libraryID: 1,
  itemKey: `K${String(index).padStart(7, "0")}`,
  DOI: index < 100 ? `10.1234/duplicate-${Math.floor(index / 2)}` : `10.1234/work-${index}`,
  title: `Synthetic research paper ${index}`,
  year: 1980 + index % 47,
  firstAuthor: `Author ${index % 200}`,
  hasPDF: index % 3 !== 0,
}));

const indexStart = performance.now();
const localIndex = ZLGIdentity.createLocalIndex(localRefs);
const indexMS = performance.now() - indexStart;
assert.equal(localIndex.refs.length, 3200);
assert.equal(localIndex.byDOI.get("10.1234/duplicate-0").length, 2);
assert.ok(indexMS < 250, `3200-item local indexing regressed to ${indexMS.toFixed(1)} ms`);

const works = Array.from({ length: 200 }, (_, index) => ({
  workKey: `openalex:W${index}`,
  provider: "openalex",
  externalId: `W${index}`,
  identifiers: { doi: `10.1234/work-${index + 100}` },
  title: `Synthetic external work ${index}`,
  year: 1990 + index % 37,
  authors: [{ name: `Author ${index % 50}` }],
  type: index % 5 === 0 ? "review" : "article",
  citationCount: index * 3,
  localKeys: index % 2 ? [] : [`1:K${String(index + 100).padStart(7, "0")}`],
  hasPDF: index % 4 === 0,
}));
const edges = Array.from({ length: 600 }, (_, index) => ZLGDiscoveryCore.externalEdge({
  provider: "openalex",
  sourceExternalId: `W${index % 200}`,
  targetExternalId: `W${(index % 200 + Math.floor(index / 200) + 1) % 200}`,
  type: index % 7 === 0 ? "similar" : "cites",
  fetchedAt: "2026-08-22T00:00:00Z",
}));

const graphStart = performance.now();
const mergedEdges = ZLGDiscoveryCore.mergeEdges(edges);
const filtered = ZLGDiscoveryCore.filterWorks(works, { yearFrom: 2010, libraryState: "in" });
const ranked = ZLGDiscoveryCore.rankCandidates(works);
const focused = ZLGDiscoveryCore.focusGraph({ nodes: works, edges: mergedEdges }, {
  seedKeys: works.slice(0, 37).map(work => work.workKey),
  resultKeys: works.slice(37, 77).map(work => work.workKey),
  maxNodes: 160,
});
const graphMS = performance.now() - graphStart;
assert.ok(mergedEdges.length > 100);
assert.equal(mergedEdges.length, 600, "performance fixture must contain 600 unique display edges");
assert.ok(filtered.length > 0 && filtered.length < works.length);
assert.equal(ranked[0].citationCount, 597);
assert.equal(focused.nodes.length, 77);
assert.ok(focused.edges.every(edge => focused.nodes.some(node => node.workKey === edge.sourceWorkKey)
  && focused.nodes.some(node => node.workKey === edge.targetWorkKey)));
assert.equal(focused.totalNodeCount, 200);
assert.equal(focused.graphTruncated, true);
const capped = ZLGDiscoveryCore.focusGraph({ nodes: works, edges: mergedEdges }, {
  seedKeys: works.slice(0, 37).map(work => work.workKey),
  resultKeys: works.map(work => work.workKey),
  maxNodes: 160,
  maxEdges: 80,
});
assert.equal(capped.nodes.length, 160, "oversized sessions must be reduced to the visible rendering budget");
assert.equal(capped.edges.length, 80, "dense sessions must be reduced to the visible edge budget");
assert.equal(capped.graphTruncated, true);
assert.ok(graphMS < 100, `200-node graph preparation regressed to ${graphMS.toFixed(1)} ms`);
const topologyStart = performance.now();
const physicsTopology = graphRenderer.buildPhysicsTopology(works, mergedEdges.slice(0, 600));
const topologyLayout = graphRenderer.topologyInitialPositions(works, mergedEdges.slice(0, 600), 1200, 800);
const topologyMS = performance.now() - topologyStart;
assert.equal(physicsTopology.nodeKeys.length, 200);
assert.equal(topologyLayout.positions.size, 200);
assert.ok(topologyMS < 35, `canonical topology and initial packing regressed to ${topologyMS.toFixed(1)} ms`);

const simulationNodes = works.slice(0, 160).map((work, index) => ({ ...work, isSeed: index < 40 }));
const simulationKeys = new Set(simulationNodes.map(work => work.workKey));
const simulationEdges = mergedEdges.filter(edge => simulationKeys.has(edge.sourceWorkKey) && simulationKeys.has(edge.targetWorkKey)).slice(0, 600);
const simulationLayout = graphRenderer.topologyInitialPositions(simulationNodes, simulationEdges, 1200, 800);
const simulationContext = {
  data: { nodes: simulationNodes, edges: simulationEdges },
  positions: simulationLayout.positions,
  physicsTopology: simulationLayout.topology,
  componentCenters: simulationLayout.centers,
  nodeElements: new Map(simulationNodes.map(node => [node.workKey, { radius: 10 }])),
  alpha: 0.82,
  incrementalLayoutActive: false,
  incrementalAnchors: new Map(),
  incrementalMovableKeys: new Set(),
  relaxCollisions: graphRenderer.Renderer.prototype.relaxCollisions,
};
const simulationStart = performance.now();
for (let step = 0; step < 51; step++) {
  graphRenderer.Renderer.prototype.simulationStep.call(simulationContext);
  simulationContext.alpha *= 0.925;
}
const simulationMS = performance.now() - simulationStart;
assert.ok(simulationMS < 350, `160-node constrained simulation regressed to ${simulationMS.toFixed(1)} ms`);

function runDenseSemanticFixture(prefix) {
  const denseSeeds = Array.from({ length: 50 }, (_, index) => ({ workKey: `${prefix}-S${index}`, isSeed: true }));
  const denseCandidates = Array.from({ length: 150 }, (_, index) => ({ workKey: `${prefix}-C${index}` }));
  const denseEdges = denseCandidates.flatMap((candidate, index) => Array.from({ length: 4 }, (_, offset) => ({
    edgeKey: `${prefix}-E${index}-${offset}`,
    sourceWorkKey: denseSeeds[(index * 11 + offset * 13) % denseSeeds.length].workKey,
    targetWorkKey: candidate.workKey,
    type: "cites",
  })));
  const denseNodes = [...denseSeeds, ...denseCandidates];
  const denseLayout = graphRenderer.topologyInitialPositions(denseNodes, denseEdges, 1200, 800);
  assert.equal(denseLayout.topology.primarySeedByKey.size, denseCandidates.length, "dense performance fixture must exercise every candidate proximity constraint");
  const denseContext = {
    data: { nodes: denseNodes, edges: denseEdges },
    positions: denseLayout.positions,
    physicsTopology: denseLayout.topology,
    componentCenters: denseLayout.centers,
    nodeElements: new Map(denseNodes.map(node => [node.workKey, { radius: 10 }])),
    alpha: 0.82,
    incrementalLayoutActive: false,
    incrementalAnchors: new Map(),
    incrementalMovableKeys: new Set(),
    relaxCollisions: graphRenderer.Renderer.prototype.relaxCollisions,
  };
  const started = performance.now();
  for (let step = 0; step < 51; step++) {
    graphRenderer.Renderer.prototype.simulationStep.call(denseContext);
    denseContext.alpha *= 0.925;
  }
  graphRenderer.Renderer.prototype.settleLayoutConstraints.call(denseContext, 2);
  const durationMS = performance.now() - started;
  const report = graphRenderer.seedProximityDiagnostics(denseContext.positions, denseContext.physicsTopology);
  return { durationMS, report, satisfied: graphRenderer.semanticLayoutSatisfied(report, denseNodes.length) };
}

const denseReports = ["DENSE", "SALT-A", "x"].map(runDenseSemanticFixture);
console.log(JSON.stringify({ denseSemantics: denseReports.map(value => ({
  durationMS: Number(value.durationMS.toFixed(2)),
  rate: Number(value.report.rate.toFixed(4)),
  violations: value.report.violations,
  total: value.report.total,
  worstRank: value.report.worstRank,
})) }));
for (const [index, dense] of denseReports.entries()) {
  assert.ok(dense.durationMS < 350, `dense semantic simulation salt ${index} regressed to ${dense.durationMS.toFixed(1)} ms`);
  assert.ok(dense.report.rate >= 0.90, `dense salt ${index} nearest-incident rate fell to ${dense.report.rate}`);
  assert.ok(dense.report.violations / dense.report.total <= 0.06, `dense salt ${index} violation ratio exceeded 6%`);
  assert.ok(dense.report.worstRank <= 4, `dense salt ${index} worst incident rank regressed to ${dense.report.worstRank}`);
  assert.equal(dense.satisfied, true, `dense salt ${index} must meet the documented approximate-layout contract`);
}
const denseSimulationMS = denseReports[0].durationMS;

(async () => {
  let serialized = "";
  const repository = new SessionRepository({
    async read() { return null; },
    async write(value) { serialized = value; },
  });
  await repository.init();
  const session = ZLGDiscoveryCore.createSession({
    sessionId: "session-performance",
    name: "Synthetic 200-node graph",
    graphSnapshot: { works, edges: mergedEdges },
  });
  const saveStart = performance.now();
  await repository.save(session);
  const saveMS = performance.now() - saveStart;
  assert.ok(serialized.length > 10000);
  assert.ok(saveMS < 250, `session serialization regressed to ${saveMS.toFixed(1)} ms`);
  console.log(JSON.stringify({
    localItems: localRefs.length,
    nodes: works.length,
    edges: mergedEdges.length,
    indexMS: Number(indexMS.toFixed(2)),
    graphMS: Number(graphMS.toFixed(2)),
    topologyMS: Number(topologyMS.toFixed(2)),
    simulationMS: Number(simulationMS.toFixed(2)),
    denseSimulationMS: Number(denseSimulationMS.toFixed(2)),
    sessionSaveMS: Number(saveMS.toFixed(2)),
    sessionBytes: serialized.length,
  }));
  console.log("performance.test.js: all assertions passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
