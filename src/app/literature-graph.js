/* global Zotero, Services, ZLGCore, ZLGRelationStore, ZLGIdentity, ZLGDiscoveryCore,
          ZLGOpenAlexProvider, ZLGSessionStore, ZLGZoteroAdapter, ZLGDiscoveryService,
          ZLGSettings, ZLGPreferencesIntegration */

var LiteratureGraph = {
  id: null,
  version: null,
  rootURI: null,
  sectionID: null,
  initialized: false,
  windowElementIDs: new Map(),
  windowCleanups: new Map(),
  _demoCache: null,
  _storeEdgeCache: null,
  _endpointCache: new Map(),
  _sessionRepository: null,
  _localIndexPromise: null,
  _notifierID: null,
  _settings: null,
  _preferencesIntegration: null,
  _languageUnsubscribe: null,
  _graphWindows: new Set(),
  READ_ONLY_BUILD: true,

  DEMO_PAPERS: [
    { title: "研究问题与基础方法（示例）", shortTitle: "基础方法", year: 2020 },
    { title: "方法改进与对比分析（示例）", shortTitle: "方法改进", year: 2021 },
    { title: "试验设计与测量方法（示例）", shortTitle: "试验设计", year: 2022 },
    { title: "近期进展与研究展望（示例）", shortTitle: "研究展望", year: 2023 },
  ],

  async init({ id, version, rootURI }) {
    if (this.initialized) return;
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    try {
    ZLGI18n.configure({language:this.getSettings().read("language"),hostLocale:Zotero.locale || "en-US"});
    this._languageUnsubscribe = this.getSettings().subscribe((settings, changedKeys) => {
      if (!changedKeys.includes("language")) return;
      ZLGI18n.configure({language:settings.language,hostLocale:Zotero.locale || "en-US"});
      this._demoCache = null;
      for (const win of this.windowElementIDs.keys()) this.refreshNativeLabels(win);
      if (this.sectionID) Zotero.ItemPaneManager.unregisterSection(this.sectionID);
      this.registerItemPane();
    });
    const persistSessions = this.getSettings().read("sessionPersistence");
    this._sessionRepository = persistSessions
      ? await ZLGSessionStore.createRuntimeRepository()
      : await new ZLGSessionStore.SessionRepository().init();
    this._notifierID = Zotero.Notifier.registerObserver({
      notify: (event, type) => {
        if (type === "item" && ["add", "modify", "delete", "trash"].includes(event)) this._localIndexPromise = null;
      },
    }, ["item"], "zotero-literature-graph-local-index");
    this.registerItemPane();
    this._preferencesIntegration = new ZLGPreferencesIntegration.PreferencesIntegration({pluginID:this.id,settings:this.getSettings()});
    await this._preferencesIntegration.register();
    this.initialized = true;
    Zotero.debug("[Zotero Collection Relations] Initialized");
    } catch (error) {
      this.shutdown();
      throw error;
    }
  },

  getSettings() {
    if (!this._settings) this._settings = ZLGSettings.createRuntimeSettings(Zotero, {
      hasUserValue:name=>Services.prefs.prefHasUserValue(name),
    });
    return this._settings;
  },

  getNodeSizeMode() {
    return this.getSettings().read("nodeSizeMode");
  },

  setNodeSizeMode(value) {
    this.getSettings().update({nodeSizeMode:value});
  },

  windowSettings() {
    return {
      language:this.getSettings().read("language"),
      hostLocale:Zotero.locale || "en-US",
      nodeSizeMode:this.getNodeSizeMode(),
      defaultResultLimit:this.getSettings().read("resultLimit"),
      setNodeSizeMode:mode=>this.setNodeSizeMode(mode),
      getSettings:()=>this.getSettings().snapshot(),
      subscribeSettings:listener=>this.getSettings().subscribe(listener),
      openSettings:()=>this._preferencesIntegration.open(),
    };
  },

  trackGraphWindow(win) {
    this._graphWindows.add(win);
    win.addEventListener("unload",()=>this._graphWindows.delete(win),{once:true});
    return win;
  },

  registerItemPane() {
    this.sectionID = Zotero.ItemPaneManager.registerSection({
      paneID: "literature-relations",
      pluginID: this.id,
      header: {
        l10nID: ZLGI18n.locale() === "en-US" ? "zlg-item-pane-header-en" : "zlg-item-pane-header-zh",
        icon: this.rootURI + "icons/16/relation.svg",
      },
      sidenav: {
        l10nID: ZLGI18n.locale() === "en-US" ? "zlg-item-pane-sidenav-en" : "zlg-item-pane-sidenav-zh",
        icon: this.rootURI + "icons/20/relation.svg",
        orderable: true,
      },
      sectionButtons: [
        {
          type: "open-graph",
          icon: this.rootURI + "icons/16/graph.svg",
          l10nID: ZLGI18n.locale() === "en-US" ? "zlg-open-local-graph-en" : "zlg-open-local-graph-zh",
          onClick: ({ item }) => this.openGraphForItem(item),
        },
      ],
      onRender: args => {
        const { body, item, setEnabled } = args;
        const enabled = Boolean(item?.isRegularItem?.());
        setEnabled(enabled);
        body.dataset.zlgItemKey = item?.key || "";
        body.replaceChildren();
        const loading = body.ownerDocument.createElement("div");
        loading.className = "zlg-loading";
        loading.textContent = enabled ? ZLGT("正在读取关系…") : ZLGT("仅支持普通文献条目");
        body.appendChild(loading);
        if (enabled) this.renderSectionSafe(args);
      },
      onAsyncRender: args => this.renderSectionSafe(args),
    });
  },

  addToAllWindows() {
    for (const win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.addToWindow(win);
    }
  },

  addToWindow(win) {
    const doc = win.document;
    if (doc.getElementById("zlg-main-style")) return;
    win.MozXULElement.insertFTLIfNeeded("literature-graph.ftl");

    const ids = [];
    const cleanups = [];
    const stylesheet = doc.createElement("link");
    stylesheet.id = "zlg-main-style";
    stylesheet.rel = "stylesheet";
    stylesheet.type = "text/css";
    stylesheet.href = this.rootURI + "ui/item-pane.css?zlg=" + encodeURIComponent(this.version);
    doc.documentElement.appendChild(stylesheet);
    ids.push(stylesheet.id);

    const toolsMenu = doc.getElementById("menu_ToolsPopup") || doc.getElementById("menu_toolsPopup");
    if (toolsMenu) {
      const discoveryItem = doc.createXULElement("menuitem");
      discoveryItem.id = "zlg-open-discovery";
      discoveryItem.setAttribute("label", "Zotero Collection Relations…");
      discoveryItem.addEventListener("command", () => this.openDiscoveryFromContext(win));
      toolsMenu.appendChild(discoveryItem);
      ids.push(discoveryItem.id);

      const restoreItem = doc.createXULElement("menuitem");
      restoreItem.id = "zlg-restore-session";
      restoreItem.setAttribute("label", ZLGT("恢复最近探索"));
      restoreItem.addEventListener("command", () => this.openRecentDiscovery(win));
      toolsMenu.appendChild(restoreItem);
      ids.push(restoreItem.id);

      const settingsItem = doc.createXULElement("menuitem");
      settingsItem.id = "zlg-open-settings";
      settingsItem.setAttribute("label", ZLGT("Zotero Collection Relations 设置…"));
      settingsItem.addEventListener("command", () => this._preferencesIntegration.open());
      toolsMenu.appendChild(settingsItem);
      ids.push(settingsItem.id);

      const menuitem = doc.createXULElement("menuitem");
      menuitem.id = "zlg-open-demo-graph";
      menuitem.setAttribute("label", ZLGT("示例图谱…"));
      menuitem.addEventListener("command", () => this.openDemoGraph());
      toolsMenu.appendChild(menuitem);
      ids.push(menuitem.id);
    }

    const itemMenu = doc.getElementById("zotero-itemmenu");
    if (itemMenu) {
      const discoverItem = doc.createXULElement("menuitem");
      discoverItem.id = "zlg-discover-selection";
      discoverItem.setAttribute("label", ZLGT("从所选文献查找…"));
      discoverItem.addEventListener("command", () => this.openDiscoveryFromContext(win, { preferSelection: true }));
      itemMenu.appendChild(discoverItem);
      ids.push(discoverItem.id);

      const updateState = () => {
        const selected = win.ZoteroPane.getSelectedItems().filter(item => item.isRegularItem());
        discoverItem.disabled = selected.length < 1 || selected.length > 50;
      };
      itemMenu.addEventListener("popupshowing", updateState);
      cleanups.push(() => itemMenu.removeEventListener("popupshowing", updateState));
    }
    const collectionToolbar = doc.getElementById("zotero-collections-toolbar");
    if (collectionToolbar) {
      const shortcut = doc.createXULElement("toolbarbutton");
      shortcut.id = "zlg-collection-shortcut";
      shortcut.className = "zotero-tb-button zlg-collection-shortcut";
      shortcut.setAttribute("label", ZLGT("关系图"));
      shortcut.setAttribute("tooltiptext", ZLGT("打开文献集关系图"));
      shortcut.setAttribute("aria-label", ZLGT("打开文献集关系图"));
      shortcut.setAttribute("image", this.rootURI + "icons/16/graph.svg");
      shortcut.addEventListener("command", async () => {
        if (shortcut.disabled) return;
        shortcut.disabled = true;
        try { await this.openCollectionFromContext(win); }
        catch (error) {
          Zotero.logError(error);
          if (this.initialized) Services.prompt.alert(win, ZLGT("文献集打开失败"), ZLGT(error.message || String(error)));
        }
        finally { if (shortcut.isConnected) shortcut.disabled = false; }
      });
      collectionToolbar.insertBefore(shortcut, collectionToolbar.querySelector("spacer"));
      ids.push(shortcut.id);
    }
    this.windowElementIDs.set(win, ids);
    this.windowCleanups.set(win, cleanups);
  },

  refreshNativeLabels(win) {
    for (const [id, text] of [["zlg-restore-session", "恢复最近探索"], ["zlg-open-settings", "Zotero Collection Relations 设置…"], ["zlg-open-demo-graph", "示例图谱…"], ["zlg-discover-selection", "从所选文献查找…"], ["zlg-collection-shortcut", "关系图"]]) {
      win.document.getElementById(id)?.setAttribute("label", ZLGT(text));
    }
    const shortcut = win.document.getElementById("zlg-collection-shortcut");
    for (const attr of ["tooltiptext", "aria-label"]) shortcut?.setAttribute(attr, ZLGT("打开文献集关系图"));
  },

  removeFromWindow(win) {
    const doc = win.document;
    for (const cleanup of this.windowCleanups.get(win) || []) cleanup();
    for (const id of this.windowElementIDs.get(win) || []) doc.getElementById(id)?.remove();
    doc.querySelector('[href="literature-graph.ftl"]')?.remove();
    this.windowElementIDs.delete(win);
    this.windowCleanups.delete(win);
  },

  shutdown() {
    for (const win of [...this._graphWindows]) if (!win.closed) win.close();
    this._graphWindows.clear();
    for (const win of Zotero.getMainWindows()) this.removeFromWindow(win);
    if (this.sectionID) Zotero.ItemPaneManager.unregisterSection(this.sectionID);
    if (this._notifierID) Zotero.Notifier.unregisterObserver(this._notifierID);
    this._languageUnsubscribe?.();
    this._languageUnsubscribe = null;
    this._preferencesIntegration?.unregister();
    this._preferencesIntegration = null;
    this._settings = null;
    this.sectionID = null;
    this._demoCache = null;
    this._storeEdgeCache = null;
    this._endpointCache.clear();
    this._sessionRepository = null;
    this._localIndexPromise = null;
    this._notifierID = null;
    this.initialized = false;
  },

  async findByDOI(libraryID, doi) {
    const search = new Zotero.Search();
    search.libraryID = libraryID;
    // Zotero's exact DOI condition is case-sensitive in the tested 9.0.6
    // library. Use contains, then normalize, so case-only duplicates are not
    // silently missed.
    search.addCondition("DOI", "contains", doi);
    const ids = await search.search();
    const items = await Zotero.Items.getAsync(ids);
    const normalized = ZLGCore.cleanDOI(doi);
    return items.filter(item => (
      item?.isRegularItem?.()
      && ZLGCore.cleanDOI(item.getField("DOI")) === normalized
    ));
  },

  async resolveDemoData() {
    if (this._demoCache) return this._demoCache;
    const nodes = this.DEMO_PAPERS.map((paper, index) => ({
      ...paper,
      workKey: `example:paper-${index + 1}`,
      authors: [{ name: ZLGT`示例作者 ${index + 1}` }],
      localKeys: [],
      provider: "example",
      isSeed: true,
    }));
    const edges = [[1, 0], [2, 0], [2, 1], [3, 2]].map(([source, target], index) => ({
      id: `zlg-demo-${index + 1}`,
      edgeKey: `example:edge-${index + 1}`,
      sourceWorkKey: nodes[source].workKey,
      targetWorkKey: nodes[target].workKey,
      type: "cites",
      status: "candidate",
      provenance: "synthetic-example",
      comment: ZLGT("虚构示例，不代表真实文献关系。"),
      evidence: [],
    }));
    this._demoCache = { nodes, edges };
    return this._demoCache;
  },

  async loadStoredEdges() {
    if (this._storeEdgeCache) return this._storeEdgeCache;
    const search = new Zotero.Search();
    search.libraryID = Zotero.Libraries.userLibraryID;
    search.addCondition("itemType", "is", "note");
    search.addCondition("tag", "is", ZLGCore.STORE_TAG);
    const ids = await search.search();
    const notes = await Zotero.Items.getAsync(ids);
    const edges = [];
    for (const note of notes) {
      try {
        const store = ZLGRelationStore.parseStore(note.getNote());
        if (store) edges.push(...store.edges);
      }
      catch (error) {
        Zotero.logError(error);
      }
    }
    this._storeEdgeCache = edges;
    return edges;
  },

  async allEdges() {
    const stored = await this.loadStoredEdges();
    return [...new Map(stored.map(edge => [edge.id, edge])).values()];
  },

  async resolveEndpoint(value) {
    const cacheKey = `${value.libraryID}:${value.itemKey}`;
    if (this._endpointCache.has(cacheKey)) return this._endpointCache.get(cacheKey);
    let item = Zotero.Items.getByLibraryAndKey(value.libraryID, value.itemKey);
    let state = "ok";
    let matches = [];
    if (!item && value.doi) {
      matches = await this.findByDOI(value.libraryID, value.doi);
      if (matches.length === 1) {
        item = matches[0];
        state = "repairable";
      }
      else state = matches.length > 1 ? "ambiguous" : "broken";
    }
    else if (value.doi) {
      matches = await this.findByDOI(value.libraryID, value.doi);
      if (matches.length > 1) state = "duplicate";
    }
    const result = {
      ...value,
      item,
      state,
      duplicateCount: matches.length,
      title: item?.getField("title") || value.title,
      year: Number((item?.getField("date") || value.year || "").toString().match(/\b(19|20)\d{2}\b/)?.[0] || value.year),
    };
    this._endpointCache.set(cacheKey, result);
    return result;
  },

  async edgesForItem(item) {
    const edges = (await this.allEdges()).filter(edge => ZLGCore.edgeTouches(edge, item.libraryID, item.key));
    return Promise.all(edges.map(async edge => {
      const outgoing = edge.source.libraryID === item.libraryID && edge.source.itemKey === item.key;
      const other = await this.resolveEndpoint(outgoing ? edge.target : edge.source);
      return { edge, outgoing, other };
    }));
  },

  async renderSection({ body, item, setEnabled, setSectionSummary }) {
    if (!item?.isRegularItem?.()) {
      setEnabled(false);
      return;
    }
    const relations = await this.edgesForItem(item);
    if (body.dataset.zlgItemKey !== item.key) return;
    setSectionSummary(ZLGT`${relations.length} 条`);
    body.replaceChildren();
    const doc = body.ownerDocument;
    const wrap = doc.createElement("div");
    wrap.className = "zlg-pane";

    if (!relations.length) {
      const empty = doc.createElement("div");
      empty.className = "zlg-empty";
      empty.textContent = ZLGT("暂无本地关系。");
      wrap.appendChild(empty);
    }
    else {
      for (const relation of relations) wrap.appendChild(this.createRelationCard(doc, item, relation));
    }

    const footer = doc.createElement("div");
    footer.className = "zlg-pane-footer";
    const graphButton = doc.createElement("button");
    graphButton.type = "button";
    graphButton.textContent = ZLGT("打开关系图");
    graphButton.addEventListener("click", () => this.openGraphForItem(item));
    footer.appendChild(graphButton);
    if (this.READ_ONLY_BUILD) {
      const guard = doc.createElement("span");
      guard.className = "zlg-guard";
      guard.textContent = ZLGT("只读");
      footer.appendChild(guard);
    }
    wrap.appendChild(footer);
    body.appendChild(wrap);
  },

  async renderSectionSafe(args) {
    try {
      await this.renderSection(args);
    }
    catch (error) {
      Zotero.logError(error);
      const { body, item } = args;
      if (body.dataset.zlgItemKey !== item?.key) return;
      const failure = body.ownerDocument.createElement("div");
      failure.className = "zlg-empty";
      failure.textContent = ZLGT("读取失败，请重试。");
      body.replaceChildren(failure);
    }
  },

  createRelationCard(doc, item, relation) {
    const { edge, outgoing, other } = relation;
    const card = doc.createElement("article");
    card.className = "zlg-relation-card";
    card.dataset.status = edge.status;

    const top = doc.createElement("div");
    top.className = "zlg-relation-top";
    const type = doc.createElement("span");
    type.className = `zlg-type zlg-type-${edge.type}`;
    type.textContent = `${outgoing ? "→" : "←"} ${ZLGT(ZLGCore.relationLabel(edge.type))}`;
    const status = doc.createElement("span");
    status.className = "zlg-status";
    status.textContent = edge.id?.startsWith("zlg-demo-") ? ZLGT("示例") : edge.status === "verified" ? ZLGT("已核验") : edge.status;
    top.append(type, status);

    const title = doc.createElement("button");
    title.type = "button";
    title.className = "zlg-target-title";
    title.textContent = `${other.year || "—"} · ${other.title || other.itemKey}`;
    title.addEventListener("click", () => this.selectEndpoint(other));

    const comment = doc.createElement("p");
    comment.className = "zlg-comment";
    comment.textContent = edge.comment || ZLGT("暂无说明");

    const meta = doc.createElement("div");
    meta.className = "zlg-meta";
    const evidence = edge.evidence?.[0];
    meta.textContent = evidence?.locator
      ? ZLGT`证据：${evidence.locator}${evidence.page ? ` · PDF p.${evidence.page}` : ""}`
      : ZLGT`来源：${edge.provenance}`;
    if (["duplicate", "ambiguous"].includes(other.state)) {
      const warning = doc.createElement("span");
      warning.className = "zlg-warning";
      warning.textContent = ZLGT`同 DOI ${other.duplicateCount} 条`;
      meta.append(" ", warning);
    }

    card.append(top, title, comment, meta);
    return card;
  },

  selectEndpoint(endpoint) {
    if (!endpoint.item) return;
    Zotero.getActiveZoteroPane()?.selectItem(endpoint.item.id);
  },

  async graphData() {
    const demo = await this.resolveDemoData();
    const edges = this.getSettings().read("demoMode") ? demo.edges : [];
    return {
      title: ZLGT("示例文献关系（虚构数据）"),
      nodes: demo.nodes,
      edges,
      readOnly: true,
      session: {
        sessionId: "example-demo",
        rootSeedWorkKeys: demo.nodes.map(node => node.workKey),
        rootSeedLocalKeys: [],
        activeSeedWorkKeys: [],
        hops: [],
        graphSnapshot: { works: demo.nodes, edges },
      },
    };
  },

  async openDemoGraph() {
    this.openGraphWindow(await this.graphData());
  },

  async openGraphForItem(item) {
    if (!item?.isRegularItem?.()) return;
    await this.openDiscoveryForItems([item], { name: ZLGT`发现 · ${item.getField("title")}` });
  },

  async ensureLocalIndex() {
    if (!this._localIndexPromise) {
      this._localIndexPromise = ZLGZoteroAdapter.buildLocalIndex().catch(error => {
        this._localIndexPromise = null;
        throw error;
      });
    }
    return this._localIndexPromise;
  },

  createProvider() {
    return new ZLGOpenAlexProvider.OpenAlexProvider({
      getAPIKey: () => this.getSettings().read("apiKey"),
      userAgent: `zotero-collection-relations/${this.version}`,
    });
  },

  async createDiscoveryService(snapshot = null) {
    const service = new ZLGDiscoveryService.DiscoveryService({
      provider: this.createProvider(),
      localIndex: await this.ensureLocalIndex(),
    });
    if (snapshot) service.hydrate(snapshot);
    return service;
  },

  async openDiscoveryFromContext(win = Zotero.getMainWindow(), options = {}) {
    const scoped = ZLGZoteroAdapter.directCollectionItems(win);
    if (!options.preferSelection && scoped.collection) {
      await this.openCollectionFromContext(win);
      return;
    }
    const selected = ZLGZoteroAdapter.selectedItems(win);
    if (selected.length) {
      await this.openDiscoveryForItems(selected, {
        name: selected.length === 1 ? ZLGT`发现 · ${selected[0].getField("title")}` : ZLGT`发现 · ${selected.length} 篇检索起点`,
      });
      return;
    }
    const { collection, items } = ZLGZoteroAdapter.directCollectionItems(win);
    if (collection && items.length) {
      await this.openDiscoveryForItems(items, { name: collection.name, collection: true });
      return;
    }
    const recent = this._sessionRepository?.recent();
    if (recent) {
      await this.openSavedDiscovery(recent);
      return;
    }
    Services.prompt.alert(win, "Zotero Collection Relations", ZLGT("请选择文献集或 1–50 篇文献。"));
  },

  async prepareCollectionContext(collectionID, snapshot = null, options = {}) {
    const collection = collectionID ? Zotero.Collections.get(Number(collectionID)) : null;
    if (collectionID && !collection) throw new Error(ZLGT("文献集已不存在，请重新选择。"));
    const audit = ZLGZoteroAdapter.seedAudit(collection?.getChildItems?.() || []);
    const scope = collection ? { id: collection.id, libraryID: collection.libraryID, key: collection.key } : null;
    const sameKeys = session => {
      const keys = [...(session.rootSeedLocalKeys || [])].sort();
      return JSON.stringify(keys) === JSON.stringify(audit.refs.map(ZLGIdentity.localKey).sort());
    };
    const saved = scope && this._sessionRepository.list().find(session =>
      session.collectionScope
        ? session.collectionScope.libraryID === scope.libraryID && session.collectionScope.key === scope.key
        : session.name === collection.name && sameKeys(session));
    const service = await this.createDiscoveryService(saved?.graphSnapshot || snapshot);
    const seeds = await service.resolveSeeds(audit.refs, { concurrency: 4, signal: options.signal });
    const checkAborted = () => {
      if (!options.signal?.aborted) return;
      const error = new Error(ZLGT("文献集切换已取消")); error.name = "AbortError"; throw error;
    };
    checkAborted();
    let session = ZLGDiscoveryCore.createSession({
      ...(saved || {}), name: collection?.name || ZLGT("文献集关系"), collectionScope: scope,
      rootSeedLocalKeys: audit.refs.map(ZLGIdentity.localKey), rootSeedWorkKeys: seeds.map(work => work.workKey),
      activeSeedWorkKeys: saved?.activeSeedWorkKeys || [],
    });
    session.graphSnapshot = service.snapshot();
    if (collection) session = await this._sessionRepository.save(session);
    checkAborted();
    return { service, session, audit, chooseCollection: !collection };
  },

  async openCollectionFromContext(win = Zotero.getMainWindow()) {
    const collection = win?.ZoteroPane?.getSelectedCollection?.();
    const context = await this.prepareCollectionContext(collection?.id || null);
    if (!this.initialized) return;
    const existing = [...this._graphWindows].find(window => !window.closed
      && window.ZLGGraphWorkbench?.args?.data.session?.sessionId === context.session.sessionId);
    if (existing) {
      existing.ZLGGraphWorkbench.replace(this.discoveryWindowArgs(context));
      existing.focus();
      return existing;
    }
    return this.openDiscoveryWindow(context);
  },

  async openDiscoveryForItems(items, options = {}) {
    const audit = ZLGZoteroAdapter.seedAudit(items);
    if (!audit.total) return;
    if (!options.collection && audit.total > 50) {
      Services.prompt.alert(
        Zotero.getMainWindow(),
        ZLGT("检索起点过多"),
        ZLGT`当前选择 ${audit.total} 篇。MVP 每个会话最多使用 50 篇检索起点，请缩小选择范围；插件没有静默截断。`,
      );
      return;
    }
    try {
      const service = await this.createDiscoveryService();
      const seeds = await service.resolveSeeds(audit.refs, { concurrency: 4 });
      let session = ZLGDiscoveryCore.createSession({
        name: options.name || ZLGT`文献发现 · ${audit.total} 篇检索起点`,
        rootSeedLocalKeys: audit.refs.map(ZLGIdentity.localKey),
        rootSeedWorkKeys: seeds.map(work => work.workKey),
        activeSeedWorkKeys: options.collection ? [] : seeds.map(work => work.workKey),
      });
      session.graphSnapshot = service.snapshot();
      session = await this._sessionRepository.save(session);
      this.openDiscoveryWindow({ service, session, audit });
    }
    catch (error) {
      Zotero.logError(error);
      Services.prompt.alert(Zotero.getMainWindow(), ZLGT("文献发现启动失败"), ZLGT(error.message || String(error)));
    }
  },

  async openRecentDiscovery(win = Zotero.getMainWindow()) {
    const recent = this._sessionRepository?.recent();
    if (!recent) {
      Services.prompt.alert(win, "Zotero Collection Relations", ZLGT("暂无探索记录。"));
      return;
    }
    await this.openSavedDiscovery(recent);
  },

  async openSavedDiscovery(sessionInput) {
    try {
      const session = ZLGDiscoveryCore.createSession(sessionInput);
      const service = await this.createDiscoveryService(session.graphSnapshot);
      this.openDiscoveryWindow({ service, session, audit: null });
    }
    catch (error) {
      Zotero.logError(error);
      Services.prompt.alert(Zotero.getMainWindow(), ZLGT("会话恢复失败"), ZLGT(error.message || String(error)));
    }
  },

  discoveryWindowArgs(context) {
    let { service, session } = context;
    const persist = async () => {
      session.graphSnapshot = service.snapshot();
      session = await this._sessionRepository.save(session);
      return session;
    };
    const data = service.graphData(session, {
      audit: context.audit,
      warnings: service.warnings,
      persistence: {
        enabled: this._sessionRepository.persistent,
        error: this._sessionRepository.lastError?.message || null,
      },
    });
    const args = {
      hostWindow: Zotero.getMainWindow(),
      data,
      chooseCollection: Boolean(context.chooseCollection),
      ...this.windowSettings(),
      focusGraph: (graphData, options) => ZLGDiscoveryCore.focusGraph(graphData, options),
      refreshCitationCounts: async request => {
        if (!request.force && !this.getSettings().read("autoRefreshCitations")) return {works:[],refreshedCount:0};
        const report = await service.refreshCitationCounts(request.workKeys, request);
        if (report.refreshedCount) await persist();
        return report;
      },
      discover: async request => {
        const previousSession = session;
        try {
        const result = await service.discover(request);
        const resultKeySet = new Set(result.works.map(work => work.workKey));
        session = ZLGDiscoveryCore.addHop(session, {
          mode: request.mode,
          seedWorkKeys: request.seedWorkKeys,
          resultWorkKeys: result.works.map(work => work.workKey),
          resultEntries: result.works.map(work => ({ workKey: work.workKey, discovery: work.discovery })),
          edgeEntries: result.edges.filter(edge => (
            resultKeySet.has(edge.sourceWorkKey) || resultKeySet.has(edge.targetWorkKey)
          )),
          resultLimit: request.limit,
          resultTotal: result.total,
          resultTotalScope: result.totalScope,
          limitedByProvider: result.limitedByProvider,
          rankingApproximate: result.rankingApproximate,
          filtersSnapshot: request.filters,
        });
        await persist();
        return service.graphData(session, {
          lastResult: {
            mode: result.mode,
            workKeys: result.works.map(work => work.workKey),
            total: result.total,
            totalScope: result.totalScope,
            limitedByProvider: result.limitedByProvider,
            rankingApproximate: result.rankingApproximate,
          },
          warnings: service.warnings,
          persistence: { enabled: this._sessionRepository.persistent },
        });
        }
        catch (error) {
          session = previousSession;
          throw error;
        }
      },
      updateCandidateState: async (workKey, state) => {
        const previousSession = session;
        session = ZLGDiscoveryCore.setCandidateState(session, workKey, state);
        try {
          await persist();
          return service.graphData(session);
        }
        catch (error) {
          session = previousSession;
          throw error;
        }
      },
      updateActiveSeeds: async workKeys => {
        const uniqueWorkKeys = [...new Set(workKeys || [])];
        if (uniqueWorkKeys.length > 50) throw new Error(ZLGT("一次最多使用 50 篇检索起点"));
        const previousSession = session;
        session = { ...session, activeSeedWorkKeys: uniqueWorkKeys };
        try {
          await persist();
          return service.graphData(session);
        }
        catch (error) {
          session = previousSession;
          throw error;
        }
      },
      updateNodeState: async (workKey, action) => {
        const previousSession = session;
        const field = ["pin", "unpin"].includes(action) ? "pinnedWorkKeys" : "hiddenWorkKeys";
        const values = new Set(session[field]);
        if (action === "unpin" || action === "unhide") values.delete(workKey);
        else values.add(workKey);
        session = { ...session, [field]: [...values] };
        try {
          await persist();
          return service.graphData(session);
        }
        catch (error) {
          session = previousSession;
          throw error;
        }
      },
      restoreSessionStates: async request => {
        const previousSession = session;
        const hidden = new Set(session.hiddenWorkKeys || []);
        for (const workKey of request.hiddenWorkKeys || []) hidden.delete(workKey);
        session = { ...session, hiddenWorkKeys: [...hidden] };
        for (const workKey of request.excludedWorkKeys || []) {
          session = ZLGDiscoveryCore.setCandidateState(session, workKey, "unreviewed");
        }
        try {
          await persist();
          return service.graphData(session);
        }
        catch (error) {
          session = previousSession;
          throw error;
        }
      },
      activateHop: async hopId => {
        const hop = session.hops.find(value => value.hopId === hopId);
        if (hop) {
          const previousHopId = session.activeHopId;
          session.activeHopId = hopId;
          try {
            await this._sessionRepository.saveActiveHop(session.sessionId, hopId);
          }
          catch (error) {
            session.activeHopId = previousHopId;
            throw error;
          }
        }
        return { session };
      },
      openExternal: url => {
        if (!/^https?:\/\//i.test(url)) throw new Error(ZLGT("无效的论文来源地址"));
        return Zotero.launchURL(url);
      },
      openPDF: node => ZLGZoteroAdapter.openLocalPDF(node.localKeys),
      copyDOI: doi => Zotero.Utilities.Internal.copyTextToClipboard(doi),
      selectLocalKey: key => ZLGZoteroAdapter.selectLocalKey(key),
      listCollections: () => ZLGZoteroAdapter.collectionTree(session.collectionScope?.libraryID || Number(session.rootSeedLocalKeys?.[0]?.split(":")[0]) || Zotero.Libraries.userLibraryID),
      openCollection: async (collectionID, options = {}) => {
        const previousRecent = this._sessionRepository.recent();
        try {
          const next = await this.prepareCollectionContext(collectionID, service.snapshot(), options);
          return this.discoveryWindowArgs(next);
        }
        catch (error) {
          if (options.signal?.aborted && previousRecent && this._sessionRepository?.recent()?.sessionId !== previousRecent.sessionId) await this._sessionRepository.save(previousRecent);
          throw error;
        }
      },
      getLocalDetail: key => ZLGZoteroAdapter.localItemDetail(key),
      selectLocalChild: key => ZLGZoteroAdapter.selectLocalKey(key),
    };
    return args;
  },

  openDiscoveryWindow(context) {
    const args = this.discoveryWindowArgs(context);
    return this.trackGraphWindow(Zotero.getMainWindow().openDialog(
      "chrome://zotero-literature-graph/content/graph.xhtml",
      "zlg-literature-discovery",
      "chrome,centerscreen,resizable,width=1440,height=880",
      args,
    ));
  },

  openGraphWindow(data) {
    const args = {
      hostWindow: Zotero.getMainWindow(),
      data,
      ...this.windowSettings(),
      listCollections: () => ZLGZoteroAdapter.collectionTree(Zotero.Libraries.userLibraryID),
      openCollection: async (collectionID, options = {}) => this.discoveryWindowArgs(await this.prepareCollectionContext(collectionID, null, options)),
      selectItem: (libraryID, itemKey) => {
        const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
        if (item) Zotero.getActiveZoteroPane()?.selectItem(item.id);
      },
    };
    this.trackGraphWindow(Zotero.getMainWindow().openDialog(
      "chrome://zotero-literature-graph/content/graph.xhtml",
      "zlg-literature-graph",
      "chrome,centerscreen,resizable,width=1280,height=820",
      args,
    ));
  },

  async createRelationFromSelection(win) {
    Services.prompt.alert(win, "Zotero Collection Relations", ZLGT("当前版本不修改 Zotero 关系。"));
  },
};
