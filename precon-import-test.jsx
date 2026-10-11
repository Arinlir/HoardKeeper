// Precon import: the Import dialog's "Precon deck" tab lists boxed decks from
// MTGJSON, and adding one resolves every card by its Scryfall id (so the right
// printing, code and art) into a new collection named after the deck.
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



const { cleanDeckList, filterPrecons, preconToRecs } = await import("./src/lib/precons.js");

const deckList = [
  { code: "LTC", fileName: "FoodAndFellowship_LTC", name: "Food and Fellowship", releaseDate: "2023-06-23", type: "Commander Deck" },
  { code: "LTC", fileName: "RidersOfRohan_LTC", name: "Riders of Rohan", releaseDate: "2023-06-23", type: "Commander Deck" },
  { code: "ZNR", fileName: "ZendikarRisingRedemption_ZNR", name: "Zendikar Rising Redemption", releaseDate: "2020-10-25", type: "MTGO Redemption" },
];
const deckFile = {
  name: "Food and Fellowship", code: "LTC", type: "Commander Deck", releaseDate: "2023-06-23",
  commander: [{ name: "Frodo, Adventurous Hobbit", count: 1, setCode: "LTC", number: "2", identifiers: { scryfallId: "id-frodo" } }],
  mainBoard: [
    { name: "Field-Tested Frying Pan", count: 1, setCode: "LTC", number: "11", identifiers: { scryfallId: "id-pan" } },
    { name: "Plains", count: 2, setCode: "LTC", number: "262", identifiers: { scryfallId: "id-plains-a" } },
    { name: "Plains", count: 2, setCode: "LTC", number: "263", identifiers: { scryfallId: "id-plains-b" } },
    { name: "Sol Ring", count: 1, setCode: "LTC", number: "284", isFoil: true, identifiers: { scryfallId: "id-sol" } },
  ],
  sideBoard: [],
};
const rawFor = (id, name, num) => ({
  id, name, set: "ltc", set_name: "Tales of Middle-earth Commander", collector_number: num,
  image_uris: { normal: `https://img/${id}.jpg` }, prices: { usd: "1.00" },
  type_line: "Artifact", color_identity: [], rarity: "rare", cmc: 1,
});
const scryfallDb = {
  "id-frodo": rawFor("id-frodo", "Frodo, Adventurous Hobbit", "2"),
  "id-pan": rawFor("id-pan", "Field-Tested Frying Pan", "11"),
  "id-plains-a": rawFor("id-plains-a", "Plains", "262"),
  "id-plains-b": rawFor("id-plains-b", "Plains", "263"),
  "id-sol": rawFor("id-sol", "Sol Ring", "284"),
};

// ---- pure helpers
const cleaned = cleanDeckList(deckList);
check("digital-only products are dropped from the list", cleaned.length === 2 && !cleaned.some((d) => d.type === "MTGO Redemption"));
check("search matches every word across name/code/type", filterPrecons(cleaned, "food ltc").length === 1 && filterPrecons(cleaned, "commander deck").length === 2 && filterPrecons(cleaned, "zzz").length === 0);
const recs = preconToRecs(deckFile);
check("commander comes first, with its printing", recs[0].name === "Frodo, Adventurous Hobbit" && recs[0].set === "ltc" && recs[0].num === "2");
check("different printings of the same basic stay separate", recs.filter((r) => r.name === "Plains").length === 2);
check("a foil card is marked foil", recs.find((r) => r.name === "Sol Ring").finish === "foil");
check("total card count is preserved", recs.reduce((n, r) => n + r.qty, 0) === 7);

// ---- UI
const cards = [
  { id: "c1", name: "Beast Within", set: "ltc", collectorNumber: "4", scryfallId: "bea1", quantity: 1, finish: "nonfoil",
    condition: "NM", collectionId: "uncategorized", location: "", usd: 1, typeLine: "Sorcery", colors: ["G"], rarity: "uncommon", added: 1 },
];
let collectionRequests = [];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "m@example.com", verified: true, handle: "m" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  if (u.includes("/api/store")) return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  if (u.includes("mtgjson.com/api/v5/DeckList.json")) return Promise.resolve({ ok: true, json: async () => ({ data: deckList }) });
  if (u.includes("mtgjson.com/api/v5/decks/FoodAndFellowship_LTC.json")) return Promise.resolve({ ok: true, json: async () => ({ data: deckFile }) });
  if (u.includes("api.scryfall.com/cards/collection")) {
    const ids = JSON.parse(opts.body).identifiers;
    collectionRequests.push(ids);
    return Promise.resolve({ ok: true, json: async () => ({ data: ids.map((i) => scryfallDb[i.id]).filter(Boolean) }) });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
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
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

await click(document.querySelector('button[aria-label="Import"]'));
check("the import dialog has a Precon deck tab", !!byText("button", "Precon deck"));
await click(byText("button", "Precon deck"));
await wait(100);
check("lists the precon decks", document.body.textContent.includes("Food and Fellowship") && document.body.textContent.includes("Riders of Rohan"));
check("digital-only products aren't offered", !document.body.textContent.includes("Redemption"));

const option = [...document.querySelectorAll('[role="option"]')].find((b) => b.textContent.includes("Food and Fellowship"));
await click(option);
await wait(100);
check("shows the deck's card count before adding", document.body.textContent.includes("7 cards") && document.body.textContent.includes("5 different"));

const addBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Add 7 cards"));
check("an Add button appears", !!addBtn);
await click(addBtn);
await wait(200);

const ids = collectionRequests.flat().map((i) => i.id);
check("cards were resolved by Scryfall id, not by name", ids.length === 5 && ids.includes("id-pan") && ids.includes("id-plains-b"));
check("reports success", document.body.textContent.includes("cards added"));
await click(byText("button", "Done"));
check("the precon's cards are in the collection", document.body.textContent.includes("Field-Tested Frying Pan") && document.body.textContent.includes("Frodo, Adventurous Hobbit"));
check("a collection named after the deck was created", document.body.textContent.includes("Food and Fellowship"));
check("existing cards are untouched", document.body.textContent.includes("Beast Within"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
