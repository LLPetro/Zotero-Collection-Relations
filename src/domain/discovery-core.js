/* global ZLGIdentity, module */

var ZLGDiscoveryCore = (() => {
  "use strict";

  const SESSION_SCHEMA_VERSION = 1;
  const CANDIDATE_STATES = new Set(["unreviewed", "reading-list", "excluded", "seeded", "in-library", "ambiguous"]);

  function nowISO(clock = Date) {
    return new clock().toISOString();
  }

  function openAlexID(value) {
    return String(value || "").replace(/^https?:\/\/openalex\.org\//i, "").toUpperCase();
  }

  function workKey(provider, externalId) {
    return `${String(provider || "unknown").toLowerCase()}:${String(externalId || "").trim()}`;
  }

  function invertAbstract(index) {
    if (!index || typeof index !== "object") return "";
    const values = [];
    for (const [word, positions] of Object.entries(index)) {
      for (const position of positions || []) values[position] = word;
    }
    return values.filter(Boolean).join(" ");
  }

  function normalizeOpenAlexWork(value = {}, fetchedAt = new Date().toISOString()) {
    const externalId = openAlexID(value.id);
    const ids = value.ids || {};
    return {
      workKey: workKey("openalex", externalId),
      provider: "openalex",
      externalId,
      identifiers: {
        doi: ZLGIdentity.cleanDOI(value.doi || ids.doi),
        pmid: ZLGIdentity.cleanPMID(ids.pmid),
        arxiv: ZLGIdentity.cleanArxiv(ids.arxiv).id,
      },
      title: String(value.title || value.display_name || "").trim(),
      year: ZLGIdentity.yearOf(value.publication_year || value.publication_date),
      authors: (value.authorships || []).map(entry => ({
        name: String(entry.author?.display_name || entry.raw_author_name || "").trim(),
        externalId: openAlexID(entry.author?.id),
      })).filter(author => author.name),
      venue: String(value.primary_location?.source?.display_name || "").trim(),
      type: String(value.type || "unknown"),
      citationCount: Number.isFinite(Number(value.cited_by_count)) ? Number(value.cited_by_count) : null,
      isRetracted: Boolean(value.is_retracted),
      openAccess: {
        isOA: Boolean(value.open_access?.is_oa),
        url: value.open_access?.oa_url || value.primary_location?.landing_page_url || null,
      },
      abstract: invertAbstract(value.abstract_inverted_index),
      referencedExternalIds: (value.referenced_works || []).map(openAlexID).filter(Boolean),
      relatedExternalIds: (value.related_works || []).map(openAlexID).filter(Boolean),
      providerUpdatedAt: value.updated_date || null,
      fetchedAt,
    };
  }

  function externalEdge({ provider, sourceExternalId, targetExternalId, type = "cites", fetchedAt, providerPosition = null }) {
    const sourceWorkKey = workKey(provider, sourceExternalId);
    const targetWorkKey = workKey(provider, targetExternalId);
    return {
      edgeKey: `${sourceWorkKey}:${type}:${targetWorkKey}`,
      sourceWorkKey,
      targetWorkKey,
      type,
      provider,
      providerPosition: Number.isInteger(Number(providerPosition)) && Number(providerPosition) > 0
        ? Number(providerPosition)
        : null,
      fetchedAt: fetchedAt || new Date().toISOString(),
    };
  }

  function mergeWorks(values = []) {
    const map = new Map();
    for (const work of values.filter(Boolean)) {
      const existing = map.get(work.workKey);
      map.set(work.workKey, existing ? { ...existing, ...work } : { ...work });
    }
    return [...map.values()];
  }

  function mergeEdges(values = []) {
    const map = new Map();
    for (const edge of values.filter(Boolean)) map.set(edge.edgeKey, edge);
    return [...map.values()];
  }

  function rankCandidates(values = [], connections = new Map(), ranking = {}) {
    const scores = ranking.scores || new Map();
    const bestPositions = ranking.bestPositions || new Map();
    return [...values].sort((left, right) => {
      const leftScore = Number(scores.get(left.workKey));
      const rightScore = Number(scores.get(right.workKey));
      if (Number.isFinite(leftScore) || Number.isFinite(rightScore)) {
        const scoreDelta = (Number.isFinite(rightScore) ? rightScore : -Infinity)
          - (Number.isFinite(leftScore) ? leftScore : -Infinity);
        if (Math.abs(scoreDelta) > 1e-12) return scoreDelta;
        const leftPosition = Number(bestPositions.get(left.workKey)) || Number.MAX_SAFE_INTEGER;
        const rightPosition = Number(bestPositions.get(right.workKey)) || Number.MAX_SAFE_INTEGER;
        if (leftPosition !== rightPosition) return leftPosition - rightPosition;
      }
      const leftConnections = connections.get(left.workKey) || 0;
      const rightConnections = connections.get(right.workKey) || 0;
      if (leftConnections !== rightConnections) return rightConnections - leftConnections;
      const leftCitations = Number(left.citationCount) || 0;
      const rightCitations = Number(right.citationCount) || 0;
      if (leftCitations !== rightCitations) return rightCitations - leftCitations;
      const leftYear = Number(left.year) || 0;
      const rightYear = Number(right.year) || 0;
      if (leftYear !== rightYear) return rightYear - leftYear;
      return left.workKey.localeCompare(right.workKey);
    });
  }

  function filterWorks(values = [], filters = {}) {
    const query = ZLGIdentity.titleFingerprint(filters.query || "");
    const types = new Set(filters.types || []);
    return values.filter(work => {
      if (filters.yearFrom && Number(work.year) < Number(filters.yearFrom)) return false;
      if (filters.yearTo && Number(work.year) > Number(filters.yearTo)) return false;
      if (types.size && !types.has(work.type)) return false;
      if (filters.libraryState === "in" && !work.localKeys?.length) return false;
      if (filters.libraryState === "out" && work.localKeys?.length) return false;
      if (filters.hasPDF === true && !work.hasPDF) return false;
      if (filters.isRetracted === false && work.isRetracted) return false;
      if (query) {
        const haystack = ZLGIdentity.titleFingerprint(`${work.title} ${work.authors?.map(author => author.name).join(" ")} ${work.venue}`);
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function focusGraph(data = {}, options = {}) {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const edges = Array.isArray(data.edges) ? data.edges : [];
    const nodeMap = new Map(nodes.map(node => [node.workKey || `${node.libraryID}:${node.itemKey}`, node]));
    const hidden = new Set(options.hiddenKeys || []);
    const seedKeys = [...new Set(options.seedKeys || [])].filter(key => nodeMap.has(key) && !hidden.has(key));
    const pinnedKeys = [...new Set(options.pinnedKeys || [])].filter(key => nodeMap.has(key) && !hidden.has(key));
    const resultKeys = [...new Set(options.resultKeys || [])].filter(key => nodeMap.has(key) && !hidden.has(key));
    const maxNodes = Math.max(seedKeys.length + pinnedKeys.length, Math.min(Number(options.maxNodes) || 160, 300));
    const maxEdges = Math.max(1, Math.min(Number(options.maxEdges) || 600, 1200));
    const selected = [];
    const selectedSet = new Set();
    const add = key => {
      if (selected.length >= maxNodes || selectedSet.has(key) || !nodeMap.has(key) || hidden.has(key)) return;
      selectedSet.add(key);
      selected.push(key);
    };
    for (const key of seedKeys) add(key);
    for (const key of pinnedKeys) add(key);
    for (const key of resultKeys) add(key);

    // A seed-only or restored session still needs visible context. Add direct
    // neighbours in stable edge order until the rendering budget is reached.
    if (selected.length < maxNodes && !resultKeys.length) {
      for (const edge of edges) {
        const source = edge.sourceWorkKey || `${edge.source?.libraryID}:${edge.source?.itemKey}`;
        const target = edge.targetWorkKey || `${edge.target?.libraryID}:${edge.target?.itemKey}`;
        if (selectedSet.has(source)) add(target);
        if (selectedSet.has(target)) add(source);
        if (selected.length >= maxNodes) break;
      }
    }

    if (!selected.length) {
      for (const key of nodeMap.keys()) add(key);
    }
    const focusedNodes = selected.map(key => nodeMap.get(key));
    const seedSet = new Set(seedKeys);
    const resultSet = new Set(resultKeys);
    const edgeCandidates = edges.map((edge, index) => {
      const source = edge.sourceWorkKey || `${edge.source?.libraryID}:${edge.source?.itemKey}`;
      const target = edge.targetWorkKey || `${edge.target?.libraryID}:${edge.target?.itemKey}`;
      if (!selectedSet.has(source) || !selectedSet.has(target)) return null;
      return {
        edge,
        index,
        seedIncidence: Number(seedSet.has(source)) + Number(seedSet.has(target)),
        resultIncidence: Number(resultSet.has(source)) + Number(resultSet.has(target)),
      };
    }).filter(Boolean);
    if (edgeCandidates.length > maxEdges) {
      edgeCandidates.sort((left, right) => right.seedIncidence - left.seedIncidence
        || right.resultIncidence - left.resultIncidence
        || left.index - right.index);
    }
    const focusedEdges = edgeCandidates.slice(0, maxEdges).map(candidate => candidate.edge);
    const availableNodeCount = nodes.filter(node => !hidden.has(node.workKey || `${node.libraryID}:${node.itemKey}`)).length;
    return {
      ...data,
      nodes: focusedNodes,
      edges: focusedEdges,
      totalNodeCount: nodes.length,
      totalEdgeCount: edges.length,
      graphTruncated: focusedNodes.length < availableNodeCount || focusedEdges.length < edgeCandidates.length,
    };
  }

  function uuid(prefix = "id") {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function createSession(input = {}) {
    const timestamp = input.createdAt || new Date().toISOString();
    return {
      sessionId: String(input.sessionId || uuid("session")),
      name: String(input.name || "未命名探索").trim(),
      collectionScope: input.collectionScope ? { ...input.collectionScope } : null,
      schemaVersion: SESSION_SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: input.updatedAt || timestamp,
      rootSeedLocalKeys: [...new Set(input.rootSeedLocalKeys || [])],
      rootSeedWorkKeys: [...new Set(input.rootSeedWorkKeys || [])],
      activeSeedWorkKeys: [...new Set(input.activeSeedWorkKeys || input.rootSeedWorkKeys || [])],
      activeHopId: input.activeHopId || null,
      hops: Array.isArray(input.hops) ? [...input.hops] : [],
      candidateStates: { ...(input.candidateStates || {}) },
      pinnedWorkKeys: [...new Set(input.pinnedWorkKeys || [])],
      hiddenWorkKeys: [...new Set(input.hiddenWorkKeys || [])],
      filters: { ...(input.filters || {}) },
      layout: { mode: "timeline", positions: {}, ...(input.layout || {}) },
      graphSnapshot: {
        works: Array.isArray(input.graphSnapshot?.works) ? [...input.graphSnapshot.works] : [],
        edges: Array.isArray(input.graphSnapshot?.edges) ? [...input.graphSnapshot.edges] : [],
      },
    };
  }

  function addHop(sessionInput, input = {}) {
    const session = createSession(sessionInput);
    const hop = {
      hopId: String(input.hopId || uuid("hop")),
      parentHopId: input.parentHopId ?? session.activeHopId,
      mode: ["references", "citations", "similar"].includes(input.mode) ? input.mode : "similar",
      seedWorkKeys: [...new Set(input.seedWorkKeys || [])],
      resultWorkKeys: [...new Set(input.resultWorkKeys || [])],
      resultEntries: (input.resultEntries || []).map(entry => ({
        workKey: entry.workKey,
        discovery: entry.discovery ? { ...entry.discovery } : null,
      })).filter(entry => entry.workKey),
      edgeEntries: (input.edgeEntries || []).map(edge => ({ ...edge })),
      resultLimit: [10, 20, 40].includes(Number(input.resultLimit)) ? Number(input.resultLimit) : 20,
      resultTotal: Math.max(0, Number(input.resultTotal) || 0),
      resultTotalScope: input.resultTotalScope || null,
      limitedByProvider: Boolean(input.limitedByProvider),
      rankingApproximate: Boolean(input.rankingApproximate),
      filtersSnapshot: { ...(input.filtersSnapshot || session.filters) },
      createdAt: input.createdAt || new Date().toISOString(),
    };
    session.hops.push(hop);
    session.activeHopId = hop.hopId;
    session.updatedAt = input.createdAt || new Date().toISOString();
    return session;
  }

  function setCandidateState(sessionInput, key, state) {
    const session = createSession(sessionInput);
    if (!CANDIDATE_STATES.has(state)) throw new Error(`Unknown candidate state: ${state}`);
    session.candidateStates[key] = state;
    session.updatedAt = new Date().toISOString();
    return session;
  }

  function validateSession(value) {
    const errors = [];
    if (!value || typeof value !== "object") return ["session must be an object"];
    if (value.schemaVersion !== SESSION_SCHEMA_VERSION) errors.push("unsupported session schemaVersion");
    if (!String(value.sessionId || "").startsWith("session-")) errors.push("invalid sessionId");
    if (!Array.isArray(value.hops)) errors.push("hops must be an array");
    if (value.activeSeedWorkKeys !== undefined && !Array.isArray(value.activeSeedWorkKeys)) errors.push("activeSeedWorkKeys must be an array");
    if (value.graphSnapshot && !Array.isArray(value.graphSnapshot.works)) errors.push("graphSnapshot.works must be an array");
    if (value.graphSnapshot && !Array.isArray(value.graphSnapshot.edges)) errors.push("graphSnapshot.edges must be an array");
    const hopIDs = new Set();
    for (const hop of value.hops || []) {
      if (hopIDs.has(hop.hopId)) errors.push(`duplicate hopId: ${hop.hopId}`);
      hopIDs.add(hop.hopId);
      if (!["references", "citations", "similar"].includes(hop.mode)) errors.push(`invalid hop mode: ${hop.mode}`);
      if (hop.resultEntries !== undefined && !Array.isArray(hop.resultEntries)) errors.push(`invalid resultEntries: ${hop.hopId}`);
      if (hop.edgeEntries !== undefined && !Array.isArray(hop.edgeEntries)) errors.push(`invalid edgeEntries: ${hop.hopId}`);
    }
    for (const [key, state] of Object.entries(value.candidateStates || {})) {
      if (!CANDIDATE_STATES.has(state)) errors.push(`invalid candidate state for ${key}: ${state}`);
    }
    return errors;
  }

  return Object.freeze({
    SESSION_SCHEMA_VERSION,
    CANDIDATE_STATES,
    nowISO,
    openAlexID,
    workKey,
    invertAbstract,
    normalizeOpenAlexWork,
    externalEdge,
    mergeWorks,
    mergeEdges,
    rankCandidates,
    filterWorks,
    focusGraph,
    createSession,
    addHop,
    setCandidateState,
    validateSession,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = ZLGDiscoveryCore;
