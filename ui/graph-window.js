if (typeof module !== "undefined" && module.exports) { var ZLGI18n = require("./i18n.js"); var ZLGT = ZLGI18n.t; }
/* global ZLGGraphRenderer, ZLGViewState, ZLGHostAppearance */

var ZLGGraphWorkbench = {
  template: null,
  args: null,
  dispose: null,
  collectionExpandedIDs: new Set(),
  replace(args) {
    this.dispose?.();
    this.args = args;
    // Some hosts expose a read-only argument array. The workbench owns the
    // authoritative current context in either case.
    try { if (window.arguments) window.arguments[0] = args; } catch {}
    document.body.replaceWith(this.template.cloneNode(true));
    initializeGraphWorkbench(args);
  },
};

function initializeGraphWorkbench(args) {
  ZLGGraphWorkbench.args = args;
  const hostLocale = args.hostLocale || args.hostWindow?.Zotero?.locale || args.hostWindow?.document?.documentElement?.lang || document.documentElement.lang || "en-US";
  ZLGI18n.configure({ language: args.getSettings?.().language || args.language || "auto", hostLocale });
  document.documentElement.lang = ZLGI18n.locale();
  ZLGI18n.localizeDOM(document);
  const lifecycle = new AbortController();
  let disposed = false;
  let collectionDialogMode = "filter";
  let collectionSearchExpansion = null;
  let collectionSearchValue = "";
  let scopeController = null;
  let data = args.data || { title: "Zotero Collection Relations", nodes: [], edges: [], readOnly: true };
  const initialHop = data.session?.hops?.find(hop => hop.hopId === data.session?.activeHopId);
  let activeSeeds = new Set(data.session?.activeSeedWorkKeys || initialHop?.seedWorkKeys || data.session?.rootSeedWorkKeys || data.nodes.filter(node => node.isSeed).map(node => node.workKey));
  let activeMode = data.lastResult?.mode || initialHop?.mode || "similar";
  let chosenMode = activeMode;
  let resultRequest = initialHop
    ? ZLGViewState.requestSnapshot(initialHop)
    : data.lastResult ? ZLGViewState.requestSnapshot({ mode: activeMode, seedWorkKeys: [...activeSeeds] }) : null;
  let workspace = "collection";
  let queueOpen = activeSeeds.size > 0;
  let collectionPage = 0;
  const collectionKeys = [...(data.session?.rootSeedWorkKeys || data.nodes.map(ZLGGraphRenderer.keyOf))];
  let activeDiscoveryByKey = new Map(
    (initialHop?.resultEntries?.length ? initialHop.resultEntries : data.nodes)
      .filter(value => value.workKey && value.discovery)
      .map(value => [value.workKey, value.discovery]),
  );
  let activeEdgeByKey = new Map((initialHop?.edgeEntries || []).map(edge => [ZLGGraphRenderer.edgeKey(edge), edge]));
  // The displayed result belongs to an explicit seed/limit/direction request.
  let resultRequestKey = resultRequest ? ZLGViewState.modeCacheKey(resultRequest.mode, resultRequest.limit, resultRequest.seedWorkKeys) : null;
  let busy = false;
  let navigationBusy = false;
  let pendingDiscoveryMode = null;
  let discoverySyncFrame = null;
  let discoverySyncTimer = null;
  let discoverySwitchToken = 0;
  let discoveryRequestToken = 0;
  let transientStatus = "";
  let activeController = null;
  const collapsedNodes = new Set();
  const modeCache = new Map();
  let collectionRows = null;
  let selectedCollection = null;
  let selectedCollectionIDs = null;
  let pendingCollectionID = null;
  let selectedWorkKey = null;
  let citationRefreshBusy = false;
  let citationRefreshTimer = null;
  let queryTimer = null;
  let yearFilterTimer = null;
  let lastReversibleAction = null;
  const forwardHopByParent = new Map();
  const pendingNodeActions = new Set();
  const enqueueSessionMutation = ZLGViewState.createMutationQueue();
  const hopSync = ZLGViewState.createHopSyncTracker(data.session?.activeHopId || null);
  const workspaceStates = new Map();
  const queueHistory = ZLGViewState.createQueueHistory([...activeSeeds]);
  let pendingWorkspaceSelection = null;

  const elements = {
    title: document.getElementById("graph-title"),
    switchCollection: document.getElementById("switch-collection"),
    collectionTab: document.getElementById("workspace-collection"),
    discoveryTab: document.getElementById("workspace-discovery"),
    queue: document.getElementById("search-queue"),
    queueToggle: document.getElementById("toggle-search-queue"),
    queueCount: document.getElementById("queue-count"),
    scopeSummary: document.getElementById("collection-summary"),
    catalogTitle: document.getElementById("catalog-title"),
    catalogScope: document.getElementById("catalog-scope"),
    pageControls: document.getElementById("collection-pages"),
    pageBack: document.getElementById("collection-page-back"),
    pageNext: document.getElementById("collection-page-next"),
    pageLabel: document.getElementById("collection-page-label"),
    seedSummary: document.getElementById("discovery-seed-summary"),
    seedList: document.getElementById("discovery-seed-list"),
    discoveryNote: document.getElementById("discovery-context-note"),
    selectionEmpty: document.getElementById("discovery-selection-empty"),
    clearSelection: document.getElementById("clear-discovery-selection"),
    undoQueueSelection: document.getElementById("undo-queue-selection"),
    runDiscovery: document.getElementById("run-discovery"),
    cancelDiscovery: document.getElementById("cancel-discovery"),
    requestNote: document.getElementById("result-request-note"),
    readonly: document.getElementById("readonly-badge"),
    status: document.getElementById("graph-status"),
    resultList: document.getElementById("result-list"),
    resultSummary: document.getElementById("result-summary"),
    seedCount: document.getElementById("seed-count"),
    limit: document.getElementById("result-limit"),
    query: document.getElementById("filter-query"),
    yearFrom: document.getElementById("filter-year-from"),
    yearTo: document.getElementById("filter-year-to"),
    type: document.getElementById("filter-type"),
    library: document.getElementById("filter-library"),
    hasPDF: document.getElementById("filter-has-pdf"),
    duplicate: document.getElementById("filter-duplicate"),
    reading: document.getElementById("filter-reading"),
    retracted: document.getElementById("filter-retracted"),
    nodeSizeMode: document.getElementById("node-size-mode"),
    nodeSizeLegend: document.getElementById("node-size-legend"),
    nodeSizeLegendText: document.getElementById("node-size-legend-text"),
    layoutSemantics: document.getElementById("layout-semantics"),
    moreFilters: document.getElementById("more-filters"),
    filterCount: document.getElementById("filter-count"),
    activeFilters: document.getElementById("active-filters"),
    filterSummary: document.getElementById("filter-summary"),
    yearError: document.getElementById("year-error"),
    clearFilters: document.getElementById("clear-filters"),
    sessionAdjustments: document.getElementById("session-adjustments"),
    sessionAdjustmentSummary: document.getElementById("session-adjustment-summary"),
    undoSessionAction: document.getElementById("undo-session-action"),
    manageSessionState: document.getElementById("manage-session-state"),
    sessionStateDialog: document.getElementById("session-state-dialog"),
    hiddenStateHeading: document.getElementById("hidden-state-heading"),
    excludedStateHeading: document.getElementById("excluded-state-heading"),
    collapsedStateHeading: document.getElementById("collapsed-state-heading"),
    hiddenStateList: document.getElementById("hidden-state-list"),
    excludedStateList: document.getElementById("excluded-state-list"),
    collapsedStateList: document.getElementById("collapsed-state-list"),
    restoreAllHidden: document.getElementById("restore-all-hidden"),
    restoreAllExcluded: document.getElementById("restore-all-excluded"),
    restoreAllCollapsed: document.getElementById("restore-all-collapsed"),
    historyHome: document.getElementById("history-home"),
    historyBack: document.getElementById("history-back"),
    historyForward: document.getElementById("history-forward"),
    refreshDiscovery: document.getElementById("refresh-discovery"),
    collectionPicker: document.getElementById("collection-picker"),
    collectionDialog: document.getElementById("collection-dialog"),
    collectionQuery: document.getElementById("collection-query"),
    collectionRecursive: document.getElementById("collection-recursive"),
    collectionList: document.getElementById("collection-list"),
    collectionApply: document.getElementById("collection-apply"),
    collectionClear: document.getElementById("collection-clear"),
  };

  let openCombobox = null;

  const initialNodeSizeMode = ["citations", "degree", "uniform"].includes(args.nodeSizeMode) ? args.nodeSizeMode : "citations";
  elements.nodeSizeMode.value = initialNodeSizeMode;
  elements.limit.value = String(resultRequest?.limit || args.defaultResultLimit || 20);

  function createCombobox(select) {
    const variant = select.dataset.zlgCombobox;
    const compact = variant === "compact";
    const size = variant === "size";
    let accessibleName = select.getAttribute("aria-label") || ZLGT("选择选项");
    let activeIndex = Math.max(0, select.selectedIndex);
    let typeahead = "";
    let typeaheadTimer = null;
    const wrapper = document.createElement("div");
    wrapper.className = `zlg-combobox${compact ? " is-compact" : ""}${size ? " is-size" : ""}`;
    select.parentNode.insertBefore(wrapper, select);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "zlg-combobox-trigger";
    trigger.id = `${select.id}-trigger`;
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const triggerLabel = document.createElement("span");
    triggerLabel.className = "zlg-combobox-value";
    trigger.appendChild(triggerLabel);

    const menu = document.createElement("div");
    menu.className = "zlg-combobox-menu";
    menu.id = `${select.id}-menu`;
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-labelledby", trigger.id);
    menu.hidden = true;
    trigger.setAttribute("aria-controls", menu.id);

    const items = [...select.options].map((option, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "zlg-combobox-option";
      item.id = `${select.id}-option-${index}`;
      item.dataset.value = option.value;
      item.setAttribute("role", "option");
      item.tabIndex = -1;
      const label = document.createElement("span");
      label.textContent = option.textContent;
      item.appendChild(label);
      menu.appendChild(item);
      return item;
    });

    select.classList.add("zlg-native-select");
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    wrapper.append(trigger, menu, select);

    const controller = {
      wrapper,
      trigger,
      menu,
      items,
      sync() {
        accessibleName = select.getAttribute("aria-label") || ZLGT("选择选项");
        items.forEach((item, index) => { item.textContent = select.options[index]?.textContent || ""; });
        const selectedIndex = Math.max(0, select.selectedIndex);
        const selected = select.options[selectedIndex];
        triggerLabel.textContent = selected?.textContent || "—";
        trigger.setAttribute("aria-label", ZLGT`${accessibleName}：${selected?.textContent || ZLGT("未选择")}`);
        trigger.disabled = select.disabled;
        items.forEach((item, index) => {
          const selectedItem = index === selectedIndex;
          item.classList.toggle("is-selected", selectedItem);
          item.setAttribute("aria-selected", selectedItem ? "true" : "false");
        });
        if (menu.hidden) controller.setActive(selectedIndex, false);
      },
      setActive(index, scroll = true) {
        activeIndex = Math.max(0, Math.min(items.length - 1, Number(index) || 0));
        items.forEach((item, itemIndex) => item.classList.toggle("is-active", itemIndex === activeIndex));
        if (!menu.hidden) trigger.setAttribute("aria-activedescendant", items[activeIndex]?.id || "");
        if (scroll) items[activeIndex]?.scrollIntoView?.({ block: "nearest" });
      },
      setOpen(next, initialIndex = null) {
        const shouldOpen = Boolean(next) && !trigger.disabled;
        if (shouldOpen && openCombobox && openCombobox !== controller) openCombobox.setOpen(false);
        wrapper.classList.toggle("is-open", shouldOpen);
        menu.hidden = !shouldOpen;
        trigger.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
        if (shouldOpen) {
          openCombobox = controller;
          controller.setActive(initialIndex === null ? Math.max(0, select.selectedIndex) : initialIndex);
          trigger.focus();
        }
        else {
          trigger.removeAttribute("aria-activedescendant");
          if (openCombobox === controller) openCombobox = null;
        }
      },
      choose(index = activeIndex) {
        const item = items[index];
        if (!item) return;
        select.value = item.dataset.value;
        controller.sync();
        controller.setOpen(false);
        trigger.focus();
        select.dispatchEvent(new Event("change", { bubbles: true }));
      },
    };

    trigger.addEventListener("click", () => controller.setOpen(menu.hidden));
    trigger.addEventListener("keydown", event => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const selectedIndex = Math.max(0, select.selectedIndex);
        const next = menu.hidden
          ? event.key === "ArrowDown" ? selectedIndex : items.length - 1
          : event.key === "ArrowDown" ? (activeIndex + 1) % items.length : (activeIndex - 1 + items.length) % items.length;
        controller.setOpen(true, next);
      }
      else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        controller.setOpen(true, event.key === "Home" ? 0 : items.length - 1);
      }
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (menu.hidden) controller.setOpen(true);
        else controller.choose();
      }
      else if (event.key === "Escape" && !menu.hidden) {
        event.preventDefault();
        controller.setOpen(false);
      }
      else if (event.key === "Tab") {
        controller.setOpen(false);
      }
      else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        typeahead += event.key.toLocaleLowerCase();
        if (typeaheadTimer) window.clearTimeout(typeaheadTimer);
        typeaheadTimer = window.setTimeout(() => { typeahead = ""; }, 650);
        const start = menu.hidden ? Math.max(0, select.selectedIndex) : activeIndex;
        const match = items.findIndex((item, index) => {
          const shifted = (index + start + 1) % items.length;
          return items[shifted].textContent.trim().toLocaleLowerCase().startsWith(typeahead);
        });
        if (match >= 0) {
          const shifted = (match + start + 1) % items.length;
          controller.setOpen(true, shifted);
        }
      }
    });
    for (const [index, item] of items.entries()) {
      let chosenByPointer = false;
      item.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        chosenByPointer = false;
        event.preventDefault();
      });
      item.addEventListener("pointerup", event => {
        if (event.button !== 0) return;
        event.preventDefault();
        chosenByPointer = true;
        controller.choose(index);
      });
      item.addEventListener("pointercancel", () => { chosenByPointer = false; });
      item.addEventListener("pointerenter", () => controller.setActive(index));
      item.addEventListener("click", event => {
        if (chosenByPointer) {
          chosenByPointer = false;
          event.preventDefault();
          return;
        }
        controller.choose(index);
      });
    }
    select.addEventListener("change", () => controller.sync());
    controller.sync();
    return controller;
  }

  const comboboxes = [...document.querySelectorAll("select[data-zlg-combobox]")].map(createCombobox);
  const syncComboboxes = () => comboboxes.forEach(combobox => combobox.sync());
  document.addEventListener("pointerdown", event => {
    if (openCombobox && !openCombobox.wrapper.contains(event.target)) openCombobox.setOpen(false);
  }, { signal: lifecycle.signal });
  window.addEventListener("blur", () => openCombobox?.setOpen(false), { signal: lifecycle.signal });

  const renderer = new ZLGGraphRenderer.Renderer({
    container: document.getElementById("graph-canvas"),
    detail: document.getElementById("graph-detail"),
    counts: document.getElementById("graph-counts"),
    data: visibleData(),
    nodeSizeMode: initialNodeSizeMode,
    onSelectItem: (args.selectLocalKey || args.selectItem) ? (node, localKey) => {
      if ((localKey || node.localKeys?.length) && args.selectLocalKey) args.selectLocalKey(localKey || node.localKeys[0]);
      else args.selectItem?.(node.libraryID, node.itemKey);
    } : null,
    onNodeSelect: node => {
      selectedWorkKey = node ? ZLGGraphRenderer.keyOf(node) : null;
      updateResultSelection();
    },
    onNodeAction: (node, action) => handleNodeAction(node, action),
    onRequestNodeDetail: (_node, localKey) => args.getLocalDetail?.(localKey),
    onSelectLocalChild: localKey => args.selectLocalChild?.(localKey),
    onClearFilters: () => resetFilters(),
    onOpenExternal: args.openExternal,
    onOpenPDF: args.openPDF,
    onCopyDOI: args.copyDOI,
  });

  function nodeMap() {
    return new Map([...(data.session?.graphSnapshot?.works || []), ...data.nodes].map(node => [ZLGGraphRenderer.keyOf(node), node]));
  }

  function nodeForActiveHop(node) {
    if (!node) return node;
    const discovery = activeDiscoveryByKey.get(ZLGGraphRenderer.keyOf(node));
    const restored = { ...node };
    delete restored.discovery;
    if (workspace === "discovery" && discovery) restored.discovery = discovery;
    return restored;
  }

  function mergeGraphData(nextData) {
    if (!nextData) return;
    const previousLastResult = data.lastResult;
    data = { ...data, ...nextData };
    if (!data.lastResult && previousLastResult) data.lastResult = previousLastResult;
  }

  function sessionWorkMap() {
    return new Map([
      ...(data.session?.graphSnapshot?.works || []),
      ...(data.nodes || []),
    ].map(node => [node.workKey, node]));
  }

  function adjustedSessionEntries() {
    const works = sessionWorkMap();
    const entry = workKey => ({ workKey, title: works.get(workKey)?.title || workKey });
    const hidden = (data.session?.hiddenWorkKeys || []).map(entry);
    const excluded = Object.entries(data.session?.candidateStates || {})
      .filter(([, state]) => state === "excluded")
      .map(([workKey]) => entry(workKey));
    const collapsed = [...collapsedNodes].map(entry);
    return { hidden, excluded, collapsed };
  }

  function readFilters() {
    const library = elements.library.value;
    const range = yearRangeState();
    return {
      query: elements.query.value.trim(),
      yearFrom: range.invalid ? null : range.from,
      yearTo: range.invalid ? null : range.to,
      types: elements.type.value === "all" ? [] : [elements.type.value],
      libraryState: library === "in" ? "in" : library === "out" ? "out" : null,
      hasPDF: elements.hasPDF.checked ? true : null,
      duplicateOnly: elements.duplicate.checked,
      candidateState: elements.reading.checked ? "reading-list" : null,
      isRetracted: elements.retracted.checked ? null : false,
    };
  }

  function yearRangeState() {
    const from = Number(elements.yearFrom.value) || null;
    const to = Number(elements.yearTo.value) || null;
    return { from, to, invalid: Boolean(from && to && from > to) };
  }

  function matchesFilters(node, filters) {
    if (selectedCollectionIDs && !(node.collectionIDs || []).some(id => selectedCollectionIDs.has(Number(id)))) return false;
    const nodeYear = Number(node.year);
    if ((filters.yearFrom || filters.yearTo) && !Number.isFinite(nodeYear)) return false;
    if (filters.yearFrom && nodeYear < filters.yearFrom) return false;
    if (filters.yearTo && nodeYear > filters.yearTo) return false;
    if (filters.libraryState === "in" && !node.localKeys?.length) return false;
    if (filters.libraryState === "out" && node.localKeys?.length) return false;
    if (filters.hasPDF && !node.hasPDF) return false;
    if (filters.duplicateOnly && Number(node.duplicateCount || node.localKeys?.length || 0) < 2) return false;
    if (filters.types.length && !filters.types.includes(node.type)) return false;
    if (node.candidateState === "excluded") return false;
    if (filters.candidateState && node.candidateState !== filters.candidateState) return false;
    if (filters.isRetracted === false && node.isRetracted) return false;
    if (filters.query) {
      const haystack = `${node.title || ""} ${(node.authors || []).map(author => author.name).join(" ")} ${node.venue || ""}`.toLowerCase();
      if (!haystack.includes(filters.query.toLowerCase())) return false;
    }
    return true;
  }

  function visibleData() {
    const filters = readFilters();
    if (workspace === "collection") {
      const visible = ZLGViewState.collectionSlice(data, collectionKeys, node => matchesFilters({ ...node, candidateState: node.candidateState === "excluded" ? null : node.candidateState }, filters), collectionPage);
      collectionPage = visible.collectionPage;
      visible.nodes = visible.nodes.map(node => ({ ...node, isSeed: false, isQueued: activeSeeds.has(ZLGGraphRenderer.keyOf(node)), isActionPending: busy || navigationBusy || pendingNodeActions.size > 0 }));
      return visible;
    }
    const collapsedNeighbors = new Set();
    const resultSeeds = new Set(resultRequest?.seedWorkKeys || []);
    const pinnedKeys = new Set(data.session?.pinnedWorkKeys || []);
    const retainContext = key => resultSeeds.has(key) || pinnedKeys.has(key);
    for (const edge of data.edges) {
      const pair = ZLGGraphRenderer.edgeKeys(edge);
      if (collapsedNodes.has(pair.source) && !retainContext(pair.target)) collapsedNeighbors.add(pair.target);
      if (collapsedNodes.has(pair.target) && !retainContext(pair.source)) collapsedNeighbors.add(pair.source);
    }
    const map = nodeMap();
    const collectionHidden = selectedCollectionIDs
      ? data.nodes.filter(node => {
          const key = ZLGGraphRenderer.keyOf(node);
          return !retainContext(key) && !(node.collectionIDs || []).some(id => selectedCollectionIDs.has(Number(id)));
        }).map(ZLGGraphRenderer.keyOf)
      : [];
    const unfilteredResultKeys = resultKeys().filter(key => !collapsedNeighbors.has(key));
    const filteredResultKeys = unfilteredResultKeys.filter(key => {
      const node = map.get(key);
      return node && matchesFilters(node, filters);
    });
    const filteredResultSet = new Set(filteredResultKeys);
    const contextVisible = activeFilterSpecs().length > 0;
    const focusGraph = args.focusGraph || ((value) => ({ ...value, nodes: [...value.nodes], edges: [...value.edges] }));
    const focusOptions = {
      seedKeys: [...resultSeeds],
      pinnedKeys: [...pinnedKeys],
      maxNodes: 160,
      maxEdges: 600,
    };
    const layoutUniverse = focusGraph(data, {
      ...focusOptions,
      resultKeys: unfilteredResultKeys,
      hiddenKeys: [...collapsedNeighbors],
    });
    const focused = contextVisible
      ? focusGraph(data, {
          ...focusOptions,
          resultKeys: filteredResultKeys,
          hiddenKeys: [...new Set([...collapsedNeighbors, ...collectionHidden])],
        })
      : layoutUniverse;
    focused.layoutUniverseSignature = `${layoutUniverse.nodes.map(ZLGGraphRenderer.keyOf).sort().join("|")}::${layoutUniverse.edges.map(ZLGGraphRenderer.edgeKey).sort().join("|")}`;
    if (contextVisible && filteredResultKeys.length === 0) {
      focused.nodes = [];
      focused.edges = [];
      focused.emptyReason = "filters";
      focused.graphTruncated = true;
    }
    focused.nodes = focused.nodes.map(node => {
      const key = ZLGGraphRenderer.keyOf(node);
      return {
        ...nodeForActiveHop(node),
        isSeed: resultSeeds.has(key),
        isQueued: activeSeeds.has(key),
        isContext: contextVisible && retainContext(key) && !filteredResultSet.has(key),
        isCollapsed: collapsedNodes.has(key),
        isActionPending: busy || navigationBusy || pendingNodeActions.size > 0,
      };
    });
    focused.edges = focused.edges.map(edge => activeEdgeByKey.get(ZLGGraphRenderer.edgeKey(edge)) || edge);
    return { ...focused, workspace: "discovery" };
  }

  function activeHopIndex() {
    const hops = data.session?.hops || [];
    return hops.findIndex(hop => hop.hopId === data.session?.activeHopId);
  }

  function resultKeys() {
    if (workspace === "collection") return collectionKeys;
    if (elements.reading.checked) return data.nodes.map(node => node.workKey || ZLGGraphRenderer.keyOf(node));
    if (data.lastResult?.workKeys) return data.lastResult.workKeys;
    const hops = data.session?.hops || [];
    const index = activeHopIndex();
    if (index >= 0) return hops[index].resultWorkKeys || [];
    return data.nodes.map(node => node.workKey || ZLGGraphRenderer.keyOf(node));
  }

  function labelForMode(mode) {
    return ({ references: ZLGT("参考文献"), citations: ZLGT("后续引用"), similar: ZLGT("相关研究") })[mode] || ZLGT("发现结果");
  }

  function sortedSeedKeys() {
    return [...activeSeeds].sort();
  }

  function modeCacheKey(mode) {
    return ZLGViewState.modeCacheKey(mode, Number(elements.limit.value) || 20, sortedSeedKeys());
  }

  function rememberModeView(mode = activeMode, lastResult = data.lastResult, captureView = true, allowRunning = false) {
    if (workspace === "collection") return;
    const key = resultRequestKey;
    if (!key) return;
    const previous = modeCache.get(key);
    const captured = captureView ? renderer.captureViewState({ allowRunning }) : null;
    const cachedResult = lastResult?.workKeys && lastResult.mode === resultRequest?.mode
      ? { ...lastResult, workKeys: [...lastResult.workKeys] }
      : previous?.lastResult || null;
    if (!captured && !cachedResult && !previous) return;
    modeCache.set(key, {
      lastResult: cachedResult,
      request: resultRequest,
      hopId: data.session?.activeHopId || null,
      viewState: captured || previous?.viewState || null,
      savedAt: Date.now(),
    });
    while (modeCache.size > 18) modeCache.delete(modeCache.keys().next().value);
  }

  function matchingHop(mode) {
    const signature = sortedSeedKeys().join("|");
    const limit = Number(elements.limit.value) || 20;
    return [...(data.session?.hops || [])].reverse().find(hop => (
      hop.mode === mode
      && Number(hop.resultLimit || 20) === limit
      && [...(hop.seedWorkKeys || [])].sort().join("|") === signature
    ));
  }

  function applyHopView(hop, nextData = null) {
    if (hop) resultRequestKey = ZLGViewState.modeCacheKey(hop.mode, hop.resultLimit, hop.seedWorkKeys);
    if (!hop) return;
    setWorkspace("discovery");
    if (nextData) mergeGraphData(nextData);
    activeDiscoveryByKey = new Map((hop.resultEntries || []).map(entry => [entry.workKey, entry.discovery]));
    activeEdgeByKey = new Map((hop.edgeEntries || []).map(edge => [ZLGGraphRenderer.edgeKey(edge), edge]));
    if (data.session) data = { ...data, session: { ...data.session, activeHopId: hop.hopId } };
    resultRequest = ZLGViewState.requestSnapshot(hop);
    activeMode = hop.mode || activeMode;
    data = { ...data, lastResult: ZLGViewState.lastResultForHop(hop) };
    rememberModeView(activeMode, data.lastResult, false);
  }

  async function activateHopRecord(hop, message = "") {
    if (!hop || navigationBusy || busy) return false;
    rememberModeView(activeMode, data.lastResult, true, true);
    const targetView = modeCache.get(ZLGViewState.modeCacheKey(hop.mode, hop.resultLimit, hop.seedWorkKeys))?.viewState;
    navigationBusy = true;
    transientStatus = message || ZLGT`正在恢复${labelForMode(hop.mode)}步骤…`;
    render();
    try {
      const nextData = args.activateHop
        ? await enqueueSessionMutation(() => args.activateHop(hop.hopId))
        : null;
      applyHopView(hop, nextData);
      if (targetView) renderer.restoreViewState(targetView);
      hopSync.confirm(hop.hopId);
      transientStatus = "";
      return true;
    }
    catch (error) {
      transientStatus = ZLGT`探索历史恢复失败：${error.message || error}`;
      return false;
    }
    finally {
      navigationBusy = false;
      render();
    }
  }

  function renderDiscoveryFeedback() {
    const displayedMode = chosenMode;
    for (const button of document.querySelectorAll("[data-discover]")) {
      const active = button.dataset.discover === displayedMode;
      const pending = active && Boolean(pendingDiscoveryMode);
      button.classList.toggle("is-active", active);
      button.classList.toggle("is-pending", pending);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.setAttribute("aria-busy", pending ? "true" : "false");
    }
    const locked = busy || navigationBusy || pendingNodeActions.size > 0;
    const map = nodeMap();
    const focusedRemoveKey = elements.seedList.contains(document.activeElement) ? document.activeElement?.dataset.removeSeed : null;
    elements.seedSummary.textContent = ZLGT`已选 ${activeSeeds.size} / 50 篇`;
    elements.queueCount.textContent = activeSeeds.size;
    elements.seedList.replaceChildren();
    for (const key of activeSeeds) {
      const node = map.get(key);
      const title = node?.title || key;
      const li = document.createElement("li");
      const label = document.createElement("button");
      label.type = "button";
      label.className = "zlg-queue-paper";
      label.textContent = title;
      label.title = title;
      label.setAttribute("aria-label", ZLGT`查看论文详情：${title}`);
      label.disabled = !node;
      label.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 800px)").matches) setQueueOpen(false);
        renderer.selectNode({ ...nodeForActiveHop(node), isQueued: true,
          isSeed: workspace === "discovery" && Boolean(resultRequest?.seedWorkKeys.includes(key)) }, { notify: true });
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.dataset.removeSeed = key;
      remove.setAttribute("aria-label", ZLGT`从检索队列移除：${title}`);
      remove.title = ZLGT`移除：${title}（不删除 Zotero 条目）`;
      remove.disabled = locked;
      remove.addEventListener("click", async () => {
        await changeSeedSelection([...activeSeeds].filter(value => value !== key));
        (elements.seedList.querySelector("[data-remove-seed]:not(:disabled)") || elements.runDiscovery).focus();
      });
      li.append(label, remove);
      elements.seedList.appendChild(li);
    }
    if (focusedRemoveKey) elements.seedList.querySelector(`[data-remove-seed="${CSS.escape(focusedRemoveKey)}"]`)?.focus();
    elements.selectionEmpty.hidden = activeSeeds.size > 0;
    elements.clearSelection.disabled = locked || !activeSeeds.size;
    elements.undoQueueSelection.disabled = locked || !queueHistory.peek();
    elements.undoQueueSelection.hidden = !queueHistory.peek();
    elements.runDiscovery.disabled = locked || !args.discover || !activeSeeds.size;
    elements.runDiscovery.textContent = busy ? ZLGT("正在查找…") : ZLGT`开始查找（${activeSeeds.size} 篇）`;
    elements.cancelDiscovery.hidden = !busy;
    elements.discoveryNote.textContent = !args.discover ? ZLGT("示例模式，无法查找。")
      : !activeSeeds.size ? ""
      : "";
    elements.discoveryNote.hidden = !elements.discoveryNote.textContent;
    elements.status.textContent = ZLGT(statusText());
    elements.status.classList.toggle("is-busy", busy || navigationBusy || Boolean(pendingDiscoveryMode));
  }

  function activateHopInBackground(hop, successMessage, viewState = null) {
    const token = ++discoverySwitchToken;
    const previousHopId = data.session?.activeHopId;
    const previousView = renderer.captureViewState({ allowRunning: true });
    activeMode = hop.mode || activeMode;
    pendingDiscoveryMode = activeMode;
    transientStatus = ZLGT`正在切换到${labelForMode(activeMode)}…`;
    renderDiscoveryFeedback();
    if (viewState) renderer.restoreViewState(viewState);
    applyHopView(hop);
    pendingDiscoveryMode = null;
    transientStatus = successMessage;
    queuePostPaintRender(() => {
      if (token === discoverySwitchToken) rememberModeView(activeMode, data.lastResult);
    });
    if (!args.activateHop) {
      hopSync.confirm(hop.hopId);
      return;
    }
    if (discoverySyncFrame !== null) window.cancelAnimationFrame(discoverySyncFrame);
    if (discoverySyncTimer !== null) window.clearTimeout(discoverySyncTimer);
    discoverySyncFrame = window.requestAnimationFrame(() => {
      discoverySyncFrame = null;
      discoverySyncTimer = window.setTimeout(() => {
        discoverySyncTimer = null;
        if (token !== discoverySwitchToken) return;
        enqueueSessionMutation(async () => {
          const nextData = await args.activateHop(hop.hopId);
          if (token === discoverySwitchToken && data.session?.activeHopId === hop.hopId) {
            hopSync.confirm(hop.hopId);
            if (nextData?.session) {
              data = {
                ...data,
                session: {
                  ...data.session,
                  activeHopId: nextData.session.activeHopId || hop.hopId,
                  activeSeedWorkKeys: [...activeSeeds],
                },
              };
            }
          }
        }).catch(error => {
          if (token === discoverySwitchToken && data.session?.activeHopId === hop.hopId) {
            const rollbackHop = hopSync.rollbackHop(data.session);
            if (rollbackHop) {
              const rollbackKey = ZLGViewState.modeCacheKey(rollbackHop.mode, rollbackHop.resultLimit, rollbackHop.seedWorkKeys);
              const rollbackView = modeCache.get(rollbackKey)?.viewState || (rollbackHop.hopId === previousHopId ? previousView : null);
              applyHopView(rollbackHop);
              if (rollbackView) renderer.restoreViewState(rollbackView);
            }
            pendingDiscoveryMode = null;
            transientStatus = ZLGT`探索历史同步失败：${error.message || error}`;
            render();
          }
        });
      }, 0);
    });
  }

  function forwardHop() {
    const activeId = data.session?.activeHopId;
    if (!activeId) return null;
    const remembered = ZLGViewState.hopById(data.session, forwardHopByParent.get(activeId));
    if (remembered?.parentHopId === activeId) return remembered;
    return ZLGViewState.childHops(data.session, activeId).at(-1) || null;
  }

  async function navigateBack() {
    const activeId = data.session?.activeHopId;
    const current = ZLGViewState.hopById(data.session, activeId);
    const parent = ZLGViewState.parentHop(data.session, activeId);
    if (!current || !parent) return;
    forwardHopByParent.set(parent.hopId, current.hopId);
    await activateHopRecord(parent);
  }

  async function navigateForward() {
    const next = forwardHop();
    if (next) await activateHopRecord(next);
  }

  function statusText() {
    if (busy || navigationBusy) return transientStatus || ZLGT("正在读取文献网络…");
    if (citationRefreshBusy) return transientStatus || ZLGT("更新被引量…");
    if (yearRangeState().invalid) return ZLGT("年份范围无效：起始年不能晚于结束年。");
    if (transientStatus) return transientStatus;
    const warnings = data.warnings || [];
    if (warnings.length) {
      const warning = warnings.at(-1);
      return `${warning.provider || ZLGT("数据源")}${warning.status ? ` HTTP ${warning.status}` : ""}：${warning.message}`;
    }
    if (data.persistence?.enabled === false) return ZLGT("本地保存不可用，当前修改仅临时保留。");
    if (data.lastResult?.limitedByProvider) {
      const count = data.lastResult.workKeys?.length || 0;
      const limit = resultRequest?.limit || 20;
      if (data.lastResult.mode === "similar") {
        return count < limit
          ? ZLGT("OpenAlex 推荐数量有限，本次结果少于上限。")
          : ZLGT("部分起点推荐较少，合并结果已达上限。");
      }
      if (data.lastResult.mode === "citations") {
        return ZLGT("引用结果过多，当前排序为近似结果。可减少起点后重试。");
      }
      return ZLGT("部分参考文献信息缺失，已按可用结果排序。");
    }
    if (selectedCollection) {
      const count = data.nodes.filter(node => matchesFilters(node, { ...readFilters(), query: "", yearFrom: null, yearTo: null, types: [], libraryState: null, hasPDF: null, duplicateOnly: false, candidateState: null, isRetracted: null })).length;
      return ZLGT`文献集：${selectedCollection.path} · 当前会话匹配 ${count} 篇`;
    }
    return "";
  }

  function renderNodeSizeLegend(visible = visibleData()) {
    const canvasEmpty = !visible.nodes?.length;
    elements.nodeSizeLegend.hidden = canvasEmpty;
    const graphHint = document.querySelector(".zlg-graph-hint");
    if (graphHint) graphHint.hidden = canvasEmpty;
    const stats = renderer.getNodeSizeStats();
    elements.nodeSizeLegend.dataset.mode = stats.mode;
    if (stats.mode === "citations") {
      const p95 = stats.p95 === null ? "—" : Number(stats.p95).toLocaleString(ZLGI18n.locale());
      elements.nodeSizeLegendText.textContent = ZLGT`大小：被引量${stats.unknownCount ? ZLGT` · 未知 ${stats.unknownCount}` : ""}`;
      elements.nodeSizeLegend.title = ZLGT`按被引量缩放，极高值封顶${stats.unknownCount ? ZLGT("；虚线外环表示未知") : ""}`;
    }
    else if (stats.mode === "degree") {
      elements.nodeSizeLegendText.textContent = ZLGT("大小：连接数");
      elements.nodeSizeLegend.title = ZLGT("节点越大，与当前视图中其他论文的直接连接越多");
    }
    else {
      elements.nodeSizeLegendText.textContent = ZLGT("大小：统一");
      elements.nodeSizeLegend.title = ZLGT("所有节点同样大小");
    }
    elements.nodeSizeLegend.setAttribute("aria-label", elements.nodeSizeLegend.title);
  }

  function renderList(visible) {
    const filters = readFilters();
    // List clicks must pass the same current selection state as graph clicks.
    const map = new Map((visible?.nodes || []).map(node => [ZLGGraphRenderer.keyOf(node), node]));
    const visibleKeys = ZLGViewState.visibleResultKeys(resultKeys(), visible?.nodes || []);
    const candidates = visibleKeys.map(key => nodeForActiveHop(map.get(key))).filter(node => node && matchesFilters(workspace === "collection" && node.candidateState === "excluded" ? { ...node, candidateState: null } : node, filters));
    elements.resultList.replaceChildren();
    for (const node of candidates) {
      const row = document.createElement("article");
      const nodeKey = ZLGGraphRenderer.keyOf(node);
      row.className = `zlg-result-row${nodeKey === selectedWorkKey ? " is-selected" : ""}`;
      row.setAttribute("role", "listitem");
      row.dataset.workKey = nodeKey;
      const top = document.createElement("div");
      top.className = "zlg-result-top";
      const year = document.createElement("span");
      year.textContent = node.year || "—";
      const state = document.createElement("span");
      const candidateState = node.candidateState || data.session?.candidateStates?.[node.workKey];
      state.textContent = node.localKeys?.length
        ? `Zotero${node.hasPDF ? " · PDF" : ""}${node.duplicateCount > 1 ? ` · ×${node.duplicateCount}` : ""}`
        : candidateState === "reading-list" ? ZLGT("稍后阅读") : node.isPinned ? ZLGT("保持显示") : ZLGT("外部");
      top.append(year, state);
      const title = document.createElement("button");
      title.type = "button";
      title.className = "zlg-result-title";
      title.textContent = node.title || node.workKey;
      if (nodeKey === selectedWorkKey) title.setAttribute("aria-current", "true");
      title.addEventListener("click", () => renderer.selectNode(node, { notify: true }));
      const meta = document.createElement("div");
      meta.className = "zlg-result-meta";
      meta.textContent = ZLGT`${node.authors?.[0]?.name || ZLGT("作者未知")} · 被引 ${node.citationCount ?? "—"}`;
      if (node.discovery?.explanation) meta.title = ZLGT(node.discovery.explanation);
      const seed = document.createElement("label");
      seed.className = "zlg-selection-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "zlg-seed-toggle";
      checkbox.checked = activeSeeds.has(node.workKey);
      checkbox.disabled = busy || navigationBusy || pendingNodeActions.size > 0;
      checkbox.setAttribute("aria-label", ZLGT`加入队列：${node.title || node.workKey}`);
      checkbox.addEventListener("change", () => toggleSeed(node));
      const selectionLabel = document.createElement("span");
      selectionLabel.textContent = checkbox.checked ? ZLGT("已在队列") : ZLGT("加入队列");
      seed.append(checkbox, selectionLabel);
      row.append(top, title, meta, seed);
      elements.resultList.appendChild(row);
    }
    if (!candidates.length) {
      const empty = document.createElement("div");
      empty.className = "zlg-list-empty";
      empty.textContent = ZLGT("无匹配文献。");
      elements.resultList.appendChild(empty);
    }
    const activeHop = data.session?.hops?.[activeHopIndex()];
    elements.resultSummary.textContent = elements.reading.checked
      ? ZLGT`稍后阅读 · ${candidates.length}`
      : data.lastResult
        ? data.lastResult.totalScope === "fetched-unique"
          ? ZLGT`${labelForMode(data.lastResult.mode)} · ${candidates.length}/${data.lastResult.total} 个已取回去重候选`
          : `${labelForMode(data.lastResult.mode)} · ${candidates.length}/${data.lastResult.total}`
        : activeHop
          ? `${labelForMode(activeHop.mode)} · ${candidates.length}/${activeHop.resultWorkKeys?.length || candidates.length}`
          : ZLGT`当前图谱 · ${candidates.length}`;
    if (workspace === "collection") elements.resultSummary.textContent = ZLGT`${visible.totalNodeCount} 篇文献`;
    if (selectedCollection) elements.resultSummary.textContent += ` · ${selectedCollection.name}`;
  }

  function updateResultSelection() {
    for (const row of elements.resultList.querySelectorAll(".zlg-result-row")) {
      const selected = row.dataset.workKey === selectedWorkKey;
      row.classList.toggle("is-selected", selected);
      const title = row.querySelector(".zlg-result-title");
      if (selected) title?.setAttribute("aria-current", "true");
      else title?.removeAttribute("aria-current");
    }
  }

  function activeFilterSpecs() {
    const range = yearRangeState();
    const specs = [];
    if (selectedCollection) specs.push({ key: "collection", label: ZLGT`文献集：${selectedCollection.name}` });
    if (elements.query.value.trim()) specs.push({ key: "query", label: ZLGT`关键词：${elements.query.value.trim()}` });
    if (elements.library.value === "in") specs.push({ key: "library", label: ZLGT("来源：库内") });
    if (elements.library.value === "out") specs.push({ key: "library", label: ZLGT("来源：外部") });
    if (range.from || range.to) specs.push({ key: "year", label: ZLGT`年份：${range.from || ZLGT("最早")}–${range.to || ZLGT("至今")}` });
    if (elements.type.value !== "all") {
      specs.push({ key: "type", label: ZLGT`类型：${elements.type.options[elements.type.selectedIndex]?.textContent || elements.type.value}` });
    }
    if (elements.hasPDF.checked) specs.push({ key: "pdf", label: ZLGT("有本地 PDF") });
    if (elements.duplicate.checked) specs.push({ key: "duplicate", label: ZLGT("本地重复项") });
    if (elements.reading.checked) specs.push({ key: "reading", label: ZLGT("稍后阅读") });
    if (!elements.retracted.checked) specs.push({ key: "retracted", label: ZLGT("排除撤稿") });
    return specs;
  }

  function clearFilter(key) {
    if (key === "collection") {
      selectedCollection = null;
      selectedCollectionIDs = null;
      pendingCollectionID = null;
    }
    else if (key === "query") {
      if (queryTimer) window.clearTimeout(queryTimer);
      queryTimer = null;
      elements.query.value = "";
    }
    else if (key === "library") elements.library.value = "all";
    else if (key === "year") {
      if (yearFilterTimer) window.clearTimeout(yearFilterTimer);
      yearFilterTimer = null;
      elements.yearFrom.value = "";
      elements.yearTo.value = "";
    }
    else if (key === "type") elements.type.value = "all";
    else if (key === "pdf") elements.hasPDF.checked = false;
    else if (key === "duplicate") elements.duplicate.checked = false;
    else if (key === "reading") elements.reading.checked = false;
    else if (key === "retracted") elements.retracted.checked = true;
    transientStatus = "";
    render();
  }

  function syncClearFiltersAvailability() {
    const hasFilters = activeFilterSpecs().length > 0;
    elements.clearFilters.disabled = !hasFilters;
    elements.clearFilters.parentElement.hidden = !hasFilters;
  }

  function renderYearValidation() {
    const range = yearRangeState();
    elements.yearError.hidden = !range.invalid;
    elements.yearFrom.setAttribute("aria-invalid", range.invalid ? "true" : "false");
    elements.yearTo.setAttribute("aria-invalid", range.invalid ? "true" : "false");
    if (range.invalid) document.getElementById("catalog-filters").open = true;
    syncClearFiltersAvailability();
    return range;
  }

  function renderFilterUI() {
    const range = renderYearValidation();

    for (const button of document.querySelectorAll("[data-library-source]")) {
      const active = button.dataset.librarySource === elements.library.value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }

    const sourceFilters = { ...readFilters(), libraryState: null };
    const sourcesByKey = nodeMap();
    const sourceCandidates = resultKeys()
      .map(key => sourcesByKey.get(key))
      .filter(node => node && matchesFilters(workspace === "collection" && node.candidateState === "excluded" ? { ...node, candidateState: null } : node, sourceFilters));
    const sourceCounts = {
      all: sourceCandidates.length,
      in: sourceCandidates.filter(node => node.localKeys?.length).length,
      out: sourceCandidates.filter(node => !node.localKeys?.length).length,
    };
    const sourceLabels = { all: ZLGT("全部"), in: ZLGT("库内"), out: ZLGT("外部") };
    for (const button of document.querySelectorAll("[data-library-source]")) {
      const source = button.dataset.librarySource;
      button.textContent = `${ZLGT(sourceLabels[source])} ${sourceCounts[source]}`;
      button.setAttribute("aria-label", ZLGT`${ZLGT(sourceLabels[source])}来源，${sourceCounts[source]} 篇`);
    }

    const secondaryCount = Number(Boolean(range.from || range.to))
      + Number(elements.type.value !== "all")
      + Number(elements.hasPDF.checked)
      + Number(elements.duplicate.checked)
      + Number(elements.reading.checked)
      + Number(!elements.retracted.checked);
    elements.filterCount.hidden = secondaryCount === 0;
    elements.filterCount.textContent = String(secondaryCount);

    const specs = activeFilterSpecs();
    elements.activeFilters.replaceChildren();
    for (const spec of specs) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "zlg-filter-chip";
      chip.textContent = `${spec.label} ×`;
      chip.setAttribute("aria-label", ZLGT`移除筛选：${spec.label}`);
      chip.addEventListener("click", () => clearFilter(spec.key));
      elements.activeFilters.appendChild(chip);
    }
    elements.activeFilters.hidden = specs.length === 0;
    const filteredCandidateCount = specs.length
      ? resultKeys().map(key => sourcesByKey.get(key)).filter(node => node && matchesFilters(workspace === "collection" && node.candidateState === "excluded" ? { ...node, candidateState: null } : node, readFilters())).length
      : null;
    elements.filterSummary.textContent = specs.length
      ? filteredCandidateCount === 0
        ? ZLGT("无匹配结果 · 未补入不匹配上下文")
        : workspace === "collection" ? ZLGT`已应用 ${specs.length} 项筛选` : ZLGT`已应用 ${specs.length} 项 · 图中保留本次起点`
      : ZLGT("未应用筛选");
    if (range.invalid) elements.filterSummary.textContent = ZLGT("年份范围无效。");
    elements.filterSummary.title = specs.length
      ? filteredCandidateCount === 0
        ? ZLGT("当前筛选没有匹配候选；画布保持为空，避免用不符合条件的论文填满视图")
        : workspace === "collection" ? ZLGT("筛选当前文献集；返回时保留这些条件") : ZLGT("筛选只作用于候选结果；本次查找的起点和保持显示项作为弱化上下文保留")
      : "";
    elements.clearFilters.disabled = specs.length === 0;
    elements.clearFilters.parentElement.hidden = specs.length === 0;
  }

  function renderStateList(host, entries, kind) {
    host.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "zlg-state-empty";
      empty.textContent = kind === "hidden"
        ? ZLGT("当前没有隐藏论文。")
        : kind === "collapsed"
          ? ZLGT("当前没有收起相邻节点的论文。")
          : ZLGT("当前没有标记为不相关的论文。");
      host.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "zlg-state-row";
      const title = document.createElement("span");
      title.textContent = entry.title;
      title.title = entry.title;
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = kind === "hidden" ? ZLGT("恢复显示") : kind === "collapsed" ? ZLGT("展开相邻节点") : ZLGT("恢复候选");
      restore.addEventListener("click", async () => {
        restore.disabled = true;
        await restoreAdjustedEntries(kind, [entry.workKey]);
      });
      row.append(title, restore);
      host.appendChild(row);
    }
  }

  function renderSessionStateDialog() {
    const entries = adjustedSessionEntries();
    elements.hiddenStateHeading.textContent = ZLGT`已隐藏（${entries.hidden.length}）`;
    elements.excludedStateHeading.textContent = ZLGT`不相关（${entries.excluded.length}）`;
    elements.collapsedStateHeading.textContent = ZLGT`已收起（${entries.collapsed.length}）`;
    elements.restoreAllHidden.disabled = !entries.hidden.length;
    elements.restoreAllExcluded.disabled = !entries.excluded.length;
    elements.restoreAllCollapsed.disabled = !entries.collapsed.length;
    renderStateList(elements.hiddenStateList, entries.hidden, "hidden");
    renderStateList(elements.excludedStateList, entries.excluded, "excluded");
    renderStateList(elements.collapsedStateList, entries.collapsed, "collapsed");
  }

  function renderSessionAdjustments() {
    const entries = adjustedSessionEntries();
    const changedCount = entries.hidden.length + entries.excluded.length + entries.collapsed.length;
    elements.sessionAdjustments.hidden = !changedCount && !lastReversibleAction;
    elements.sessionAdjustmentSummary.textContent = ZLGT`视图调整 · 隐藏 ${entries.hidden.length} · 不相关 ${entries.excluded.length} · 收起 ${entries.collapsed.length}`;
    elements.manageSessionState.disabled = !changedCount;
    elements.undoSessionAction.hidden = !lastReversibleAction;
    if (lastReversibleAction) {
      const label = lastReversibleAction.kind === "hidden" ? ZLGT("隐藏") : lastReversibleAction.kind === "collapsed" ? ZLGT("收起") : ZLGT("不相关");
      elements.undoSessionAction.textContent = ZLGT`撤销${label}`;
      elements.undoSessionAction.title = lastReversibleAction.title;
    }
    if (elements.sessionStateDialog.open) renderSessionStateDialog();
  }

  async function restoreAdjustedEntries(kind, workKeys) {
    const keys = [...new Set(workKeys || [])];
    if (!keys.length || busy || navigationBusy) return;
    try {
      if (kind === "collapsed") {
        for (const workKey of keys) collapsedNodes.delete(workKey);
      }
      else if (args.restoreSessionStates) {
        mergeGraphData(await enqueueSessionMutation(() => args.restoreSessionStates({
          hiddenWorkKeys: kind === "hidden" ? keys : [],
          excludedWorkKeys: kind === "excluded" ? keys : [],
        })));
      }
      else if (kind === "hidden" && args.updateNodeState) {
        for (const workKey of keys) {
          mergeGraphData(await enqueueSessionMutation(() => args.updateNodeState(workKey, "unhide")));
        }
      }
      else if (kind === "excluded" && args.updateCandidateState) {
        for (const workKey of keys) {
          mergeGraphData(await enqueueSessionMutation(() => args.updateCandidateState(workKey, "unreviewed")));
        }
      }
      if (lastReversibleAction && keys.includes(lastReversibleAction.workKey)) lastReversibleAction = null;
      transientStatus = kind === "hidden"
        ? ZLGT`已恢复 ${keys.length} 篇隐藏论文。`
        : kind === "collapsed"
          ? ZLGT`已展开 ${keys.length} 篇论文的相邻节点。`
          : ZLGT`已将 ${keys.length} 篇论文恢复为候选。`;
    }
    catch (error) {
      transientStatus = ZLGT`恢复失败：${error.message || error}`;
    }
    render();
  }

  let renderFrame = null;
  let postPaintRenderFrame = null;
  let postPaintCommitFrame = null;

  function cancelPostPaintRender() {
    if (postPaintRenderFrame !== null) window.cancelAnimationFrame(postPaintRenderFrame);
    if (postPaintCommitFrame !== null) window.cancelAnimationFrame(postPaintCommitFrame);
    postPaintRenderFrame = null;
    postPaintCommitFrame = null;
  }

  function queuePostPaintRender(afterRender = null) {
    cancelPostPaintRender();
    if (renderFrame !== null) {
      window.cancelAnimationFrame(renderFrame);
      renderFrame = null;
    }
    postPaintRenderFrame = window.requestAnimationFrame(() => {
      postPaintRenderFrame = null;
      postPaintCommitFrame = window.requestAnimationFrame(() => {
        postPaintCommitFrame = null;
        render();
        afterRender?.();
      });
    });
  }

  function queueRender() {
    if (renderFrame !== null) return;
    renderFrame = window.requestAnimationFrame(() => {
      renderFrame = null;
      render();
    });
  }

  function render() {
    if (disposed) return;
    cancelPostPaintRender();
    if (renderFrame !== null) {
      window.cancelAnimationFrame(renderFrame);
      renderFrame = null;
    }
    renderFilterUI();
    renderSessionAdjustments();
    elements.title.textContent = data.title || "Zotero Collection Relations";
    elements.switchCollection.title = ZLGT`${data.title || ZLGT("文献集关系")} · 点击切换文献集`;
    document.title = data.title ? `${data.title} — Zotero Collection Relations` : "Zotero Collection Relations";
    elements.readonly.hidden = !data.readOnly;
    elements.status.textContent = ZLGT(statusText());
    elements.status.classList.toggle("is-busy", busy || navigationBusy);
    const rootWorkCount = new Set(data.session?.rootSeedWorkKeys || []).size;
    const rootLocalCount = data.audit?.total || data.session?.rootSeedLocalKeys?.length || 0;
    elements.seedCount.textContent = activeSeeds.size === rootWorkCount && rootLocalCount > rootWorkCount
      ? ZLGT`${activeSeeds.size} 篇检索起点 · ${rootLocalCount} 个 Zotero 条目`
      : ZLGT`${activeSeeds.size} 篇检索起点`;
    const activeHopId = data.session?.activeHopId;
    elements.historyBack.disabled = busy || navigationBusy || pendingNodeActions.size > 0 || !ZLGViewState.parentHop(data.session, activeHopId);
    elements.historyForward.disabled = busy || navigationBusy || pendingNodeActions.size > 0 || !forwardHop();
    elements.historyHome.disabled = busy || navigationBusy || pendingNodeActions.size > 0;
    elements.limit.disabled = busy || navigationBusy || !args.discover;
    elements.nodeSizeMode.disabled = busy || navigationBusy;
    elements.refreshDiscovery.disabled = busy || navigationBusy || citationRefreshBusy || pendingNodeActions.size > 0 || !args.discover || !activeSeeds.size;
    elements.collectionPicker.disabled = busy || navigationBusy || !args.listCollections;
    elements.switchCollection.disabled = busy || navigationBusy || pendingNodeActions.size > 0 || !args.listCollections || !args.openCollection;
    elements.collectionPicker.textContent = selectedCollection ? selectedCollection.name : ZLGT("全部文献集");
    elements.collectionPicker.title = selectedCollection?.path || ZLGT("按所属文献集筛选");
    for (const button of document.querySelectorAll("[data-discover]")) {
      button.disabled = busy || navigationBusy || pendingNodeActions.size > 0;
    }
    renderDiscoveryFeedback();
    syncComboboxes();
    const visible = visibleData();
    renderer.setData(visible);
    if (pendingWorkspaceSelection) {
      const node = visible.nodes.find(value => ZLGGraphRenderer.keyOf(value) === pendingWorkspaceSelection);
      pendingWorkspaceSelection = null;
      if (node) renderer.selectNode(node, { notify: true });
      else selectedWorkKey = null;
    }
    if (elements.layoutSemantics) {
      elements.layoutSemantics.textContent = visible.emptyReason === "filters"
        ? ZLGT("筛选无匹配 · 画布为空")
        : renderer.mode === "timeline"
        ? ZLGT("按年份排列")
        : visible.graphTruncated ? ZLGT("当前为部分图谱") : ZLGT("距离不代表相似度");
      elements.layoutSemantics.title = visible.emptyReason === "filters"
        ? ZLGT("重置筛选后查看全部。")
        : renderer.mode === "timeline"
        ? ZLGT("横向表示年份，纵向仅用于避让。")
        : visible.graphTruncated
          ? ZLGT`显示 ${visible.nodes.length}/${visible.totalNodeCount || visible.nodes.length} 篇文献，部分关系可能未显示。`
          : ZLGT("位置仅用于布局，距离不表示相似度。");
    }
    renderNodeSizeLegend(visible);
    renderList(visible);
    renderWorkspace(visible);
  }

  function setQueueOpen(open) {
    const changed = elements.queue.hidden === open;
    queueOpen = open;
    elements.queue.hidden = !open;
    elements.queueToggle.setAttribute("aria-expanded", String(open));
    document.body.dataset.queueOpen = String(open);
    if (changed) window.requestAnimationFrame(() => renderer.fit());
  }

  function renderWorkspace(visible = visibleData()) {
    document.body.dataset.workspace = workspace;
    for (const [button, name] of [[elements.collectionTab, "collection"], [elements.discoveryTab, "discovery"]]) {
      button.classList.toggle("is-active", workspace === name);
      button.setAttribute("aria-pressed", String(workspace === name));
    }
    elements.discoveryTab.disabled = busy || navigationBusy || (!data.lastResult && !data.session?.activeHopId);
    elements.collectionTab.disabled = busy || navigationBusy;
    elements.catalogTitle.textContent = workspace === "collection" ? ZLGT("文献集目录") : ZLGT("发现结果");
    elements.query.setAttribute("aria-label", workspace === "collection" ? ZLGT("搜索文献集：标题、作者或期刊") : ZLGT("筛选发现结果：标题、作者或期刊"));
    elements.seedCount.textContent = workspace === "collection" ? ZLGT`本页 ${visible.nodes.length} 篇` : ZLGT`本次 ${resultRequest?.seedWorkKeys.length || 0} 篇起点`;
    elements.catalogScope.textContent = workspace === "collection" ? ZLGT("勾选加入队列") : labelForMode(activeMode);
    document.getElementById("discovery-history").hidden = workspace !== "discovery";
    elements.pageControls.hidden = workspace !== "collection" || visible.collectionPages <= 1;
    elements.pageBack.disabled = collectionPage <= 0;
    elements.pageNext.disabled = collectionPage >= (visible.collectionPages || 1) - 1;
    elements.pageLabel.textContent = `${collectionPage + 1} / ${visible.collectionPages || 1}`;
    elements.scopeSummary.textContent = workspace === "collection"
      ? (visible.graphTruncated ? ZLGT("当前仅显示部分关系；跨页连线不显示。") : ZLGT("未连线不代表无关联。"))
      : ZLGT`${labelForMode(activeMode)} · ${resultRequest?.seedWorkKeys.length || 0} 篇起点 · 上限 ${resultRequest?.limit || 20} 篇`;
    const requestChanged = ZLGViewState.requestChanged(resultRequest, [...activeSeeds], chosenMode, Number(elements.limit.value) || 20);
    elements.requestNote.hidden = workspace !== "discovery" || !requestChanged;
    elements.requestNote.textContent = ZLGT("条件已改变，点击“开始查找”更新结果。");
    document.getElementById("result-seed-legend").hidden = workspace !== "discovery";
    setQueueOpen(queueOpen);
  }

  function setWorkspace(next) {
    if (next === workspace) return false;
    const filterFields = [elements.query, elements.yearFrom, elements.yearTo, elements.type, elements.library,
      elements.hasPDF, elements.duplicate, elements.reading, elements.retracted];
    workspaceStates.set(workspace, {
      filters: Object.fromEntries(filterFields.map(input => [input.id, input.type === "checkbox" ? input.checked : input.value])),
      selectedCollection,
      selectedCollectionIDs: selectedCollectionIDs ? new Set(selectedCollectionIDs) : null,
      collectionPage,
      selectedWorkKey,
      viewState: renderer.captureViewState({ allowRunning: true }),
    });
    workspace = next;
    const saved = workspaceStates.get(next);
    resetFilterInputs();
    if (saved) {
      for (const input of filterFields) {
        if (input.type === "checkbox") input.checked = saved.filters[input.id];
        else input.value = saved.filters[input.id];
      }
      selectedCollection = saved.selectedCollection;
      selectedCollectionIDs = saved.selectedCollectionIDs ? new Set(saved.selectedCollectionIDs) : null;
      pendingCollectionID = selectedCollection?.id || null;
      collectionPage = saved.collectionPage;
    }
    renderer.clearSelection?.();
    selectedWorkKey = saved?.selectedWorkKey || null;
    pendingWorkspaceSelection = selectedWorkKey;
    if (saved?.viewState) renderer.restoreViewState(saved.viewState);
    return true;
  }

  function switchWorkspace(next) {
    if (next === workspace || busy || navigationBusy || (next === "discovery" && !data.lastResult && !data.session?.activeHopId)) return;
    if (workspace === "discovery") rememberModeView();
    setWorkspace(next);
    transientStatus = "";
    render();
  }

  elements.collectionTab.addEventListener("click", () => switchWorkspace("collection"));
  elements.discoveryTab.addEventListener("click", () => switchWorkspace("discovery"));
  elements.queueToggle.addEventListener("click", () => setQueueOpen(!queueOpen));
  document.getElementById("close-search-queue").addEventListener("click", () => { setQueueOpen(false); elements.queueToggle.focus(); });
  elements.pageBack.addEventListener("click", () => { collectionPage--; render(); });
  elements.pageNext.addEventListener("click", () => { collectionPage++; render(); });

  function actionFocusOrigin(workKey) {
    const active = document.activeElement;
    if (active?.matches?.(`.zlg-result-row[data-work-key="${CSS.escape(workKey)}"] .zlg-seed-toggle`)) return "list-seed";
    if (active?.closest?.("#graph-detail")) return "detail";
    return "graph";
  }

  function restoreActionFocus(workKey, action, origin = "graph") {
    window.requestAnimationFrame(() => {
      if (["hide", "exclude"].includes(action)) {
        if (!elements.undoSessionAction.hidden) elements.undoSessionAction.focus();
        return;
      }
      if (action === "seed") {
        const detailSeed = document.querySelector('#graph-detail [data-node-action="seed"]');
        const rowSeed = document.querySelector(`.zlg-result-row[data-work-key="${CSS.escape(workKey)}"] .zlg-seed-toggle`);
        const target = origin === "list-seed"
          ? rowSeed || detailSeed
          : selectedWorkKey === workKey
            ? detailSeed || rowSeed
            : rowSeed || detailSeed;
        target?.focus();
        return;
      }
      document.querySelector("#graph-detail .zlg-command-more")?.focus();
    });
  }

  async function changeSeedSelection(workKeys, { remember = true } = {}) {
    if (busy || navigationBusy || pendingNodeActions.size > 0) return false;
    const next = new Set(workKeys);
    if (next.size > 50) {
      transientStatus = ZLGT("队列已满（50 篇），请先移除文献。");
      render();
      return false;
    }
    const previous = new Set(activeSeeds);
    if (next.size === previous.size && [...next].every(key => previous.has(key))) return true;
    let saved = false;
    pendingNodeActions.add("selection");
    try {
      rememberModeView(activeMode, data.lastResult, true, true);
      activeSeeds = next;
      if (next.size) queueOpen = true;
      transientStatus = next.size ? ZLGT`队列已更新（${next.size} 篇），点击“开始查找”生效。` : ZLGT("队列已清空。");
      render();
      if (args.updateActiveSeeds) mergeGraphData(await enqueueSessionMutation(() => args.updateActiveSeeds([...next])));
      if (remember) queueHistory.capture([...next]);
      saved = true;
    }
    catch (error) {
      activeSeeds = previous;
      transientStatus = ZLGT`队列保存失败，已恢复原队列：${error.message || error}`;
    }
    finally {
      pendingNodeActions.delete("selection");
      render();
    }
    return saved;
  }

  async function toggleSeed(node) {
    if (!node.workKey) return;
    const focusOrigin = actionFocusOrigin(node.workKey);
    const next = new Set(activeSeeds);
    if (next.has(node.workKey)) next.delete(node.workKey);
    else next.add(node.workKey);
    await changeSeedSelection([...next]);
    restoreActionFocus(node.workKey, "seed", focusOrigin);
  }

  async function handleNodeAction(node, action) {
    if (!node.workKey || busy || navigationBusy) return;
    if (pendingNodeActions.has(node.workKey)) return;
    if (["hide", "exclude"].includes(action) && activeSeeds.has(node.workKey)) {
      transientStatus = ZLGT("请先移出队列，再隐藏或标记不相关。");
      render();
      return;
    }
    if (action === "seed") {
      await toggleSeed(node);
      return;
    }
    if (action === "collapse") {
      const focusOrigin = actionFocusOrigin(node.workKey);
      const wasCollapsed = collapsedNodes.has(node.workKey);
      if (wasCollapsed) collapsedNodes.delete(node.workKey);
      else collapsedNodes.add(node.workKey);
      if (!wasCollapsed) lastReversibleAction = { kind: "collapsed", workKey: node.workKey, title: node.title || node.workKey };
      else if (lastReversibleAction?.kind === "collapsed" && lastReversibleAction.workKey === node.workKey) lastReversibleAction = null;
      transientStatus = collapsedNodes.has(node.workKey) ? ZLGT("已收起相邻文献。") : ZLGT("已展开相邻文献。");
      render();
      restoreActionFocus(node.workKey, "collapse", focusOrigin);
      return;
    }
    pendingNodeActions.add(node.workKey);
    render();
    try {
    if (["reading-list", "exclude", "unreviewed"].includes(action) && args.updateCandidateState) {
      const previousState = node.candidateState || data.session?.candidateStates?.[node.workKey] || "unreviewed";
      const state = action === "exclude" ? "excluded" : action === "reading-list" ? "reading-list" : "unreviewed";
      mergeGraphData(await enqueueSessionMutation(() => args.updateCandidateState(node.workKey, state)));
      if (action === "exclude") {
        lastReversibleAction = { kind: "excluded", workKey: node.workKey, title: node.title || node.workKey };
        transientStatus = ZLGT("已标记不相关，可在“视图调整”恢复。");
      }
      else if (state === "reading-list") transientStatus = ZLGT("已加入稍后阅读。");
      else if (previousState === "reading-list") transientStatus = ZLGT("已移出稍后阅读。");
      else transientStatus = ZLGT("已恢复候选。");
      return;
    }
    if (["pin", "unpin", "hide"].includes(action) && args.updateNodeState) {
      mergeGraphData(await enqueueSessionMutation(() => args.updateNodeState(node.workKey, action)));
      if (action === "hide") {
        selectedWorkKey = null;
        lastReversibleAction = { kind: "hidden", workKey: node.workKey, title: node.title || node.workKey };
        transientStatus = ZLGT("已隐藏，可撤销或在“视图调整”恢复。");
      }
      else transientStatus = action === "pin"
        ? ZLGT("已设为保持显示。")
        : ZLGT("已取消保持显示。");
    }
    }
    catch (error) {
      transientStatus = ZLGT`操作失败：${error.message || error}`;
    }
    finally {
      pendingNodeActions.delete(node.workKey);
      render();
      restoreActionFocus(node.workKey, action);
    }
  }

  async function discover(mode) {
    if (busy || navigationBusy || !args.discover) return;
    const seedWorkKeys = [...activeSeeds];
    const resultLimit = Number(elements.limit.value) || 20;
    if (!seedWorkKeys.length) {
      transientStatus = ZLGT("请先将文献加入队列。");
      render();
      return;
    }
    const requestToken = ++discoveryRequestToken;
    busy = true;
    pendingDiscoveryMode = mode;
    const controller = new AbortController();
    activeController = controller;
    const previousMode = activeMode;
    transientStatus = ZLGT`正在通过 OpenAlex 获取${labelForMode(mode)}…`;
    render();
    try {
      const nextData = await enqueueSessionMutation(() => args.discover({
        mode,
        seedWorkKeys,
        limit: resultLimit,
        filters: workspace === "discovery" ? readFilters() : {},
        signal: controller.signal,
      }));
      if (requestToken !== discoveryRequestToken) return;
      if (controller.signal.aborted) {
        transientStatus = ZLGT("已取消查找。");
        return;
      }
      setWorkspace("discovery");
      data = nextData;
      hopSync.confirm(data.session?.activeHopId);
      activeMode = mode;
      resultRequest = ZLGViewState.requestSnapshot({ mode, resultLimit, seedWorkKeys });
      resultRequestKey = ZLGViewState.modeCacheKey(mode, resultLimit, seedWorkKeys);
      pendingWorkspaceSelection = null;
      selectedWorkKey = null;
      renderer.clearSelection?.();
      pendingDiscoveryMode = null;
      const discoveredHop = data.session?.hops?.find(hop => hop.hopId === data.session?.activeHopId);
      activeDiscoveryByKey = new Map(
        (discoveredHop?.resultEntries?.length ? discoveredHop.resultEntries : data.nodes)
          .filter(value => value.workKey && value.discovery)
          .map(value => [value.workKey, value.discovery]),
      );
      activeEdgeByKey = new Map((discoveredHop?.edgeEntries || []).map(edge => [ZLGGraphRenderer.edgeKey(edge), edge]));
      rememberModeView(mode, data.lastResult, false);
      transientStatus = "";
    }
    catch (error) {
      if (requestToken !== discoveryRequestToken) return;
      activeMode = previousMode;
      pendingDiscoveryMode = null;
      transientStatus = error?.name === "AbortError"
        ? ZLGT("已取消查找。")
        : error?.status === 429
        ? ZLGT`OpenAlex 请求受限${error.retryAfter ? ZLGT`，请在 ${error.retryAfter} 秒后重试` : ""}。当前图谱未丢失。`
        : ZLGT`发现失败：${error.message || error}`;
    }
    finally {
      if (activeController === controller) activeController = null;
      busy = false;
      pendingDiscoveryMode = null;
      if (requestToken !== discoveryRequestToken) return;
      render();
      rememberModeView(activeMode, data.lastResult);
    }
  }

  async function refreshCitationCounts(force = false) {
    if (disposed || navigationBusy) return null;
    if (!args.refreshCitationCounts || citationRefreshBusy) return null;
    if (!force && args.getSettings?.().autoRefreshCitations === false) return null;
    const workKeys = visibleData().nodes.map(node => node.workKey).filter(Boolean);
    if (!workKeys.length) return null;
    citationRefreshBusy = true;
    if (force) {
      transientStatus = ZLGT("更新被引量…");
      render();
    }
    try {
      const report = await enqueueSessionMutation(() => args.refreshCitationCounts({ workKeys, force }));
      if (disposed) return null;
      if (report.works?.length) {
        const graphCanvas = document.getElementById("graph-canvas");
        const waitStarted = Date.now();
        while (graphCanvas?.dataset.simulationState === "running" && Date.now() - waitStarted < 3000) {
          await new Promise(resolve => window.setTimeout(resolve, 40));
        }
        const updated = new Map(report.works.map(work => [work.workKey, work]));
        data = {
          ...data,
          nodes: data.nodes.map(node => updated.has(node.workKey) ? { ...node, ...updated.get(node.workKey) } : node),
        };
      }
      if (report.refreshedCount) {
        transientStatus = ZLGT`已更新 ${report.refreshedCount} 篇文献的被引量。`;
        render();
      }
      else if (force) {
        transientStatus = ZLGT("被引量已是最新。");
        render();
      }
      return report;
    }
    catch (error) {
      if (force) {
        transientStatus = ZLGT`被引量更新失败：${error.message || error}`;
        render();
      }
      return null;
    }
    finally {
      citationRefreshBusy = false;
      render();
    }
  }

  async function switchDiscoveryMode(mode, force = false) {
    if (navigationBusy || busy || !args.discover) return;
    if (!force && mode === activeMode && pendingDiscoveryMode === null && resultRequestKey === modeCacheKey(mode)) {
      setWorkspace("discovery");
      render();
      return;
    }
    if (!force) {
      rememberModeView(activeMode, data.lastResult);
      const cached = modeCache.get(modeCacheKey(mode));
      if (cached) {
        const cachedHop = ZLGViewState.hopById(data.session, cached.hopId);
        if (cachedHop) {
          activateHopInBackground(cachedHop, ZLGT`已切换到${labelForMode(mode)}。`, cached.viewState);
          return;
        }
        else if (cached.lastResult) {
          activeMode = mode;
          setWorkspace("discovery");
          resultRequestKey = modeCacheKey(mode);
          resultRequest = cached.request;
          data = { ...data, lastResult: cached.lastResult };
          transientStatus = ZLGT`已切换到${labelForMode(mode)}。`;
          render();
          return;
        }
      }
      const hop = matchingHop(mode);
      if (hop) {
        activateHopInBackground(hop, ZLGT`已切换到${labelForMode(mode)}。`);
        return;
      }
    }
    await discover(mode);
  }

  function updateCollectionSelection() {
    for (const row of elements.collectionList.querySelectorAll(".zlg-collection-row")) {
      const selected = Number(row.dataset.collectionId) === pendingCollectionID;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-selected", String(selected));
    }
    elements.collectionApply.disabled = !pendingCollectionID || Boolean(scopeController);
    const active = elements.collectionList.querySelector(".zlg-collection-row.is-selected");
    if (active) elements.collectionList.setAttribute("aria-activedescendant", active.id);
    else elements.collectionList.removeAttribute("aria-activedescendant");
  }

  function toggleCollection(row) {
    if (scopeController) return;
    const expanded = collectionSearchExpansion || ZLGGraphWorkbench.collectionExpandedIDs;
    if (expanded.has(row.id)) {
      expanded.delete(row.id);
      if (ZLGCollectionTree.ancestors(collectionRows, pendingCollectionID).includes(row.id)) pendingCollectionID = row.id;
    }
    else expanded.add(row.id);
    renderCollectionList();
    elements.collectionList.focus();
  }

  function renderCollectionList() {
    const query = elements.collectionQuery.value.trim().toLowerCase();
    if (query !== collectionSearchValue) {
      collectionSearchValue = query;
      collectionSearchExpansion = query ? ZLGCollectionTree.searchExpansion(collectionRows || [], query) : null;
    }
    const recursive = collectionDialogMode === "filter" && elements.collectionRecursive.checked;
    elements.collectionList.replaceChildren();
    const rows = ZLGCollectionTree.visible(collectionRows || [], collectionSearchExpansion || ZLGGraphWorkbench.collectionExpandedIDs, query);
    if (query && !rows.some(row => row.id === pendingCollectionID)) {
      pendingCollectionID = rows.find(row => `${row.name} ${row.path || ""}`.toLowerCase().includes(query))?.id || null;
    }
    const groups = new Map();
    for (const row of rows) {
      const button = document.createElement("div");
      button.className = `zlg-collection-row${row.id === pendingCollectionID ? " is-selected" : ""}`;
      button.id = `zlg-collection-${row.id}`;
      button.dataset.collectionId = row.id;
      button.setAttribute("role", "treeitem");
      button.setAttribute("aria-level", row.depth + 1);
      button.setAttribute("aria-posinset", row.position);
      button.setAttribute("aria-setsize", row.size);
      if (row.hasChildren) button.setAttribute("aria-expanded", String(row.expanded));
      button.setAttribute("aria-selected", row.id === pendingCollectionID ? "true" : "false");
      button.title = row.path;
      const line = document.createElement("div");
      line.className = "zlg-collection-line";
      line.style.paddingInlineStart = `${6 + row.depth * 18}px`;
      const disclosure = document.createElement(row.hasChildren ? "button" : "span");
      disclosure.className = `zlg-collection-disclosure${row.hasChildren ? " has-children" : ""}`;
      if (row.hasChildren) {
        disclosure.type = "button";
        disclosure.tabIndex = -1;
        disclosure.setAttribute("aria-label", row.expanded ? ZLGT`折叠文献集：${row.name}` : ZLGT`展开文献集：${row.name}`);
        disclosure.addEventListener("click", event => { event.stopPropagation(); toggleCollection(row); });
      }
      else disclosure.setAttribute("aria-hidden", "true");
      const folder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      folder.setAttribute("viewBox", "0 0 20 20");
      folder.setAttribute("class", "zlg-collection-folder");
      folder.setAttribute("aria-hidden", "true");
      const folderPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      folderPath.setAttribute("d", row.expanded ? "M2 8V4H8L10 6H18V8M2 8H18L16 16H2Z" : "M2 6V4H8L10 6H18V16H2Z M2 8H18");
      folder.append(folderPath);
      const name = document.createElement("span");
      name.className = "zlg-collection-name";
      name.id = `${button.id}-name`;
      name.textContent = row.name;
      button.setAttribute("aria-labelledby", name.id);
      const count = document.createElement("small");
      count.textContent = ZLGT`${recursive ? row.recursiveItemCount : row.directItemCount} 篇`;
      line.append(disclosure, folder, name, count);
      button.append(line);
      button.addEventListener("click", event => {
        event.stopPropagation();
        pendingCollectionID = row.id;
        updateCollectionSelection();
        elements.collectionList.focus();
      });
      line.addEventListener("dblclick", event => {
        if (event.target.closest(".zlg-collection-disclosure")) return;
        pendingCollectionID = row.id;
        void applyCollectionSelection();
      });
      (groups.get(Number(row.parentID)) || elements.collectionList).appendChild(button);
      if (row.expanded) {
        const group = document.createElement("div");
        group.setAttribute("role", "group");
        button.appendChild(group);
        groups.set(row.id, group);
      }
    }
    if (!elements.collectionList.childElementCount) {
      const empty = document.createElement("div");
      empty.className = "zlg-list-empty";
      empty.textContent = ZLGT("没有匹配的文献集。");
      elements.collectionList.appendChild(empty);
    }
    updateCollectionSelection();
  }

  function positionCollectionDialog() {
    if (collectionDialogMode !== "switch") return;
    const anchor = elements.switchCollection.getBoundingClientRect();
    const top = document.querySelector(".zlg-topbar").getBoundingClientRect().bottom + 6;
    const width = Math.min(440, window.innerWidth - 24);
    elements.collectionDialog.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, anchor.left))}px`;
    elements.collectionDialog.style.top = `${top}px`;
    elements.collectionDialog.style.width = `${width}px`;
    elements.collectionDialog.style.setProperty("--zlg-picker-height", `${Math.max(180, window.innerHeight - top - 12)}px`);
  }

  async function openCollectionDialog(mode = "filter") {
    if (!args.listCollections) return;
    collectionDialogMode = mode;
    elements.collectionDialog.dataset.mode = mode;
    elements.collectionDialog.style.cssText = "";
    collectionSearchExpansion = null;
    collectionSearchValue = "";
    pendingCollectionID = mode === "switch" ? data.session?.collectionScope?.id || null : selectedCollection?.id || null;
    document.getElementById("collection-dialog-title").textContent = mode === "switch" ? ZLGT("切换文献集") : ZLGT("筛选文献集");
    document.getElementById("collection-dialog-help").textContent = mode === "switch" ? ZLGT("选择要浏览的文献集。") : ZLGT("筛选当前结果。");
    const feedback = document.getElementById("collection-dialog-feedback");
    feedback.hidden = true;
    feedback.textContent = "";
    elements.collectionRecursive.closest("label").hidden = mode === "switch";
    elements.collectionClear.hidden = mode === "switch";
    elements.collectionApply.textContent = mode === "switch" ? ZLGT("打开文献集") : ZLGT("应用筛选");
    if (mode === "switch") collectionRows = null;
    elements.collectionQuery.value = "";
    if (elements.collectionDialog.showModal) elements.collectionDialog.showModal();
    else elements.collectionDialog.setAttribute("open", "open");
    window.requestAnimationFrame(() => elements.collectionQuery.focus());
    positionCollectionDialog();
    if (!collectionRows) {
      elements.collectionList.textContent = ZLGT("读取文献集…");
      elements.collectionList.setAttribute("aria-busy", "true");
      elements.collectionApply.disabled = true;
      try {
        collectionRows = await args.listCollections();
        if (disposed || !elements.collectionDialog.open) return;
        if (mode === "switch" && !pendingCollectionID) pendingCollectionID = collectionRows.find(row => row.name === data.title)?.id || null;
      }
      finally {
        elements.collectionList.removeAttribute("aria-busy");
      }
    }
    for (const id of ZLGCollectionTree.ancestors(collectionRows || [], pendingCollectionID)) ZLGGraphWorkbench.collectionExpandedIDs.add(id);
    renderCollectionList();
    elements.collectionList.querySelector(".zlg-collection-row.is-selected")?.scrollIntoView({ block: "nearest" });
  }

  function closeCollectionDialog() {
    if (elements.collectionDialog.close) elements.collectionDialog.close();
    else {
      elements.collectionDialog.removeAttribute("open");
      window.requestAnimationFrame(() => elements.collectionPicker.focus());
    }
  }

  function applyCollectionFilter() {
    const row = collectionRows?.find(value => value.id === pendingCollectionID);
    if (!row) return;
    selectedCollection = row;
    selectedCollectionIDs = new Set([row.id, ...(elements.collectionRecursive.checked ? row.descendantIDs : [])].map(Number));
    const matched = data.nodes.filter(node => (node.collectionIDs || []).some(id => selectedCollectionIDs.has(Number(id)))).length;
    transientStatus = ZLGT`已筛选 ${row.path} · 当前会话匹配 ${matched} 篇${elements.collectionRecursive.checked ? ZLGT("（含子文献集）") : ""}`;
    closeCollectionDialog();
    render();
  }

  function clearCollectionFilter() {
    selectedCollection = null;
    selectedCollectionIDs = null;
    pendingCollectionID = null;
    transientStatus = ZLGT("已显示全部文献集。");
    closeCollectionDialog();
    render();
  }

  async function applyCollectionSelection() {
    if (collectionDialogMode !== "switch") return applyCollectionFilter();
    const row = collectionRows?.find(value => value.id === pendingCollectionID);
    if (!row || scopeController || !args.openCollection) return;
    const controller = new AbortController();
    scopeController = controller;
    navigationBusy = true;
    const feedback = document.getElementById("collection-dialog-feedback");
    feedback.hidden = false;
    feedback.textContent = ZLGT("正在打开文献集…");
    feedback.removeAttribute("data-error");
    renderCollectionList();
    render();
    try {
      const next = await enqueueSessionMutation(() => args.openCollection(row.id, { signal: controller.signal }));
      if (disposed || controller.signal.aborted) return;
      closeCollectionDialog();
      ZLGGraphWorkbench.replace(next);
    }
    catch (error) {
      if (disposed) return;
      if (controller.signal.aborted || error.name === "AbortError") transientStatus = ZLGT("已取消切换。");
      else {
        feedback.textContent = ZLGT`切换失败：${error.message || error}`;
        feedback.dataset.error = "true";
      }
    }
    finally {
      if (!disposed) {
        scopeController = null;
        navigationBusy = false;
        renderCollectionList();
        render();
      }
    }
  }

  for (const button of document.querySelectorAll("[data-discover]")) {
    button.addEventListener("click", () => {
      chosenMode = button.dataset.discover;
      renderDiscoveryFeedback();
    });
  }
  for (const button of document.querySelectorAll("[data-library-source]")) {
    button.addEventListener("click", () => {
      elements.library.value = button.dataset.librarySource;
      transientStatus = "";
      render();
    });
  }
  elements.nodeSizeMode.addEventListener("change", () => {
    renderer.setNodeSizeMode(elements.nodeSizeMode.value);
    args.setNodeSizeMode?.(elements.nodeSizeMode.value);
    renderNodeSizeLegend();
    transientStatus = ZLGT`节点大小已切换为${ZLGGraphRenderer.nodeSizeModeLabel(elements.nodeSizeMode.value)}。`;
    elements.status.textContent = ZLGT(statusText());
  });
  elements.runDiscovery.addEventListener("click", () => {
    if (!activeSeeds.size || pendingNodeActions.size) return;
    void switchDiscoveryMode(chosenMode);
  });
  elements.clearSelection.addEventListener("click", () => changeSeedSelection([]));
  elements.refreshDiscovery.addEventListener("click", () => void switchDiscoveryMode(chosenMode, true));
  elements.collectionPicker.addEventListener("click", () => openCollectionDialog().catch(error => {
    transientStatus = ZLGT`文献集读取失败：${error.message || error}`;
    render();
  }));
  elements.switchCollection.addEventListener("click", () => openCollectionDialog("switch").catch(error => {
    if (disposed) return;
    const feedback = document.getElementById("collection-dialog-feedback");
    feedback.hidden = false;
    feedback.textContent = ZLGT`读取失败：${error.message || error}`;
    feedback.dataset.error = "true";
  }));
  elements.collectionQuery.addEventListener("input", renderCollectionList);
  elements.collectionQuery.addEventListener("keydown", event => {
    if (event.key === "Enter" && pendingCollectionID) {
      event.preventDefault();
      void applyCollectionSelection();
      return;
    }
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    const target = elements.collectionList.querySelector(".zlg-collection-row.is-selected")
      || elements.collectionList.querySelector(".zlg-collection-row");
    if (target) {
      if (!target.classList.contains("is-selected")) {
        pendingCollectionID = Number(target.id.replace("zlg-collection-", ""));
        renderCollectionList();
      }
      elements.collectionList.focus();
    }
  });
  elements.collectionList.addEventListener("keydown", event => {
    const rows = [...elements.collectionList.querySelectorAll(".zlg-collection-row")];
    if (!rows.length) return;
    let index = rows.findIndex(row => row.classList.contains("is-selected"));
    if (event.key === "ArrowDown") index = Math.min(rows.length - 1, index + 1);
    else if (event.key === "ArrowUp") index = Math.max(0, index < 0 ? 0 : index - 1);
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = rows.length - 1;
    else if (event.key === "ArrowRight" && index >= 0) {
      const selected = rows[index];
      if (selected.getAttribute("aria-expanded") === "false") {
        event.preventDefault();
        toggleCollection({ id: Number(selected.dataset.collectionId) });
        return;
      }
      if (selected.getAttribute("aria-expanded") === "true") index = Math.min(rows.length - 1, index + 1);
      else { event.preventDefault(); return; }
    }
    else if (event.key === "ArrowLeft" && index >= 0) {
      const selected = rows[index];
      if (selected.getAttribute("aria-expanded") === "true") {
        event.preventDefault();
        toggleCollection({ id: Number(selected.dataset.collectionId) });
        return;
      }
      const parent = collectionRows.find(row => row.id === Number(selected.dataset.collectionId))?.parentID;
      const parentIndex = rows.findIndex(row => Number(row.dataset.collectionId) === Number(parent));
      if (parentIndex < 0) { event.preventDefault(); return; }
      index = parentIndex;
    }
    else if (event.key === "Enter" && index >= 0) {
      event.preventDefault();
      void applyCollectionSelection();
      return;
    }
    else if (event.key === " " && index >= 0) { event.preventDefault(); return; }
    else if (event.key === "Escape") {
      event.preventDefault();
      elements.collectionQuery.focus();
      return;
    }
    else return;
    event.preventDefault();
    pendingCollectionID = Number(rows[index].id.replace("zlg-collection-", ""));
    updateCollectionSelection();
    rows[index].scrollIntoView({ block: "nearest" });
  });
  elements.collectionRecursive.addEventListener("change", renderCollectionList);
  elements.collectionDialog.addEventListener("close", () => {
    scopeController?.abort();
    const target = collectionDialogMode === "switch" ? elements.switchCollection : elements.collectionPicker;
    window.requestAnimationFrame(() => { if (!disposed) target.focus(); });
  });
  elements.collectionDialog.addEventListener("cancel", () => scopeController?.abort());
  elements.collectionDialog.addEventListener("click", event => {
    if (collectionDialogMode !== "switch" || event.target !== elements.collectionDialog) return;
    const bounds = elements.collectionDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeCollectionDialog();
  });
  window.addEventListener("resize", () => { if (elements.collectionDialog.open) positionCollectionDialog(); }, { signal: lifecycle.signal });
  elements.collectionApply.addEventListener("click", () => void applyCollectionSelection());
  elements.collectionClear.addEventListener("click", clearCollectionFilter);
  elements.manageSessionState.addEventListener("click", () => {
    renderSessionStateDialog();
    if (elements.sessionStateDialog.showModal) elements.sessionStateDialog.showModal();
    else elements.sessionStateDialog.setAttribute("open", "open");
  });
  elements.undoSessionAction.addEventListener("click", async () => {
    if (!lastReversibleAction) return;
    const action = lastReversibleAction;
    await restoreAdjustedEntries(action.kind, [action.workKey]);
  });
  elements.restoreAllHidden.addEventListener("click", async () => {
    await restoreAdjustedEntries("hidden", adjustedSessionEntries().hidden.map(entry => entry.workKey));
  });
  elements.restoreAllExcluded.addEventListener("click", async () => {
    await restoreAdjustedEntries("excluded", adjustedSessionEntries().excluded.map(entry => entry.workKey));
  });
  elements.restoreAllCollapsed.addEventListener("click", async () => {
    await restoreAdjustedEntries("collapsed", adjustedSessionEntries().collapsed.map(entry => entry.workKey));
  });
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => {
      for (const candidate of document.querySelectorAll("[data-mode]")) {
        candidate.classList.remove("is-active");
        candidate.setAttribute("aria-pressed", "false");
      }
      button.classList.add("is-active");
      button.setAttribute("aria-pressed", "true");
      renderer.setMode(button.dataset.mode);
      render();
    });
  }
  document.getElementById("fit-graph").addEventListener("click", () => renderer.fit());
  elements.query.addEventListener("input", () => {
    syncClearFiltersAvailability();
    if (queryTimer) window.clearTimeout(queryTimer);
    queryTimer = window.setTimeout(() => {
      queryTimer = null;
      transientStatus = "";
      render();
    }, 180);
  });
  elements.query.addEventListener("keydown", event => {
    if (event.key !== "Enter" || queryTimer === null) return;
    event.preventDefault();
    if (queryTimer) window.clearTimeout(queryTimer);
    queryTimer = null;
    transientStatus = "";
    render();
  });
  const flushYearFilter = () => {
    if (yearFilterTimer) window.clearTimeout(yearFilterTimer);
    yearFilterTimer = null;
    transientStatus = "";
    render();
  };
  for (const input of [elements.yearFrom, elements.yearTo]) {
    input.addEventListener("input", () => {
      renderYearValidation();
      transientStatus = "";
      if (yearFilterTimer) window.clearTimeout(yearFilterTimer);
      yearFilterTimer = window.setTimeout(flushYearFilter, 180);
    });
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter" || yearFilterTimer === null) return;
      event.preventDefault();
      flushYearFilter();
    });
  }
  for (const input of [elements.type, elements.hasPDF, elements.duplicate, elements.reading, elements.retracted]) {
    input.addEventListener("change", () => {
      transientStatus = "";
      render();
    });
  }
  elements.limit.addEventListener("change", () => {
    transientStatus = ZLGT`结果上限：${Number(elements.limit.value) || 20} 篇，下次查找生效。`;
    render();
  });
  function resetFilterInputs() {
    if (queryTimer) window.clearTimeout(queryTimer);
    if (yearFilterTimer) window.clearTimeout(yearFilterTimer);
    queryTimer = null;
    yearFilterTimer = null;
    elements.query.value = "";
    elements.yearFrom.value = "";
    elements.yearTo.value = "";
    elements.type.value = "all";
    elements.library.value = "all";
    elements.hasPDF.checked = false;
    elements.duplicate.checked = false;
    elements.reading.checked = false;
    elements.retracted.checked = true;
    selectedCollection = null;
    selectedCollectionIDs = null;
    pendingCollectionID = null;
  }
  function resetFilters() {
    resetFilterInputs();
    collectionPage = 0;
    transientStatus = ZLGT("已重置筛选。");
    render();
  }
  elements.clearFilters.addEventListener("click", resetFilters);
  elements.undoQueueSelection.addEventListener("click", async () => {
    const previous = queueHistory.peek();
    if (!previous) return;
    if (await changeSeedSelection(previous, { remember: false })) {
      queueHistory.undo();
      transientStatus = ZLGT("已撤销队列修改。");
      render();
    }
  });
  elements.cancelDiscovery.addEventListener("click", () => activeController?.abort());
  elements.historyHome.addEventListener("click", () => {
    // A Collection may contain more than 50 items; it is never an implicit queue.
    const firstSearch = data.session?.hops?.[0];
    void changeSeedSelection(firstSearch?.seedWorkKeys || []);
  });
  elements.historyBack.addEventListener("click", navigateBack);
  elements.historyForward.addEventListener("click", navigateForward);
  window.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (activeController) activeController.abort();
    else if (queueOpen && !document.querySelector("dialog[open]")) {
      setQueueOpen(false);
      elements.queueToggle.focus();
      event.preventDefault();
    }
  }, { signal: lifecycle.signal });
  const settingsButton = document.getElementById("open-settings");
  settingsButton.disabled = !args.openSettings;
  settingsButton.addEventListener("click", () => args.openSettings?.());
  const unsubscribeSettings = args.subscribeSettings?.((settings, changedKeys) => {
    if (disposed) return;
    if (changedKeys.includes("language")) {
      ZLGI18n.configure({ language: settings.language, hostLocale });
      document.documentElement.lang = ZLGI18n.locale();
      ZLGI18n.localizeDOM(document);
      syncComboboxes();
      render();
      if (elements.collectionDialog.open) {
        document.getElementById("collection-dialog-title").textContent = ZLGT(collectionDialogMode === "switch" ? "切换文献集" : "筛选文献集");
        document.getElementById("collection-dialog-help").textContent = ZLGT(collectionDialogMode === "switch" ? "选择要浏览的文献集。" : "筛选当前结果。");
        elements.collectionApply.textContent = ZLGT(collectionDialogMode === "switch" ? "打开文献集" : "应用筛选");
        const scrollTop = elements.collectionList.scrollTop;
        renderCollectionList();
        elements.collectionList.scrollTop = scrollTop;
      }
    }
    if (changedKeys.includes("nodeSizeMode")) {
      elements.nodeSizeMode.value = settings.nodeSizeMode;
      renderer.setNodeSizeMode(settings.nodeSizeMode);
      syncComboboxes();
      renderNodeSizeLegend();
    }
    if (!settings.autoRefreshCitations && citationRefreshTimer) {
      window.clearTimeout(citationRefreshTimer);
      citationRefreshTimer = null;
    }
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    lifecycle.abort();
    scopeController?.abort();
    unsubscribeSettings?.();
    activeController?.abort();
    discoverySwitchToken++;
    if (discoverySyncFrame !== null) window.cancelAnimationFrame(discoverySyncFrame);
    if (discoverySyncTimer !== null) window.clearTimeout(discoverySyncTimer);
    if (queryTimer) window.clearTimeout(queryTimer);
    if (yearFilterTimer) window.clearTimeout(yearFilterTimer);
    if (citationRefreshTimer) window.clearTimeout(citationRefreshTimer);
    if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
    cancelPostPaintRender();
    renderer.destroy();
  }
  ZLGGraphWorkbench.dispose = dispose;
  window.addEventListener("unload", dispose, { once: true, signal: lifecycle.signal });
  rememberModeView();
  render();
  citationRefreshTimer = window.setTimeout(() => {
    citationRefreshTimer = null;
    refreshCitationCounts(false);
  }, 700);
  if (args.chooseCollection) void openCollectionDialog("switch");
}

document.addEventListener("DOMContentLoaded", () => {
  const args = window.arguments?.[0] || {};
  ZLGHostAppearance.connect(window, args.hostWindow);
  ZLGGraphWorkbench.template = document.body.cloneNode(true);
  initializeGraphWorkbench(args);
}, { once: true });
