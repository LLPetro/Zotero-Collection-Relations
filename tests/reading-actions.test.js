"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { paperSourceLinks } = require("../ui/paper-actions.js");

test("creates a DOI source URL for a valid DOI", () => {
  assert.deepEqual(paperSourceLinks({ doi: "10.1038/nature12373" }), [
    { kind: "doi", label: "DOI 来源", url: "https://doi.org/10.1038/nature12373" },
  ]);
});

test("reads DOI from normalized provider identifier fields", () => {
  assert.equal(paperSourceLinks({ identifiers: { doi: "10.5555/a/b" } })[0].url, "https://doi.org/10.5555/a/b");
  assert.equal(paperSourceLinks({ DOI: "doi:10.5555/CaseSensitive" })[0].url, "https://doi.org/10.5555/CaseSensitive");
});

test("creates OpenAlex fallback only for provider records with a valid work id", () => {
  assert.equal(paperSourceLinks({ provider: "openalex", externalId: "W2741809807" })[0].url, "https://openalex.org/W2741809807");
  assert.deepEqual(paperSourceLinks({ provider: "crossref", externalId: "W2741809807" }), []);
  assert.deepEqual(paperSourceLinks({ provider: "openalex", externalId: "javascript:alert(1)" }), []);
});

test("accepts explicit HTTP(S) source addresses and rejects unsafe schemes", () => {
  assert.equal(paperSourceLinks({ sourceUrl: "https://example.org/paper" })[0].url, "https://example.org/paper");
  assert.deepEqual(paperSourceLinks({ sourceUrl: "javascript:alert(1)" }), []);
  assert.deepEqual(paperSourceLinks({ sourceUrl: "file:///etc/passwd" }), []);
});

test("supports OpenAlex open-access landing URLs", () => {
  assert.equal(paperSourceLinks({ openAccess: { url: "https://publisher.example/article" } })[0].url, "https://publisher.example/article");
});

test("ignores malformed DOI values", () => {
  assert.deepEqual(paperSourceLinks({ doi: "javascript:alert(1)" }), []);
  assert.deepEqual(paperSourceLinks({ doi: "10.x/bad" }), []);
});
