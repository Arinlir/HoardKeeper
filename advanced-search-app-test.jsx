// Verifies: the advanced search syntax as it actually reaches the collection
// grid -- typing `t:`, `is:`, `col:` and `cmc<=` in the real search box filters
// the real cards, and the syntax help offers clickable examples.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout, and CardTile's observer-driven bits don't need one.
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

localStorage.setItem("hk-search-scope", "name"); // no network for oracle text

const collections = [{ id: "vault", name: "The Vault", purchasePrice: 0 }];
const cards = [
  { id: "b", name: "Lightning Bolt", set: "2xm", collectorNumber: "129", scryfallId: "sb", quantity: 4, usd: 5, colors: ["R"], cmc: 1, rarity: "uncommon", typeLine: "Instant", collectionId: "vault", added: 3 },
  { id: "s", name: "Sol Ring", set: "ltc", collectorNumber: "59", scryfallId: "ss", quantity: 1, usd: 30, colors: [], cmc: 1, rarity: "uncommon", typeLine: "Artifact", collectionId: "uncategorized", proxy: true, added: 2 },
  { id: "t", name: "Treebeard, Gracious Host", set: "ltr", collectorNumber: "168", scryfallId: "st", quantity: 1, usd: 2, colors: ["G"], cmc: 5, rarity: "rare", typeLine: "Legendary Creature — Treefolk", collectionId: "uncategorized", tags: ["trade"], added: 1 },
];
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections, cards, decks: [] }) }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const box = document.querySelector("input.search-input");
// React 18's delegated input events don't fire under this jsdom harness (mouse
// events do, which is why the buttons below are clicked), so typing goes
// through the input's own onChange the way React would have called it. What's
// under test is the filtering, not React's event plumbing.
const reactProps = Object.keys(box).find((k) => k.startsWith("__reactProps$"));
function setSearch(q) {
  document.querySelector("input.search-input")[reactProps].onChange({ target: { value: q } });
}
const shown = () => {
  const text = document.body.textContent;
  return ["Lightning Bolt", "Sol Ring", "Treebeard"].filter((n) => text.includes(n)).join(",");
};

check("the search box is there", !!box);
check("everything shows to begin with", shown() === "Lightning Bolt,Sol Ring,Treebeard");

await act(async () => setSearch("t:instant"));
check("t: filters by type line", shown() === "Lightning Bolt");

await act(async () => setSearch("is:proxy"));
check("is:proxy finds the proxy", shown() === "Sol Ring");

await act(async () => setSearch("-is:proxy cmc<=1"));
check("negation and a comparison combine", shown() === "Lightning Bolt");

await act(async () => setSearch("col:vault"));
check("col: filters by collection name", shown() === "Lightning Bolt");

await act(async () => setSearch("tag:trade"));
check("tag: finds your own label", shown() === "Treebeard");

await act(async () => setSearch("qty>=4"));
check("qty compares copies", shown() === "Lightning Bolt");

await act(async () => setSearch("c:g or c:r"));
check("or takes either side", shown() === "Lightning Bolt,Treebeard");

await act(async () => setSearch("bolt"));
check("a plain word still just searches names", shown() === "Lightning Bolt");

await act(async () => setSearch(""));
check("clearing brings everything back", shown() === "Lightning Bolt,Sol Ring,Treebeard");

// --- the help panel ---
const helpBtn = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Search syntax help");
check("there's a way to discover the syntax", !!helpBtn);
await act(async () => { helpBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("the help panel lists examples", document.body.textContent.includes("cmc<=3") && document.body.textContent.includes("is:foil"));
const example = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("t:goblin"));
await act(async () => { example.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("clicking an example puts it in the box", document.querySelector("input.search-input").value.includes("t:goblin"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
