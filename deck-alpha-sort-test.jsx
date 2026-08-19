// Verifies: cards within a deck display alphabetically by name, in both the
// Cards (gallery) view and the Roles view -- not in the order they were
// added to the deck. Commander stays pinned first in the gallery.
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
  { id: "cmd1", name: "Galadriel, Elven-Queen", set: "ltc", collectorNumber: "3", scryfallId: "gala", quantity: 1, usd: 5, colors: ["G", "U"], rarity: "mythic", typeLine: "Legendary Creature", collectionId: "uncategorized", added: 1 },
  // added deliberately in NON-alphabetical order: Zombie, Amulet, Mystic
  { id: "z1", name: "Zombie Apprentice", set: "ltc", collectorNumber: "10", scryfallId: "zomb", quantity: 1, usd: 1, colors: ["B"], rarity: "common", typeLine: "Creature", collectionId: "uncategorized", added: 2 },
  { id: "a1", name: "Amulet of Vigor", set: "ltc", collectorNumber: "11", scryfallId: "amul", quantity: 1, usd: 3, colors: [], rarity: "rare", typeLine: "Artifact", collectionId: "uncategorized", added: 3 },
  { id: "m1", name: "Mystic Sanctuary", set: "ltc", collectorNumber: "12", scryfallId: "myst", quantity: 1, usd: 2, colors: [], rarity: "uncommon", typeLine: "Land", collectionId: "uncategorized", added: 4 },
  // two more creatures, same role as Zombie Apprentice, added in reverse
  // alphabetical order -- this is what actually exercises the within-group sort
  { id: "t1", name: "Treebeard, Gracious Host", set: "ltc", collectorNumber: "13", scryfallId: "tree", quantity: 1, usd: 3, colors: [], rarity: "rare", typeLine: "Creature", collectionId: "uncategorized", added: 5 },
  { id: "b1", name: "Bilbo, Retired Burglar", set: "ltc", collectorNumber: "14", scryfallId: "bilb", quantity: 1, usd: 4, colors: [], rarity: "rare", typeLine: "Creature", collectionId: "uncategorized", added: 6 },
];
const decks = [
  {
    id: "d1", name: "Test deck", format: "commander", commanderId: "cmd1",
    // entries added in the SAME non-alphabetical order (z, a, m) --
    // insertion order is deliberately the opposite of alphabetical order
    entries: [
      { cardId: "z1", qty: 1, role: "creature" },
      { cardId: "t1", qty: 1, role: "creature" },
      { cardId: "b1", qty: 1, role: "creature" },
      { cardId: "a1", qty: 1, role: "ramp" },
      { cardId: "m1", qty: 1, role: "land" },
    ],
    basics: {},
  },
];
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards, decks }) }) });
  if (u.includes("api.scryfall.com/cards/collection"))
    return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
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

const decksTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Decks");
await act(async () => { decksTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const deckCard = [...document.querySelectorAll("div")].find((d) => d.textContent.includes("Test deck") && (d.getAttribute("style") || "").includes("cursor: pointer"));
await act(async () => { deckCard.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

// --- Cards (gallery) view: default view when opening a deck ---
let bodyText = document.body.textContent;
check(
  "Cards view: commander first, then alphabetical (Galadriel, Amulet, Mystic, Zombie)",
  bodyText.indexOf("Galadriel") < bodyText.indexOf("Amulet of Vigor") &&
  bodyText.indexOf("Amulet of Vigor") < bodyText.indexOf("Mystic Sanctuary") &&
  bodyText.indexOf("Mystic Sanctuary") < bodyText.indexOf("Zombie Apprentice")
);

// --- Roles view ---
const rolesBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Roles");
await act(async () => { rolesBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
bodyText = document.body.textContent;
// each card lands in its own role group (creature/ramp/land), so alphabetical
// ordering only needs to be checked within groups that have >1 card -- but we
// can still confirm each individual name renders correctly at minimum
check("Roles view renders every card", bodyText.includes("Zombie Apprentice") && bodyText.includes("Amulet of Vigor") && bodyText.includes("Mystic Sanctuary") && bodyText.includes("Treebeard") && bodyText.includes("Bilbo"));
check(
  "within the shared creature role group, cards sort alphabetically (Bilbo, Treebeard, Zombie) -- not insertion order (Zombie, Treebeard, Bilbo)",
  bodyText.indexOf("Bilbo") < bodyText.indexOf("Treebeard") && bodyText.indexOf("Treebeard") < bodyText.indexOf("Zombie Apprentice")
);

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
