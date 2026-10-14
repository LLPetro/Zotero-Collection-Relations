"use strict";

const assert = require("node:assert/strict");
const core = require("../src/domain/relation-core.js");

assert.equal(core.cleanDOI("https://doi.org/10.1002/NAG.3038"), "10.1002/nag.3038");
assert.equal(core.relationLabel("usesData"), "使用数据");

const edge = core.createEdge({
  id: "zlg-test-edge",
  source: { libraryID: 1, itemKey: "SOURCE01", doi: "10.1/source", year: 2020 },
  target: { libraryID: 1, itemKey: "TARGET01", doi: "10.1/target", year: 2012 },
  type: "modifies",
  status: "verified",
  comment: "test",
  evidence: [{ attachmentKey: "ATTACH01", page: 3, locator: "Section 3.1" }],
});

assert.deepEqual(core.validateEdge(edge), []);
assert.equal(core.edgeTouches(edge, 1, "SOURCE01"), true);
assert.equal(core.edgeOtherEnd(edge, 1, "SOURCE01").itemKey, "TARGET01");

const store = core.createStore(edge.source, [edge]);
assert.deepEqual(core.validateStore(store), []);

const duplicate = core.createStore(edge.source, [edge, edge]);
assert.match(core.validateStore(duplicate).join("\n"), /duplicate edge id/);

const self = core.createEdge({
  id: "zlg-self-edge",
  source: { libraryID: 1, itemKey: "SAMEITEM" },
  target: { libraryID: 1, itemKey: "SAMEITEM" },
  type: "cites",
});
assert.match(core.validateEdge(self).join("\n"), /self-relations/);

console.log("core.test.js: all assertions passed");
