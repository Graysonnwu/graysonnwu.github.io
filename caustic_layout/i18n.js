import { english } from "./locales/en.js";

const key = "caustic-optical-language";
const query =
  typeof location === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(location.search);
let current = "zh";
if (typeof document !== "undefined") {
  current =
    query.get("lang") || (navigator.language.startsWith("zh") ? "zh" : "en");
  try {
    current = query.get("lang") || localStorage.getItem(key) || current;
  } catch {}
}
if (!["zh", "en"].includes(current)) current = "zh";
export const language = () => current;
const dictionary = new Map(english),
  pattern = new RegExp(
    [...dictionary.keys()]
      .sort((a, b) => b.length - a.length)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "g",
  );
export function tr(text, locale = current) {
  if (locale !== "en" || !/[\u3400-\u9fff]/.test(text)) return text;
  return text.replace(/\s+/g, " ").replace(pattern, (s) => dictionary.get(s));
}

// Keep the authored text so language changes are reversible. Only changed UI
// nodes are translated; canvas pixels, project names and uploaded filenames are
// left alone. This also covers asynchronous import and tracing messages.
export function initializeI18n() {
  const originals = new WeakMap(),
    attributes = ["title", "aria-label", "alt", "placeholder", "data-label"],
    skip =
      "script, style, code, pre, textarea, [data-user-content], #languageToggle";
  function translateNode(node) {
    const element =
      node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element?.closest || element.closest(skip)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const saved = originals.get(node);
      const original =
        saved && node.data === saved.rendered ? saved.original : node.data;
      const rendered = tr(original);
      originals.set(node, { original, rendered });
      if (node.data !== rendered) node.data = rendered;
    } else {
      let saved = originals.get(node) || {};
      for (const name of attributes) {
        if (!node.hasAttribute(name)) continue;
        const value = node.getAttribute(name),
          old = saved[name];
        const original = old && value === old.rendered ? old.original : value;
        const rendered = tr(original);
        saved[name] = { original, rendered };
        if (value !== rendered) node.setAttribute(name, rendered);
      }
      originals.set(node, saved);
    }
  }
  function walk(root) {
    translateNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) translateNode(walker.currentNode);
  }
  const button = document.getElementById("languageToggle");
  function refresh() {
    document.documentElement.lang = current === "en" ? "en" : "zh-CN";
    document.title = current === "en" ? "Caustic Layout" : "焦散光路";
    button.textContent = current === "en" ? "中文" : "EN";
    button.title = button.ariaLabel =
      current === "en" ? "切换为中文" : "Switch to English";
    walk(document.body);
    window.dispatchEvent(new Event("optical-layout-change"));
  }
  button.onclick = () => {
    current = current === "en" ? "zh" : "en";
    try {
      if (!query.has("test")) localStorage.setItem(key, current);
    } catch {}
    refresh();
  };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach(walk);
      else translateNode(record.target);
    }
  }).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: attributes,
  });
  refresh();
}
