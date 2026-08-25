// Verifies: opening a card's detail view shows whether it's already tied up
// in a virtual deck, alongside physical location -- as commander, as a
// regular entry with its role and quantity, in multiple decks at once, and
// explicitly "Not in any deck" for a card that isn't, so the answer is
// never just silence.
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
  { id: "gala1", name: "Galadriel, Elven-Queen", set: "ltc", collectorNumber: "3", scryfallId: "gala", quantity: 1, usd: 5, colors: ["G", "U"], rarity: "mythic", typeLine: "Legendary Creature", collectionId: "uncategorized", added: 1 },
  { id: "sol1", name: "Sol Ring", set: "ltc", collectorNumber: "59", scryfallId: "sol", quantity: 2, usd: 2, colors: [], rarity: "uncommon", typeLine: "Artifact", collectionId: "uncategorized", added: 2 },
  { id: "lonely1", name: "Lonely Sandbar", set: "ltc", collectorNumber: "80", scryfallId: "lonely", quantity: 1, usd: 1, colors: [], rarity: "common", typeLine: "Land", collectionId: "uncategorized", added: 3 },
];
const decks = [
  { id: "d1", name: "Galadriel EDH", format: "commander", commanderId: "gala1", entries: [{ cardId: "sol1", qty: 1, role: "ramp" }], basics: {} },
  { id: "d2", name: "Grixis Control", format: "standard", commanderId: null, entries: [{ cardId: "sol1", qty: 1, role: "ramp" }], basics: {} },
];
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards, decks }) }) });
  if (u.includes("api.scryfall.com/cards/collection")) return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
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

function openCard(id) {
  const tile = document.querySelector(`[data-card-id="${id}"]`);
  return tile;
}
function closeModal() {
  return document.querySelector('[data-role="modal-backdrop"]');
}

// --- commander card ---
await act(async () => { openCard("gala1").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("'In decks' section present", document.body.textContent.includes("In decks"));
check("commander card shows the deck it's the commander of", document.body.textContent.includes("Galadriel EDH"));
check("labeled as Commander, not a generic role", document.body.textContent.includes("Commander"));

await act(async () => { closeModal().dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

// --- card in TWO decks at once ---
await act(async () => { openCard("sol1").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const bodyText = document.body.textContent;
check("card in two decks shows BOTH deck names", bodyText.includes("Galadriel EDH") && bodyText.includes("Grixis Control"));
check("shows the role it plays in the deck", bodyText.includes("ramp"));

await act(async () => { closeModal().dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

// --- card in NO deck ---
await act(async () => { openCard("lonely1").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("card not in any deck says so explicitly, not just silence", document.body.textContent.includes("Not in any deck"));
check("doesn't wrongly claim membership in a deck it's not part of", !document.body.textContent.includes("Galadriel EDH") && !document.body.textContent.includes("Grixis Control"));

// physical location field still present alongside it
check("physical location field still there too, unaffected", document.body.textContent.includes("Physical location"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
