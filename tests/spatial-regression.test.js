"use strict";

const assert = require("node:assert/strict");
const renderer = require("../ui/graph-renderer.js");
const fixture = require("./fixtures/synthetic-topology.js");
const dynamicRoleFixture = require("./fixtures/synthetic-role-topology.js");

function semanticReport(positions, topology) {
  let hits = 0;
  let violations = 0;
  let worstRank = 0;
  let minimumMargin = Infinity;
  for (const [candidateKey, incidentSeeds] of topology.seedNeighborsByKey) {
    const candidate = positions.get(candidateKey);
    const ranked = [...topology.seedKeys].map(seedKey => ({
      seedKey,
      distance: Math.hypot(candidate.x - positions.get(seedKey).x, candidate.y - positions.get(seedKey).y),
    })).sort((left, right) => left.distance - right.distance || left.seedKey.localeCompare(right.seedKey));
    const nearestIncidentRank = ranked.findIndex(value => incidentSeeds.includes(value.seedKey)) + 1;
    const nearestIncident = ranked.find(value => incidentSeeds.includes(value.seedKey));
    const nearestNonincident = ranked.find(value => !incidentSeeds.includes(value.seedKey));
    hits += Number(nearestIncidentRank === 1);
    worstRank = Math.max(worstRank, nearestIncidentRank);
    if (nearestIncident && nearestNonincident) {
      const margin = nearestNonincident.distance - nearestIncident.distance;
      minimumMargin = Math.min(minimumMargin, margin);
      violations += Number(margin < -0.5);
    }
  }
  return {
    hits,
    total: topology.seedNeighborsByKey.size,
    rate: hits / Math.max(1, topology.seedNeighborsByKey.size),
    violations,
    worstRank,
    minimumMargin,
  };
}

const dimensions = { width: 650, height: 725 };
function runFixture({ nodes, edges }, expectedOrigins, expectedCandidates, repair = true) {
  assert.equal(nodes.length, 50);
  assert.equal(edges.length, 140);
  assert.equal(nodes.filter(node => node.isSeed).length, expectedOrigins);
  const layout = renderer.topologyInitialPositions(nodes, edges, dimensions.width, dimensions.height);
  const stats = renderer.citationScaleStats(nodes);
  const context = {
    data: { nodes, edges },
    positions: layout.positions,
    physicsTopology: layout.topology,
    componentCenters: layout.centers,
    nodeElements: new Map(nodes.map(node => [node.workKey, {
      radius: renderer.nodeRadius(node, 0, "citations", stats.p95),
    }])),
    alpha: 0.82,
    incrementalLayoutActive: false,
    incrementalAnchors: new Map(),
    incrementalMovableKeys: new Set(),
    dimensions: () => dimensions,
    relaxCollisions: renderer.Renderer.prototype.relaxCollisions,
    settleLayoutConstraints: renderer.Renderer.prototype.settleLayoutConstraints,
  };
  for (let step = 0; step < 49; step++) {
    renderer.Renderer.prototype.simulationStep.call(context);
    context.alpha *= 0.925;
  }
  renderer.Renderer.prototype.settleLayoutConstraints.call(context, 2);
  const beforeRepair = new Map([...context.positions].map(([key, value]) => [key, { ...value }]));
  const repairResult = repair
    ? renderer.repairSeedProximityViolations(
        context.positions,
        context.physicsTopology,
        new Map([...context.nodeElements].map(([key, value]) => [key, value.radius])),
      )
    : null;
  const report = semanticReport(context.positions, context.physicsTopology);
  const diagnostic = renderer.seedProximityDiagnostics(context.positions, context.physicsTopology);
  assert.equal(report.total, expectedCandidates);
  assert.equal(report.hits, report.total, `${expectedOrigins}-origin narrow graph regressed to ${(report.rate * 100).toFixed(1)}% nearest-incident hits`);
  assert.equal(report.violations, 0, `${expectedOrigins}-origin narrow graph retained ${report.violations} semantic violations`);
  assert.equal(report.worstRank, 1);
  assert.ok(report.minimumMargin > 0, `${expectedOrigins}-origin narrow graph has ${report.minimumMargin.toFixed(2)} px minimum semantic margin`);
  assert.equal(diagnostic.exact, true, `${expectedOrigins}-origin graph must satisfy the explicit stable diagnostic`);
  assert.equal(renderer.semanticLayoutSatisfied(diagnostic, nodes.length), true);
  if (repair) {
    assert.deepEqual(repairResult.unresolved, [], "synthetic role mutation must converge");
    const repairedKeys = new Set(repairResult.repaired.map(value => value.candidateKey));
    for (const [key, prior] of beforeRepair) {
      if (!repairedKeys.has(key)) assert.deepEqual(context.positions.get(key), prior, `repair must preserve non-violating node ${key}`);
    }
  }
  return {
    nodes: nodes.length,
    edges: edges.length,
    origins: expectedOrigins,
    nearestIncidentRate: report.rate,
    violations: report.violations,
    worstRank: report.worstRank,
    minimumMargin: Number(report.minimumMargin.toFixed(2)),
    repairedCandidates: repairResult?.repairedCandidates || 0,
  };
}

const baseReport = runFixture(fixture, 38, 12);
const dynamicRoleReport = runFixture(dynamicRoleFixture, 39, 11, true);
assert.equal(dynamicRoleFixture.dynamicSeedKey, "example:paper-38");

const reversedRoleReport = runFixture({
  nodes: [...dynamicRoleFixture.nodes].reverse(),
  edges: [...dynamicRoleFixture.edges].reverse(),
}, 39, 11, true);
assert.deepEqual(reversedRoleReport, dynamicRoleReport, "semantic repair must be independent of input ordering");

console.log(JSON.stringify({ base: baseReport, dynamicRole: dynamicRoleReport }));
console.log("spatial-regression.test.js: all assertions passed");
