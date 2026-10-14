"use strict";

const assert = require("node:assert/strict");
global.ZLGIdentity = require("../src/domain/identity-core.js");
global.ZLGDiscoveryCore = require("../src/domain/discovery-core.js");
const { SessionRepository } = require("../src/infrastructure/session-store.js");

let stored = null;
let storedNavigation = null;
const adapter = {
  async read() { return stored; },
  async write(value) { stored = value; },
  async readNavigation() { return storedNavigation; },
  async writeNavigation(value) { storedNavigation = value; },
};

(async () => {
  const repository = new SessionRepository(adapter);
  await repository.init();
  const session = ZLGDiscoveryCore.createSession({ sessionId: "session-store", name: "Test", collectionScope:{id:10,libraryID:1,key:"COLL0001"}, rootSeedWorkKeys: ["openalex:W1"], activeSeedWorkKeys: ["openalex:W2"] });
  await repository.save(session);
  assert.equal(repository.recent().name, "Test");
  assert.match(stored, /session-store/);

  const restored = new SessionRepository(adapter);
  await restored.init();
  assert.equal(restored.list().length, 1);
  assert.deepEqual(restored.recent().activeSeedWorkKeys, ["openalex:W2"]);
  assert.deepEqual(restored.recent().collectionScope,{id:10,libraryID:1,key:"COLL0001"},"Collection identity must survive profile reload");

  let navigationSession = ZLGDiscoveryCore.createSession({ sessionId: "session-navigation", rootSeedWorkKeys: ["openalex:W1"] });
  navigationSession = ZLGDiscoveryCore.addHop(navigationSession, { hopId: "hop-references", mode: "references", seedWorkKeys: ["openalex:W1"], resultWorkKeys: ["openalex:W2"] });
  navigationSession = ZLGDiscoveryCore.addHop(navigationSession, { hopId: "hop-similar", mode: "similar", seedWorkKeys: ["openalex:W2"], resultWorkKeys: ["openalex:W3"] });
  navigationSession.activeHopId = "hop-references";
  navigationSession.activeSeedWorkKeys = ["openalex:DRAFT"];
  await restored.save(navigationSession);
  await restored.saveActiveHop("session-navigation", "hop-similar");
  assert.match(storedNavigation, /hop-similar/, "active-hop navigation must use its compact sidecar store");
  assert.deepEqual(restored.get("session-navigation").activeSeedWorkKeys, ["openalex:DRAFT"], "changing the active result hop must preserve the editable queue");
  const navigationRestored = new SessionRepository(adapter);
  await navigationRestored.init();
  assert.equal(navigationRestored.get("session-navigation").activeHopId, "hop-similar");
  assert.deepEqual(navigationRestored.get("session-navigation").activeSeedWorkKeys, ["openalex:DRAFT"], "navigation sidecar must not overwrite the persisted queue with historical hop seeds");

  await restored.remove("session-store");
  await restored.remove("session-navigation");
  assert.equal(restored.list().length, 0);

  let activeWrites = 0;
  let maximumActiveWrites = 0;
  const concurrentAdapter = {
    async read() { return null; },
    async write() {
      activeWrites++;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await new Promise(resolve => setTimeout(resolve, 8));
      activeWrites--;
    },
  };
  const concurrentRepository = new SessionRepository(concurrentAdapter);
  await concurrentRepository.init();
  const firstSession = ZLGDiscoveryCore.createSession({ sessionId: "session-concurrent-1", rootSeedWorkKeys: ["openalex:W1"] });
  const secondSession = ZLGDiscoveryCore.createSession({ sessionId: "session-concurrent-2", rootSeedWorkKeys: ["openalex:W2"] });
  await Promise.all([concurrentRepository.save(firstSession), concurrentRepository.save(secondSession)]);
  assert.equal(maximumActiveWrites, 1, "repository flushes must serialize access to the shared temp file");
  assert.equal(concurrentRepository.persistent, true);

  let failingMain = false;
  let failingNavigation = false;
  let mainWriteCount = 0;
  let failMainOnCall = 0;
  const compensationError = new Error("main compensation failed");
  const navigationWriteError = new Error("navigation write failed");
  let failureStore = null;
  let failureNavigation = null;
  const failureAdapter = {
    async read() { return failureStore; },
    async write(value) {
      mainWriteCount++;
      if (mainWriteCount === failMainOnCall) { failMainOnCall = 0; throw compensationError; }
      if (failingMain) { failingMain = false; throw new Error("main write failed"); }
      failureStore = value;
    },
    async readNavigation() { return failureNavigation; },
    async writeNavigation(value) {
      if (failingNavigation) { failingNavigation = false; throw navigationWriteError; }
      failureNavigation = value;
    },
  };
  const failureRepository = new SessionRepository(failureAdapter);
  await failureRepository.init();
  let baselineSession = ZLGDiscoveryCore.createSession({
    sessionId: "session-failure-atomic",
    name: "before",
    rootSeedWorkKeys: ["openalex:W1"],
    activeSeedWorkKeys: ["openalex:DRAFT"],
  });
  baselineSession = ZLGDiscoveryCore.addHop(baselineSession, {
    hopId: "hop-failure-a", mode: "references", seedWorkKeys: ["openalex:W1"], resultWorkKeys: ["openalex:W2"],
  });
  baselineSession = ZLGDiscoveryCore.addHop(baselineSession, {
    hopId: "hop-failure-b", mode: "similar", seedWorkKeys: ["openalex:W2"], resultWorkKeys: ["openalex:W3"],
  });
  baselineSession.activeHopId = "hop-failure-a";
  await failureRepository.save(baselineSession);
  const originalStore = failureStore;
  const originalNavigation = failureNavigation;

  failingMain = true;
  await assert.rejects(failureRepository.save({ ...baselineSession, name: "main-failed" }), /main write failed/);
  assert.equal(failureRepository.get("session-failure-atomic").name, "before", "failed main write must restore in-memory session state");
  assert.equal(failureStore, originalStore, "failed main write must leave the previous main file intact");
  assert.equal(failureRepository.persistent, false);
  await failureRepository.save({ ...baselineSession, name: "main-retried" });
  assert.equal(failureRepository.persistent, true, "a later save must retry a failed adapter and recover persistence");
  assert.equal(JSON.parse(failureStore).sessions["session-failure-atomic"].name, "main-retried");

  const beforeNavigationFailure = failureRepository.get("session-failure-atomic");
  const storeBeforeNavigationFailure = failureStore;
  const navBeforeNavigationFailure = failureNavigation;
  failingNavigation = true;
  await assert.rejects(failureRepository.save({ ...beforeNavigationFailure, name: "navigation-failed" }), error => error === navigationWriteError);
  assert.equal(failureRepository.get("session-failure-atomic").name, "main-retried", "failed sidecar write must roll back the repository session");
  assert.equal(failureStore, storeBeforeNavigationFailure, "main file must be compensated when sidecar persistence fails");
  assert.equal(failureNavigation, navBeforeNavigationFailure, "failed sidecar write must preserve its prior contents");
  assert.equal(failureRepository.persistent, false);
  await failureRepository.saveActiveHop("session-failure-atomic", "hop-failure-a");
  assert.equal(failureRepository.persistent, true, "navigation writes must also recover after a transient failure");

  const activeHopBeforeFailure = failureRepository.get("session-failure-atomic").activeHopId;
  const draftBeforeFailure = failureRepository.get("session-failure-atomic").activeSeedWorkKeys;
  failingNavigation = true;
  await assert.rejects(failureRepository.saveActiveHop("session-failure-atomic", "hop-failure-b"), error => error === navigationWriteError);
  assert.equal(failureRepository.get("session-failure-atomic").activeHopId, activeHopBeforeFailure, "failed navigation must roll back the active hop");
  assert.deepEqual(failureRepository.get("session-failure-atomic").activeSeedWorkKeys, draftBeforeFailure, "failed navigation must preserve the queue draft");

  const beforeDoubleFailure = failureRepository.get("session-failure-atomic");
  failMainOnCall = mainWriteCount + 2;
  failingNavigation = true;
  await assert.rejects(
    failureRepository.save({ ...beforeDoubleFailure, name: "compensation-failed" }),
    error => error === navigationWriteError,
    "a compensation failure must not replace the original navigation error",
  );
  assert.equal(failureRepository.get("session-failure-atomic").name, beforeDoubleFailure.name, "double failure must restore repository memory");
  assert.equal(failureRepository.get("session-failure-atomic").activeHopId, beforeDoubleFailure.activeHopId);
  assert.deepEqual(failureRepository.get("session-failure-atomic").activeSeedWorkKeys, beforeDoubleFailure.activeSeedWorkKeys);
  assert.equal(failureRepository.lastError, navigationWriteError, "lastError must keep the original write failure");
  assert.deepEqual(failureRepository.lastRollbackErrors, [compensationError], "compensation errors must be retained separately");
  assert.equal(failureRepository.persistent, false, "persistence must remain marked unavailable after failed compensation");
  await failureRepository.save(beforeDoubleFailure);
  assert.equal(failureRepository.persistent, true, "a later successful save must recover after failed compensation");

  const beforeRemoveFailure = failureStore;
  failingNavigation = true;
  await assert.rejects(failureRepository.remove("session-failure-atomic"), /navigation write failed/);
  assert.ok(failureRepository.get("session-failure-atomic"), "failed removal must restore the in-memory session");
  assert.equal(failureStore, beforeRemoveFailure, "failed removal must compensate the main file");

  const restartRepository = new SessionRepository(failureAdapter);
  await restartRepository.init();
  assert.deepEqual(restartRepository.get("session-failure-atomic").activeSeedWorkKeys, draftBeforeFailure, "restart must preserve the saved editable queue after sidecar navigation");
  console.log("session.test.js: all assertions passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
