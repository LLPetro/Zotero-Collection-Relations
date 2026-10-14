/* Shared UI messages. User metadata is never passed through DOM translation. */
var ZLGI18n = (() => {
  "use strict";
  const messages = typeof ZLGMessages !== "undefined" ? ZLGMessages : require("./messages.js");
  const choices = new Set(["auto", "zh-CN", "en-US"]);
  const token = /\{(\d+)(?:\|([^{}|]*)\|([^{}|]*))?\}/g;
  const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reverse = new Map(Object.entries(messages).map(([zh, en]) => [en, zh]));
  let patterns;

  function resolve(language = "auto", hostLocale = "en-US") {
    if (language === "zh-CN" || language === "en-US") return language;
    return /^zh(?:[-_]|$)/i.test(String(hostLocale || "en-US")) ? "zh-CN" : "en-US";
  }

  function fill(pattern, values) {
    return pattern.replace(token, (_, index, one, other) => {
      if (one !== undefined) return Number(values[index]) === 1 ? one : other;
      return String(values[index] ?? "");
    });
  }

  function compile(pattern, zh) {
    let cursor = 0, source = "", indices = [];
    for (const match of pattern.matchAll(token)) {
      source += escape(pattern.slice(cursor, match.index));
      if (match[2] !== undefined) source += `(?:${escape(match[2])}|${escape(match[3])})`;
      else { source += "([\\s\\S]*?)"; indices.push(Number(match[1])); }
      cursor = match.index + match[0].length;
    }
    source += escape(pattern.slice(cursor));
    return { regex: new RegExp("^" + source + "$"), indices, zh };
  }

  function formattedSource(value) {
    if (!patterns) {
      patterns = Object.entries(messages).filter(([zh]) => /\{\d+\}/.test(zh)).sort((a, b) => b[0].replace(/\{\d+\}/g, "").length - a[0].replace(/\{\d+\}/g, "").length)
        .flatMap(([zh, en]) => [compile(zh, zh), compile(en, zh)]);
    }
    for (const pattern of patterns) {
      const match = pattern.regex.exec(value);
      if (!match) continue;
      const values = [];
      pattern.indices.forEach((index, capture) => { values[index] = match[capture + 1]; });
      return { key: pattern.zh, values };
    }
    return null;
  }

  function createTranslator({ language = "zh-CN", hostLocale = "en-US" } = {}) {
    let choice = choices.has(language) ? language : "auto";
    let host = hostLocale;
    const locale = () => resolve(choice, host);
    const translate = (input, ...values) => {
      if (Array.isArray(input) && input.raw) {
        const key = input.map((part, index) => part + (index < values.length ? `{${index}}` : "")).join("");
        return fill(locale() === "en-US" ? messages[key] || key : key, values);
      }
      const text = String(input ?? "");
      const key = Object.hasOwn(messages, text) ? text : reverse.get(text);
      if (key !== undefined) return locale() === "en-US" ? messages[key] : key;
      const formatted = formattedSource(text);
      if (formatted) return fill(locale() === "en-US" ? messages[formatted.key] : formatted.key, formatted.values);
      return text;
    };
    const configure = (next = {}) => {
      if (next.language !== undefined) choice = choices.has(next.language) ? next.language : "auto";
      if (next.hostLocale !== undefined) host = next.hostLocale;
      return locale();
    };
    return { t: translate, locale, configure };
  }

  function canonicalKey(value) {
    const text = String(value ?? "");
    return Object.hasOwn(messages, text) ? text : reverse.get(text) || formattedSource(text)?.key || text;
  }
  const current = createTranslator();
  function localizeDOM(root) {
    const elements = [...root.querySelectorAll("[data-zlg-text], [data-zlg-title], [data-zlg-label], [data-zlg-placeholder]")];
    if (root.matches?.("[data-zlg-text], [data-zlg-title], [data-zlg-label], [data-zlg-placeholder]")) elements.unshift(root);
    for (const element of elements) {
      if (element.hasAttribute("data-zlg-text")) element.textContent = current.t(element.getAttribute("data-zlg-text"));
      for (const [source, target] of [["data-zlg-title", "title"], ["data-zlg-label", "aria-label"], ["data-zlg-placeholder", "placeholder"]]) {
        if (element.hasAttribute(source)) element.setAttribute(target, current.t(element.getAttribute(source)));
      }
    }
  }
  return Object.freeze({ ...current, resolve, createTranslator, localizeDOM, canonicalKey, messages });
})();
function ZLGT(input, ...values) { return ZLGI18n.t(input, ...values); }
if (typeof module !== "undefined" && module.exports) module.exports = ZLGI18n;
