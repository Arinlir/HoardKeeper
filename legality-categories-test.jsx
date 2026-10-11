// Verifies: format legality (packing, reading back, deck banlist checks),
// custom deck categories, the commander picker's ordering, and card tags.
// All four are pure modules, so this test needs no DOM.
import { FORMATS, deckLegality, isSingletonFormat, legalityOf, packLegalities } from "./src/lib/formats";
import {
  addDeckCategory,
  deckCategories,
  isCustomCategory,
  removeDeckCategory,
  renameDeckCategory,
  setEntryCategory,
} from "./src/features/decks/categories";
import { commanderOptions } from "./src/features/decks/commanderPicker";
import { addTag, allTags, normalizeTag, removeTag } from "./src/lib/tags";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// ---- legality --------------------------------------------------------------
const raw = {
  standard: "not_legal", modern: "legal", legacy: "banned", vintage: "restricted",
  commander: "legal", pauper: "not_legal", brawl: "not_legal", pioneer: "not_legal",
  duel: "legal", future: "legal", // a format we deliberately don't keep
};
const packed = packLegalities(raw);
check("packing keeps one letter per format", Object.values(packed).every((v) => v.length === 1));
check("packing drops formats we don't track", Object.keys(packed).length === FORMATS.length);
check("packing is smaller than what came in", JSON.stringify(packed).length < JSON.stringify(raw).length / 2);
check("packing nothing yields nothing", packLegalities(null) === null);

const card = { name: "Test", legalities: packed };
check("legal reads back", legalityOf(card, "modern") === "legal");
check("banned reads back", legalityOf(card, "legacy") === "banned");
check("restricted reads back", legalityOf(card, "vintage") === "restricted");
check("edh is commander", legalityOf(card, "edh") === "legal");
check("an unstored card is unknown, not illegal", legalityOf({ name: "Old" }, "modern") === "");
check("an unknown format asks nothing", legalityOf(card, "peasant") === "");

check("commander is singleton", isSingletonFormat("commander") && isSingletonFormat("brawl"));
check("modern is not", !isSingletonFormat("modern") && !isSingletonFormat("standard"));
check("an unrecognised format is treated as 60-card", !isSingletonFormat("cube"));

const legal = { id: "l", name: "Fine Card", legalities: packLegalities({ modern: "legal", commander: "legal" }) };
const banned = { id: "x", name: "Banned Card", legalities: packLegalities({ modern: "banned", commander: "legal" }) };
const unchecked = { id: "u", name: "Never Refreshed" };
const island = { id: "i", name: "Island", typeLine: "Basic Land — Island", legalities: packLegalities({ modern: "legal" }) };
const cardById = { l: legal, x: banned, u: unchecked, i: island };
const isBasicLand = (c) => /basic/i.test(c.typeLine || "");

const modernDeck = {
  format: "modern",
  entries: [
    { cardId: "l", qty: 4 },
    { cardId: "x", qty: 1 },
    { cardId: "u", qty: 1 },
    { cardId: "i", qty: 20 },
  ],
};
const r1 = deckLegality(modernDeck, cardById, { isBasicLand });
check("the banned card is named", r1.problems.length === 1 && r1.problems[0].card.id === "x");
check("the unchecked card is counted, not accused", r1.unknown === 1 && !r1.problems.some((p) => p.card.id === "u"));
check("four copies are fine in modern", r1.overLimit.length === 0);
check("twenty basics are fine anywhere", !r1.overLimit.some((o) => o.card.id === "i"));
check("a deck with a banned card is not ok", !r1.ok);

const fiveCopies = deckLegality(
  { format: "modern", entries: [{ cardId: "l", qty: 5 }] },
  cardById,
  { isBasicLand }
);
check("five copies is over the modern limit", fiveCopies.overLimit.length === 1 && fiveCopies.overLimit[0].limit === 4);

const edh = deckLegality(
  { format: "commander", commanderId: "l", entries: [{ cardId: "l", qty: 2 }] },
  cardById,
  { isBasicLand }
);
check("commander is singleton, so two copies is over", edh.overLimit.length === 1 && edh.overLimit[0].limit === 1);
check("a card the deck can have any number of is exempt", (() => {
  const rat = { id: "r", name: "Rat Colony", legalities: packLegalities({ commander: "legal" }) };
  const res = deckLegality(
    { format: "commander", entries: [{ cardId: "r", qty: 9 }] },
    { r: rat },
    { isBasicLand, unlimited: (c) => c.name === "Rat Colony" }
  );
  return res.overLimit.length === 0;
})());
check("a clean deck says so", deckLegality({ format: "modern", entries: [{ cardId: "l", qty: 4 }] }, cardById, { isBasicLand }).ok);

// ---- deck categories -------------------------------------------------------
let deck = { format: "commander", entries: [{ cardId: "l", qty: 1, role: "other" }] };
check("a deck starts with the six built-in roles", deckCategories(deck).length === 7 && deckCategories(deck)[0].key === "land");
const added = addDeckCategory(deck, "Combo pieces");
deck = added.deck;
check("a new category is custom and keyed apart", isCustomCategory(added.key) && !added.existed);
check("the new category shows up last", deckCategories(deck).slice(-1)[0].label === "Combo pieces");
check("adding the same name twice reuses it", addDeckCategory(deck, "combo pieces").existed);
check("an empty name adds nothing", addDeckCategory(deck, "   ") === null);

deck = setEntryCategory(deck, "l", added.key);
check("a card can be moved into it", deck.entries[0].role === added.key);
deck = renameDeckCategory(deck, added.key, "Combo");
check("renaming keeps the key, so cards stay put", deckCategories(deck).slice(-1)[0].label === "Combo" && deck.entries[0].role === added.key);
check("built-in roles can't be renamed", renameDeckCategory(deck, "land", "Terrain") === deck);

deck = removeDeckCategory(deck, added.key);
check("deleting the category keeps the card", deck.entries.length === 1 && deck.entries[0].role === "other");
check("deleting the category removes the group", !deckCategories(deck).some((c) => c.key === added.key));
check("an orphan role from an import still shows", (() => {
  const imported = { entries: [{ cardId: "l", role: "sideboard-ish" }] };
  return deckCategories(imported).some((c) => c.key === "sideboard-ish" && c.orphan);
})());

// ---- commander picker ------------------------------------------------------
const pool = [
  { id: "1", name: "Zurgo Helmsmasher", typeLine: "Legendary Creature — Orc Warrior", colors: ["R", "W", "B"] },
  { id: "2", name: "Armaggon, Future Shark", typeLine: "Legendary Creature — Shark", colors: ["B"], set: "fin", collectorNumber: "12" },
  { id: "3", name: "Armaggon, Future Shark", typeLine: "Legendary Creature — Shark", colors: ["B"], set: "fic", collectorNumber: "301", finish: "foil" },
  { id: "4", name: "Amulet of Vigor", typeLine: "Artifact", colors: [] },
  { id: "5", name: "Sold Legend", typeLine: "Legendary Creature — Human", colors: ["W"], sold: true },
];
const opts = commanderOptions(pool);
check("only legendary creatures are offered", opts.length === 3);
check("a sold card is not a commander you have", !opts.some((o) => o.id === "5"));
check("the list is alphabetical", opts.map((o) => o.name).join("|") === "Armaggon, Future Shark|Armaggon, Future Shark|Zurgo Helmsmasher");
check("two copies of the same legend are told apart", opts[0].label !== opts[1].label);
check("the printing is what tells them apart", opts.some((o) => o.label.includes("FIN") && o.label.includes("#12")));
check("the finish shows too when it differs", opts.some((o) => o.label.includes("foil")));
check("a card with no twin keeps a clean label", opts[2].label === "Zurgo Helmsmasher (RWB)");

// ---- tags ------------------------------------------------------------------
check("a tag is trimmed and collapsed", normalizeTag("  for   trade ") === "for trade");
check("adding is case-insensitive", addTag(["Trade"], "trade").length === 1);
check("adding keeps the first spelling", addTag(["Trade"], "trade")[0] === "Trade");
check("removing is case-insensitive", removeTag(["Trade"], "TRADE").length === 0);
check("an empty tag is not added", addTag([], "  ").length === 0);
check("suggestions come back most-used first", (() => {
  const list = allTags([{ tags: ["trade", "keep"] }, { tags: ["trade"] }, { tags: ["Trade"] }]);
  return list[0].tag === "trade" && list[0].count === 3 && list[1].tag === "keep";
})());

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
