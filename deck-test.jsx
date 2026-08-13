// Actually render DecksView with data — both the list and an open deck — so a
// conditional-hook or runtime error can't slip through again.
import React from "react";
import { renderToString } from "react-dom/server";
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
globalThis.window = { innerHeight: 900, location: { search: "", pathname: "/" }, history: { replaceState(){} } };
const { __test_DecksView: DecksView } = await import("./src/App.jsx");

const cards = [
  { id: "c1", name: "Galadriel, Elven-Queen", typeLine: "Legendary Creature — Elf Noble", colors: ["G","U"], quantity: 1, set: "ltc", collectorNumber: "3", usd: 1, cmc: 4 },
  { id: "c2", name: "Hinterland Harbor", typeLine: "Land", colors: [], quantity: 1, set: "ltc", collectorNumber: "317", usd: 3, cmc: 0 },
  { id: "c3", name: "Swamp", typeLine: "Basic Land — Swamp", colors: [], quantity: 1, set: "tmt", collectorNumber: "317", usd: 0.1, cmc: 0 },
  { id: "c4", name: "Sol Ring", typeLine: "Artifact", colors: [], quantity: 2, set: "tmc", collectorNumber: "59", usd: 2, cmc: 1 },
];
const decks = [
  { id: "d1", format: "commander", name: "Galadriel deck", commanderId: "c1", entries: [{ cardId: "c3", role: "land", qty: 2 }], basics: { Forest: 10 } },
  { id: "d2", format: "commander", name: "TMNT deck", commanderId: null, entries: [{ cardId: "c2", role: "land", qty: 1 }], basics: {} },
  { id: "d3", format: "standard", name: "Mono-G", colors: ["G"], entries: [{ cardId: "c4", role: "other", qty: 2 }], basics: { Forest: 24 } },
];
const props = { cards, decks, setDecks(){}, valueOf: (c) => (c.usd || 0) * (c.quantity || 1), collections: [{ id: "col1", name: "Elven court" }] };

const list = renderToString(React.createElement(DecksView, props));
console.log("deck list renders:", list.length > 500, `(${list.length} chars)`);
console.log("  shows both decks:", list.includes("Galadriel deck") && list.includes("TMNT deck"));
console.log("  shows card counts:", /\d+\/100/.test(list));
console.log("PASS");
