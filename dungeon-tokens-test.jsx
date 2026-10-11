// Regression test for: a card that ventures into the dungeon (e.g. a card
// linking to Tomb of Annihilation) never showed up in "Tokens to bring".
// fetchOracleTexts only kept Scryfall's all_parts entries with
// component === "token", but dungeons, emblems and similar "bring this extra
// thing to the table" objects come back as component === "combo_piece" too —
// they were being silently dropped. Widening the filter to all of
// combo_piece then overcorrected: Scryfall also files a Partner commander,
// or any card simply referenced by name in another's rules text, under that
// same bucket, and those started showing up in "Tokens to bring" as if they
// were physical tokens. The fix keeps combo_piece only when the part's own
// type line says it isn't a normal card (Dungeon/Emblem/Stickers). This
// checks all three layers: the raw parts-filtering logic, that a real card
// wrongly bucketed as combo_piece is excluded, and the actual Tokens panel
// on a deck page.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// ---- fetchOracleTexts keeps combo_piece alongside token, drops meld -------
import { fetchOracleTexts } from "./src/lib/scryfall";

globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("api.scryfall.com/cards/collection")) {
    const body = JSON.parse(opts.body);
    const ids = body.identifiers.map((i) => i.id);
    const data = [];
    if (ids.includes("venture-card")) {
      data.push({
        id: "venture-card",
        oracle_text: "When this creature enters, venture into the dungeon.",
        type_line: "Creature — Human Rogue",
        all_parts: [
          { id: "tomb-of-annihilation", component: "combo_piece", name: "Tomb of Annihilation", type_line: "Dungeon" },
          { id: "lost-mine", component: "combo_piece", name: "Lost Mine of Phandelver", type_line: "Dungeon" },
          { id: "zombie-token", component: "token", name: "Zombie", type_line: "Token Creature — Zombie" },
          { id: "meld-half", component: "meld_result", name: "Some Meld Result", type_line: "Legendary Creature" },
          // Real cards land under combo_piece too — a Partner commander
          // referencing its partner by name, most commonly. That's not a
          // physical extra to bring, it's a card already in the deck (or
          // one to draft), so it must NOT survive the filter.
          { id: "partner-card", component: "combo_piece", name: "Some Partner Commander", type_line: "Legendary Creature — Elf Druid" },
        ],
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ data }) });
  }
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

const cache = await fetchOracleTexts(["venture-card"]);
const partNames = (cache["venture-card"]?.parts || []).map((p) => p.name);
check("a dungeon linked as combo_piece is kept", partNames.includes("Tomb of Annihilation"));
check("a second dungeon on the same card is kept too", partNames.includes("Lost Mine of Phandelver"));
check("an actual token (component: token) still works as before", partNames.includes("Zombie"));
check("a meld_result is NOT treated as something to bring", !partNames.includes("Some Meld Result"));
check("a real card wrongly bucketed as combo_piece (e.g. a Partner commander) is NOT treated as something to bring", !partNames.includes("Some Partner Commander"));
check("cached under the bumped key so the old, incomplete cache isn't served", JSON.parse(localStorage.getItem("lf-oracle-v4"))["venture-card"].parts.length === 3);

// ---- end to end: the dungeon actually shows up in the Tokens panel --------
// Clear the cache the pure check above just populated for "venture-card" (it
// deliberately included two dungeons and a token to test the filter) so this
// section starts fresh with its own, narrower fixture.
localStorage.removeItem("lf-oracle-v4");

const liveCards = [
  { id: "cmd1", name: "Farideh, Devil's Chosen", set: "clb", collectorNumber: "1", scryfallId: "farideh", quantity: 1, usd: 5, colors: ["B", "R"], rarity: "mythic", typeLine: "Legendary Creature — Tiefling Warlock", cmc: 3, manaCost: "{1}{B}{R}", imageUrl: "cmd.jpg", collectionId: "uncategorized", added: 1 },
  { id: "venturer1", name: "Sword Coast Sailor", set: "afr", collectorNumber: "2", scryfallId: "venture-card", quantity: 1, usd: 1, colors: ["U"], rarity: "common", typeLine: "Creature — Human Rogue", cmc: 2, manaCost: "{1}{U}", imageUrl: "sailor.jpg", collectionId: "uncategorized", added: 2 },
];
const decks = [
  {
    id: "d1", name: "Venture Deck", format: "commander", commanderId: "cmd1",
    entries: [{ cardId: "venturer1", qty: 1, role: "other" }],
    basics: {},
  },
];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards: liveCards, decks }) }) });
  if (u.includes("api.scryfall.com/cards/collection")) {
    const body = JSON.parse(opts.body);
    const ids = body.identifiers.map((i) => i.id);
    const data = [];
    if (ids.includes("venture-card")) {
      data.push({
        id: "venture-card",
        oracle_text: "When this creature enters, venture into the dungeon.",
        type_line: "Creature — Human Rogue",
        all_parts: [
          { id: "tomb-of-annihilation", component: "combo_piece", name: "Tomb of Annihilation", type_line: "Dungeon" },
        ],
      });
    }
    if (ids.includes("farideh")) {
      data.push({ id: "farideh", oracle_text: "", type_line: "Legendary Creature — Tiefling Warlock", all_parts: [] });
    }
    // artwork lookups (fetchTokenCards) for the dungeon "card" itself
    if (ids.includes("tomb-of-annihilation")) {
      data.push({ id: "tomb-of-annihilation", name: "Tomb of Annihilation", type_line: "Dungeon", image_uris: { normal: "tomb.jpg" } });
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

const byText = (tag, text) => [...document.querySelectorAll(tag)].find((el) => el.textContent.trim() === text);
const click = async (el) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };

await click(byText("button", "Decks"));
const deckTile = [...document.querySelectorAll("div")].find((d) => d.textContent.includes("Venture Deck") && (d.getAttribute("style") || "").includes("cursor: pointer"));
await click(deckTile);
// give the oracle-text and token-art fetches a moment to land
await act(async () => { await new Promise((r) => setTimeout(r, 250)); });

check("Tokens to bring picks up the dungeon the deck can venture into", document.body.textContent.includes("Tomb of Annihilation"));
check("the panel's count includes it", document.body.textContent.includes("1 type"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
