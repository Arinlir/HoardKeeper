// Two related deck-page requests: the Roles (list) view has no card art at
// all, so hovering a row now floats the card's image next to the cursor
// (same idea as the Sets roster's art-card preview); and the Cards
// (gallery) view could set a card as the deck's cover image but had no way
// to remove a card at all — only the Roles list had that. Both are now
// covered from the Cards/Roles tabs on the same deck page.
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


const liveCards = [
  { id: "cmd1", name: "Ith, Elvish Archdruid", set: "ltc", collectorNumber: "1", scryfallId: "ith", quantity: 1, usd: 5, colors: ["G"], rarity: "mythic", typeLine: "Legendary Creature — Elf Druid", cmc: 3, manaCost: "{2}{G}", imageUrl: "cmd.jpg", collectionId: "uncategorized", added: 1 },
  { id: "elves1", name: "Elvish Visionary", set: "ltc", collectorNumber: "3", scryfallId: "elv1", quantity: 1, usd: 1, colors: ["G"], rarity: "common", typeLine: "Creature — Elf", cmc: 2, manaCost: "{1}{G}", imageUrl: "visionary.jpg", collectionId: "uncategorized", added: 3 },
  { id: "beast1", name: "Beast Within", set: "ltc", collectorNumber: "4", scryfallId: "bea1", quantity: 1, usd: 1, colors: ["G"], rarity: "uncommon", typeLine: "Sorcery", cmc: 4, manaCost: "{2}{G}{G}", imageUrl: "beast.jpg", collectionId: "uncategorized", added: 4 },
];
const decks = [
  {
    id: "d1", name: "Elf Ramp", format: "commander", commanderId: "cmd1",
    entries: [
      { cardId: "elves1", qty: 1, role: "ramp" },
      { cardId: "beast1", qty: 1, role: "removal" },
    ],
    basics: {},
  },
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
// Driven through React's own onMouseEnter/onMouseLeave props rather than a
// real DOM MouseEvent — jsdom either doesn't fire React's synthetic
// enter/leave handling reliably or requires more DOM plumbing than a plain
// dispatchEvent gives it; going straight at the prop is the same trick this
// suite already uses for onChange/onKeyDown (see typeInto/pressEnter
// elsewhere), and it's what actually runs when a real mouse hovers the row.
function reactProps(el) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  return el[key];
}

await click(byText("button", "Decks"));
const deckTile = [...document.querySelectorAll("div")].find((d) => d.textContent.includes("Elf Ramp") && (d.getAttribute("style") || "").includes("cursor: pointer"));
await click(deckTile);

// --- Roles view: hover shows the card's art -------------------------------
await click(byText("button", "Roles"));
// The row div itself carries the hover handlers; find it by walking up from
// the one element on that row we can select precisely (its remove button),
// rather than guessing which ancestor div is "the" row.
const visionaryRemoveInRoles = document.querySelector('button[aria-label="Remove Elvish Visionary from deck"]');
const visionaryRow = visionaryRemoveInRoles?.parentElement?.parentElement;
check("found the Elvish Visionary row in Roles view", !!visionaryRow && visionaryRow.textContent.includes("Elvish Visionary"));
check("no preview image before hovering", !document.querySelector('img[alt="Elvish Visionary"]'));
await act(async () => { reactProps(visionaryRow).onMouseEnter({ clientY: 300 }); });
const previewImg = document.querySelector('img[alt="Elvish Visionary"]');
check("hovering a Roles row floats that card's image", previewImg?.getAttribute("src") === "visionary.jpg");
await act(async () => { reactProps(visionaryRow).onMouseLeave(); });
check("moving off the row clears the preview", !document.querySelector('img[alt="Elvish Visionary"]'));

// --- Cards view: a remove button on non-commander tiles -------------------
await click(byText("button", "Cards"));
check("Elvish Visionary is in the gallery to start", document.body.textContent.includes("Elvish Visionary"));
check("the commander has no remove button (that's a different action)", !document.querySelector('button[aria-label="Remove Ith, Elvish Archdruid from deck"]'));
const removeBtn = document.querySelector('button[aria-label="Remove Elvish Visionary from deck"]');
check("the gallery tile has a remove button", !!removeBtn);
await click(removeBtn);
check("removing it from the Cards view actually takes it out of the deck", !document.body.textContent.includes("Elvish Visionary"));
check("the other card is untouched", document.body.textContent.includes("Beast Within"));
check("the commander is untouched", document.body.textContent.includes("Ith, Elvish Archdruid"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
