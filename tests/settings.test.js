"use strict";

const assert = require("node:assert/strict");
const { SCHEMA, SettingsService, createRuntimeSettings } = require("../src/config/settings.js");

function memoryAdapter(initial = {}, failOn) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: name => values.has(name) ? values.get(name) : undefined,
    hasUserValue: name => values.has(name),
    set(name, value) {
      if (name === failOn) throw new Error("write failed");
      values.set(name, value);
    },
    clear(name) { values.delete(name); },
  };
}

const adapter = memoryAdapter({ [SCHEMA.resultLimit.name]: 99 });
const service = new SettingsService(adapter);
assert.equal(service.read("resultLimit"), 20, "invalid persisted values fall back to defaults");
assert.equal(service.read("nodeSizeMode"), "citations");
assert.equal(service.snapshot().apiKeyConfigured, false);
assert.throws(() => service.update({ resultLimit: 30 }), /Invalid settings update/);
assert.deepEqual(service.snapshot(), { apiKeyConfigured: false, language: "auto", resultLimit: 20, nodeSizeMode: "citations", autoRefreshCitations: true, demoMode: true, sessionPersistence: true });
assert.throws(() => service.update({ demoMode: false, resultLimit: 30 }), /Invalid settings update/);
assert.equal(adapter.values.has(SCHEMA.demoMode.name), false, "validation is atomic before writes");
assert.throws(() => service.update({ unknownSetting: 1 }), /Invalid settings update/);
assert.throws(() => service.read("toString"), /Unknown setting/);
assert.throws(() => service.read("__proto__"), /Unknown setting/);
assert.throws(() => service.update({ toString: true }), /Invalid settings update/);

assert.equal(service.read("language"), "auto");
assert.throws(() => service.update({language:"de-DE"}), /Invalid settings update/);
service.update({language:"en-US"});
assert.equal(new SettingsService(adapter).read("language"), "en-US");
service.update({language:"auto"});
const secret = "s3cr3t-KEY";
let notification;
const unsubscribe = service.subscribe((state, keys) => { notification = { state, keys }; });
service.update({ apiKey: secret, resultLimit: 40, demoMode: false });
assert.equal(service.read("apiKey"), secret);
assert.equal(service.snapshot().apiKeyConfigured, true);
assert.equal(JSON.stringify(service.snapshot()).includes(secret), false);
assert.equal(Object.isFrozen(service.snapshot()), true);
assert.deepEqual(notification.keys, ["apiKey", "resultLimit", "demoMode"]);
assert.equal(JSON.stringify(notification).includes(secret), false);
assert.throws(() => service.update({ apiKey: "bad key" }), error => !error.message.includes("bad key"));
assert.throws(() => service.update({ apiKey: "\u00e9" }), /Invalid settings update/);
unsubscribe();
notification = null;
service.update({ demoMode: true });
assert.equal(notification, null, "unsubscribe prevents later delivery");

const rollbackAdapter = memoryAdapter({ [SCHEMA.demoMode.name]: true }, SCHEMA.resultLimit.name);
const rollbackService = new SettingsService(rollbackAdapter);
assert.throws(() => rollbackService.update({ demoMode: false, resultLimit: 40 }), error => error.message === "Settings could not be saved" && !error.message.includes(secret));
assert.equal(rollbackAdapter.get(SCHEMA.demoMode.name), true, "successful earlier writes are rolled back");

const incompleteAdapter = memoryAdapter({ [SCHEMA.demoMode.name]: true });
incompleteAdapter.set = (name, value) => {
  if (name === SCHEMA.resultLimit.name || (name === SCHEMA.demoMode.name && value === true)) throw new Error("write failed");
  incompleteAdapter.values.set(name, value);
};
const incompleteService = new SettingsService(incompleteAdapter);
assert.throws(
  () => incompleteService.update({ demoMode: false, resultLimit: 40 }),
  error => error.message === "Settings could not be saved" && error.rollbackIncomplete === true && !error.message.includes(secret),
);

const persisted = memoryAdapter();
const writer = new SettingsService(persisted);
writer.update({ resultLimit: 40, apiKey: secret });
const reader = new SettingsService(persisted);
assert.equal(reader.read("resultLimit"), 40);
assert.equal(reader.snapshot().apiKeyConfigured, true);
reader.update({ apiKey: "" });
assert.equal(persisted.values.has(SCHEMA.apiKey.name), false, "empty key explicitly clears the preference");
assert.equal(reader.snapshot().apiKeyConfigured, false);

const prefs = new Map();
const runtime = createRuntimeSettings({ Prefs: {
  get(name, absolute) { assert.equal(absolute, true); return prefs.get(name); },
  set(name, value, absolute) { assert.equal(absolute, true); prefs.set(name, value); },
  clear(name, absolute) { assert.equal(absolute, true); prefs.delete(name); },
  hasUserValue(name, absolute) { assert.equal(absolute, true); return prefs.has(name); },
} });
runtime.update({ demoMode: false });
assert.equal(runtime.read("demoMode"), false);

console.log("settings tests passed");
