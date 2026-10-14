/* global ZLGDiscoveryCore, ZLGIdentity, module */

var ZLGOpenAlexProvider = (() => {
  "use strict";

  const WORK_FIELDS = [
    "id", "doi", "title", "display_name", "publication_year", "publication_date", "type",
    "cited_by_count", "is_retracted", "primary_location", "open_access", "authorships", "ids",
    "referenced_works", "related_works", "updated_date",
  ].join(",");

  class ProviderError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = "ZLGProviderError";
      Object.assign(this, details);
    }
  }

  class OpenAlexProvider {
    constructor(options = {}) {
      this.baseURL = options.baseURL || "https://api.openalex.org";
      this.fetchImpl = options.fetchImpl || globalThis.fetch;
      this.apiKey = String(options.apiKey || "").trim();
      this.getAPIKey = options.getAPIKey || (() => this.apiKey);
      this.userAgent = options.userAgent || "zotero-literature-graph";
      this.clock = options.clock || Date;
      if (typeof this.fetchImpl !== "function") throw new Error("fetch implementation is required");
    }

    fetchedAt() {
      return new this.clock().toISOString();
    }

    url(path, params = {}) {
      const url = new URL(path, this.baseURL);
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.set(key, String(value));
      }
      return url.toString();
    }

    async request(path, params = {}, options = {}) {
      const url = this.url(path, params);
      const apiKey = String(this.getAPIKey() || "").trim();
      const redact = value => apiKey ? String(value).replaceAll(apiKey,"[redacted]") : String(value);
      const headers = { Accept:"application/json", "User-Agent":this.userAgent };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      let response;
      try {
        response = await this.fetchImpl(url, {
          signal: options.signal,
          headers,
        });
      }
      catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new ProviderError(`OpenAlex network error: ${redact(error.message)}`, { provider: "openalex", retryable: true });
      }
      const retryAfter = response.headers?.get?.("Retry-After") || null;
      if (!response.ok) {
        let body = "";
        try { body = await response.text(); }
        catch {}
        throw new ProviderError(`OpenAlex HTTP ${response.status}`, {
          provider: "openalex",
          status: response.status,
          retryAfter,
          retryable: response.status === 429 || response.status >= 500,
          body: redact(body).slice(0, 500),
        });
      }
      try {
        return await response.json();
      }
      catch (error) {
        throw new ProviderError(`OpenAlex returned invalid JSON: ${redact(error.message)}`, { provider: "openalex", retryable: true });
      }
    }

    async resolve(identityInput, options = {}) {
      const identity = ZLGIdentity.externalIdentity(identityInput);
      const fetchedAt = this.fetchedAt();
      if (identity.doi) {
        const id = encodeURIComponent(`doi:${identity.doi}`);
        const value = await this.request(`/works/${id}`, { select: WORK_FIELDS }, options);
        return ZLGDiscoveryCore.normalizeOpenAlexWork(value, fetchedAt);
      }
      if (!identity.title) return null;
      const data = await this.request("/works", {
        search: identity.title,
        per_page: 5,
        select: WORK_FIELDS,
      }, options);
      const works = (data.results || []).map(value => ZLGDiscoveryCore.normalizeOpenAlexWork(value, fetchedAt));
      const expected = identity.titleFingerprint;
      const candidates = works.filter(work => {
        if (ZLGIdentity.titleFingerprint(work.title) !== expected) return false;
        if (identity.year && work.year && Math.abs(identity.year - work.year) > 1) return false;
        return true;
      });
      return candidates.length === 1 ? candidates[0] : null;
    }

    async getWork(externalId, options = {}) {
      const id = ZLGDiscoveryCore.openAlexID(externalId);
      const value = await this.request(`/works/${encodeURIComponent(id)}`, { select: WORK_FIELDS }, options);
      return ZLGDiscoveryCore.normalizeOpenAlexWork(value, this.fetchedAt());
    }

    async getWorks(externalIds, options = {}) {
      const ids = [...new Set((externalIds || []).map(ZLGDiscoveryCore.openAlexID).filter(Boolean))];
      const values = [];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const chunk = ids.slice(offset, offset + 100);
        const data = await this.request("/works", {
          filter: `openalex:${chunk.join("|")}`,
          per_page: 100,
          select: WORK_FIELDS,
        }, options);
        values.push(...(data.results || []));
      }
      const fetchedAt = this.fetchedAt();
      return values.map(value => ZLGDiscoveryCore.normalizeOpenAlexWork(value, fetchedAt));
    }

    async getReferences(seedInput, options = {}) {
      const seed = typeof seedInput === "string" ? await this.getWork(seedInput, options) : seedInput;
      const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
      const allIDs = seed.referencedExternalIds || [];
      // OpenAlex does not document referenced_works as an importance-ranked
      // list. Rank the complete reference set instead of an arbitrary prefix.
      const ids = allIDs;
      const works = await this.getWorks(ids, options);
      const completeRanking = ZLGDiscoveryCore.rankCandidates(works);
      const sorted = options.fullPool ? completeRanking : completeRanking.slice(0, limit);
      const selected = new Set(sorted.map(work => work.externalId));
      const edges = ids.filter(id => selected.has(id)).map(id => ZLGDiscoveryCore.externalEdge({
        provider: "openalex",
        sourceExternalId: seed.externalId,
        targetExternalId: id,
        type: "cites",
        fetchedAt: this.fetchedAt(),
        providerPosition: sorted.findIndex(work => work.externalId === id) + 1,
      }));
      return {
        seed,
        works: sorted,
        edges,
        total: allIDs.length,
        mode: "references",
        provider: "openalex",
        limitedByProvider: works.length < allIDs.length,
      };
    }

    async getCitations(seedInput, options = {}) {
      const seed = typeof seedInput === "string" ? await this.getWork(seedInput, options) : seedInput;
      const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
      const fetchedAt = this.fetchedAt();
      const values = [];
      let total = 0;
      let cursor = options.fullPool ? "*" : null;
      do {
        const data = await this.request("/works", {
          filter: `cites:${seed.externalId}`,
          sort: "cited_by_count:desc",
          per_page: options.fullPool ? 100 : limit,
          cursor,
          select: WORK_FIELDS,
        }, options);
        if (!total) total = Number(data.meta?.count) || 0;
        values.push(...(data.results || []));
        if (!options.fullPool || !(data.results || []).length) {
          cursor = null;
          break;
        }
        cursor = data.meta?.next_cursor || null;
      } while (cursor);
      const works = values.map(value => ZLGDiscoveryCore.normalizeOpenAlexWork(value, fetchedAt));
      const edges = works.map((work, index) => ZLGDiscoveryCore.externalEdge({
        provider: "openalex",
        sourceExternalId: work.externalId,
        targetExternalId: seed.externalId,
        type: "cites",
        fetchedAt,
        providerPosition: index + 1,
      }));
      total ||= works.length;
      return {
        seed, works, edges, total, mode: "citations", provider: "openalex",
        limitedByProvider: works.length < total,
        poolComplete: works.length >= total,
        availableCount: works.length,
      };
    }

    async getSimilar(seedInput, options = {}) {
      const seed = typeof seedInput === "string" ? await this.getWork(seedInput, options) : seedInput;
      const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
      const requestedLimit = Math.max(1, Math.min(Number(options.requestedLimit) || limit, 100));
      const ids = (seed.relatedExternalIds || []).slice(0, limit);
      const works = await this.getWorks(ids, options);
      const byID = new Map(works.map(work => [work.externalId, work]));
      const ordered = ids.map(id => byID.get(id)).filter(Boolean);
      const edges = ordered.map((work, index) => ZLGDiscoveryCore.externalEdge({
        provider: "openalex",
        sourceExternalId: seed.externalId,
        targetExternalId: work.externalId,
        type: "similar",
        fetchedAt: this.fetchedAt(),
        // related_works exposes an ordered recommendation list, not a
        // calibrated similarity value. Preserve the ordinal evidence only.
        providerPosition: index + 1,
      }));
      return {
        seed,
        works: ordered,
        edges,
        total: seed.relatedExternalIds?.length || ordered.length,
        mode: "similar",
        provider: "openalex",
        limitedByProvider: ordered.length < requestedLimit,
        poolExhausted: ids.length < limit,
        availableCount: ordered.length,
      };
    }
  }

  return Object.freeze({ WORK_FIELDS, ProviderError, OpenAlexProvider });
})();

if (typeof module !== "undefined" && module.exports) module.exports = ZLGOpenAlexProvider;
