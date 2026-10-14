"use strict";
const assert = require("node:assert/strict");
const tree = require("../ui/collection-tree.js");
const rows = [
  {id:1,name:"Research",path:"Research",parentID:null},
  {id:2,name:"Methods",path:"Research / Methods",parentID:1},
  {id:3,name:"Deep leaf",path:"Research / Methods / Deep leaf",parentID:2},
  {id:4,name:"Results",path:"Research / Results",parentID:1},
  {id:5,name:"Other",path:"Other",parentID:null},
];
const ids = result => result.map(row=>row.id);
assert.deepEqual(ids(tree.visible(rows)),[1,5]);
assert.deepEqual(ids(tree.visible(rows,new Set([1]))),[1,2,4,5]);
assert.deepEqual(ids(tree.visible(rows,new Set([1,2]))),[1,2,3,4,5]);
assert.deepEqual(tree.ancestors(rows,3),[2,1]);
const search=tree.searchExpansion(rows,"deep leaf");
assert.deepEqual(ids(tree.visible(rows,search,"deep leaf")),[1,2,3]);
search.delete(1);
assert.deepEqual(ids(tree.visible(rows,search,"deep leaf")),[1],"search results can still be folded without losing the query");
assert.deepEqual(ids(tree.visible(rows,new Set(),"missing")),[]);
assert.equal(tree.visible(rows,new Set([1,2]))[2].depth,2);
assert.equal(tree.visible(rows)[0].expanded,false);
console.log("collection-tree.test.js: all assertions passed");
