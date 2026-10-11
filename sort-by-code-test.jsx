// "Set + collector #" sort: cards ordered by set code first, then by
// collector number within a set -- numerically, not as plain strings, so
// "2" comes before "10" and a trailing letter ("10a") sorts right after its
// base number. Covers both the pure comparator (codeCompare /
// collectorNumberCompare in lib/scryfall.js) and the dropdown wired into
// the actual Collection view.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

// --- pure comparator ---
const { codeCompare, collectorNumberCompare } = await import("./src/lib/scryfall.js");

check("numeric-aware: '9' before '10'", collectorNumberCompare("9", "10") < 0);
check("numeric-aware: '10' before '2' would be wrong -- confirms it's not a string sort", collectorNumberCompare("10", "2") > 0);
check("trailing letter sorts right after its base number: '10' before '10a'", collectorNumberCompare("10", "10a") < 0);
check("'10a' before '11'", collectorNumberCompare("10a", "11") < 0);
check("equal numbers, tiebreak by suffix: '10a' before '10b'", collectorNumberCompare("10a", "10b") < 0);
check("set code takes priority over collector number", codeCompare({ set: "abc", collectorNumber: "999" }, { set: "xyz", collectorNumber: "1" }) < 0);
check("same set: collector number decides", codeCompare({ set: "abc", collectorNumber: "2" }, { set: "abc", collectorNumber: "10" }) < 0);
check("missing/blank collector numbers don't throw", collectorNumberCompare(undefined, "") === 0);

// --- wired into the Collection view ---
const cards = [
  { id: "c1", name: "Card Eleven", set: "abc", collectorNumber: "11", rarity: "common", quantity: 1, usd: 1, collectionId: "uncategorized" },
  { id: "c2", name: "Card Two", set: "abc", collectorNumber: "2", rarity: "common", quantity: 1, usd: 1, collectionId: "uncategorized" },
  { id: "c3", name: "Card Ten-A", set: "abc", collectorNumber: "10a", rarity: "common", quantity: 1, usd: 1, collectionId: "uncategorized" },
  { id: "c4", name: "Card Ten", set: "abc", collectorNumber: "10", rarity: "common", quantity: 1, usd: 1, collectionId: "uncategorized" },
  { id: "c5", name: "Other Set One", set: "zzz", collectorNumber: "1", rarity: "common", quantity: 1, usd: 1, collectionId: "uncategorized" },
];
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

const sortSelect = [...document.querySelectorAll("select")].find((s) =>
  [...s.options].some((o) => o.value === "code")
);
check("'Set + collector #' option exists in the sort dropdown", !!sortSelect);
check("option label is human-readable", sortSelect && [...sortSelect.options].find((o) => o.value === "code").textContent === "Set + collector #");

await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
  setter.call(sortSelect, "code");
  sortSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});

const bodyText = document.body.textContent;
check(
  "cards ordered abc#2, abc#10, abc#10a, abc#11, then zzz#1",
  bodyText.indexOf("Card Two") < bodyText.indexOf("Card Ten") &&
    bodyText.indexOf("Card Ten") < bodyText.indexOf("Card Ten-A") &&
    bodyText.indexOf("Card Ten-A") < bodyText.indexOf("Card Eleven") &&
    bodyText.indexOf("Card Eleven") < bodyText.indexOf("Other Set One")
);

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
