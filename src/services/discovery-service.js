if (typeof module !== "undefined" && module.exports) { var ZLGI18n = require("../../ui/i18n.js"); var ZLGT = ZLGI18n.t; }
/* global ZLGDiscoveryCore, ZLGIdentity, ZLGOpenAlexProvider */

var ZLGDiscoveryService = (() => {
  "use strict";

  const CITATION_COUNT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const DISCOVERY_SCORE_VERSION = "zlg-ranking-v2";

  function knownCitationCount(work) {
    if (work?.citationCount === null || work?.citationCount === undefined || work?.citationCount === "") return null;
    const value = Number(work.citationCount);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function sameIdentity(work, seed) {
    if (!work || !seed) return false;
    if (work.workKey && work.workKey === seed.workKey) return true;
    for (const field of ["doi", "pmid", "arxiv"]) {
      const left = String(work.identifiers?.[field] || "").toLowerCase();
      const right = String(seed.identifiers?.[field] || "").toLowerCase();
      if (left && right && left === right) return true;
    }
    const seedLocalKeys = new Set(seed.localKeys || []);
    return (work.localKeys || []).some(key => seedLocalKeys.has(key));
  }

  function providerFailureMessage(error) {
    const message = error?.message || String(error);
    return Number(error?.status) === 429 && error?.retryAfter
      ? ZLGT`${message}；请在 ${error.retryAfter} 秒后重试`
      : message;
  }

  function percentileScores(works = []) {
    const known = works.filter(work => knownCitationCount(work) !== null)
      .sort((left, right) => (knownCitationCount(left) - knownCitationCount(right))
        || left.workKey.localeCompare(right.workKey));
    const scores = new Map(works.map(work => [work.workKey, 0]));
    if (known.length === 1) scores.set(known[0].workKey, 1);
    for (let start = 0; start < known.length;) {
      let end = start + 1;
      while (end < known.length && knownCitationCount(known[end]) === knownCitationCount(known[start])) end++;
      const percentile = known.length <= 1 ? 1 : ((start + end - 1) / 2) / (known.length - 1);
      for (let index = start; index < end; index++) scores.set(known[index].workKey, percentile);
      start = end;
    }
    return scores;
  }

  function scoreDiscoveryCandidates(results = [], mode = "similar", seedWorks = [], scoredAt = new Date().toISOString()) {
    const successfulSeedKeys = [...new Set(results.map(result => result.seed?.workKey).filter(Boolean))].sort();
    const successfulSeedCount = Math.max(1, successfulSeedKeys.length);
    const works = ZLGDiscoveryCore.mergeWorks(results.flatMap(result => result.works || []))
      .filter(work => !seedWorks.some(seed => sameIdentity(work, seed)));
    const evidence = new Map(works.map(work => [work.workKey, new Map()]));
    for (const result of results) {
      const seedKey = result.seed?.workKey;
      if (!seedKey) continue;
      const edgePositions = new Map();
      for (const edge of result.edges || []) {
        const candidateKey = edge.sourceWorkKey === seedKey ? edge.targetWorkKey : edge.sourceWorkKey;
        const position = Number(edge.providerPosition);
        if (Number.isInteger(position) && position > 0) edgePositions.set(candidateKey, position);
      }
      for (const [index, work] of (result.works || []).entries()) {
        if (!evidence.has(work.workKey)) continue;
        const position = edgePositions.get(work.workKey) || index + 1;
        const prior = evidence.get(work.workKey).get(seedKey);
        evidence.get(work.workKey).set(seedKey, prior ? Math.min(prior, position) : position);
      }
    }
    const impactScores = percentileScores(works);
    const scoreYear = new Date(scoredAt).getUTCFullYear() || new Date().getUTCFullYear();
    const scores = new Map();
    const bestPositions = new Map();
    const metadata = new Map();
    for (const work of works) {
      const perSeed = evidence.get(work.workKey) || new Map();
      const triggeredBy = [...perSeed.keys()].sort();
      const positions = [...perSeed.values()];
      const coverage = triggeredBy.length / successfulSeedCount;
      const rankAffinity = (11 / successfulSeedCount)
        * positions.reduce((sum, position) => sum + 1 / (10 + position), 0);
      const impact = impactScores.get(work.workKey) || 0;
      const impactKnown = knownCitationCount(work) !== null;
      const year = Number(work.year);
      const recencyKnown = Number.isFinite(year) && year > 0;
      const age = recencyKnown ? Math.max(0, scoreYear - year) : null;
      const recency = recencyKnown ? Math.exp(-Math.LN2 * age / 5) : 0;
      const scoreWeights = mode === "similar"
        ? { rankAffinity: 0.80, coverage: 0.15, impact: 0.05, recency: 0 }
        : mode === "references"
          ? { rankAffinity: 0, coverage: 0.70, impact: 0.30, recency: 0 }
          : { rankAffinity: 0, coverage: 0.55, impact: 0.25, recency: 0.20 };
      const score = mode === "similar"
        ? 0.80 * rankAffinity + 0.15 * coverage + 0.05 * impact
        : mode === "references"
          ? 0.70 * coverage + 0.30 * impact
          : 0.55 * coverage + 0.25 * impact + 0.20 * recency;
      scores.set(work.workKey, score);
      bestPositions.set(work.workKey, positions.length ? Math.min(...positions) : Number.MAX_SAFE_INTEGER);
      metadata.set(work.workKey, {
        triggeredBy,
        perSeedPositions: Object.fromEntries([...perSeed.entries()].sort()),
        connectionCount: triggeredBy.length,
        score,
        scoreComponents: { coverage, rankAffinity, impact, impactKnown, recency, recencyKnown },
        scoreWeights,
      });
    }
    return { works, scores, bestPositions, metadata, successfulSeedCount, requestedSeedCount: seedWorks.length };
  }

  function zoteroSeedWork(ref) {
    const key = `zotero:${ZLGIdentity.localKey(ref)}`;
    return {
      workKey: key,
      provider: "zotero",
      externalId: ZLGIdentity.localKey(ref),
      identifiers: { doi: ref.doi, pmid: ref.pmid, arxiv: ref.arxivId },
      title: ref.title,
      year: ref.year,
      authors: ref.firstAuthor ? [{ name: ref.firstAuthor }] : [],
      venue: "",
      type: "local-item",
      citationCount: null,
      isRetracted: false,
      openAccess: { isOA: false, url: null },
      localKeys: [ZLGIdentity.localKey(ref)],
      hasPDF: ref.hasPDF,
      collectionIDs: [...(ref.collections || [])],
      matchStatus: "local-only",
      isSeed: true,
    };
  }

  class DiscoveryService {
    constructor({ provider, localIndex, clock = Date }) {
      this.provider = provider || new ZLGOpenAlexProvider.OpenAlexProvider();
      this.localIndex = localIndex || ZLGIdentity.createLocalIndex([]);
      this.clock = clock;
      this.works = new Map();
      this.edges = new Map();
      this.warnings = [];
    }

    hydrate(snapshot = {}) {
      this.rememberWorks(snapshot.works || []);
      this.rememberEdges(snapshot.edges || []);
      this.rememberInternalReferences(snapshot.works || []);
      return this;
    }

    snapshot() {
      return {
        works: [...this.works.values()],
        edges: [...this.edges.values()],
      };
    }

    decorateLocal(work) {
      const match = ZLGIdentity.matchExternal(work, this.localIndex);
      return {
        ...work,
        localKeys: match.localKeys,
        hasPDF: match.matches.some(value => value.hasPDF),
        matchStatus: match.status,
        duplicateCount: match.matches.length,
        collectionIDs: [...new Set(match.matches.flatMap(value => value.collections || []))],
      };
    }

    rememberWorks(works) {
      for (const raw of works || []) {
        const work = raw.provider === "zotero"
          ? {
              ...raw,
              collectionIDs: [...new Set([
                ...(raw.collectionIDs || []),
                ...(raw.localKeys || []).flatMap(key => this.localIndex.byLocalKey.get(key)?.collections || []),
              ])],
            }
          : this.decorateLocal(raw);
        const existing = this.works.get(work.workKey);
        this.works.set(work.workKey, existing ? { ...existing, ...work } : work);
      }
    }

    rememberEdges(edges) {
      for (const edge of edges || []) this.edges.set(edge.edgeKey, edge);
    }

    rememberInternalReferences(works) {
      const ids = new Set(works.filter(work => work.provider === "openalex").map(work => work.externalId));
      const edges = works.filter(work => work.provider === "openalex").flatMap(work => (work.referencedExternalIds || [])
        .filter(id => ids.has(id) && id !== work.externalId)
        .map(id => ZLGDiscoveryCore.externalEdge({ provider: "openalex", sourceExternalId: work.externalId, targetExternalId: id, type: "cites", fetchedAt: work.fetchedAt })));
      this.rememberEdges(edges);
    }

    async resolveSeeds(localRefs, options = {}) {
      const resolved = new Array(localRefs.length);
      const cachedByLocalKey = new Map();
      for (const work of this.works.values()) {
        if (work.provider !== "openalex") continue;
        for (const key of work.localKeys || []) cachedByLocalKey.set(key, work);
      }
      const checkAborted = () => {
        if (!options.signal?.aborted) return;
        const error = new Error(ZLGT("文献集切换已取消"));
        error.name = "AbortError";
        throw error;
      };
      const concurrency = Math.max(1, Math.min(Number(options.concurrency) || 4, 8));
      let cursor = 0;
      const worker = async () => {
        while (cursor < localRefs.length) {
          checkAborted();
          const index = cursor++;
          const ref = localRefs[index];
          let work = null;
          const cached = cachedByLocalKey.get(ZLGIdentity.localKey(ref));
          const sameIdentity = cached && (ref.doi
            ? ZLGIdentity.cleanDOI(cached.identifiers?.doi) === ZLGIdentity.cleanDOI(ref.doi)
            : ZLGIdentity.titleFingerprint(cached.title) === ZLGIdentity.titleFingerprint(ref.title) && (!ref.year || Number(cached.year) === Number(ref.year)));
          try { work = sameIdentity && !options.force ? { ...cached } : await this.provider.resolve(ref, options); }
          catch (error) {
            if (options.signal?.aborted || error.name === "AbortError") throw error;
            if (error.status !== 404) {
              this.warnings.push({
                provider: error.provider || "openalex",
                status: error.status || null,
                message: error.message,
                retryAfter: error.retryAfter || null,
              });
            }
          }
          if (work) {
            work = this.decorateLocal(work);
            const localKey = ZLGIdentity.localKey(ref);
            work.localKeys = [...new Set([...(work.localKeys || []), localKey])];
            work.hasPDF ||= ref.hasPDF;
            work.collectionIDs = [...new Set([...(work.collectionIDs || []), ...(ref.collections || [])])];
            work.isSeed = true;
          }
          else work = zoteroSeedWork(ref);
          resolved[index] = work;
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, localRefs.length) }, worker));
      checkAborted();
      this.rememberWorks(resolved);
      this.rememberInternalReferences(resolved);
      return resolved;
    }

    async refreshCitationCounts(workKeys, options = {}) {
      if (typeof this.provider.getWorks !== "function") {
        return { requestedCount: 0, refreshedCount: 0, skippedCount: 0, works: [] };
      }
      const now = Number(options.now) || Date.now();
      const requestedMaxAge = Number(options.maxAgeMS);
      const maxAgeMS = Number.isFinite(requestedMaxAge) && requestedMaxAge >= 0 ? requestedMaxAge : CITATION_COUNT_MAX_AGE_MS;
      const requested = [...new Set(workKeys || [])].map(key => this.works.get(key)).filter(Boolean);
      const eligible = requested.filter(work => {
        if (work.provider !== "openalex" || !work.externalId) return false;
        if (options.force) return true;
        const fetchedAt = Date.parse(work.fetchedAt || "");
        return !Number.isFinite(fetchedAt) || now - fetchedAt >= maxAgeMS;
      });
      if (!eligible.length) {
        return { requestedCount: requested.length, refreshedCount: 0, skippedCount: requested.length, works: [] };
      }
      const refreshed = await this.provider.getWorks(eligible.map(work => work.externalId), { signal: options.signal });
      this.rememberWorks(refreshed);
      const works = refreshed.map(work => this.works.get(work.workKey)).filter(Boolean);
      return {
        requestedCount: requested.length,
        refreshedCount: works.length,
        skippedCount: Math.max(0, requested.length - eligible.length),
        missingCount: Math.max(0, eligible.length - works.length),
        works,
      };
    }

    async mergedReferenceResults(seeds, options = {}) {
      if (typeof this.provider.getWorks !== "function") return null;
      const allIDs = [...new Set(seeds.flatMap(seed => seed.referencedExternalIds || []))];
      const works = await this.provider.getWorks(allIDs, { signal: options.signal });
      const byID = new Map(works.map(work => [work.externalId, work]));
      return seeds.map(seed => {
        const seedWorks = (seed.referencedExternalIds || []).map(id => byID.get(id)).filter(Boolean);
        const ranked = ZLGDiscoveryCore.rankCandidates(seedWorks);
        const positionByID = new Map(ranked.map((work, index) => [work.externalId, index + 1]));
        return {
          seed,
          works: ranked,
          edges: ranked.map(work => ZLGDiscoveryCore.externalEdge({
            provider: "openalex",
            sourceExternalId: seed.externalId,
            targetExternalId: work.externalId,
            type: "cites",
            fetchedAt: work.fetchedAt,
            providerPosition: positionByID.get(work.externalId),
          })),
          total: seed.referencedExternalIds?.length || 0,
          mode: "references",
          provider: "openalex",
          limitedByProvider: seedWorks.length < (seed.referencedExternalIds?.length || 0),
        };
      });
    }

    async discover({ seedWorkKeys, mode = "similar", limit = 20, signal, concurrency = 2 }) {
      const seedWorks = seedWorkKeys.map(key => this.works.get(key)).filter(Boolean);
      if (!seedWorks.length) throw new Error("No resolvable seed works");
      const eligibleSeeds = seedWorks.filter(seed => seed.provider === "openalex");
      if (!eligibleSeeds.length) throw new Error(ZLGT("所选检索起点尚未匹配到 OpenAlex 作品，无法沿引文网络扩展。"));
      const method = mode === "references" ? "getReferences" : mode === "citations" ? "getCitations" : "getSimilar";
      const slots = Math.max(1, Math.min(Number(concurrency) || 2, 4));
      // Use a fixed discovery pool so 10/20/40 changes only the displayed K,
      // not the evidence pool or score denominator.
      const perSeedLimit = mode === "references" ? limit : 100;
      let resultsByIndex = null;
      const providerErrors = [];
      if (mode === "references") {
        try { resultsByIndex = await this.mergedReferenceResults(eligibleSeeds, { signal }); }
        catch (error) {
          if (signal?.aborted || error?.name === "AbortError") throw error;
          if (Number(error?.status) === 429) throw error;
          providerErrors.push(error);
          this.warnings.push({
            provider: error.provider || "openalex",
            status: error.status || null,
            message: ZLGT`合并参考文献池失败，已回退逐起点获取：${providerFailureMessage(error)}`,
            retryAfter: error.retryAfter || null,
            operation: mode,
          });
        }
      }
      resultsByIndex ||= new Array(eligibleSeeds.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < eligibleSeeds.length) {
          const index = cursor++;
          try {
            if (resultsByIndex[index]) continue;
            const result = await this.provider[method](eligibleSeeds[index], {
              limit: perSeedLimit,
              requestedLimit: limit,
              signal,
              fullPool: mode === "references" || mode === "citations",
            });
            resultsByIndex[index] = { ...result, seed: result.seed || eligibleSeeds[index] };
          }
          catch (error) {
            if (signal?.aborted || error?.name === "AbortError") throw error;
            providerErrors.push(error);
            this.warnings.push({
              provider: error.provider || "openalex",
              status: error.status || null,
              message: providerFailureMessage(error),
              retryAfter: error.retryAfter || null,
              seedWorkKey: eligibleSeeds[index].workKey,
              operation: mode,
            });
          }
        }
      };
      if (resultsByIndex.filter(Boolean).length !== eligibleSeeds.length) {
        await Promise.all(Array.from({ length: Math.min(slots, eligibleSeeds.length) }, worker));
      }
      const results = resultsByIndex.filter(Boolean);
      if (!results.length) {
        const rateLimitError = providerErrors.find(error => Number(error?.status) === 429);
        if (rateLimitError) throw rateLimitError;
        if (providerErrors.length) throw providerErrors[0];
        throw new Error(ZLGT("所选检索起点尚未匹配到 OpenAlex 作品，无法沿引文网络扩展。"));
      }
      const scoredAt = new this.clock().toISOString();
      const decoratedResults = results.map(result => ({
        ...result,
        works: (result.works || []).map(work => this.decorateLocal(work)),
      }));
      const scoring = scoreDiscoveryCandidates(decoratedResults, mode, seedWorks, scoredAt);
      const works = scoring.works;
      const edges = ZLGDiscoveryCore.mergeEdges(results.flatMap(result => result.edges));
      this.rememberWorks(works);
      this.rememberEdges(edges);
      const connections = new Map([...scoring.metadata].map(([key, value]) => [key, value.connectionCount]));
      const ranked = ZLGDiscoveryCore.rankCandidates(
        works.map(work => this.works.get(work.workKey)),
        connections,
        { scores: scoring.scores, bestPositions: scoring.bestPositions },
      ).slice(0, limit).map((work, index) => {
        const candidateScore = scoring.metadata.get(work.workKey);
        const connectionCount = candidateScore?.connectionCount || 0;
        const explanation = mode === "references"
          ? ZLGT`被当前 ${connectionCount} 个检索起点直接引用`
          : mode === "citations"
            ? ZLGT`直接引用当前 ${connectionCount} 个检索起点`
            : ZLGT`由 OpenAlex related_works 推荐，与 ${connectionCount} 个检索起点相连；不代表精确相似度`;
        return {
          ...work,
          discovery: {
            mode,
            connectionCount,
            explanation,
            triggeredBy: candidateScore?.triggeredBy || [],
            perSeedPositions: candidateScore?.perSeedPositions || {},
            rankAtDiscovery: index + 1,
            score: candidateScore?.score || 0,
            scoreComponents: candidateScore?.scoreComponents || {},
            scoreWeights: candidateScore?.scoreWeights || {},
            successfulSeedCount: scoring.successfulSeedCount,
            requestedSeedCount: scoring.requestedSeedCount,
            scoreVersion: DISCOVERY_SCORE_VERSION,
            scoredAt,
          },
        };
      });
      this.rememberWorks(ranked);
      return {
        mode,
        works: ranked,
        edges,
        total: results.length === 1
          ? Math.max(results[0].total || 0, ranked.length)
          : Math.max(works.length, ranked.length),
        totalScope: results.length === 1 ? "provider" : "fetched-unique",
        limitedByProvider: results.some(result => result.limitedByProvider),
        rankingApproximate: mode === "citations" && results.some(result => result.limitedByProvider),
      };
    }

    graphData(session, extra = {}) {
      const hidden = new Set(session.hiddenWorkKeys || []);
      const pinned = new Set(session.pinnedWorkKeys || []);
      const activeHop = (session.hops || []).find(hop => hop.hopId === session.activeHopId);
      const rankingSnapshot = new Map((activeHop?.resultEntries || []).map(entry => [entry.workKey, entry.discovery]));
      const nodes = [...this.works.values()]
        .filter(work => !hidden.has(work.workKey))
        .map(work => {
          const node = { ...work };
          if (activeHop) delete node.discovery;
          if (rankingSnapshot.has(work.workKey)) node.discovery = rankingSnapshot.get(work.workKey);
          node.isPinned = pinned.has(work.workKey);
          node.candidateState = session.candidateStates?.[work.workKey] || null;
          return node;
        });
      const nodeKeys = new Set(nodes.map(work => work.workKey));
      const edgeSnapshot = new Map((activeHop?.edgeEntries || []).map(edge => [edge.edgeKey, edge]));
      const edges = [...this.edges.values()].map(edge => edgeSnapshot.get(edge.edgeKey) || edge).filter(edge => (
        nodeKeys.has(edge.sourceWorkKey) && nodeKeys.has(edge.targetWorkKey)
      ));
      return {
        title: session.name,
        nodes,
        edges,
        session,
        readOnly: true,
        provider: "openalex",
        ...extra,
      };
    }
  }

  return Object.freeze({
    CITATION_COUNT_MAX_AGE_MS, DISCOVERY_SCORE_VERSION, percentileScores, scoreDiscoveryCandidates,
    zoteroSeedWork, DiscoveryService,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = ZLGDiscoveryService;
