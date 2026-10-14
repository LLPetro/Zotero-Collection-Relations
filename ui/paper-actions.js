if (typeof module !== "undefined" && module.exports) { var ZLGI18n = require("./i18n.js"); var ZLGT = ZLGI18n.t; }
(function (root) {
  "use strict";

  function paperDOI(node) {
    return String(node?.identifiers?.doi || node?.doi || node?.DOI || "").trim()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
      .replace(/^doi:\s*/i, "");
  }

  function paperSourceLinks(node) {
    const links = [];
    const doi = paperDOI(node);
    if (/^10\.\d{4,9}\/[\-._;()/:A-Z0-9]+$/i.test(doi)) {
      links.push({ kind: "doi", label: ZLGT("DOI 来源"), url: `https://doi.org/${encodeURI(doi)}` });
    }

    if (String(node?.provider || "").toLowerCase() === "openalex" && /^W\d+$/i.test(String(node?.externalId || ""))) {
      links.push({ kind: "openalex", label: "OpenAlex", url: `https://openalex.org/${String(node.externalId).toUpperCase()}` });
    }

    const explicit = node?.sourceUrl || node?.sourceURL || node?.openAccess?.url || node?.url;
    if (typeof explicit === "string") {
      try {
        const parsed = new URL(explicit);
        if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !links.some(link => link.url === parsed.href)) {
          links.push({ kind: "source", label: ZLGT("原文链接"), url: parsed.href });
        }
      } catch (_) {
        // Ignore malformed or unsafe source addresses.
      }
    }
    return links;
  }

  const api = { paperDOI, paperSourceLinks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ZLGPaperActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
