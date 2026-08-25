// Full typed-input simulation into the art search box hits the same
// jsdom/React limitation documented earlier this session (real browsers
// handle this fine -- it's specifically a jsdom synthetic-event gap). What's
// verified here instead, without needing simulated typing:
//   1. The Art card tab exists and its series dropdown is correctly scoped
//      to real art-series sets only (a token set with a similar shape is
//      excluded) -- this is the highest-risk logic, since a false positive
//      here would let the wrong kind of card into search results.
//   2. An owned art card's detail view shows the Signature field, the
//      checkbox reflects its actual `signed` state, and toggling + saving
//      persists correctly -- this exercises the exact same isArt/signed
//      code path the search-tab's submit() uses, just entered via
//      pre-seeded data instead of a typed search.
//   3. cleanArtCardName's collapsing logic, tested directly (no DOM at all).
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLElement.prototype.attachEvent = function () {};
dom.window.HTMLElement.prototype.detachEvent = function () {};

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

const scryfallSets = {
  data: [
    { code: "aacr", name: "Assassin's Creed Art Series", set_type: "memorabilia", parent_set_code: "acr", card_count: 40 },
    { code: "totj", name: "Thunder Junction Tokens", set_type: "token", parent_set_code: "otj", card_count: 20 },
  ],
};

const cards = [
  {
    id: "hb1", name: "Hidden Blade", set: "aacr", collectorNumber: "9", scryfallId: "hb-art",
    quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", location: "",
    usd: 3, colors: [], rarity: "common", typeLine: "Card", artist: "Jane Artist",
    isArt: true, signed: true, added: Date.now(),
  },
];
let putCalls = [];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael") && opts?.method === "PUT") {
    putCalls.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  if (u.includes("api.scryfall.com/sets") && !u.includes("/sets/"))
    return Promise.resolve({ ok: true, json: async () => scryfallSets });
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

// --- 1. tab + scoping ---
const addBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add card"));
await act(async () => { addBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const artTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Art card");
check("Art card tab exists in Add Card", !!artTab);
await act(async () => { artTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
check("real art series listed in scope dropdown", document.body.textContent.includes("Assassin's Creed Art Series"));
check("a token set with a similar shape is correctly excluded", !document.body.textContent.includes("Thunder Junction Tokens"));

// click the modal backdrop directly -- ModalShell closes on backdrop click
const backdrop = document.querySelector('[data-role="modal-backdrop"]');
check("found the Add Card modal backdrop", !!backdrop);
if (backdrop) await act(async () => { backdrop.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

// --- 2. owned art card's detail view ---
// the only owned card is an art card, so it's correctly hidden from the
// default "Cards" sub-tab -- switch to "Art Cards" first
const artSubTab = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Art Cards") && !b.textContent.includes("Art Card\n"));
check("Art Cards sub-tab appears since the only card is art", !!artSubTab);
if (artSubTab) await act(async () => { artSubTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const tile = document.querySelector('[data-card-id="hb1"]');
check("owned art card renders in the collection grid", !!tile);
await act(async () => { tile.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

check("Signature field visible on an art card's detail view", document.body.textContent.includes("Signature"));
const signedBox = document.querySelector('input[type=checkbox]');
check("checkbox reflects the card's actual signed:true state", signedBox && signedBox.checked === true);

await act(async () => { signedBox.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const saveBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Save"));
await act(async () => { saveBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 700)); });

const saved = JSON.parse(putCalls[putCalls.length - 1].value).cards;
const hb = saved.find((c) => c.id === "hb1");
check("signed toggled off and persisted via the edit view", hb && hb.signed === false);
check("everything else about the card untouched by the toggle", hb && hb.name === "Hidden Blade" && hb.artist === "Jane Artist" && hb.isArt === true);

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
