"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function adapter(items, attachments, open) {
  return vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../src/integrations/zotero-adapter.js"), "utf8") + "\nZLGZoteroAdapter;",
    { ZLGT: require("../ui/i18n.js").t, Zotero: { Items: {
      getByLibraryAndKey: (library, key) => items.get(`${library}:${key}`),
      get: id => attachments.get(id),
    }, Reader: { open } } },
  );
}

function item(ids) {
  return { isRegularItem: () => true, getAttachments: () => ids };
}

function pdf(id, exists, isFile = true) {
  return { id, attachmentContentType: "application/pdf", isFileAttachment: () => isFile, fileExists: async () => exists };
}

test("opens an available PDF across duplicate local records, skipping missing files and URL attachments", async () => {
  const opened = [];
  const linkedURL = pdf(2, true, false);
  linkedURL.fileExists = () => { throw new Error("must not inspect linked URL as a file"); };
  const value = adapter(
    new Map([["1:FIRST", item([1, 2])], ["1:SECOND", item([3])]]),
    new Map([[1, pdf(1, false)], [2, linkedURL], [3, pdf(3, true)]]),
    async id => opened.push(id),
  );
  assert.equal(await value.openLocalPDF(["1:FIRST", "1:SECOND"]), true);
  assert.deepEqual(opened, [3]);
});

test("reports an unavailable local PDF without opening a reader", async () => {
  let opened = false;
  const value = adapter(new Map([["1:FIRST", item([1])]]), new Map([[1, pdf(1, false)]]), async () => { opened = true; });
  await assert.rejects(value.openLocalPDF(["1:FIRST"]), /没有可读取的本地 PDF/);
  assert.equal(opened, false);
});

test("propagates reader failure so the UI can offer a retry", async () => {
  const value = adapter(new Map([["1:FIRST", item([1])]]), new Map([[1, pdf(1, true)]]), async () => { throw new Error("reader unavailable"); });
  await assert.rejects(value.openLocalPDF(["1:FIRST"]), /reader unavailable/);
});
