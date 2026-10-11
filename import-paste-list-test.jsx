// The collection's CSV importer had no way to take the plain "1 Sol Ring
// (LTC) 123123" list format Binderwyrm's own text export already writes
// (and that Archidekt/Moxfield/etc. read right back in) -- only a proper CSV
// with header columns. This adds a "Paste a list" mode to the same Import
// modal: paste (or load a .txt of) plain decklist-style lines, they're
// looked up on Scryfall the same way the CSV path's "look up prices and
// art" step does, and the result lands in the collection.
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


const cards = [
  {
    id: "c1", name: "Beast Within", set: "ltc", collectorNumber: "4", scryfallId: "bea1",
    quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", location: "",
    usd: 1, typeLine: "Sorcery", colors: ["G"], rarity: "uncommon", added: 1,
  },
];

// A raw Scryfall "cards/collection" style record for Sol Ring — enough
// fields for normalizeCard to build a real card out of.
const solRingRaw = {
  id: "sol-ring-ltc-123123",
  name: "Sol Ring",
  set: "ltc",
  set_name: "Lord of the Rings: Tales of Middle-earth Commander",
  collector_number: "123123",
  image_uris: { normal: "https://example.com/solring.jpg" },
  prices: { usd: "1.50" },
  type_line: "Artifact",
  color_identity: [],
  rarity: "uncommon",
  cmc: 1,
};

let putCalls = [];
let collectionRequests = [];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") {
    putCalls.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store"))
    return Promise.resolve({
      ok: true,
      json: async () => ({ value: JSON.stringify({ collections: [], cards }) }),
    });
  if (u.includes("api.scryfall.com/cards/collection")) {
    collectionRequests.push(JSON.parse(opts.body).identifiers);
    return Promise.resolve({ ok: true, json: async () => ({ data: [solRingRaw] }) });
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

// jsdom doesn't drive React's onChange from a real input event reliably for
// a textarea any more than for <input>, so this goes straight at the React
// prop -- same trick this suite already uses elsewhere for onChange/onKeyDown.
function setReactValue(el, value) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  act.isBatchingUpdates; // no-op reference, keeps bundler from tree-shaking act import oddly
  el[key].onChange({ target: { value } });
}

const importBtn = document.querySelector('button[aria-label="Import"]');
check("an Import button is present", !!importBtn);
await click(importBtn);

check("the import modal opens with a mode picker", document.body.textContent.includes("CSV file") && document.body.textContent.includes("Paste a list"));

await click(byText("button", "Paste a list"));
check("switches to the paste UI", !!document.querySelector('textarea[aria-label="Pasted card list"]'));

const textarea = document.querySelector('textarea[aria-label="Pasted card list"]');
await act(async () => { setReactValue(textarea, "1 Sol Ring (LTC) 123123"); });

const checkListBtn = byText("button", "Check list");
await click(checkListBtn);

check("shows a preview of what it parsed", document.body.textContent.includes("1 card to look up on Scryfall"));

const importListBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Import ") && b.textContent.includes("card"));
check("an Import-N-cards button appears", !!importListBtn);
await click(importListBtn);
await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

check("looked Sol Ring up by its set + collector number, not just its name", JSON.stringify(collectionRequests).includes('"collector_number":"123123"'));
check("reports success", document.body.textContent.includes("cards added"));

const doneBtn = byText("button", "Done");
await click(doneBtn);

check("Sol Ring is now in the collection", document.body.textContent.includes("Sol Ring"));
check("the card that was already there is untouched", document.body.textContent.includes("Beast Within"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
