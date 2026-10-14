/* global IOUtils, PathUtils, ZLGDiscoveryCore, Zotero, module */

var ZLGSessionStore = (() => {
  "use strict";

  const STORE_SCHEMA_VERSION = 1;
  const NAVIGATION_SCHEMA_VERSION = 1;

  function emptyState() {
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      recentSessionId: null,
      sessions: {},
      updatedAt: new Date().toISOString(),
    };
  }

  function emptyNavigationState() {
    return {
      schemaVersion: NAVIGATION_SCHEMA_VERSION,
      activeBySession: {},
      updatedAt: new Date().toISOString(),
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  class SessionRepository {
    constructor(adapter = null) {
      this.adapter = adapter;
      this.state = emptyState();
      this.navigationState = emptyNavigationState();
      this.initialized = false;
      this.persistent = Boolean(adapter);
      this.lastError = null;
      this.lastRollbackErrors = [];
      this.mutationQueue = Promise.resolve();
    }

    async init() {
      if (this.initialized) return this;
      this.initialized = true;
      if (!this.adapter) return this;
      try {
        const raw = await this.adapter.read();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.schemaVersion !== STORE_SCHEMA_VERSION || typeof parsed.sessions !== "object") {
            throw new Error("Unsupported session store schema");
          }
          for (const session of Object.values(parsed.sessions)) {
            const errors = ZLGDiscoveryCore.validateSession(session);
            if (errors.length) throw new Error(`Invalid saved session: ${errors.join("; ")}`);
          }
          this.state = parsed;
        }
      }
      catch (error) {
        this.lastError = error;
        try { await this.adapter.quarantine?.(); }
        catch { this.persistent = false; }
        this.state = emptyState();
      }
      if (this.adapter.readNavigation) {
        try {
          const raw = await this.adapter.readNavigation();
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.schemaVersion !== NAVIGATION_SCHEMA_VERSION || typeof parsed.activeBySession !== "object") {
              throw new Error("Unsupported navigation store schema");
            }
            this.navigationState = parsed;
            for (const [sessionId, navigation] of Object.entries(parsed.activeBySession)) {
              const session = this.state.sessions[sessionId];
              const hop = session?.hops?.find(value => value.hopId === navigation.hopId);
              if (!session || !hop) continue;
              session.activeHopId = hop.hopId;
            }
          }
        }
        catch (error) {
          this.lastError = error;
          try { await this.adapter.quarantineNavigation?.(); }
          catch { this.persistent = false; }
          this.navigationState = emptyNavigationState();
        }
      }
      return this;
    }

    serializeMutation(task) {
      const operation = this.mutationQueue.catch(() => {}).then(task);
      this.mutationQueue = operation.catch(() => {});
      return operation;
    }

    async writeMainState() {
      if (!this.adapter) return;
      try {
        await this.adapter.write(JSON.stringify(this.state, null, 2));
      }
      catch (error) {
        this.lastError = error;
        this.persistent = false;
        throw error;
      }
      this.lastError = null;
      this.lastRollbackErrors = [];
      this.persistent = true;
    }

    async writeNavigationState() {
      if (!this.adapter?.writeNavigation) return;
      try {
        await this.adapter.writeNavigation(JSON.stringify(this.navigationState));
      }
      catch (error) {
        this.lastError = error;
        this.persistent = false;
        throw error;
      }
      this.lastError = null;
      this.lastRollbackErrors = [];
      this.persistent = true;
    }

    snapshotState() {
      return { state: clone(this.state), navigationState: clone(this.navigationState) };
    }

    async rollbackWrites(snapshot, { mainWritten, navigationAttempted }) {
      if (!this.adapter) return;
      const failures = [];
      if (mainWritten) {
        try { await this.adapter.write(JSON.stringify(snapshot.state, null, 2)); }
        catch (error) { failures.push(error); }
      }
      if (navigationAttempted && this.adapter.writeNavigation) {
        try { await this.adapter.writeNavigation(JSON.stringify(snapshot.navigationState)); }
        catch (error) { failures.push(error); }
      }
      this.lastRollbackErrors = failures;
    }

    async atomicMutation(mutate, { main = false, navigation = false } = {}) {
      const snapshot = this.snapshotState();
      let mainWritten = false;
      let navigationAttempted = false;
      try {
        const result = mutate();
        if (main) {
          await this.writeMainState();
          mainWritten = Boolean(this.adapter);
        }
        if (navigation) {
          navigationAttempted = Boolean(this.adapter?.writeNavigation);
          await this.writeNavigationState();
        }
        return result;
      }
      catch (error) {
        this.state = snapshot.state;
        this.navigationState = snapshot.navigationState;
        await this.rollbackWrites(snapshot, { mainWritten, navigationAttempted });
        this.lastError = error;
        this.persistent = false;
        throw error;
      }
    }

    flushNow() {
      return this.serializeMutation(() => this.atomicMutation(() => {
        this.state.updatedAt = new Date().toISOString();
      }, { main: true }));
    }

    flush() {
      return this.flushNow();
    }

    flushNavigationNow() {
      return this.serializeMutation(() => this.atomicMutation(() => {
        this.navigationState.updatedAt = new Date().toISOString();
      }, { navigation: true }));
    }

    flushNavigation() {
      return this.flushNavigationNow();
    }

    list() {
      return Object.values(this.state.sessions)
        .map(clone)
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    }

    get(sessionId) {
      const value = this.state.sessions[sessionId];
      return value ? clone(value) : null;
    }

    recent() {
      return this.get(this.state.recentSessionId) || this.list()[0] || null;
    }

    save(sessionInput) {
      return this.serializeMutation(async () => {
        const session = ZLGDiscoveryCore.createSession(sessionInput);
        const errors = ZLGDiscoveryCore.validateSession(session);
        if (errors.length) throw new Error(`Invalid session: ${errors.join("; ")}`);
        session.updatedAt = new Date().toISOString();
        return this.atomicMutation(() => {
          this.state.sessions[session.sessionId] = session;
          this.state.recentSessionId = session.sessionId;
          if (session.activeHopId) {
            this.navigationState.activeBySession[session.sessionId] = {
              hopId: session.activeHopId,
              updatedAt: session.updatedAt,
            };
          }
          return clone(session);
        }, { main: true, navigation: Boolean(session.activeHopId) });
      });
    }

    saveActiveHop(sessionId, hopId) {
      return this.serializeMutation(() => {
        const session = this.state.sessions[sessionId];
        const hop = session?.hops?.find(value => value.hopId === hopId);
        if (!session || !hop) throw new Error(`Unknown active hop: ${hopId}`);
        return this.atomicMutation(() => {
          session.activeHopId = hop.hopId;
          session.updatedAt = new Date().toISOString();
          this.state.recentSessionId = sessionId;
          this.navigationState.activeBySession[sessionId] = {
            hopId: hop.hopId,
            updatedAt: session.updatedAt,
          };
          return {
            activeHopId: hop.hopId,
            activeSeedWorkKeys: [...(session.activeSeedWorkKeys || [])],
          };
        }, { navigation: true });
      });
    }

    remove(sessionId) {
      return this.serializeMutation(() => this.atomicMutation(() => {
        delete this.state.sessions[sessionId];
        delete this.navigationState.activeBySession[sessionId];
        if (this.state.recentSessionId === sessionId) this.state.recentSessionId = this.list()[0]?.sessionId || null;
      }, { main: true, navigation: true }));
    }
  }

  function runtimeAdapter() {
    if (typeof PathUtils === "undefined" || typeof IOUtils === "undefined") return null;
    const directory = PathUtils.join(PathUtils.profileDir, "zotero-literature-graph");
    const path = PathUtils.join(directory, "sessions-v1.json");
    const tempPath = PathUtils.join(directory, "sessions-v1.tmp");
    const navigationPath = PathUtils.join(directory, "session-navigation-v1.json");
    const navigationTempPath = PathUtils.join(directory, "session-navigation-v1.tmp");
    return {
      path,
      async read() {
        await IOUtils.makeDirectory(directory, { ignoreExisting: true });
        if (!await IOUtils.exists(path)) return null;
        return IOUtils.readUTF8(path);
      },
      async write(value) {
        await IOUtils.makeDirectory(directory, { ignoreExisting: true });
        await IOUtils.writeUTF8(path, value, { tmpPath: tempPath });
      },
      async readNavigation() {
        await IOUtils.makeDirectory(directory, { ignoreExisting: true });
        if (!await IOUtils.exists(navigationPath)) return null;
        return IOUtils.readUTF8(navigationPath);
      },
      async writeNavigation(value) {
        await IOUtils.makeDirectory(directory, { ignoreExisting: true });
        await IOUtils.writeUTF8(navigationPath, value, { tmpPath: navigationTempPath });
      },
      async quarantine() {
        if (!await IOUtils.exists(path)) return;
        const suffix = new Date().toISOString().replace(/[:.]/g, "-");
        await IOUtils.move(path, `${path}.corrupt-${suffix}`, { noOverwrite: true });
      },
      async quarantineNavigation() {
        if (!await IOUtils.exists(navigationPath)) return;
        const suffix = new Date().toISOString().replace(/[:.]/g, "-");
        await IOUtils.move(navigationPath, `${navigationPath}.corrupt-${suffix}`, { noOverwrite: true });
      },
    };
  }

  async function createRuntimeRepository() {
    const repository = new SessionRepository(runtimeAdapter());
    await repository.init();
    if (repository.lastError && typeof Zotero !== "undefined") Zotero.logError(repository.lastError);
    return repository;
  }

  return Object.freeze({ STORE_SCHEMA_VERSION, NAVIGATION_SCHEMA_VERSION, emptyState, emptyNavigationState, SessionRepository, runtimeAdapter, createRuntimeRepository });
})();

if (typeof module !== "undefined" && module.exports) module.exports = ZLGSessionStore;
