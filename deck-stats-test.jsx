// Verifies: the pure chart-data shaping in deckStats.js, then the three
// features built on top of it end to end — deck tags, the all-decks filter
// box, the Stats tab's three charts, and "set as deck image".
import {
  deckColorCounts,
  coverImageFor,
  deckCategoryCounts,
  deckManaCurve,
} from "./src/features/decks/deckStats";
import { analyseManabase, recommendLands } from "./src/features/decks/manabase";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// ---- pure logic -------------------------------------------------------------
const forest = { id: "f1", name: "Forest", typeLine: "Basic Land — Forest", cmc: 0 };
const oneDrop = { id: "s1", name: "Llanowar Elves", typeLine: "Creature", cmc: 1, manaCost: "{G}" };
const fourDrop = { id: "s2", name: "Beast Within", typeLine: "Sorcery", cmc: 4, manaCost: "{2}{G}{G}" };
const cardById = { f1: forest, s1: oneDrop, s2: fourDrop };
const commander = { id: "c1", name: "Commander Card", typeLine: "Legendary Creature", cmc: 3, manaCost: "{2}{G}" };

const deck = {
  format: "commander",
  commanderId: "c1",
  entries: [
    { cardId: "f1", qty: 8, role: "land" },
    { cardId: "s1", qty: 1, role: "ramp" },
    { cardId: "s2", qty: 1, role: "removal" },
  ],
};

const curve = deckManaCurve(deck, cardById, commander);
check("curve has one bucket per mana value 0-6 plus 7+", curve.length === 8);
check("lands are excluded from the curve", curve.find((c) => c.name === "0").Cards === 0);
check("the commander counts toward its own mana value bucket", curve.find((c) => c.name === "3").Cards === 1);
check("a one-drop lands in the 1 bucket", curve.find((c) => c.name === "1").Cards === 1);
check("a four-drop lands in the 4 bucket", curve.find((c) => c.name === "4").Cards === 1);

const cats = deckCategoryCounts(deck, cardById);
check("only categories that actually hold cards are returned", cats.every((c) => c.Cards > 0));
check("lands show up under the Lands category", cats.find((c) => c.name === "Lands")?.Cards === 8);
check("ramp and removal are counted separately", cats.find((c) => c.name === "Ramp")?.Cards === 1 && cats.find((c) => c.name === "Removal")?.Cards === 1);

const colourCounts = deckColorCounts(
  { entries: [{ cardId: "a", qty: 2 }, { cardId: "b", qty: 1 }, { cardId: "l", qty: 5 }] },
  {
    a: { typeLine: "Creature", colors: ["G"] },
    b: { typeLine: "Instant", colors: ["G", "U"] },
    l: { typeLine: "Basic Land - Forest", colors: ["G"] },
  },
  { typeLine: "Legendary Creature", colors: [] },
);
const countOf = (k) => colourCounts.find((r) => r.key === k)?.Cards;
check("a multicolour card counts once for each of its colours", countOf("G") === 3 && countOf("U") === 1);
check("lands are not counted, and colourless cards get their own row", countOf("C") === 1 && !colourCounts.some((r) => r.Cards === 5));

// land-count recommendation counts nonbasic lands that are already in the deck
const plan = analyseManabase({
  cards: [
    { card: { name: "Utility Land", typeLine: "Land", manaCost: "" }, qty: 1 },
    { card: { name: "Bear", typeLine: "Creature", manaCost: "{1}{G}", cmc: 2 }, qty: 4 },
  ],
  basics: { Forest: 10 },
  deckSize: 100,
}).landPlan;
check("land plan counts basics + nonbasic lands together", plan.have === 11 && plan.basics === 10 && plan.nonbasic === 1);
check("recommendation for a 100-card deck is in a sane commander range", plan.recommended >= 30 && plan.recommended <= 45);
check("pricier decks want more lands", recommendLands({ avgMv: 4, cheapRamp: 0, deckSize: 100 }) > recommendLands({ avgMv: 2.5, cheapRamp: 0, deckSize: 100 }));

check("coverImageFor prefers an explicit choice", coverImageFor({ coverCardId: "s1" }, cardById, commander) === oneDrop);
check("coverImageFor falls back to the commander", coverImageFor({}, cardById, commander) === commander);
check("coverImageFor is null for a 60-card deck with neither", coverImageFor({}, cardById, null) === null);

// ---- end to end (DOM) -------------------------------------------------------
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// recharts' ResponsiveContainer (used by the new Stats tab, and by the
// collection's own Analytics panel it borrows styling from) watches its size
// via ResizeObserver, which jsdom doesn't implement. No test has rendered a
// chart under this harness before now, so this is a new gotcha, not a broken
// one: a no-op observer is enough — the panel still renders its title and
// legend text, which is all these checks need.
if (!dom.window.ResizeObserver) {
  dom.window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
globalThis.ResizeObserver = dom.window.ResizeObserver;
// jsdom types text into a controlled input via React's own onChange prop
// rather than a real DOM event — see hoardkeeper_build_env.md's test-harness
// notes on why the delegated input event doesn't fire under this harness.
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });
function typeInto(el, value) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  el[key].onChange({ target: { value } });
}
// Driven through React's own onKeyDown prop rather than a real DOM
// KeyboardEvent — jsdom's input-change polyfill (see the typeInto note above)
// gets tangled up trying to detect a "did this change the input" state on a
// value that was only ever set via the prop, not real user focus/typing.
function pressEnter(el) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  el[key].onKeyDown({ key: "Enter", preventDefault() {} });
}


const liveCards = [
  { id: "cmd1", name: "Ith, Elvish Archdruid", set: "ltc", collectorNumber: "1", scryfallId: "ith", quantity: 1, usd: 5, colors: ["G"], rarity: "mythic", typeLine: "Legendary Creature — Elf Druid", cmc: 3, manaCost: "{2}{G}", imageUrl: "cmd.jpg", collectionId: "uncategorized", added: 1 },
  { id: "forest1", name: "Forest", set: "ltc", collectorNumber: "2", scryfallId: "for1", quantity: 8, usd: 0, colors: [], rarity: "common", typeLine: "Basic Land — Forest", cmc: 0, imageUrl: "forest.jpg", collectionId: "uncategorized", added: 2 },
  { id: "elves1", name: "Elvish Visionary", set: "ltc", collectorNumber: "3", scryfallId: "elv1", quantity: 1, usd: 1, colors: ["G"], rarity: "common", typeLine: "Creature — Elf", cmc: 2, manaCost: "{1}{G}", imageUrl: "visionary.jpg", collectionId: "uncategorized", added: 3 },
  { id: "beast1", name: "Beast Within", set: "ltc", collectorNumber: "4", scryfallId: "bea1", quantity: 1, usd: 1, colors: ["G"], rarity: "uncommon", typeLine: "Sorcery", cmc: 4, manaCost: "{2}{G}{G}", imageUrl: "beast.jpg", collectionId: "uncategorized", added: 4 },
];
const decks = [
  {
    id: "d1", name: "Elf Ramp", format: "commander", commanderId: "cmd1", tags: ["aggro", "tribal"],
    entries: [
      { cardId: "forest1", qty: 8, role: "land" },
      { cardId: "elves1", qty: 1, role: "ramp" },
      { cardId: "beast1", qty: 1, role: "removal" },
    ],
    basics: {},
  },
  { id: "d2", name: "Zombies Only", format: "commander", entries: [], basics: {} },
];
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards: liveCards, decks }) }) });
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

const byText = (tag, text) => [...document.querySelectorAll(tag)].find((el) => el.textContent.trim() === text);
const click = async (el) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };

await click(byText("button", "Decks"));

// --- all-decks filter box ---
check("both decks show with no filter", document.body.textContent.includes("Elf Ramp") && document.body.textContent.includes("Zombies Only"));
const filterInput = document.querySelector('input[aria-label="Filter decks by name or tag"]');
check("the filter box exists", !!filterInput);
await act(async () => { typeInto(filterInput, "tribal"); });
check("filtering by a deck tag keeps the matching deck", document.body.textContent.includes("Elf Ramp"));
check("...and hides the non-matching one", !document.body.textContent.includes("Zombies Only"));
await act(async () => { typeInto(filterInput, "zombies"); });
check("filtering by name works the other way", document.body.textContent.includes("Zombies Only") && !document.body.textContent.includes("Elf Ramp"));
await act(async () => { typeInto(filterInput, ""); });

// --- open the deck, check tags render ---
const deckTile = [...document.querySelectorAll("div")].find((d) => d.textContent.includes("Elf Ramp") && (d.getAttribute("style") || "").includes("cursor: pointer"));
await click(deckTile);
check("deck tags render on the detail page", document.body.textContent.includes("aggro") && document.body.textContent.includes("tribal"));

// add a tag
const tagInput = document.querySelector('input[aria-label="Add a tag"]');
await act(async () => { typeInto(tagInput, "combo"); });
await act(async () => { pressEnter(tagInput); });
check("a new deck tag can be added", document.body.textContent.includes("combo"));

// remove a tag
const removeAggro = document.querySelector('button[aria-label="Remove tag aggro"]');
await click(removeAggro);
check("a deck tag can be removed", !document.body.textContent.includes("aggro"));

// --- Stats tab ---
await click(byText("button", "Stats"));
check("the Stats tab renders the mana curve panel", document.body.textContent.includes("MANA CURVE"));
check("...and the category breakdown panel", document.body.textContent.includes("CATEGORIES"));
check("...and the cards-by-colour panel", document.body.textContent.includes("CARDS BY COLOR"));
check("...and the land-count panel", document.body.textContent.includes("LAND COUNT"));

// --- set as deck image ---
await click(byText("button", "Cards"));
const setCoverBtn = document.querySelector('button[aria-label="Use Beast Within as this deck\'s image"]');
check("the set-as-deck-image button exists on a card tile", !!setCoverBtn);
await click(setCoverBtn);
await click(byText("button", "← ALL DECKS"));
const elfTile = [...document.querySelectorAll("div")].find((d) => d.textContent.includes("Elf Ramp") && (d.getAttribute("style") || "").includes("cursor: pointer"));
const tileImg = elfTile.querySelector("img");
check("the gallery tile now shows the chosen card's art, not the commander's", tileImg?.getAttribute("src") === "beast.jpg");

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
