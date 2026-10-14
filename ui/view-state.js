"use strict";

var ZLGViewState = (() => {
  function lastResultForHop(hop = {}) {
    const workKeys = [...new Set(hop.resultWorkKeys || [])];
    return {
      mode: hop.mode || "similar",
      workKeys,
      total: Math.max(Number(hop.resultTotal) || 0, workKeys.length),
      totalScope: hop.resultTotalScope || "cached-hop",
      limitedByProvider: Boolean(hop.limitedByProvider),
      rankingApproximate: Boolean(hop.rankingApproximate),
    };
  }

  function modeCacheKey(mode, limit, seedKeys = []) {
    return `${mode}|${Number(limit) || 20}|${[...new Set(seedKeys)].sort().join("|")}`;
  }

  function hopsOf(value) {
    return Array.isArray(value) ? value : value?.hops || [];
  }

  function hopById(hops = [], hopId = null) {
    return hopsOf(hops).find(hop => hop.hopId === hopId) || null;
  }

  function parentHop(hops = [], hopId = null) {
    const active = hopById(hops, hopId);
    return active?.parentHopId ? hopById(hops, active.parentHopId) : null;
  }

  function childHops(hops = [], hopId = null) {
    return hopsOf(hops).filter(hop => hop.parentHopId === hopId);
  }

  function visibleResultKeys(resultKeys = [], visibleNodes = []) {
    const visible = new Set(visibleNodes.map(node => node.workKey || `${node.libraryID}:${node.itemKey}`));
    return [...new Set(resultKeys)].filter(key => visible.has(key));
  }

  // Collection membership is independent from discovery hops and queue selection.
  function collectionSlice(data, rootKeys, matches = () => true, page = 0, pageSize = 160) {
    const keyOf = node => node.workKey || `${node.libraryID}:${node.itemKey}`;
    const works = new Map([...(data.session?.graphSnapshot?.works || []), ...(data.nodes || [])].map(node => [keyOf(node), node]));
    const roots = [...new Set(rootKeys)];
    const nodes = roots.map(key => works.get(key)).filter(Boolean).filter(matches);
    const pages = Math.max(1, Math.ceil(nodes.length / pageSize));
    const currentPage = Math.min(Math.max(0, page), pages - 1);
    const visibleNodes = nodes.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
    const keys = new Set(nodes.map(keyOf));
    const visibleKeys = new Set(visibleNodes.map(keyOf));
    const edgeKey = edge => edge.edgeKey || `${edge.sourceWorkKey || keyOf(edge.source)}:${edge.type}:${edge.targetWorkKey || keyOf(edge.target)}`;
    const allEdges = [...new Map([...(data.session?.graphSnapshot?.edges || []), ...(data.edges || [])].map(edge => [edgeKey(edge), edge])).values()];
    const edges = allEdges.filter(edge => edge.type !== "similar" && keys.has(edge.sourceWorkKey || keyOf(edge.source)) && keys.has(edge.targetWorkKey || keyOf(edge.target)));
    const visibleEdges = edges.filter(edge => visibleKeys.has(edge.sourceWorkKey || keyOf(edge.source)) && visibleKeys.has(edge.targetWorkKey || keyOf(edge.target)));
    return { ...data, workspace: "collection", nodes: visibleNodes, edges: visibleEdges.slice(0, 600),
      totalNodeCount: nodes.length, totalEdgeCount: edges.length, collectionPage: currentPage, collectionPages: pages,
      graphTruncated: visibleNodes.length < nodes.length || visibleEdges.length > 600,
      emptyReason: nodes.length ? null : "filters" };
  }

  function sortedUniqueKeys(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).filter(value => value != null).map(String))].sort();
  }

  function requestSnapshot(hop = {}, lastResult = null, fallbackKeys = []) {
    const result = lastResult || lastResultForHop(hop);
    const keys = hop.seedWorkKeys || hop.seedKeys || result.seedWorkKeys || fallbackKeys;
    return Object.freeze({
      mode: hop.mode || result.mode || "similar",
      seedWorkKeys: Object.freeze(sortedUniqueKeys(keys)),
      limit: Math.max(1, Number(hop.limit || hop.resultLimit || result.limit) || 20),
    });
  }

  function requestChanged(snapshot, draftKeys = [], chosenMode = "similar", limit = 20) {
    if (!snapshot) return true;
    const previousKeys = sortedUniqueKeys(snapshot.seedWorkKeys || []);
    const currentKeys = sortedUniqueKeys(draftKeys);
    return previousKeys.length !== currentKeys.length ||
      previousKeys.some((key, index) => key !== currentKeys[index]) ||
      (snapshot.mode || "similar") !== (chosenMode || "similar") ||
      (Number(snapshot.limit) || 20) !== (Number(limit) || 20);
  }

  function createQueueHistory(initialState) {
    const states = [initialState];
    return Object.freeze({
      capture(state) { states.push(state); return state; },
      peek() { return states.length > 1 ? states[states.length - 2] : null; },
      undo(restore = () => {}) {
        if (states.length < 2) return null;
        const previous = states[states.length - 2];
        restore(previous);
        states.pop();
        return previous;
      },
    });
  }

  function createMutationQueue() {
    let tail = Promise.resolve();
    return task => {
      const operation = tail.catch(() => {}).then(task);
      tail = operation.catch(() => {});
      return operation;
    };
  }

  function createHopSyncTracker(initialHopId = null) {
    let confirmedHopId = initialHopId || null;
    return Object.freeze({
      confirm(hopId) {
        if (hopId) confirmedHopId = hopId;
        return confirmedHopId;
      },
      confirmedId() {
        return confirmedHopId;
      },
      rollbackHop(session) {
        return hopById(session, confirmedHopId);
      },
    });
  }

  return Object.freeze({
    collectionSlice,
    lastResultForHop,
    modeCacheKey,
    hopsOf,
    hopById,
    parentHop,
    childHops,
    visibleResultKeys,
    createMutationQueue,
    createHopSyncTracker,
    requestSnapshot,
    requestChanged,
    createQueueHistory,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = ZLGViewState;
