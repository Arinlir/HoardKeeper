// Verifies: the detail view shows a card's real rules text under the price
// (fetched via the same oracle-text infra Decks/Glossary already use), and
// for an art card (no oracle text) shows the artist and signed status
// instead rather than an empty panel.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

const cards = [
  { id: "s1", name: "Sol Ring", set: "ltc", collectorNumber: "59", scryfallId: "sol-ring-1", quantity: 1, usd: 2, colors: [], rarity: "uncommon", typeLine: "Artifact", collectionId: "uncategorized", isArt: false, added: 1 },
  { id: "a1", name: "Hidden Blade", set: "aacr", collectorNumber: "9", scryfallId: "hb-art", quantity: 1, usd: 7, colors: [], rarity: "common", typeLine: "Card", artist: "Jane Artist", collectionId: "uncategorized", isArt: true, signed: true, added: 2 },
];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  if (u.includes("api.scryfall.com/cards/collection")) {
    const body = JSON.parse(opts.body);
    const ids = body.identifiers.map((i) => i.id);
    const data = [];
    if (ids.includes("sol-ring-1")) {
      data.push({ id: "sol-ring-1", oracle_text: "{T}: Add {C}{C}.", type_line: "Artifact", all_parts: [] });
    }
    if (ids.includes("hb-art")) {
      // art series cards genuinely have no oracle text
      data.push({ id: "hb-art", oracle_text: "", type_line: "Card", all_parts: [] });
    }
    return Promise.resolve({ ok: true, json: async () => ({ data }) });
  }
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

const sol = document.querySelector('[data-card-id="s1"]');
await act(async () => { sol.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
check("Sol Ring's real oracle text shown under the price", document.body.textContent.includes("Add {C}{C}"));
check("type line shown too", document.body.textContent.includes("Artifact"));

const backdrop1 = [...document.querySelectorAll("div")].find((d) => (d.getAttribute("style") || "").includes("position: fixed") && (d.getAttribute("style") || "").includes("rgba(10, 11, 13, 0.72)"));
await act(async () => { backdrop1.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const artSubTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().includes("Art Cards"));
if (artSubTab) await act(async () => { artSubTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const art = document.querySelector('[data-card-id="a1"]');
await act(async () => { art.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

check("art card shows artist instead of empty rules text", document.body.textContent.includes("Jane Artist"));
check("art card shows signed status", document.body.textContent.includes("Signed copy"));
check("art card explicitly says no rules text (not a blank confusing panel)", document.body.textContent.includes("no rules text") || document.body.textContent.toLowerCase().includes("art card"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
