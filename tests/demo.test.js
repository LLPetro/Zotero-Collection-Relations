"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function exampleApp() {
  const scope = vm.createContext({
    Zotero: new Proxy({}, { get() { throw new Error("Example must not read the personal library"); } }),
  });
  for (const file of ["../ui/messages.js", "../ui/i18n.js", "../src/app/literature-graph.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), scope);
  }
  return scope.LiteratureGraph;
}

test("standalone example contains no local item, attachment or DOI bindings", async () => {
  const app = exampleApp();
  const data = await app.resolveDemoData();
  assert.equal(data.nodes.length, 4);
  assert.equal(data.edges.length, 4);
  for (const node of data.nodes) {
    assert.match(node.workKey, /^example:/);
    assert.equal(node.localKeys.length, 0);
    assert.equal(node.itemKey, undefined);
    assert.equal(node.doi, undefined);
  }
  for (const edge of data.edges) {
    assert.equal(edge.evidence.length, 0);
    assert.notEqual(edge.status, "verified");
    assert.equal(edge.source, undefined);
  }
});

test("fictional edges never merge into real item relations", async () => {
  const app = exampleApp();
  const stored = [{ id: "stored-example" }];
  app.loadStoredEdges = async () => stored;
  const edges = await app.allEdges();
  assert.equal(edges.length, 1);
  assert.equal(edges[0], stored[0]);
});

test("example preference affects only the standalone graph", async () => {
  const app = exampleApp();
  let showEdges = true;
  app.getSettings = () => ({ read(name) { assert.equal(name, "demoMode"); return showEdges; } });
  assert.equal((await app.graphData()).edges.length, 4);
  showEdges = false;
  const graph = await app.graphData();
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.nodes.length, 4);
  assert.match(graph.title, /虚构/);
});
