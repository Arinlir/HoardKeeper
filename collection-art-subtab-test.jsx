// Verifies: with a mix of art and non-art cards in one collection, the
// "Cards"/"Art Cards" sub-tabs appear and correctly segregate; a collection
// with NO art cards shows no sub-tabs at all (behaves exactly as before);
// and switching to a collection without art cards while on the Art Cards
// sub-tab resets back to "Cards" instead of showing an empty grid.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

const collections = [
  { id: "ac", name: "Assassins Creed", purchasePrice: 50 },
  { id: "hobbit", name: "Hobbit", purchasePrice: 20 },
];
const cards = [
  { id: "p1", name: "Murder", set: "acr", collectorNumber: "92", quantity: 1, usd: 6, colors: ["B"], rarity: "uncommon", typeLine: "Instant", collectionId: "ac", isArt: false, added: 1 },
  { id: "p2", name: "Shay Cormac", set: "acr", collectorNumber: "73", quantity: 1, usd: 8, colors: ["R"], rarity: "rare", typeLine: "Creature", collectionId: "ac", isArt: false, added: 2 },
  { id: "a1", name: "Hidden Blade", set: "aacr", collectorNumber: "9", quantity: 1, usd: 7, colors: [], rarity: "common", typeLine: "Card", artist: "Jane Artist", collectionId: "ac", isArt: true, added: 3 },
  { id: "h1", name: "Bilbo Baggins", set: "hob", collectorNumber: "1", quantity: 1, usd: 4, colors: ["W"], rarity: "rare", typeLine: "Creature", collectionId: "hobbit", isArt: false, added: 4 },
];
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections, cards }) }) });
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

// default "All" filter mixes both collections -- has art cards somewhere, so sub-tabs should show
check("sub-tabs appear on default view (contains an art card)", document.body.textContent.includes("Art Cards"));
check("default sub-tab is Cards, and art card is hidden from it", !document.querySelector('[data-card-id="a1"]'));
check("non-art cards ARE visible on the default Cards sub-tab", !!document.querySelector('[data-card-id="p1"]') && !!document.querySelector('[data-card-id="p2"]'));

const artSubTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().includes("Art Cards"));
await act(async () => { artSubTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("Art Cards sub-tab shows ONLY the art card", !!document.querySelector('[data-card-id="a1"]') && !document.querySelector('[data-card-id="p1"]') && !document.querySelector('[data-card-id="p2"]'));

// switch to the Hobbit collection, which has no art cards at all
const hobbitChip = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Hobbit"));
await act(async () => { hobbitChip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

check("no sub-tabs shown for a collection with zero art cards", !document.body.textContent.includes("Art Cards"));
check("automatically fell back off the Art Cards sub-tab -- Hobbit's own card is visible", !!document.querySelector('[data-card-id="h1"]'));

// back to Assassins Creed -- sub-tabs should reappear, reset to Cards (not stuck on Art Cards)
const acChip = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Assassins Creed"));
await act(async () => { acChip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

check("sub-tabs reappear for Assassins Creed", document.body.textContent.includes("Art Cards"));
check("reset back to the Cards sub-tab (not stuck showing only the art card)", !!document.querySelector('[data-card-id="p1"]'));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
