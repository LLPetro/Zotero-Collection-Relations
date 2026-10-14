var ZLGCollectionTree = (() => {
  "use strict";
  function index(rows = []) {
    const byID = new Map(rows.map(row => [Number(row.id), row]));
    const children = new Map();
    for (const row of byID.values()) {
      const parent = byID.has(Number(row.parentID)) ? Number(row.parentID) : null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(row);
    }
    return { byID, children };
  }
  function ancestors(rows, id) {
    const { byID } = index(rows), result = [], seen = new Set([Number(id)]);
    let parent = Number(byID.get(Number(id))?.parentID);
    while (byID.has(parent) && !seen.has(parent)) {
      result.push(parent); seen.add(parent); parent = Number(byID.get(parent).parentID);
    }
    return result;
  }
  function searchIDs(rows, query = "") {
    const term = String(query).trim().toLocaleLowerCase();
    if (!term) return null;
    const matches = new Set();
    for (const row of rows) {
      if (!`${row.name} ${row.path || ""}`.toLocaleLowerCase().includes(term)) continue;
      matches.add(Number(row.id));
      for (const parent of ancestors(rows, row.id)) matches.add(parent);
    }
    return matches;
  }
  function searchExpansion(rows, query) {
    const allowed = searchIDs(rows, query), expanded = new Set();
    for (const id of allowed || []) for (const parent of ancestors(rows, id)) expanded.add(parent);
    return expanded;
  }
  function visible(rows = [], expanded = new Set(), query = "") {
    const { children } = index(rows), allowed = searchIDs(rows, query), result = [], seen = new Set();
    const visit = (row, depth, position, size) => {
      const id = Number(row.id);
      if (seen.has(id) || allowed && !allowed.has(id)) return;
      seen.add(id);
      const nested = (children.get(id) || []).filter(child => !allowed || allowed.has(Number(child.id)));
      result.push({ ...row, id, depth, hasChildren: nested.length > 0, expanded: nested.length > 0 && expanded.has(id), position, size });
      if (expanded.has(id)) nested.forEach((child, i) => visit(child, depth + 1, i + 1, nested.length));
    };
    const roots = (children.get(null) || []).filter(row => !allowed || allowed.has(Number(row.id)));
    roots.forEach((row, i) => visit(row, 0, i + 1, roots.length));
    return result;
  }
  return { ancestors, searchExpansion, visible };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ZLGCollectionTree;
