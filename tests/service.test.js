"use strict";

const assert = require("node:assert/strict");
global.ZLGIdentity = require("../src/domain/identity-core.js");
global.ZLGDiscoveryCore = require("../src/domain/discovery-core.js");
global.ZLGOpenAlexProvider = require("../src/infrastructure/openalex-provider.js");
const { DiscoveryService, percentileScores, scoreDiscoveryCandidates } = require("../src/services/discovery-service.js");

const seed = {
  workKey: "openalex:W1", provider: "openalex", externalId: "W1", identifiers: { doi: "10.1/seed" },
  title: "Seed", year: 2020, authors: [], referencedExternalIds: [], relatedExternalIds: [],
};
const candidate = {
  workKey: "openalex:W2", provider: "openalex", externalId: "W2", identifiers: { doi: "10.1/candidate" },
  title: "Candidate", year: 2021, authors: [], citationCount: 5,
};
const provider = {
  async resolve() { return seed; },
  async getSimilar() {
    return {
      works: [candidate],
      edges: [ZLGDiscoveryCore.externalEdge({ provider: "openalex", sourceExternalId: "W1", targetExternalId: "W2", type: "similar" })],
      total: 1,
      limitedByProvider: true,
    };
  },
};

(async () => {
  const index = ZLGIdentity.createLocalIndex([
    { libraryID: 1, itemKey: "LOCAL1", DOI: "10.1/seed", title: "Seed", year: 2020, hasPDF: true, collections: [10] },
    { libraryID: 1, itemKey: "LOCAL2", DOI: "10.1/candidate", title: "Candidate", year: 2021, collections: [11, 12] },
  ]);
  const service = new DiscoveryService({ provider, localIndex: index });
  const seeds = await service.resolveSeeds(index.refs.slice(0, 1));
  assert.deepEqual(seeds[0].localKeys, ["1:LOCAL1"]);
  assert.deepEqual(seeds[0].collectionIDs, [10]);
  const result = await service.discover({ seedWorkKeys: ["openalex:W1"], mode: "similar", limit: 20 });
  assert.deepEqual(result.works[0].localKeys, ["1:LOCAL2"]);
  assert.deepEqual(result.works[0].collectionIDs, [11, 12]);
  assert.match(result.works[0].discovery.explanation, /OpenAlex related_works/);
  assert.equal(result.works[0].discovery.rankAtDiscovery, 1);
  assert.equal(result.works[0].discovery.scoreVersion, "zlg-ranking-v2");
  assert.deepEqual(result.works[0].discovery.triggeredBy, ["openalex:W1"]);
  const session = ZLGDiscoveryCore.createSession({ name: "Graph", rootSeedWorkKeys: ["openalex:W1"] });
  const data = service.graphData(session);
  assert.equal(data.nodes.length, 2);
  assert.equal(data.edges.length, 1);

  const collectionProvider = {
    async resolve(ref) {
      if (ref.itemKey === "UNRESOLVED") return null;
      return ref.itemKey === "LOCAL1"
        ? { ...seed, referencedExternalIds: ["W1", "W2", "W999"], relatedExternalIds: ["W3"] }
        : { ...candidate, referencedExternalIds: [] };
    },
  };
  const collectionService = new DiscoveryService({ provider: collectionProvider, localIndex: index });
  const collectionWorks = await collectionService.resolveSeeds([...index.refs, { libraryID: 1, itemKey: "UNRESOLVED", title: "No provider record" }]);
  assert.equal(collectionWorks.length, 3, "unresolved collection entries must survive");
  assert.equal(collectionService.edges.size, 1, "only a real internal reference forms an edge");
  const internal = [...collectionService.edges.values()][0];
  assert.equal(internal.sourceWorkKey, "openalex:W1");
  assert.equal(internal.targetWorkKey, "openalex:W2");
  assert.equal(internal.type, "cites");
  const restoredService = new DiscoveryService({ provider: collectionProvider, localIndex: index });
  restoredService.hydrate({ works: collectionWorks, edges: [] });
  assert.equal(restoredService.edges.size, 1, "old snapshots reconstruct references without network calls");

  let active = 0;
  let peak = 0;
  const concurrentProvider = {
    async getSimilar(work) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      if (work.externalId === "W3") throw Object.assign(new Error("transient"), { status: 503 });
      const nextId = `${work.externalId}-candidate`;
      return {
        works: [{ ...candidate, workKey: `openalex:${nextId}`, externalId: nextId }],
        edges: [ZLGDiscoveryCore.externalEdge({
          provider: "openalex", sourceExternalId: work.externalId, targetExternalId: nextId, type: "similar",
        })],
        total: 1,
      };
    },
  };
  const concurrentService = new DiscoveryService({ provider: concurrentProvider, localIndex: index });
  concurrentService.rememberWorks(["W1", "W2", "W3", "W4"].map(externalId => ({
    ...seed, workKey: `openalex:${externalId}`, externalId,
  })));
  const partial = await concurrentService.discover({
    seedWorkKeys: ["openalex:W1", "openalex:W2", "openalex:W3", "openalex:W4"],
    mode: "similar",
    limit: 20,
    concurrency: 2,
  });
  assert.equal(peak, 2, "multi-seed expansion must honor bounded concurrency");
  assert.equal(partial.works.length, 3, "one failed seed must not discard successful seed results");
  assert.equal(partial.totalScope, "fetched-unique");
  assert.equal(partial.total, 3, "multi-seed totals describe the fetched deduplicated pool");
  assert.ok(concurrentService.warnings.some(warning => warning.seedWorkKey === "openalex:W3" && warning.status === 503),
    "successful seed results survive alongside a warning for the failed seed");

  const retryAfterError = Object.assign(new Error("OpenAlex HTTP 429"), {
    provider: "openalex", status: 429, retryAfter: "23", retryable: true,
  });
  const failingSeeds = ["FAIL-A", "FAIL-B", "FAIL-C"].map(externalId => ({
    ...seed, workKey: `openalex:${externalId}`, externalId,
  }));
  const allRateLimitedProvider = {
    async getSimilar() { throw retryAfterError; },
  };
  const allRateLimitedService = new DiscoveryService({ provider: allRateLimitedProvider, localIndex: index });
  allRateLimitedService.rememberWorks(failingSeeds);
  await assert.rejects(
    allRateLimitedService.discover({ seedWorkKeys: failingSeeds.map(work => work.workKey), mode: "similar" }),
    error => error === retryAfterError && error.status === 429 && error.retryAfter === "23",
    "all-rate-limited discovery must surface the original 429 and Retry-After",
  );

  const partialRateLimitService = new DiscoveryService({
    provider: {
      async getSimilar(work) {
        if (work.externalId === "FAIL-A") throw retryAfterError;
        const resultWork = { ...candidate, workKey: "openalex:PARTIAL-RATE", externalId: "PARTIAL-RATE" };
        return {
          works: [resultWork],
          edges: [ZLGDiscoveryCore.externalEdge({
            provider: "openalex", sourceExternalId: work.externalId, targetExternalId: resultWork.externalId, type: "similar",
          })],
          total: 1,
        };
      },
    },
    localIndex: index,
  });
  partialRateLimitService.rememberWorks(failingSeeds.slice(0, 2));
  const partialRateLimitResult = await partialRateLimitService.discover({
    seedWorkKeys: failingSeeds.slice(0, 2).map(work => work.workKey), mode: "similar",
  });
  assert.equal(partialRateLimitResult.works.length, 1, "successful seeds still produce results when another seed is rate-limited");
  assert.equal(partialRateLimitService.warnings[0].status, 429);
  assert.equal(partialRateLimitService.warnings[0].retryAfter, "23");
  assert.match(partialRateLimitService.warnings[0].message, /23 秒后重试/,
    "partial-success warning text must surface Retry-After in the existing UI status path");

  const unavailableError = Object.assign(new Error("OpenAlex HTTP 503"), {
    provider: "openalex", status: 503, retryAfter: "5", retryable: true,
  });
  const mixedFailureService = new DiscoveryService({
    provider: {
      async getSimilar(work) {
        if (work.externalId === "FAIL-A") throw unavailableError;
        throw retryAfterError;
      },
    },
    localIndex: index,
  });
  mixedFailureService.rememberWorks(failingSeeds);
  await assert.rejects(
    mixedFailureService.discover({ seedWorkKeys: failingSeeds.map(work => work.workKey), mode: "similar" }),
    error => error === retryAfterError,
    "when all seeds fail, a 429 must take priority over other provider errors",
  );

  const allFailedService = new DiscoveryService({
    provider: { async getSimilar() { throw unavailableError; } },
    localIndex: index,
  });
  allFailedService.rememberWorks(failingSeeds);
  await assert.rejects(
    allFailedService.discover({ seedWorkKeys: failingSeeds.map(work => work.workKey), mode: "similar" }),
    error => error === unavailableError,
    "all provider failures must surface the actual provider error",
  );

  const unmatchedSeed = {
    ...seed, workKey: "zotero:1:LOCAL-ONLY", provider: "zotero", externalId: "1:LOCAL-ONLY",
  };
  const unmatchedService = new DiscoveryService({ provider, localIndex: index });
  unmatchedService.rememberWorks([unmatchedSeed]);
  await assert.rejects(
    unmatchedService.discover({ seedWorkKeys: [unmatchedSeed.workKey], mode: "similar" }),
    /尚未匹配到 OpenAlex/,
    "locally known seeds with no OpenAlex match must retain the unmatched-seed explanation",
  );

  let referenceFallbackCalls = 0;
  const mergedRateLimitProvider = {
    async getWorks() { throw retryAfterError; },
    async getReferences() { referenceFallbackCalls++; return { works: [], edges: [] }; },
  };
  const mergedRateLimitService = new DiscoveryService({ provider: mergedRateLimitProvider, localIndex: index });
  mergedRateLimitService.rememberWorks([{
    ...seed, workKey: "openalex:REF-RATE-LIMIT", externalId: "REF-RATE-LIMIT", referencedExternalIds: ["R1"],
  }]);
  await assert.rejects(
    mergedRateLimitService.discover({ seedWorkKeys: ["openalex:REF-RATE-LIMIT"], mode: "references" }),
    error => error === retryAfterError,
    "a merged reference-pool 429 must surface without retrying per seed",
  );
  assert.equal(referenceFallbackCalls, 0, "429 from merged reference lookup must not cause duplicate provider requests");

  const rankedCandidates = [
    { ...candidate, workKey: "openalex:RANK1", externalId: "RANK1", citationCount: 0 },
    { ...candidate, workKey: "openalex:RANK2", externalId: "RANK2", citationCount: 100000 },
  ];
  const ordinalProvider = {
    async getSimilar(work) {
      return {
        seed: work,
        works: rankedCandidates,
        edges: rankedCandidates.map((value, index) => ZLGDiscoveryCore.externalEdge({
          provider: "openalex", sourceExternalId: work.externalId, targetExternalId: value.externalId,
          type: "similar", providerPosition: index + 1,
        })),
        total: 2,
      };
    },
  };
  const ordinalService = new DiscoveryService({ provider: ordinalProvider, localIndex: index });
  ordinalService.rememberWorks([seed]);
  const ordinalResult = await ordinalService.discover({ seedWorkKeys: [seed.workKey], mode: "similar", limit: 2 });
  assert.deepEqual(ordinalResult.works.map(work => work.externalId), ["RANK1", "RANK2"], "raw citation count alone must not overturn the first related_works recommendation");

  const secondSeed = { ...seed, workKey: "openalex:W9", externalId: "W9" };
  const seedLeakProvider = {
    async getSimilar(work) {
      const leaked = work.externalId === "W1" ? secondSeed : seed;
      return {
        seed: work,
        works: [leaked, candidate],
        edges: [leaked, candidate].map((value, position) => ZLGDiscoveryCore.externalEdge({
          provider: "openalex", sourceExternalId: work.externalId, targetExternalId: value.externalId,
          type: "similar", providerPosition: position + 1,
        })),
        total: 2,
      };
    },
  };
  const seedLeakService = new DiscoveryService({ provider: seedLeakProvider, localIndex: index });
  seedLeakService.rememberWorks([seed, secondSeed]);
  const noSeedLeak = await seedLeakService.discover({
    seedWorkKeys: [seed.workKey, secondSeed.workKey], mode: "similar", limit: 20,
  });
  assert.deepEqual(noSeedLeak.works.map(work => work.workKey), [candidate.workKey], "active seeds must never leak back into candidate results");
  assert.equal(noSeedLeak.works[0].discovery.connectionCount, 2);

  const missingMetrics = { ...candidate, workKey: "openalex:MISSING", externalId: "MISSING", year: null, citationCount: null };
  const knownMetrics = { ...candidate, workKey: "openalex:KNOWN", externalId: "KNOWN", year: 2020, citationCount: 0 };
  const metricPercentiles = percentileScores([missingMetrics, knownMetrics]);
  assert.equal(metricPercentiles.get(missingMetrics.workKey), 0, "unknown citation counts must not masquerade as a known zero");
  const metricScoring = scoreDiscoveryCandidates([{
    seed,
    works: [missingMetrics, knownMetrics],
    edges: [missingMetrics, knownMetrics].map((work, itemIndex) => ZLGDiscoveryCore.externalEdge({
      provider: "openalex", sourceExternalId: seed.externalId, targetExternalId: work.externalId,
      providerPosition: itemIndex + 1,
    })),
  }], "citations", [seed], "2026-08-26T00:00:00.000Z");
  assert.equal(metricScoring.metadata.get(missingMetrics.workKey).scoreComponents.recency, 0, "unknown year must not receive maximum recency");
  assert.ok(metricScoring.scores.get(knownMetrics.workKey) > metricScoring.scores.get(missingMetrics.workKey));

  const aliasSeed = {
    workKey: "zotero:1:LOCAL-ALIAS", provider: "zotero", externalId: "1:LOCAL-ALIAS",
    identifiers: { doi: "10.1/alias" }, localKeys: ["1:LOCAL-ALIAS"], title: "Alias seed",
  };
  const aliasCandidate = { ...candidate, workKey: "openalex:ALIAS", externalId: "ALIAS", identifiers: { doi: "10.1/alias" } };
  const aliasProvider = {
    async getSimilar(work) {
      return {
        seed: work,
        works: [aliasCandidate, candidate],
        edges: [aliasCandidate, candidate].map((value, itemIndex) => ZLGDiscoveryCore.externalEdge({
          provider: "openalex", sourceExternalId: work.externalId, targetExternalId: value.externalId,
          type: "similar", providerPosition: itemIndex + 1,
        })),
        total: 2,
      };
    },
  };
  const aliasService = new DiscoveryService({ provider: aliasProvider, localIndex: index });
  aliasService.rememberWorks([seed, aliasSeed]);
  const aliasResult = await aliasService.discover({
    seedWorkKeys: [seed.workKey, aliasSeed.workKey], mode: "similar", limit: 20,
  });
  assert.deepEqual(aliasResult.works.map(work => work.workKey), [candidate.workKey], "Zotero-only seed aliases must not leak back as OpenAlex candidates");

  const sharedReference = { ...candidate, workKey: "openalex:SHARED", externalId: "SHARED", citationCount: 0 };
  const referenceSeedA = {
    ...seed, workKey: "openalex:REF-A", externalId: "REF-A",
    referencedExternalIds: [...Array.from({ length: 40 }, (_, value) => `A${value}`), "SHARED"],
  };
  const referenceSeedB = {
    ...seed, workKey: "openalex:REF-B", externalId: "REF-B",
    referencedExternalIds: [...Array.from({ length: 40 }, (_, value) => `B${value}`), "SHARED"],
  };
  const referenceProvider = {
    async getWorks(ids) {
      return ids.map(id => id === "SHARED" ? sharedReference : {
        ...candidate, workKey: `openalex:${id}`, externalId: id, citationCount: 100 + Number(id.slice(1)),
      });
    },
  };
  const referenceService = new DiscoveryService({ provider: referenceProvider, localIndex: index });
  referenceService.rememberWorks([referenceSeedA, referenceSeedB]);
  const completeFusion = await referenceService.discover({
    seedWorkKeys: [referenceSeedA.workKey, referenceSeedB.workKey], mode: "references", limit: 10,
  });
  assert.equal(completeFusion.works[0].workKey, sharedReference.workKey, "a shared reference below each local cutoff must survive complete-pool fusion");

  const sharedCitation = { ...candidate, workKey: "openalex:CITE-SHARED", externalId: "CITE-SHARED", citationCount: 0, year: 2020 };
  const citationSeedA = { ...seed, workKey: "openalex:CITE-A", externalId: "CITE-A" };
  const citationSeedB = { ...seed, workKey: "openalex:CITE-B", externalId: "CITE-B" };
  const citationProvider = {
    async getCitations(work, options) {
      assert.equal(options.fullPool, true, "citation fusion must request the complete provider pool");
      const prefix = work.externalId === "CITE-A" ? "CA" : "CB";
      const uniques = Array.from({ length: 100 }, (_, index) => ({
        ...candidate, workKey: `openalex:${prefix}${index}`, externalId: `${prefix}${index}`,
        citationCount: 1000 - index, year: 2020,
      }));
      const works = [...uniques, sharedCitation];
      return {
        seed: work,
        works,
        edges: works.map((value, index) => ZLGDiscoveryCore.externalEdge({
          provider: "openalex", sourceExternalId: value.externalId, targetExternalId: work.externalId,
          type: "cites", providerPosition: index + 1,
        })),
        total: works.length,
        limitedByProvider: false,
        poolComplete: true,
      };
    },
  };
  const citationService = new DiscoveryService({ provider: citationProvider, localIndex: index });
  citationService.rememberWorks([citationSeedA, citationSeedB]);
  const completeCitationFusion = await citationService.discover({
    seedWorkKeys: [citationSeedA.workKey, citationSeedB.workKey], mode: "citations", limit: 10,
  });
  assert.equal(completeCitationFusion.works[0].workKey, sharedCitation.workKey, "a shared citing work at per-seed position 101 must survive complete-pool fusion");
  assert.equal(completeCitationFusion.rankingApproximate, false);

  const hopSnapshotService = new DiscoveryService({ provider, localIndex: index });
  hopSnapshotService.rememberWorks([seed, { ...candidate, discovery: { rankAtDiscovery: 2 } }]);
  let hopSession = ZLGDiscoveryCore.createSession({ rootSeedWorkKeys: [seed.workKey] });
  hopSession = ZLGDiscoveryCore.addHop(hopSession, {
    hopId: "hop-rank-1", mode: "similar", resultWorkKeys: [candidate.workKey],
    resultEntries: [{ workKey: candidate.workKey, discovery: { rankAtDiscovery: 1, mode: "similar" } }],
    edgeEntries: [{ edgeKey: "rank-edge", sourceWorkKey: seed.workKey, targetWorkKey: candidate.workKey, type: "similar", providerPosition: 1 }],
  });
  hopSession = ZLGDiscoveryCore.addHop(hopSession, {
    hopId: "hop-rank-2", parentHopId: "hop-rank-1", mode: "citations", resultWorkKeys: [candidate.workKey],
    resultEntries: [{ workKey: candidate.workKey, discovery: { rankAtDiscovery: 2, mode: "citations" } }],
    edgeEntries: [{ edgeKey: "rank-edge", sourceWorkKey: seed.workKey, targetWorkKey: candidate.workKey, type: "similar", providerPosition: 2 }],
  });
  hopSnapshotService.rememberEdges([{ edgeKey: "rank-edge", sourceWorkKey: seed.workKey, targetWorkKey: candidate.workKey, type: "similar", providerPosition: 2 }]);
  hopSession.activeHopId = "hop-rank-1";
  const restoredHop = hopSnapshotService.graphData(hopSession);
  assert.equal(restoredHop.nodes.find(work => work.workKey === candidate.workKey).discovery.rankAtDiscovery, 1, "old-hop explanations must come from the hop snapshot");
  assert.equal(restoredHop.edges.find(edge => edge.edgeKey === "rank-edge").providerPosition, 1, "old-hop edge ordinals must come from the hop snapshot");
  const staleCandidate = { ...candidate, workKey: "openalex:STALE-HOP", externalId: "STALE-HOP", discovery: { mode: "similar", rankAtDiscovery: 9 } };
  hopSnapshotService.rememberWorks([staleCandidate]);
  const activeHopView = hopSnapshotService.graphData(hopSession);
  assert.equal(activeHopView.nodes.find(work => work.workKey === staleCandidate.workKey).discovery, undefined, "a pinned or retained node outside the active hop must not display stale discovery reasoning");

  const refreshedIDs = [];
  const refreshProvider = {
    async getWorks(ids) {
      refreshedIDs.push([...ids]);
      return ids.map((externalId, index) => ({
        ...seed,
        workKey: `openalex:${externalId}`,
        externalId,
        citationCount: 100 + index,
        fetchedAt: "2026-08-22T12:00:00.000Z",
        providerUpdatedAt: "2026-08-21T00:00:00.000Z",
      }));
    },
  };
  const refreshService = new DiscoveryService({ provider: refreshProvider, localIndex: index });
  refreshService.rememberWorks([
    { ...seed, workKey: "openalex:W1", externalId: "W1", citationCount: 1, fetchedAt: "2026-07-01T00:00:00.000Z" },
    { ...candidate, workKey: "openalex:W2", externalId: "W2", citationCount: 2, fetchedAt: "2026-08-21T00:00:00.000Z" },
    { workKey: "zotero:1:LOCAL3", provider: "zotero", externalId: "1:LOCAL3", citationCount: null },
  ]);
  const refreshed = await refreshService.refreshCitationCounts(
    ["openalex:W1", "openalex:W2", "zotero:1:LOCAL3"],
    { now: Date.parse("2026-08-22T12:00:00.000Z") },
  );
  assert.deepEqual(refreshedIDs[0], ["W1"], "only stale OpenAlex works should refresh in the background");
  assert.equal(refreshed.refreshedCount, 1);
  assert.equal(refreshed.skippedCount, 2);
  assert.equal(refreshService.works.get("openalex:W1").citationCount, 100);
  const forced = await refreshService.refreshCitationCounts(["openalex:W1", "openalex:W2"], { force: true });
  assert.deepEqual(refreshedIDs[1], ["W1", "W2"], "explicit refresh must ignore the seven-day freshness window");
  assert.equal(forced.refreshedCount, 2);
  const cachedService = new DiscoveryService({provider:{resolve(){throw new Error("cached scope must not fetch");}},localIndex:index});
  cachedService.rememberWorks([seed]);
  const cachedSeeds = await cachedService.resolveSeeds(index.refs.slice(0,1));
  assert.equal(cachedSeeds[0].workKey,seed.workKey,"reopening a cached collection must preserve work identity");
  const cancelled = new AbortController();cancelled.abort();
  await assert.rejects(cachedService.resolveSeeds(index.refs,{signal:cancelled.signal}),{name:"AbortError"});
  const duringAbort = new DiscoveryService({provider:{async resolve(){const e=new Error("cancelled");e.name="AbortError";throw e;}},localIndex:index});
  await assert.rejects(duringAbort.resolveSeeds(index.refs.slice(0,1)),{name:"AbortError"});
  assert.equal(duringAbort.works.size,0,"cancelled scope matching must not turn into local-only fallback data");
  console.log("service.test.js: all assertions passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
