"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../ui/view-state.js");

test("request snapshot compares the draft with committed seed keys", () => {
  const committed = state.requestSnapshot(
    { mode: "similar", seedWorkKeys: ["A"], limit: 20 },
    { mode: "similar", workKeys: ["result-1"] },
  );

  assert.equal(state.requestChanged(committed, ["B"], "similar", 20), true);
  assert.equal(state.requestChanged(committed, ["A"], "similar", 20), false);
});

test("request key comparison ignores order and duplicate draft entries", () => {
  const committed = state.requestSnapshot({ seedWorkKeys: ["B", "A", "A"] });

  assert.deepEqual(committed.seedWorkKeys, ["A", "B"]);
  assert.equal(Object.isFrozen(committed), true);
  assert.equal(Object.isFrozen(committed.seedWorkKeys), true);
  assert.equal(state.requestChanged(committed, ["A", "B", "B"], "similar", 20), false);
});

test("mode and result limit changes invalidate an otherwise matching request", () => {
  const committed = state.requestSnapshot({ mode: "similar", seedWorkKeys: ["A"], limit: 20 });

  assert.equal(state.requestChanged(committed, ["A"], "citation", 20), true);
  assert.equal(state.requestChanged(committed, ["A"], "similar", 40), true);
});

test("missing snapshots and empty drafts are handled explicitly", () => {
  assert.equal(state.requestChanged(null, [], "similar", 20), true);
  const empty = state.requestSnapshot({ mode: "similar", seedWorkKeys: [], limit: 20 });
  assert.equal(state.requestChanged(empty, [], "similar", 20), false);
  assert.equal(state.requestChanged(empty, ["A"], "similar", 20), true);
});

test("queue history rolls back one state and rejects undo when there is no history", () => {
  const history = state.createQueueHistory({ queue: ["A"] });
  assert.equal(history.peek(), null);
  assert.equal(history.undo(), null);

  const next = { queue: ["A", "B"] };
  history.capture(next);
  const previous = history.peek();
  assert.equal(previous.queue.join(","), "A");
  let restored = null;
  assert.equal(history.undo(value => { restored = value; }), previous);
  assert.deepEqual(restored, { queue: ["A"] });
  assert.equal(history.peek(), null);
});

test("a failed queue restore leaves its undo record available", () => {
  const before = { queue: ["A"] };
  const history = state.createQueueHistory(before);
  history.capture({ queue: ["A", "B"] });

  assert.throws(() => history.undo(() => { throw new Error("restore failed"); }), /restore failed/);
  assert.equal(history.peek(), before);
  assert.equal(history.undo(value => assert.equal(value, before)), before);
});
