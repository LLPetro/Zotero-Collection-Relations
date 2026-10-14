/* global module */

var ZLGIdentity = (() => {
  "use strict";

  function text(value) {
    return String(value || "").trim();
  }

  function cleanDOI(value) {
    return text(value)
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
      .replace(/^doi:\s*/i, "")
      .toLowerCase();
  }

  function cleanPMID(value) {
    return text(value).replace(/^pmid:\s*/i, "").replace(/\D/g, "");
  }

  function cleanArxiv(value) {
    const normalized = text(value)
      .replace(/^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\//i, "")
      .replace(/\.pdf$/i, "")
      .replace(/^arxiv:\s*/i, "")
      .toLowerCase();
    const match = normalized.match(/^(.+?)(v\d+)?$/i);
    return {
      id: match?.[1] || "",
      version: match?.[2]?.toLowerCase() || null,
    };
  }

  function yearOf(value) {
    const match = text(value).match(/\b(18|19|20|21)\d{2}\b/);
    return match ? Number(match[0]) : null;
  }

  function titleFingerprint(value) {
    return text(value)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[‐‑‒–—―]/g, "-")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function authorFingerprint(value) {
    return titleFingerprint(value).split(" ").filter(Boolean).at(-1) || "";
  }

  function localKey(value) {
    return `${Number(value?.libraryID || 0)}:${text(value?.itemKey || value?.key)}`;
  }

  function localRef(input = {}) {
    const arxiv = cleanArxiv(input.arxivId || input.arxiv || input.arXiv);
    return {
      libraryID: Number(input.libraryID || 0),
      itemKey: text(input.itemKey || input.key),
      itemVersion: Number.isFinite(Number(input.itemVersion ?? input.version))
        ? Number(input.itemVersion ?? input.version)
        : null,
      doi: cleanDOI(input.doi || input.DOI),
      pmid: cleanPMID(input.pmid || input.PMID),
      arxivId: arxiv.id,
      arxivVersion: arxiv.version,
      title: text(input.title),
      titleFingerprint: titleFingerprint(input.title),
      year: yearOf(input.year || input.date),
      firstAuthor: authorFingerprint(input.firstAuthor || input.author),
      hasPDF: Boolean(input.hasPDF),
      collections: Array.isArray(input.collections) ? [...input.collections] : [],
    };
  }

  function externalIdentity(input = {}) {
    const ids = input.identifiers || input.externalIds || {};
    const arxiv = cleanArxiv(ids.arxiv || ids.ArXiv || input.arxivId);
    const authors = Array.isArray(input.authors) ? input.authors : [];
    const firstAuthor = input.firstAuthor || authors[0]?.name || authors[0]?.display_name || "";
    return {
      doi: cleanDOI(ids.doi || ids.DOI || input.doi),
      pmid: cleanPMID(ids.pmid || ids.PMID || input.pmid),
      arxivId: arxiv.id,
      arxivVersion: arxiv.version,
      title: text(input.title || input.display_name),
      titleFingerprint: titleFingerprint(input.title || input.display_name),
      year: yearOf(input.year || input.publication_year || input.date),
      firstAuthor: authorFingerprint(firstAuthor),
    };
  }

  function addIndex(map, key, value) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }

  function createLocalIndex(values = []) {
    const refs = values.map(localRef).filter(value => value.libraryID && value.itemKey);
    const index = {
      refs,
      byLocalKey: new Map(),
      byDOI: new Map(),
      byPMID: new Map(),
      byArxiv: new Map(),
      byTitle: new Map(),
    };
    for (const value of refs) {
      index.byLocalKey.set(localKey(value), value);
      addIndex(index.byDOI, value.doi, value);
      addIndex(index.byPMID, value.pmid, value);
      addIndex(index.byArxiv, value.arxivId, value);
      addIndex(index.byTitle, value.titleFingerprint, value);
    }
    return index;
  }

  function titleCandidates(identity, index) {
    if (!identity.titleFingerprint) return [];
    const exact = index.byTitle.get(identity.titleFingerprint) || [];
    return exact.filter(candidate => {
      if (identity.year && candidate.year && Math.abs(identity.year - candidate.year) > 1) return false;
      if (identity.firstAuthor && candidate.firstAuthor && identity.firstAuthor !== candidate.firstAuthor) return false;
      return true;
    });
  }

  function matchExternal(input, index) {
    const identity = externalIdentity(input);
    const result = (matches, method, status = "exact") => ({
      status: matches.length > 1 ? "duplicate" : status,
      method,
      confidence: status === "exact" ? 1 : 0.86,
      localKeys: matches.map(localKey),
      matches,
    });

    if (identity.doi && index.byDOI.has(identity.doi)) return result(index.byDOI.get(identity.doi), "doi-exact");
    if (identity.pmid && index.byPMID.has(identity.pmid)) return result(index.byPMID.get(identity.pmid), "pmid-exact");
    if (identity.arxivId && index.byArxiv.has(identity.arxivId)) {
      return result(index.byArxiv.get(identity.arxivId), "arxiv-family", "exact-version-family");
    }
    const candidates = titleCandidates(identity, index);
    if (candidates.length === 1) return result(candidates, "title-year-author", "probable");
    if (candidates.length > 1) return result(candidates, "title-year-author", "ambiguous");
    return { status: "unresolved", method: null, confidence: 0, localKeys: [], matches: [] };
  }

  return Object.freeze({
    cleanDOI,
    cleanPMID,
    cleanArxiv,
    yearOf,
    titleFingerprint,
    authorFingerprint,
    localKey,
    localRef,
    externalIdentity,
    createLocalIndex,
    matchExternal,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = ZLGIdentity;

