"use strict";

const assert = require("node:assert/strict");
global.ZLGIdentity = require("../src/domain/identity-core.js");
global.ZLGDiscoveryCore = require("../src/domain/discovery-core.js");
const { OpenAlexProvider, ProviderError } = require("../src/infrastructure/openalex-provider.js");

assert.equal(ZLGIdentity.cleanDOI(" DOI:10.1002/NAG.3038 "), "10.1002/nag.3038");
assert.deepEqual(ZLGIdentity.cleanArxiv("https://arxiv.org/pdf/2401.01234v2.pdf"), { id: "2401.01234", version: "v2" });
assert.equal(
  ZLGIdentity.titleFingerprint("Methane–hydrate: A Model"),
  "methane hydrate a model",
);

const localIndex = ZLGIdentity.createLocalIndex([
  { libraryID: 1, itemKey: "A", DOI: "10.1/Test", title: "A paper", year: 2020, hasPDF: true },
  { libraryID: 1, itemKey: "B", DOI: "10.1/test", title: "A paper duplicate", year: 2020 },
  { libraryID: 1, itemKey: "C", title: "Title-only paper", year: 2019, firstAuthor: "Smith" },
]);
const duplicateMatch = ZLGIdentity.matchExternal({ doi: "10.1/test", title: "A paper" }, localIndex);
assert.equal(duplicateMatch.status, "duplicate");
assert.deepEqual(duplicateMatch.localKeys, ["1:A", "1:B"]);
const titleMatch = ZLGIdentity.matchExternal({ title: "Title-only paper", year: 2019, authors: [{ name: "Jane Smith" }] }, localIndex);
assert.equal(titleMatch.status, "probable");
assert.deepEqual(titleMatch.localKeys, ["1:C"]);

const openAlexRecord = {
  id: "https://openalex.org/W42",
  doi: "https://doi.org/10.1/TEST",
  title: "Test work",
  publication_year: 2020,
  cited_by_count: 9,
  authorships: [{ author: { id: "https://openalex.org/A1", display_name: "Jane Smith" } }],
  referenced_works: ["https://openalex.org/W1"],
  related_works: ["https://openalex.org/W2"],
  open_access: { is_oa: true, oa_url: "https://example.test/work" },
};
const normalized = ZLGDiscoveryCore.normalizeOpenAlexWork(openAlexRecord, "2026-08-22T00:00:00Z");
assert.equal(normalized.workKey, "openalex:W42");
assert.equal(normalized.identifiers.doi, "10.1/test");
assert.deepEqual(normalized.referencedExternalIds, ["W1"]);

let session = ZLGDiscoveryCore.createSession({
  sessionId: "session-test",
  rootSeedLocalKeys: ["1:A"],
  rootSeedWorkKeys: ["openalex:W42"],
  createdAt: "2026-08-22T00:00:00Z",
});
assert.deepEqual(session.activeSeedWorkKeys, session.rootSeedWorkKeys, "new sessions should restore the current seed set");
session = ZLGDiscoveryCore.addHop(session, {
  hopId: "hop-test",
  mode: "references",
  seedWorkKeys: ["openalex:W42"],
  resultWorkKeys: ["openalex:W1"],
  createdAt: "2026-08-22T00:01:00Z",
});
session = ZLGDiscoveryCore.setCandidateState(session, "openalex:W1", "reading-list");
assert.deepEqual(ZLGDiscoveryCore.validateSession(session), []);
assert.equal(session.activeHopId, "hop-test");

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name] || null },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

const requests = [];
const fixtureWorks = {
  W42: openAlexRecord,
  W1: { id: "https://openalex.org/W1", title: "Reference", publication_year: 2010, cited_by_count: 30 },
  W2: { id: "https://openalex.org/W2", title: "Related", publication_year: 2021, cited_by_count: 3 },
};
const provider = new OpenAlexProvider({
  clock: class extends Date { constructor() { super("2026-08-22T00:00:00Z"); } },
  fetchImpl: async url => {
    requests.push(url);
    const parsed = new URL(url);
    if (parsed.pathname.includes("doi%3A10.1%2Ftest")) return response(200, fixtureWorks.W42);
    if (parsed.pathname.endsWith("/W42")) return response(200, fixtureWorks.W42);
    const filter = parsed.searchParams.get("filter") || "";
    if (filter.startsWith("openalex:")) {
      const ids = filter.slice("openalex:".length).split("|");
      return response(200, { meta: { count: ids.length }, results: ids.map(id => fixtureWorks[id]).filter(Boolean) });
    }
    if (filter === "cites:W42") return response(200, { meta: { count: 1 }, results: [fixtureWorks.W2] });
    return response(404, { error: "missing fixture" });
  },
});

(async () => {
  const resolved = await provider.resolve({ doi: "10.1/test" });
  assert.equal(resolved.externalId, "W42");
  const references = await provider.getReferences(resolved, { limit: 20 });
  assert.equal(references.works[0].externalId, "W1");
  assert.equal(references.edges[0].sourceWorkKey, "openalex:W42");
  assert.equal(references.edges[0].targetWorkKey, "openalex:W1");
  const citations = await provider.getCitations(resolved, { limit: 20 });
  assert.equal(citations.edges[0].sourceWorkKey, "openalex:W2");
  assert.equal(citations.edges[0].targetWorkKey, "openalex:W42");
  const similar = await provider.getSimilar(resolved, { limit: 20 });
  assert.equal(similar.works[0].externalId, "W2");
  assert.equal(similar.edges[0].providerPosition, 1, "related_works ordinal evidence must survive provider normalization");
  assert.equal(similar.limitedByProvider, true);

  const relatedIDs = Array.from({ length: 15 }, (_, index) => `REL${index + 1}`);
  const adequateSimilarProvider = new OpenAlexProvider({
    fetchImpl: async url => {
      const filter = new URL(url).searchParams.get("filter") || "";
      const ids = filter.slice("openalex:".length).split("|");
      return response(200, { results: ids.map(id => ({ id: `https://openalex.org/${id}`, title: id })) });
    },
  });
  const adequateSimilar = await adequateSimilarProvider.getSimilar({ ...resolved, relatedExternalIds: relatedIDs }, {
    limit: 100, requestedLimit: 10,
  });
  assert.equal(adequateSimilar.works.length, 15);
  assert.equal(adequateSimilar.limitedByProvider, false, "an internal evidence pool below 100 must not warn when it satisfies the user's requested K");

  const cursorRequests = [];
  const completeCitationProvider = new OpenAlexProvider({
    fetchImpl: async url => {
      const parsed = new URL(url);
      cursorRequests.push(parsed.searchParams.get("cursor"));
      const secondPage = parsed.searchParams.get("cursor") === "page-2";
      const values = Array.from({ length: secondPage ? 1 : 100 }, (_, index) => {
        const ordinal = secondPage ? 101 : index + 1;
        return { id: `https://openalex.org/CITE${ordinal}`, title: `Citation ${ordinal}`, cited_by_count: 102 - ordinal };
      });
      return response(200, {
        meta: { count: 101, next_cursor: secondPage ? null : "page-2" },
        results: values,
      });
    },
  });
  const completeCitations = await completeCitationProvider.getCitations(resolved, { limit: 100, fullPool: true });
  assert.equal(completeCitations.works.length, 101);
  assert.equal(completeCitations.poolComplete, true);
  assert.equal(completeCitations.limitedByProvider, false);
  assert.deepEqual(cursorRequests, ["*", "page-2"], "complete citation discovery must follow OpenAlex next_cursor until exhaustion");

  const referenceIDs = Array.from({ length: 120 }, (_, index) => `WR${index + 1}`);
  const completeReferenceProvider = new OpenAlexProvider({
    fetchImpl: async url => {
      const filter = new URL(url).searchParams.get("filter") || "";
      const ids = filter.slice("openalex:".length).split("|");
      return response(200, { results: ids.map(id => ({
        id: `https://openalex.org/${id}`,
        title: id,
        cited_by_count: id === "WR101" ? 10000 : Number(id.slice(2)),
      })) });
    },
  });
  const completeReferences = await completeReferenceProvider.getReferences({
    ...resolved,
    referencedExternalIds: referenceIDs,
  }, { limit: 10 });
  assert.ok(completeReferences.works.some(work => work.externalId === "WR101"), "reference #101 must be ranked instead of discarded by prefix truncation");
  assert.equal(completeReferences.limitedByProvider, false);

  const limited = new OpenAlexProvider({ fetchImpl: async () => response(429, { error: "rate" }, { "Retry-After": "5" }) });
  await assert.rejects(
    limited.getWork("W42"),
    error => error instanceof ProviderError && error.status === 429 && error.retryAfter === "5",
  );
  // A service already in use must pick up changed credentials without putting them in URLs.
  let currentKey = "synthetic-test-key-1";
  const credentialRequests = [];
  const dynamicKeyProvider = new OpenAlexProvider({getAPIKey:()=>currentKey,fetchImpl:async(url,options)=>{
    credentialRequests.push({url,authorization:options.headers.Authorization});
    return response(200,openAlexRecord);
  }});
  await dynamicKeyProvider.getWork("W42");
  currentKey = "synthetic-test-key-2";
  await dynamicKeyProvider.getWork("W42");
  currentKey = "";
  await dynamicKeyProvider.getWork("W42");
  assert.deepEqual(credentialRequests.map(value=>value.authorization),["Bearer synthetic-test-key-1","Bearer synthetic-test-key-2",undefined]);
  assert.ok(credentialRequests.every(value=>!value.url.includes("synthetic-test-key") && !new URL(value.url).searchParams.has("api_key")));
  const failingKeyProvider = new OpenAlexProvider({apiKey:"synthetic-redaction-key",fetchImpl:async()=>{throw new Error("echo synthetic-redaction-key");}});
  await assert.rejects(failingKeyProvider.getWork("W42"),error=>!error.message.includes("synthetic-redaction-key") && error.message.includes("[redacted]"));
  const reflectedKeyProvider = new OpenAlexProvider({apiKey:"synthetic-redaction-key",fetchImpl:async()=>response(401,{error:"synthetic-redaction-key"})});
  await assert.rejects(reflectedKeyProvider.getWork("W42"),error=>!error.body.includes("synthetic-redaction-key"));
  assert.ok(requests.length >= 4);
  console.log("discovery.test.js: all assertions passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
