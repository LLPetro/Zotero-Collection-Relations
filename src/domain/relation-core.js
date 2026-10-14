/* global module */

var ZLGCore = (() => {
  "use strict";

  const SCHEMA = "zotero-literature-graph";
  const SCHEMA_VERSION = 1;
  const STORE_TAG = "_zlg_relation_store";

  const RELATION_TYPES = Object.freeze({
    cites: { label: "引用", symmetric: false, color: "#8b95a7" },
    extends: { label: "扩展自", symmetric: false, color: "#4f7cff" },
    modifies: { label: "修正", symmetric: false, color: "#7357d8" },
    validates: { label: "验证", symmetric: false, color: "#1f9d75" },
    contradicts: { label: "反驳/不支持", symmetric: false, color: "#d85858" },
    comparesWith: { label: "对比", symmetric: true, color: "#d58b31" },
    usesData: { label: "使用数据", symmetric: false, color: "#16a3a3" },
    usesModel: { label: "使用模型", symmetric: false, color: "#376fc8" },
    reviews: { label: "综述", symmetric: false, color: "#8b6d4d" },
    sameMethod: { label: "同方法", symmetric: true, color: "#7b8794" },
  });

  function cleanDOI(value) {
    return String(value || "")
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
      .replace(/^doi:\s*/i, "")
      .toLowerCase();
  }

  function endpoint(input = {}) {
    const yearMatch = String(input.year || input.date || "").match(/\b(19|20)\d{2}\b/);
    return {
      libraryID: Number(input.libraryID || 0),
      itemKey: String(input.itemKey || input.key || "").trim(),
      doi: cleanDOI(input.doi || input.DOI),
      title: String(input.title || "").trim(),
      year: yearMatch ? Number(yearMatch[0]) : null,
      version: Number.isFinite(Number(input.version)) ? Number(input.version) : null,
    };
  }

  function uuid() {
    if (globalThis.crypto?.randomUUID) return "zlg-" + globalThis.crypto.randomUUID();
    const part = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
    return `zlg-${Date.now().toString(36)}-${part()}${part()}-${part()}`;
  }

  function createEdge(input = {}) {
    const now = new Date().toISOString();
    return {
      id: String(input.id || uuid()),
      source: endpoint(input.source),
      target: endpoint(input.target),
      type: RELATION_TYPES[input.type] ? input.type : "cites",
      status: ["candidate", "asserted", "verified", "rejected", "broken", "ambiguous"].includes(input.status)
        ? input.status
        : "asserted",
      provenance: String(input.provenance || "manual"),
      comment: String(input.comment || "").trim(),
      evidence: Array.isArray(input.evidence)
        ? input.evidence.map(normalizeEvidence).filter(Boolean)
        : [],
      createdAt: String(input.createdAt || now),
      updatedAt: String(input.updatedAt || now),
    };
  }

  function normalizeEvidence(value) {
    if (!value || typeof value !== "object") return null;
    const page = Number(value.page);
    return {
      attachmentKey: String(value.attachmentKey || "").trim() || null,
      page: Number.isFinite(page) && page > 0 ? page : null,
      annotationKey: String(value.annotationKey || "").trim() || null,
      locator: String(value.locator || "").trim(),
      quote: String(value.quote || "").trim(),
    };
  }

  function validateEdge(edge) {
    const errors = [];
    if (!edge || typeof edge !== "object") return ["edge must be an object"];
    if (!String(edge.id || "").startsWith("zlg-")) errors.push("invalid edge id");
    if (!RELATION_TYPES[edge.type]) errors.push("unknown relation type");
    for (const side of ["source", "target"]) {
      if (!edge[side]?.libraryID) errors.push(`${side}.libraryID is required`);
      if (!edge[side]?.itemKey) errors.push(`${side}.itemKey is required`);
    }
    if (
      edge.source?.libraryID === edge.target?.libraryID
      && edge.source?.itemKey === edge.target?.itemKey
    ) errors.push("self-relations are not allowed");
    return errors;
  }

  function createStore(source, edges = []) {
    return {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      source: endpoint(source),
      edges: edges.map(createEdge),
      updatedAt: new Date().toISOString(),
    };
  }

  function validateStore(store) {
    const errors = [];
    if (store?.schema !== SCHEMA) errors.push("unknown schema");
    if (store?.schemaVersion !== SCHEMA_VERSION) errors.push("unsupported schema version");
    if (!Array.isArray(store?.edges)) errors.push("edges must be an array");
    else {
      const ids = new Set();
      for (const edge of store.edges) {
        errors.push(...validateEdge(edge).map(error => `${edge?.id || "unknown"}: ${error}`));
        if (ids.has(edge.id)) errors.push(`${edge.id}: duplicate edge id`);
        ids.add(edge.id);
      }
    }
    return errors;
  }

  function edgeTouches(edge, libraryID, itemKey) {
    const match = endpointValue => (
      Number(endpointValue?.libraryID) === Number(libraryID)
      && endpointValue?.itemKey === itemKey
    );
    return match(edge.source) || match(edge.target);
  }

  function edgeOtherEnd(edge, libraryID, itemKey) {
    if (
      Number(edge.source?.libraryID) === Number(libraryID)
      && edge.source?.itemKey === itemKey
    ) return edge.target;
    return edge.source;
  }

  function relationLabel(type) {
    return RELATION_TYPES[type]?.label || type;
  }

  return Object.freeze({
    SCHEMA,
    SCHEMA_VERSION,
    STORE_TAG,
    RELATION_TYPES,
    cleanDOI,
    endpoint,
    createEdge,
    createStore,
    validateEdge,
    validateStore,
    edgeTouches,
    edgeOtherEnd,
    relationLabel,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = ZLGCore;
