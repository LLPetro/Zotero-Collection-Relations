"use strict";

const assert = require("node:assert/strict");
const view = require("../ui/view-state.js");

const hops = [
  { hopId: "A", parentHopId: null, mode: "similar", seedWorkKeys: ["S1"], resultWorkKeys: ["A1", "A2"] },
  { hopId: "B", parentHopId: "A", mode: "references", seedWorkKeys: ["A1"], resultWorkKeys: ["B1"] },
  { hopId: "C", parentHopId: "A", mode: "citations", seedWorkKeys: ["A2"], resultWorkKeys: ["C1", "C2"] },
];

assert.deepEqual(view.lastResultForHop(hops[0]), {
  mode: "similar", workKeys: ["A1", "A2"], total: 2, totalScope: "cached-hop", limitedByProvider: false,
  rankingApproximate: false,
});
assert.equal(view.modeCacheKey("similar", 20, ["S2", "S1", "S1"]), "similar|20|S1|S2");
assert.equal(view.parentHop(hops, "C")?.hopId, "A");
assert.deepEqual(view.childHops(hops, "A").map(hop => hop.hopId), ["B", "C"]);
assert.equal(view.parentHop({ hops }, "C")?.hopId, "A", "window state helpers must accept the full session object");
assert.deepEqual(view.visibleResultKeys(["A1", "A2", "A3"], [{ workKey: "A2" }, { workKey: "A3" }]), ["A2", "A3"]);

(async () => {
  const sequence = [];
  const enqueue = view.createMutationQueue();
  const first = enqueue(async () => {
    sequence.push("first:start");
    await new Promise(resolve => setTimeout(resolve, 10));
    sequence.push("first:end");
    throw new Error("expected failure");
  }).catch(error => error.message);
  const second = enqueue(async () => {
    sequence.push("second:start");
    sequence.push("second:end");
  });
  assert.equal(await first, "expected failure");
  await second;
  assert.deepEqual(sequence, ["first:start", "first:end", "second:start", "second:end"], "failed mutations must not poison or bypass the serial queue");

  const sync = view.createHopSyncTracker("A");
  assert.equal(sync.rollbackHop({ hops })?.hopId, "A");
  // Optimistic B and C views do not confirm either hop. If both writes fail,
  // rollback must still target the last backend-confirmed hop A.
  assert.equal(sync.confirmedId(), "A");
  assert.equal(sync.rollbackHop({ hops })?.hopId, "A");
  sync.confirm("B");
  assert.equal(sync.rollbackHop({ hops })?.hopId, "B");

  console.log("view-state.test.js: all assertions passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

// Returning to a collection must not import discovery candidates or recommendation edges.
const original = Array.from({ length: 165 }, (_, index) => ({ workKey: `base:${index}`, title: `Paper ${index}` }));
const scopeData = {
  nodes: [...original.slice(1), { workKey: "outside", title: "Discovery only" }],
  edges: [
    { edgeKey: "cite", sourceWorkKey: "base:0", targetWorkKey: "base:1", type: "cites" },
    { edgeKey: "outside", sourceWorkKey: "base:1", targetWorkKey: "outside", type: "cites" },
    { edgeKey: "recommended", sourceWorkKey: "base:1", targetWorkKey: "base:2", type: "similar" },
  ],
  session: { graphSnapshot: { works: original, edges: [] }, hiddenWorkKeys: ["base:0"] },
};
const scopeView = require('../ui/view-state.js');
const rootKeys = original.map(node => node.workKey);
const firstPage = scopeView.collectionSlice(scopeData, rootKeys);
assert.equal(firstPage.totalNodeCount, 165);
assert.equal(firstPage.nodes.length, 160);
assert.equal(firstPage.nodes[0].workKey, 'base:0', 'discovery hiding must not remove a collection member');
assert.deepEqual(firstPage.edges.map(edge => edge.edgeKey), ['cite']);
const secondPage = scopeView.collectionSlice(scopeData, rootKeys, () => true, 1);
assert.equal(secondPage.nodes.length, 5);
assert.equal(secondPage.nodes.at(-1).workKey, 'base:164', 'unconnected works remain browsable');
assert.equal(secondPage.collectionPages, 2);
assert.equal(scopeView.collectionSlice(scopeData, rootKeys, node => node.workKey === 'base:164', 1).collectionPage, 0);
assert.equal(scopeView.collectionSlice(scopeData, rootKeys, () => false).nodes.length, 0);
