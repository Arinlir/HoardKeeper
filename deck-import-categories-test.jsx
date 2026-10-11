// Regression test for: importing a decklist put every single card into
// "Other spells" instead of splitting it into groups (lands, creatures,
// artifacts, instants, sorceries...) the way every other deckbuilder does.
// matchDecklist() and ImportDeckModal's buildExternals() both hardcoded
// role: "other" on every new entry. Fixed with a new, purely type-line-based
// classifier (importCategoryFor/importCategoryDeclarations in categories.js)
// deliberately separate from draftLogic's classifyRole, which reads oracle
// text for mechanical roles (ramp/removal/draw) the drafter needs and isn't
// available at import time. Along the way, a JSON re-import (Binderwyrm's
// own export format) was silently discarding each card's saved role and the
// deck's own named categories -- that's fixed too, so a saved grouping
// survives an export -> reimport round trip instead of being recomputed.
//
// That fix only changes what a *future* import does -- a deck that was
// already built before importCategoryFor existed has every non-land,
// non-creature card sitting in "other" forever, and nothing about the fix
// above reaches back to reclassify it (confirmed live: an existing deck kept
// showing everything but lands/creatures under one "Other spells" bucket
// even after the fix shipped). splitOtherByType() is the catch-up: a
// "Split Other spells by type" button on the deck page re-files any entry
// still parked in "other" using the same classifier, without touching a
// card in a mechanical role or a category the deck named for itself.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.HTMLElement.prototype.scrollIntoView = function () {};

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });

const {
  __test_importCategoryFor: importCategoryFor,
  __test_importCategoryDeclarations: importCategoryDeclarations,
  __test_parseDecklist: parseDecklist,
  __test_matchDecklist: matchDecklist,
  __test_deckToJson: deckToJson,
  __test_jsonToParsed: jsonToParsed,
  __test_splitOtherByType: splitOtherByType,
} = await import("./src/App.jsx");

// ---- importCategoryFor: pure type-line -> category key -------------------
check("a basic land is 'land'", importCategoryFor("Basic Land — Forest") === "land");
check("a nonbasic land is 'land' too", importCategoryFor("Land") === "land");
check("a plain creature is 'creature'", importCategoryFor("Legendary Creature — Elf Druid") === "creature");
check(
  "an artifact creature is filed with creatures, not artifacts (creature wins the tie)",
  importCategoryFor("Artifact Creature — Golem") === "creature"
);
check("a planeswalker gets its own group", importCategoryFor("Legendary Planeswalker — Elspeth") === "cat-planeswalkers");
check("a battle gets its own group", importCategoryFor("Battle — Siege") === "cat-battles");
check("a plain artifact gets its own group", importCategoryFor("Artifact") === "cat-artifacts");
check("an enchantment gets its own group", importCategoryFor("Enchantment") === "cat-enchantments");
check("an instant gets its own group", importCategoryFor("Instant") === "cat-instants");
check("a sorcery gets its own group", importCategoryFor("Sorcery") === "cat-sorceries");
check("an unrecognized/blank type line falls back to 'other'", importCategoryFor("") === "other");

const decls = importCategoryDeclarations(new Set(["cat-artifacts", "cat-sorceries", "cat-instants"]));
check("declarations only cover the keys actually used", decls.length === 3);
check("artifacts get the label 'Artifacts'", decls.find((d) => d.key === "cat-artifacts")?.label === "Artifacts");
check("sorceries get the label 'Sorceries'", decls.find((d) => d.key === "cat-sorceries")?.label === "Sorceries");
check(
  "an unused key isn't declared even though it's a known category",
  importCategoryDeclarations(new Set(["cat-artifacts"])).every((d) => d.key !== "cat-enchantments")
);

// ---- matchDecklist: a plain-text import splits by type, not "other" ------
const pool = [
  { id: "cmd1", name: "Muldrotha, the Gravetide", set: "c18", collectorNumber: "1", quantity: 1, typeLine: "Legendary Creature — Elemental Horror" },
  { id: "land1", name: "Command Tower", set: "c18", collectorNumber: "300", quantity: 1, typeLine: "Land" },
  { id: "art1", name: "Sol Ring", set: "ltc", collectorNumber: "59", quantity: 1, typeLine: "Artifact" },
  { id: "inst1", name: "Lightning Bolt", set: "2x2", collectorNumber: "117", quantity: 1, typeLine: "Instant" },
  { id: "sorc1", name: "Cultivate", set: "c18", collectorNumber: "179", quantity: 1, typeLine: "Sorcery" },
  { id: "crea1", name: "Llanowar Elves", set: "dom", collectorNumber: "179", quantity: 1, typeLine: "Creature — Elf Druid" },
];
const text = [
  "Commander",
  "1 Muldrotha, the Gravetide",
  "",
  "Deck",
  "1 Command Tower",
  "1 Sol Ring",
  "1 Lightning Bolt",
  "1 Cultivate",
  "1 Llanowar Elves",
].join("\n");
const parsed = parseDecklist(text);
const matched = matchDecklist(parsed, pool, {});
const roleOf = (name) => {
  const rec = pool.find((c) => c.name === name);
  return matched.entries.find((e) => e.cardId === rec.id)?.role;
};
check("nothing landed in 'other' for a list covering every basic type", matched.entries.every((e) => e.role !== "other"));
check("Command Tower filed as land", roleOf("Command Tower") === "land");
check("Sol Ring filed as an artifact", roleOf("Sol Ring") === "cat-artifacts");
check("Lightning Bolt filed as an instant", roleOf("Lightning Bolt") === "cat-instants");
check("Cultivate filed as a sorcery", roleOf("Cultivate") === "cat-sorceries");
check("Llanowar Elves filed as a creature", roleOf("Llanowar Elves") === "creature");

// ---- JSON round trip: a saved role/category survives export -> reimport --
const cardById = {
  art1: { id: "art1", name: "Sol Ring", set: "ltc", collectorNumber: "59", typeLine: "Artifact", usd: 2 },
};
const savedDeck = {
  name: "Combo deck",
  entries: [{ cardId: "art1", qty: 1, role: "cat-combo" }],
  basics: {},
  categories: [{ key: "cat-combo", label: "Combo pieces" }],
};
const exported = JSON.parse(deckToJson(savedDeck, cardById, null));
check("export carries the deck's own category declarations", exported.categories?.[0]?.key === "cat-combo");
check("export carries each card's saved role", exported.cards[0].role === "cat-combo");

const reparsed = jsonToParsed(JSON.stringify(exported));
check("re-parsing a JSON export preserves the category declarations", reparsed.meta.categories?.[0]?.label === "Combo pieces");
check("re-parsing preserves the per-card role", reparsed.entries[0].role === "cat-combo");

const rematched = matchDecklist(reparsed, [{ ...cardById.art1, quantity: 1 }], {});
check(
  "re-importing the export keeps the saved role instead of recomputing it from type",
  rematched.entries.find((e) => e.cardId === "art1")?.role === "cat-combo"
);

// ---- splitOtherByType: catch-up for a deck imported before this fix ------
const legacyCardById = {
  land1: pool[1],
  art1: pool[2],
  inst1: pool[3],
  sorc1: pool[4],
  crea1: pool[5],
};
const legacyDeck = {
  name: "Pre-fix deck",
  entries: [
    { cardId: "land1", qty: 1, role: "land" },
    { cardId: "crea1", qty: 1, role: "creature" },
    { cardId: "art1", qty: 1, role: "other" },
    { cardId: "inst1", qty: 1, role: "other" },
    { cardId: "sorc1", qty: 1, role: "other" },
  ],
  basics: {},
};
const resorted = splitOtherByType(legacyDeck, legacyCardById);
check("resorting actually returns a changed deck", resorted !== legacyDeck);
check("Sol Ring moves out of 'other' into artifacts", resorted.entries.find((e) => e.cardId === "art1")?.role === "cat-artifacts");
check("Lightning Bolt moves into instants", resorted.entries.find((e) => e.cardId === "inst1")?.role === "cat-instants");
check("Cultivate moves into sorceries", resorted.entries.find((e) => e.cardId === "sorc1")?.role === "cat-sorceries");
check("the already-correct land entry is left alone", resorted.entries.find((e) => e.cardId === "land1")?.role === "land");
check("the already-correct creature entry is left alone", resorted.entries.find((e) => e.cardId === "crea1")?.role === "creature");
check("the new categories get declared with proper labels", resorted.categories?.some((c) => c.key === "cat-artifacts" && c.label === "Artifacts"));

const alreadySplitDeck = { name: "Nothing to do", entries: [{ cardId: "land1", qty: 1, role: "land" }], basics: {} };
check(
  "a deck with nothing left in 'other' is returned unchanged (no needless patch)",
  splitOtherByType(alreadySplitDeck, legacyCardById) === alreadySplitDeck
);

// ---- end to end: importing a deck in the app splits the Roles view -------
const liveCards = pool.map((c, i) => ({
  ...c,
  scryfallId: `sf-${c.id}`,
  usd: 1,
  colors: [],
  rarity: "common",
  cmc: 1,
  manaCost: "",
  imageUrl: `${c.id}.jpg`,
  collectionId: "uncategorized",
  added: i,
}));
// A deck as it would exist if it were imported before importCategoryFor
// existed: every non-land, non-creature card sitting in "other". Uses its
// own separate cards (not the `pool`/`liveCards` set above) so claiming them
// here doesn't eat into what the fresh-import flow below needs to match.
const legacyLiveCards = [
  { id: "Lland1", name: "Command Tower", set: "c18", collectorNumber: "300", typeLine: "Land" },
  { id: "Lart1", name: "Sol Ring", set: "ltc", collectorNumber: "59", typeLine: "Artifact" },
  { id: "Linst1", name: "Lightning Bolt", set: "2x2", collectorNumber: "117", typeLine: "Instant" },
  { id: "Lsorc1", name: "Cultivate", set: "c18", collectorNumber: "179", typeLine: "Sorcery" },
  { id: "Lcrea1", name: "Llanowar Elves", set: "dom", collectorNumber: "179", typeLine: "Creature — Elf Druid" },
].map((c, i) => ({
  ...c,
  quantity: 1,
  scryfallId: `sf-${c.id}`,
  usd: 1,
  colors: [],
  rarity: "common",
  cmc: 1,
  manaCost: "",
  imageUrl: `${c.id}.jpg`,
  collectionId: "uncategorized",
  added: 100 + i,
}));
const liveLegacyDeck = {
  id: "legacy1",
  name: "Pre-fix Deck",
  format: "commander",
  commanderId: null,
  entries: [
    { cardId: "Lland1", qty: 1, role: "land" },
    { cardId: "Lcrea1", qty: 1, role: "creature" },
    { cardId: "Lart1", qty: 1, role: "other" },
    { cardId: "Linst1", qty: 1, role: "other" },
    { cardId: "Lsorc1", qty: 1, role: "other" },
  ],
  basics: {},
};
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store"))
    return Promise.resolve({
      ok: true,
      json: async () => ({
        value: JSON.stringify({ collections: [], cards: [...liveCards, ...legacyLiveCards], decks: [liveLegacyDeck] }),
      }),
    });
  if (u.includes("api.scryfall.com")) return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
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
function setReactValue(el, value) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  el[key].onChange({ target: { value } });
}

await click(byText("button", "Decks"));

// A deck that already existed before this fix: open it and confirm it's
// still stuck with everything but lands/creatures dumped in Other spells,
// then use the new catch-up button to fix it in place.
const legacyTile = [...document.querySelectorAll("div")].find(
  (d) => d.textContent.includes("Pre-fix Deck") && (d.getAttribute("style") || "").includes("cursor: pointer")
);
check("the pre-existing deck is listed", !!legacyTile);
await click(legacyTile);
await click(document.querySelector('button[aria-label="Roles"]'));
let legacyBody = document.body.textContent;
check("before resorting, the legacy deck's extra cards are all lumped into Other spells", legacyBody.includes("Other spells"));
check("before resorting, no Artifacts group exists yet", !legacyBody.includes("Artifacts"));

const splitBtn = document.querySelector('button[aria-label="Split Other spells by type"]');
check("the 'Split Other spells by type' catch-up button appears for this deck", !!splitBtn);
await click(splitBtn);
await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

legacyBody = document.body.textContent;
check("after resorting, Artifacts shows up", legacyBody.includes("Artifacts"));
check("after resorting, Instants shows up", legacyBody.includes("Instants"));
check("after resorting, Sorceries shows up", legacyBody.includes("Sorceries"));
check("after resorting, nothing is left in Other spells", !legacyBody.includes("Other spells"));
check(
  "the catch-up button disappears once there's nothing left for it to do",
  !document.querySelector('button[aria-label="Split Other spells by type"]')
);

await click(byText("button", "← ALL DECKS"));

const importBtn = document.querySelector('button[aria-label="Import a deck"]');
check("an Import a deck button is present", !!importBtn);
await click(importBtn);

const textarea = document.querySelector('textarea[aria-label="Decklist text"]');
check("the import modal's textarea is present", !!textarea);
await act(async () => { setReactValue(textarea, text); });
await click(byText("button", "Check list"));
await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

const createBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Create deck with"));
check("a Create-deck button appears once the list is matched", !!createBtn);
await click(createBtn);
await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

const rolesBtn = document.querySelector('button[aria-label="Roles"]');
check("the newly-imported deck opens straight into its detail view", !!rolesBtn);
await click(rolesBtn);

const bodyText = document.body.textContent;
check("Roles view shows a Lands group", bodyText.includes("Lands"));
check("Roles view shows a Creatures group", bodyText.includes("Creatures"));
check("Roles view shows an Artifacts group", bodyText.includes("Artifacts"));
check("Roles view shows an Instants group", bodyText.includes("Instants"));
check("Roles view shows a Sorceries group", bodyText.includes("Sorceries"));
check("nothing was left dumped into Other spells", !bodyText.includes("Other spells"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
