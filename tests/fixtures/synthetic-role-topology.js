"use strict";

// Promote a fictional candidate while preserving its node and edge universe.
const base = require("./synthetic-topology.js");
const dynamicSeedKey = "example:paper-38";
module.exports = {
  dynamicSeedKey,
  nodes: base.nodes.map(node => ({ ...node, isSeed: node.isSeed || node.workKey === dynamicSeedKey })),
  edges: base.edges.map(edge => ({ ...edge })),
};
