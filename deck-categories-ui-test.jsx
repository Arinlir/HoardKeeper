// Verifies: custom deck categories as they actually behave in the deck view --
// creating one, moving a card into it, renaming it, deleting it (which keeps
// the card) -- plus the commander picker being sorted with duplicate legends
// told apart, and the format chips flagging a banned card.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom's document has no `oninput`, so React decides input events aren't
// supported and falls back to an IE-era polyfill that calls attachEvent. Give
// it the property and React uses the modern path.
if (!("oninput" in dom.window.document)) {
  Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });
}
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

localStorage.setItem("hk-search-scope", "name");

// packLegalities' own shape, written out here so the test doesn't depend on it.
const cards = [
  { id: "t", name: "Treebeard, Gracious Host", set: "ltr", collectorNumber: "168", scryfallId: "st", quantity: 1, usd: 2, colors: ["G"], cmc: 5, rarity: "rare", typeLine: "Legendary Creature — Treefolk", collectionId: "uncategorized", added: 5, legalities: { cmd: "l", mod: "l" } },
  { id: "b", name: "Lightning Bolt", set: "2xm", collectorNumber: "129", scryfallId: "sb", quantity: 1, usd: 5, colors: ["R"], cmc: 1, rarity: "uncommon", typeLine: "Instant", collectionId: "uncategorized", added: 4, legalities: { cmd: "l", mod: "l" } },
  { id: "s", name: "Sol Ring", set: "ltc", collectorNumber: "59", scryfallId: "ss", quantity: 1, usd: 30, colors: [], cmc: 1, rarity: "uncommon", typeLine: "Artifact", collectionId: "uncategorized", added: 3, legalities: { cmd: "l", mod: "b" } },
  // two copies of one legend, plus a legend that sorts before both
  { id: "g1", name: "Galadriel, Elven-Queen", set: "ltc", collectorNumber: "3", scryfallId: "sg1", quantity: 1, usd: 3, colors: ["G", "U"], cmc: 3, rarity: "mythic", typeLine: "Legendary Creature — Elf Noble", collectionId: "uncategorized", added: 2 },
  { id: "g2", name: "Galadriel, Elven-Queen", set: "ltr", collectorNumber: "204", scryfallId: "sg2", quantity: 1, usd: 6, finish: "foil", colors: ["G", "U"], cmc: 3, rarity: "mythic", typeLine: "Legendary Creature — Elf Noble", collectionId: "uncategorized", added: 1 },
];
const decks = [
  { id: "d1", name: "Treebeard EDH", format: "commander", commanderId: "t", entries: [{ cardId: "b", qty: 1, role: "removal" }, { cardId: "s", qty: 1, role: "ramp" }, { cardId: "g1", qty: 1, role: "creature" }], basics: {} },
];
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards, decks }) }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
};
const byText = (text, tag = "button") =>
  [...document.querySelectorAll(tag)].find((b) => b.textContent.trim() === text);

await click(byText("Decks"));

// ---- the commander picker ----
const picker = document.querySelector('select[aria-label="Choose a commander"]');
const options = [...picker.querySelectorAll("option")].slice(1).map((o) => o.textContent.trim());
check("the commander list is alphabetical", options[0].startsWith("Galadriel") && options[2].startsWith("Treebeard"));
check("both copies of the duplicate legend are offered", options.filter((o) => o.startsWith("Galadriel")).length === 2);
check("the two copies read differently", options[0] !== options[1]);
check("the printing is what separates them", options.some((o) => o.includes("LTC") && o.includes("#3")) && options.some((o) => o.includes("LTR") && o.includes("#204")));
check("the foil copy says so", options.some((o) => o.includes("foil")));
check("the legend with no twin stays clean", options[2] === "Treebeard, Gracious Host (G)");

// ---- open the deck ----
const deckCard = [...document.querySelectorAll("div")].find(
  (d) => d.textContent.includes("Treebeard EDH") && (d.getAttribute("style") || "").includes("cursor: pointer")
);
await click(deckCard);
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

// ---- legality ----
const legalityPanel = () => document.querySelector('[data-role="deck-legality"]').textContent;
check("a commander deck with nothing banned says so", legalityPanel().includes("Nothing banned in Commander"));
check("a card whose legality was never fetched is said out loud, not assumed", legalityPanel().includes("hasn't been checked yet"));
await click(byText("Modern"));
check("switching format re-checks the banlist", legalityPanel().includes("Not legal in Modern"));
check("the banned card is named", legalityPanel().includes("Sol Ring"));
check("the legal cards are not", !legalityPanel().includes("Lightning Bolt"));
await click(byText("Commander"));
check("switching back clears it", legalityPanel().includes("Nothing banned in Commander"));

// ---- categories ----
await click(byText("Roles"));
check("the built-in roles are still there", document.body.textContent.includes("Removal") && document.body.textContent.includes("Ramp"));

await click(byText("New category"));
const draft = document.querySelector('input[aria-label="New category name"]');
check("naming a category is an input, not a browser prompt", !!draft);
const props = Object.keys(draft).find((k) => k.startsWith("__reactProps$"));
await act(async () => { draft[props].onChange({ target: { value: "Combo pieces" } }); });
await click(byText("Add"));
check("the new category appears", document.body.textContent.includes("Combo pieces"));

// move Lightning Bolt into it
const moveBtn = document.querySelector('button[aria-label="Move Lightning Bolt to another category"]');
check("every card row offers a move", !!moveBtn);
await click(moveBtn);
await click(byText("Combo pieces"));
const comboPanel = [...document.querySelectorAll("div")].find(
  (d) => d.textContent.includes("Combo pieces") && d.textContent.includes("Lightning Bolt") && d.textContent.length < 200
);
check("the card lands in the new category", !!comboPanel);

// rename it
await click(byText("Rename"));
const renameBox = document.querySelector('input[aria-label="Rename category"]');
const rprops = Object.keys(renameBox).find((k) => k.startsWith("__reactProps$"));
await act(async () => { renameBox[rprops].onChange({ target: { value: "Wincons" } }); });
await act(async () => { renameBox[rprops].onKeyDown({ key: "Enter", target: { value: "Wincons" } }); });
check("renaming sticks", document.body.textContent.includes("Wincons") && !document.body.textContent.includes("Combo pieces"));
check("the card stays where it was put", document.body.textContent.includes("Lightning Bolt"));

// delete it -- the card must survive
await click(byText("Delete group"));
check("deleting the group removes it", !document.body.textContent.includes("Wincons"));
check("but keeps the card", document.body.textContent.includes("Lightning Bolt"));
check("and files it under Other spells", (() => {
  const other = [...document.querySelectorAll("div")].find(
    (d) => d.textContent.includes("Other spells") && d.textContent.includes("Lightning Bolt") && d.textContent.length < 200
  );
  return !!other;
})());

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
