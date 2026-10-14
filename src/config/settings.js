"use strict";

var ZLGSettings = (function (root) {
  const SCHEMA = Object.freeze({
    language: Object.freeze({ name: "extensions.zotero-literature-graph.language", defaultValue: "auto", values: Object.freeze(["auto", "zh-CN", "en-US"]), validate: value => ["auto", "zh-CN", "en-US"].includes(value) }),
    apiKey: Object.freeze({ name: "extensions.zotero-literature-graph.openalex.apiKey", defaultValue: "", secret: true, validate: validApiKey }),
    resultLimit: Object.freeze({ name: "extensions.zotero-literature-graph.discovery.resultLimit", defaultValue: 20, values: Object.freeze([10, 20, 40]), validate: value => [10, 20, 40].includes(value) }),
    nodeSizeMode: Object.freeze({ name: "extensions.zotero-literature-graph.graph.nodeSizeMode", defaultValue: "citations", values: Object.freeze(["citations", "degree", "uniform"]), validate: value => ["citations", "degree", "uniform"].includes(value) }),
    autoRefreshCitations: Object.freeze({ name: "extensions.zotero-literature-graph.openalex.autoRefreshCitations", defaultValue: true, validate: value => typeof value === "boolean" }),
    demoMode: Object.freeze({ name: "extensions.zotero-literature-graph.demoMode", defaultValue: true, validate: value => typeof value === "boolean" }),
    sessionPersistence: Object.freeze({ name: "extensions.zotero-literature-graph.sessionPersistence", defaultValue: true, validate: value => typeof value === "boolean" }),
  });

  function validApiKey(value) {
    return typeof value === "string" && value.length <= 1024 && /^[\x21-\x7e]*$/.test(value);
  }

  class SettingsService {
    constructor(adapter) {
      if (!adapter || typeof adapter.get !== "function" || typeof adapter.set !== "function") throw new TypeError("A settings adapter with get and set is required");
      this.adapter = adapter;
      this.listeners = new Set();
    }

    read(key) {
      if (!Object.hasOwn(SCHEMA, key)) throw new Error("Unknown setting");
      const spec = SCHEMA[key];
      try {
        const value = this.adapter.get(spec.name);
        return spec.validate(value) ? value : spec.defaultValue;
      } catch (_) { return spec.defaultValue; }
    }

    snapshot() {
      const result = { apiKeyConfigured: this.read("apiKey").length > 0 };
      for (const key of Object.keys(SCHEMA)) if (!SCHEMA[key].secret) result[key] = this.read(key);
      return Object.freeze(result);
    }

    update(patch) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Invalid settings update");
      const keys = Object.keys(patch);
      const normalized = {};
      for (const key of keys) {
        if (!Object.hasOwn(SCHEMA, key)) throw new Error("Invalid settings update");
        const spec = SCHEMA[key];
        let value = patch[key];
        if (key === "apiKey" && typeof value === "string") value = value.trim();
        if (!spec.validate(value)) throw new Error("Invalid settings update");
        normalized[key] = value;
      }

      const before = {};
      const changedKeys = [];
      for (const key of keys) {
        before[key] = this.read(key);
        if (before[key] !== normalized[key]) changedKeys.push(key);
      }
      const previousRaw = {};
      const previousHadValue = {};
      for (const key of keys) {
        const name = SCHEMA[key].name;
        try { previousRaw[key] = this.adapter.get(name); } catch (_) { previousRaw[key] = undefined; }
        try { previousHadValue[key] = typeof this.adapter.hasUserValue === "function" ? this.adapter.hasUserValue(name) : true; }
        catch (_) { previousHadValue[key] = true; }
      }
      const written = [];
      try {
        for (const key of keys) {
          const spec = SCHEMA[key];
          written.push(key);
          if (key === "apiKey" && normalized[key] === "" && typeof this.adapter.clear === "function") this.adapter.clear(spec.name);
          else this.adapter.set(spec.name, normalized[key]);
        }
      } catch (_) {
        let rollbackIncomplete = false;
        for (const key of written.reverse()) {
          const spec = SCHEMA[key];
          try {
            if (!previousHadValue[key] && typeof this.adapter.clear === "function") this.adapter.clear(spec.name);
            else this.adapter.set(spec.name, previousRaw[key]);
          } catch (_) { rollbackIncomplete = true; }
        }
        const error = new Error("Settings could not be saved");
        error.rollbackIncomplete = rollbackIncomplete;
        throw error;
      }
      const state = this.snapshot();
      for (const listener of this.listeners) {
        try { listener(state, changedKeys.slice()); } catch (_) { /* Listener errors do not affect a successful save. */ }
      }
      return state;
    }

    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Listener must be a function");
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
  }

  function createRuntimeSettings(zotero, options = {}) {
    if (!zotero || !zotero.Prefs) throw new TypeError("Zotero.Prefs is required");
    const prefs = zotero.Prefs;
    return new SettingsService({
      get: name => prefs.get(name, true),
      set: (name, value) => prefs.set(name, value, true),
      clear: options.clear || (typeof prefs.clear === "function" ? name => prefs.clear(name, true) : undefined),
      hasUserValue: options.hasUserValue || (typeof prefs.hasUserValue === "function" ? name => prefs.hasUserValue(name, true) : undefined),
    });
  }

  return Object.freeze({ SCHEMA, SettingsService, createRuntimeSettings });
})(typeof globalThis !== "undefined" ? globalThis : this);

if (typeof module !== "undefined" && module.exports) module.exports = ZLGSettings;
