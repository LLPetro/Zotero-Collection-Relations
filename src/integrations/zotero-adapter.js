if (typeof module !== "undefined" && module.exports) { var ZLGI18n = require("../../ui/i18n.js"); var ZLGT = ZLGI18n.t; }
/* global Zotero, ZLGIdentity */

var ZLGZoteroAdapter = (() => {
  "use strict";

  function extraIdentifier(item, name) {
    const extra = String(item.getField("extra") || "");
    const match = extra.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
    return match?.[1]?.trim() || "";
  }

  function firstAuthor(item) {
    const creators = item.getCreators?.() || [];
    const creator = creators.find(value => value.creatorType === "author") || creators[0];
    return creator?.lastName || creator?.name || "";
  }

  function hasPDF(item) {
    for (const id of item.getAttachments?.() || []) {
      const attachment = Zotero.Items.get(id);
      if (attachment?.attachmentContentType === "application/pdf") return true;
    }
    return false;
  }

  function itemToLocalRef(item) {
    return ZLGIdentity.localRef({
      libraryID: item.libraryID,
      itemKey: item.key,
      itemVersion: item.version,
      DOI: item.getField("DOI"),
      PMID: extraIdentifier(item, "PMID"),
      arxivId: extraIdentifier(item, "arXiv"),
      title: item.getField("title"),
      date: item.getField("date"),
      firstAuthor: firstAuthor(item),
      hasPDF: hasPDF(item),
      collections: item.getCollections?.() || [],
    });
  }

  function regularItems(values) {
    return (values || []).filter(item => item?.isRegularItem?.());
  }

  function selectedItems(win = Zotero.getMainWindow()) {
    return regularItems(win?.ZoteroPane?.getSelectedItems?.() || []);
  }

  function directCollectionItems(win = Zotero.getMainWindow()) {
    const collection = win?.ZoteroPane?.getSelectedCollection?.();
    return {
      collection,
      items: regularItems(collection?.getChildItems?.() || []),
    };
  }

  async function allRegularItems(libraryID = Zotero.Libraries.userLibraryID) {
    const search = new Zotero.Search();
    search.libraryID = libraryID;
    search.addCondition("itemType", "isNot", "attachment");
    search.addCondition("itemType", "isNot", "note");
    const ids = await search.search();
    return regularItems(await Zotero.Items.getAsync(ids));
  }

  async function buildLocalIndex(libraryID = Zotero.Libraries.userLibraryID) {
    const items = await allRegularItems(libraryID);
    return ZLGIdentity.createLocalIndex(items.map(itemToLocalRef));
  }

  function seedAudit(items) {
    const refs = regularItems(items).map(itemToLocalRef);
    const doiCounts = new Map();
    for (const ref of refs) if (ref.doi) doiCounts.set(ref.doi, (doiCounts.get(ref.doi) || 0) + 1);
    return {
      refs,
      total: refs.length,
      withDOI: refs.filter(value => value.doi).length,
      withoutIdentifier: refs.filter(value => !value.doi && !value.pmid && !value.arxivId).length,
      duplicateDOIs: [...doiCounts.entries()].filter(([, count]) => count > 1).map(([doi, count]) => ({ doi, count })),
      withPDF: refs.filter(value => value.hasPDF).length,
    };
  }

  function selectLocalKey(key) {
    const [libraryID, itemKey] = String(key || "").split(":");
    const item = Zotero.Items.getByLibraryAndKey(Number(libraryID), itemKey);
    if (item) Zotero.getActiveZoteroPane()?.selectItem(item.id);
  }

  async function openLocalPDF(localKeys = []) {
    for (const key of localKeys) {
      const [libraryID, itemKey] = String(key || "").split(":");
      const item = Zotero.Items.getByLibraryAndKey(Number(libraryID), itemKey);
      if (!item?.isRegularItem?.()) continue;
      const attachments = (item.getAttachments?.() || []).map(id => Zotero.Items.get(id));
      for (const attachment of attachments) {
        if (attachment?.attachmentContentType !== "application/pdf" || !attachment.isFileAttachment()) continue;
        if (!await attachment.fileExists()) continue;
        await Zotero.Reader.open(attachment.id);
        return true;
      }
    }
    throw new Error(ZLGT("没有可读取的本地 PDF；请先在 Zotero 检查附件是否已下载。"));
  }

  function collectionPath(collection) {
    const names = [];
    let current = collection;
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      names.unshift(current.name || ZLGT("未命名 Collection"));
      current = current.parentID ? Zotero.Collections.get(current.parentID) : null;
    }
    return names.join(" / ");
  }

  async function collectionTree(libraryID = Zotero.Libraries.userLibraryID) {
    const roots = await Zotero.Collections.getByLibrary(libraryID);
    const rows = [];
    const walk = collection => {
      const childIDs = collection.getChildCollections?.(true) || [];
      const children = childIDs.map(id => Zotero.Collections.get(id)).filter(Boolean);
      const directItemCount = regularItems(collection.getChildItems?.() || []).length;
      const row = {
        id: collection.id,
        libraryID: collection.libraryID,
        key: collection.key,
        name: collection.name || ZLGT("未命名 Collection"),
        parentID: collection.parentID || null,
        depth: 0,
        path: collectionPath(collection),
        directItemCount,
        recursiveItemCount: directItemCount,
        descendantIDs: [],
      };
      rows.push(row);
      for (const child of children.sort((left, right) => String(left.name).localeCompare(String(right.name)))) {
        const childRow = walk(child);
        childRow.depth = row.depth + 1;
        row.recursiveItemCount += childRow.recursiveItemCount;
        row.descendantIDs.push(childRow.id, ...childRow.descendantIDs);
      }
      return row;
    };
    for (const root of [...roots].sort((left, right) => String(left.name).localeCompare(String(right.name)))) walk(root);
    const byID = new Map(rows.map(row => [row.id, row]));
    for (const row of rows) {
      let depth = 0;
      let parentID = row.parentID;
      while (parentID && byID.has(parentID)) {
        depth++;
        parentID = byID.get(parentID).parentID;
      }
      row.depth = depth;
    }
    return rows;
  }

  function noteText(html) {
    const value = String(html || "");
    try {
      const parsed = new DOMParser().parseFromString(value, "text/html");
      return String(parsed.body?.textContent || "").replace(/\s+/g, " ").trim();
    }
    catch {
      return value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  function localItemDetail(key) {
    const [libraryID, itemKey] = String(key || "").split(":");
    const item = Zotero.Items.getByLibraryAndKey(Number(libraryID), itemKey);
    if (!item?.isRegularItem?.()) return null;
    const creators = item.getCreators?.() || [];
    const authors = creators.map(creator => ({
      name: creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" "),
      creatorType: creator.creatorType || "author",
    })).filter(creator => creator.name);
    const collectionIDs = item.getCollections?.() || [];
    const collections = collectionIDs.map(id => Zotero.Collections.get(id)).filter(Boolean).map(collection => ({
      id: collection.id,
      key: collection.key,
      name: collection.name,
      path: collectionPath(collection),
    }));
    const attachments = (item.getAttachments?.() || []).map(id => Zotero.Items.get(id)).filter(Boolean).map(attachment => ({
      id: attachment.id,
      key: `${attachment.libraryID}:${attachment.key}`,
      title: attachment.getField?.("title") || attachment.attachmentFilename || ZLGT("附件"),
      contentType: attachment.attachmentContentType || "",
      isPDF: attachment.attachmentContentType === "application/pdf",
    }));
    const notes = (item.getNotes?.() || []).map(id => Zotero.Items.get(id)).filter(Boolean).map(note => {
      const text = noteText(note.getNote?.() || "");
      return {
        id: note.id,
        key: `${note.libraryID}:${note.key}`,
        title: note.getNoteTitle?.() || text.slice(0, 80) || ZLGT("未命名笔记"),
        preview: text.slice(0, 360),
      };
    });
    return {
      localKey: key,
      itemType: item.itemType,
      title: item.getField("title") || "",
      authors,
      abstract: item.getField("abstractNote") || "",
      publicationTitle: item.getField("publicationTitle") || item.getField("bookTitle") || "",
      volume: item.getField("volume") || "",
      issue: item.getField("issue") || "",
      pages: item.getField("pages") || "",
      url: item.getField("url") || "",
      collections,
      attachments,
      notes,
    };
  }

  return Object.freeze({
    extraIdentifier,
    firstAuthor,
    hasPDF,
    itemToLocalRef,
    regularItems,
    selectedItems,
    directCollectionItems,
    allRegularItems,
    buildLocalIndex,
    seedAudit,
    selectLocalKey,
    openLocalPDF,
    collectionTree,
    localItemDetail,
  });
})();
