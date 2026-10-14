/* global Zotero, DOMParser, ZLGCore, module */

var ZLGRelationStore = (() => {
  "use strict";

  const NOTE_HEADING = "Zotero Collection Relations data — do not edit manually";
  const WRITES_COMPILED = false;

  function itemEndpoint(item) {
    return ZLGCore.endpoint({
      libraryID: item.libraryID,
      itemKey: item.key,
      doi: item.getField("DOI"),
      title: item.getField("title"),
      date: item.getField("date"),
      version: item.version,
    });
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function serializeStore(store) {
    const errors = ZLGCore.validateStore(store);
    if (errors.length) throw new Error("Invalid relation store: " + errors.join("; "));
    const json = JSON.stringify(store, null, 2);
    return [
      `<div data-zlg-schema="${ZLGCore.SCHEMA}" data-zlg-version="${ZLGCore.SCHEMA_VERSION}">`,
      `<p><strong>${NOTE_HEADING}</strong></p>`,
      `<pre>${escapeHTML(json)}</pre>`,
      "</div>",
    ].join("");
  }

  function parseStore(noteHTML) {
    if (!String(noteHTML || "").includes(`data-zlg-schema="${ZLGCore.SCHEMA}"`)) return null;
    const doc = new DOMParser().parseFromString(String(noteHTML), "text/html");
    const pre = doc.querySelector("[data-zlg-schema] pre");
    if (!pre) throw new Error("Relation store note has no JSON payload");
    const store = JSON.parse(pre.textContent);
    const errors = ZLGCore.validateStore(store);
    if (errors.length) throw new Error("Invalid relation store: " + errors.join("; "));
    return store;
  }

  function isStoreNote(note) {
    return note?.isNote?.()
      && note.getTags().some(tag => tag.tag === ZLGCore.STORE_TAG);
  }

  function getStoreNote(sourceItem) {
    for (const noteID of sourceItem.getNotes()) {
      const note = Zotero.Items.get(noteID);
      if (isStoreNote(note)) return note;
    }
    return null;
  }

  function read(sourceItem) {
    const note = getStoreNote(sourceItem);
    if (!note) return ZLGCore.createStore(itemEndpoint(sourceItem), []);
    return parseStore(note.getNote());
  }

  async function write(sourceItem, store) {
    if (!WRITES_COMPILED) throw new Error("Relation writes are not compiled into this read-only build.");
    const normalized = ZLGCore.createStore(itemEndpoint(sourceItem), store.edges || []);
    normalized.updatedAt = new Date().toISOString();
    const note = getStoreNote(sourceItem) || new Zotero.Item("note");
    if (!note.id) {
      note.libraryID = sourceItem.libraryID;
      note.parentID = sourceItem.id;
      note.addTag(ZLGCore.STORE_TAG, 1);
    }
    note.setNote(serializeStore(normalized));
    await note.saveTx();
    return normalized;
  }

  async function upsert(sourceItem, edgeInput) {
    const store = read(sourceItem);
    const edge = ZLGCore.createEdge(edgeInput);
    const errors = ZLGCore.validateEdge(edge);
    if (errors.length) throw new Error(errors.join("; "));
    const index = store.edges.findIndex(existing => existing.id === edge.id);
    if (index >= 0) store.edges[index] = edge;
    else store.edges.push(edge);
    return write(sourceItem, store);
  }

  async function remove(sourceItem, edgeID) {
    const store = read(sourceItem);
    store.edges = store.edges.filter(edge => edge.id !== edgeID);
    return write(sourceItem, store);
  }

  return Object.freeze({
    NOTE_HEADING,
    WRITES_COMPILED,
    itemEndpoint,
    serializeStore,
    parseStore,
    isStoreNote,
    getStoreNote,
    read,
    write,
    upsert,
    remove,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = ZLGRelationStore;
