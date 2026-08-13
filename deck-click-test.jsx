// Mount DecksView for real and click into a deck — this is the test that would
// have caught the conditional-hook crash.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const { __test_DecksView: DecksView } = await import("./src/App.jsx");

const cards = [
  { id: "c1", name: "Galadriel, Elven-Queen", typeLine: "Legendary Creature — Elf Noble", colors: ["G","U"], quantity: 1, set: "ltc", collectorNumber: "3", usd: 1, cmc: 4 },
  { id: "c2", name: "Hinterland Harbor", typeLine: "Land", colors: [], quantity: 1, set: "ltc", collectorNumber: "317", usd: 3, cmc: 0 },
  { id: "c3", name: "Swamp", typeLine: "Basic Land — Swamp", colors: [], quantity: 1, set: "tmt", collectorNumber: "317", usd: 0.1, cmc: 0 },
  { id: "c4", name: "Sol Ring", typeLine: "Artifact", colors: [], quantity: 2, set: "tmc", collectorNumber: "59", usd: 2, cmc: 1 },
];
let decks = [
  { id: "d1", format: "commander", name: "Galadriel deck", commanderId: "c1", entries: [{ cardId: "c3", role: "land", qty: 2 }], basics: { Forest: 10 } },
  { id: "d2", format: "commander", name: "TMNT deck", commanderId: null, entries: [{ cardId: "c2", role: "land", qty: 1 }], basics: {} },
];

const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.join(" ")); };

const root = createRoot(document.getElementById("root"));
const props = () => ({ cards, decks, setDecks: (f) => { decks = typeof f === "function" ? f(decks) : f; }, valueOf: (c) => (c.usd || 0) * (c.quantity || 1), collections: [] });

await act(async () => { root.render(React.createElement(DecksView, props())); });
console.log("1. deck list mounted:", document.body.textContent.includes("Galadriel deck"));

// click the first deck card to open it
// the card itself, not an ancestor: must mention this deck and no other
const openIt = [...document.querySelectorAll("div")]
  .filter((d) => d.textContent.includes("Galadriel deck") && !d.textContent.includes("TMNT deck"))
  .pop();
await act(async () => { openIt.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const text = document.body.textContent;
console.log("2. deck detail opened:", text.includes("ALL DECKS"));
console.log("3. commander shown:", text.includes("Galadriel, Elven-Queen"));
console.log("4. cards view is default:", text.includes("Forest"));

// switch to the Roles view and check the columns render there
const rolesBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Roles");
await act(async () => { rolesBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const rolesText = document.body.textContent;
console.log("5. roles view columns:", ["Lands","Creatures","Other spells"].filter((x) => rolesText.includes(x)).join(", ") || "NONE");
console.log("   land quota shown:", (rolesText.match(/\d+\/37/) || ["-"])[0]);
console.log("   mana value legend:", rolesText.includes("mana value"));

console.error = origError;
const hookErrors = errors.filter((e) => /hook|Rendered more hooks|Rendered fewer hooks/i.test(e));
console.log("6. hook-order errors:", hookErrors.length === 0 ? "none" : hookErrors[0].slice(0, 120));
const other = errors.filter((e) => !/not wrapped in act/i.test(e));
console.log("7. other console errors:", other.length === 0 ? "none" : other[0].slice(0, 160));
if (hookErrors.length || !text.includes("ALL DECKS")) process.exit(1);
console.log("ALL PASS");
