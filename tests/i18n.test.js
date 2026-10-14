"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTranslator, resolve, messages, canonicalKey } = require("../ui/i18n.js");

test("auto follows Zotero and unsupported host languages fall back to English", () => {
  assert.equal(resolve("auto", "zh-CN"), "zh-CN");
  assert.equal(resolve("auto", "en-GB"), "en-US");
  assert.equal(resolve("auto", "fr-FR"), "en-US");
  assert.equal(resolve("en-US", "zh-CN"), "en-US");
  assert.equal(canonicalKey("Zotero notes (2)"), "Zotero 笔记（{0}）");
});

test("live templates preserve paper names and use English count grammar", () => {
  const i18n = createTranslator({language:"en-US"});
  const title = "用户文献名称 <b>原文</b>";
  assert.equal(i18n.t`查看论文详情：${title}`, "View paper details: " + title);
  assert.equal(i18n.t(title), title);
  assert.equal(i18n.t`${1} 篇文献`, "1 paper");
  assert.equal(i18n.t`${2} 篇文献`, "2 papers");
  i18n.configure({language:"zh-CN"});
  assert.equal(i18n.t("Selected 2 / 50"), "已选 2 / 50 篇");
  assert.equal(i18n.t("Restored 1 hidden paper."), "已恢复 1 篇隐藏论文。");
  i18n.configure({language:"en-US"});
  assert.equal(i18n.t("被当前 3 个检索起点直接引用"), "Directly cited by 3 starting papers");
});

test("catalog keeps all parameter slots and contains complete English UI text", () => {
  assert.ok(Object.keys(messages).length >= 525);
  for (const [source, target] of Object.entries(messages)) {
    const slots = value => [...new Set([...value.matchAll(/\{(\d+)(?:\||\})/g)].map(match => match[1]))].sort();
    assert.deepEqual(slots(target), slots(source), source);
    if (source !== "简体中文") assert.doesNotMatch(target, /\p{Script=Han}/u, source);
  }
});
