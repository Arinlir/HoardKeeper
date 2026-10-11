// "Add a card" is a full-screen search: results are a grid of big card faces
// with set / number / price printed under each, the selected card and its form
// sit in a side panel, and it works as a plain lookup too (adding is optional).
// Duplicating a card you own is still the small dialog (duplicate-card-test).
//
// jsdom can't lay anything out, so this pins what the screen *contains* and how
// it behaves: the tiles and their details, the two-step card → printing flow,
// "Owned ×N", paging ("Load more"), that Add & next keeps the results on screen,
// and that Escape / Close leave and hand the page's scrolling back.
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
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });


const raw = (id, name, set, setName, num, released, usd, usdFoil, extra = {}) => ({
  id, name, set, set_name: setName, collector_number: num, released_at: released,
  prices: { usd, usd_foil: usdFoil || null }, finishes: usdFoil ? ["nonfoil", "foil"] : ["nonfoil"],
  color_identity: ["R"], type_line: "Creature — Goblin", rarity: "rare",
  scryfall_uri: `https://scryfall.com/card/${set}/${num}`, ...extra,
});

// page 1 of "goblin" — 3 of 5, so there is more to load
const PAGE1 = [
  raw("gg-zen", "Goblin Guide", "zen", "Zendikar", "126", "2009-10-02", "4.50", "12.00"),
  raw("gc-m19", "Goblin Chieftain", "m19", "Core Set 2019", "141", "2018-07-13", "0.30", null, { rarity: "rare" }),
  raw("gm-tsp", "Goblin Matron", "tsp", "Time Spiral", "180", "2006-10-06", "0.10", null, { rarity: "common" }),
];
const PAGE2 = [
  raw("gp-mm", "Goblin Piledriver", "mmq", "Mercadian Masques", "195", "1999-10-04", "1.00", null),
  raw("gw-usg", "Goblin Welder", "usg", "Urza's Saga", "208", "1998-10-12", "2.00", null),
];
// every printing of Goblin Guide, newest first — the order Scryfall answers in
const GUIDE_PRINTS = [
  raw("gg-znr", "Goblin Guide", "znr", "Zendikar Rising", "141", "2020-09-25", "3.00", "7.50"),
  raw("gg-mm3", "Goblin Guide", "mm3", "Modern Masters 2017", "97", "2017-03-17", "9.00", null, { frame_effects: ["showcase"] }),
  raw("gg-zen", "Goblin Guide", "zen", "Zendikar", "126", "2009-10-02", "4.50", "12.00"),
];

const owned = [
  {
    id: "own1", name: "Goblin Guide", set: "zen", collectorNumber: "126", scryfallId: "gg-zen",
    quantity: 2, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", location: "",
    usd: 4.5, usdFoil: 12, colors: ["R"], rarity: "rare", typeLine: "Creature — Goblin", added: Date.now(),
  },
];

const searchCalls = [];
let putCalls = [];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") {
    putCalls.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards: owned }) }) });
  if (u.startsWith("https://api.scryfall.com/cards/search")) {
    const p = new URL(u).searchParams;
    searchCalls.push({ q: p.get("q"), unique: p.get("unique"), page: p.get("page") });
    if (p.get("unique") === "prints") {
      return Promise.resolve({ ok: true, json: async () => ({ data: GUIDE_PRINTS, total_cards: 3, has_more: false }) });
    }
    if (p.get("page") === "2") {
      return Promise.resolve({ ok: true, json: async () => ({ data: PAGE2, total_cards: 5, has_more: false }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: PAGE1, total_cards: 5, has_more: true }) });
  }
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}
const click = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
function setValue(el, value) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  return act(async () => { el[key].onChange({ target: { value } }); });
}
const modal = () => document.querySelector('[data-role="modal-backdrop"]');
const tiles = () => [...modal().querySelectorAll(".acs-tile")];
const btn = (text, within = modal()) => [...within.querySelectorAll("button")].find((b) => b.textContent.trim() === text || b.textContent.trim().startsWith(text));

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await settle(60);

// ---------------------------------------------------------------- open
await click([...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add card")));
const m = modal();
check("Add a card opens", !!m);
check("as a full-screen layer, not a 480px dialog", /position:\s*fixed/.test(m.getAttribute("style") || "") && !/max-width/.test(m.getAttribute("style") || ""));
check("it is a modal dialog for assistive tech", m.getAttribute("role") === "dialog" && m.getAttribute("aria-modal") === "true");
check("the page behind stops scrolling while it's open", document.body.style.overflow === "hidden");
check("it opens on the search with the four ways in as tabs", ["By name", "By code", "Scan", "Art card"].every((t) => !!btn(t)));
check("a hint fills the empty results area", m.textContent.includes("Find any card"));
check("the side panel says what will appear there", m.textContent.includes("Pick a card, then a printing"));

// ---------------------------------------------------------------- search
await setValue(m.querySelector('[aria-label="Card name"]'), "goblin");
await click(btn("Search", m));
await settle();

check("results are a grid of tiles", tiles().length === 3);
check("Scryfall's total is shown, not just what fit on the page", m.textContent.includes("Total results: 5") && m.textContent.includes("showing 3"));
const guide = tiles()[0];
check("a tile names the card", guide.textContent.includes("Goblin Guide"));
check("...its set and collector number", guide.textContent.includes("ZEN #126") && guide.textContent.includes("Zendikar"));
check("...and its price, foil too where there is one", guide.textContent.includes("$4.50") && guide.textContent.includes("$12.00"));
check("a card with no foil price shows just the one", tiles()[1].textContent.includes("$0.30") && !tiles()[1].textContent.includes("✦"));
check("a card you own says how many", guide.textContent.includes("Owned ×2"));
check("a card you don't own doesn't", !tiles()[1].textContent.includes("Owned"));
check("no printings step yet", !m.textContent.includes("Printings —"));

// ---------------------------------------------------------------- load more
const more = btn("Load more");
check("the rest can be loaded", !!more && more.textContent.includes("2 more"));
await click(more);
await settle();
check("page 2 was asked for by number", searchCalls.some((c) => c.unique === "cards" && c.page === "2"));
check("and its cards were added to the grid", tiles().length === 5 && tiles()[4].textContent.includes("Goblin Welder"));
check("with nothing left, the button goes", !btn("Load more"));

// ---------------------------------------------------------------- pick a card → its printings
await click(tiles()[0]);
await settle();
check("picking a card shows all its printings", m.textContent.includes("Printings — Goblin Guide") && tiles().length === 3);
check("with a count", m.textContent.includes("3 printings"));
check("newest first: the printing tile leads with its set", tiles()[0].textContent.includes("Zendikar Rising") && tiles()[0].textContent.includes("ZNR #141"));
check("each printing shows its own price", tiles()[0].textContent.includes("$3.00") && tiles()[0].textContent.includes("$7.50") && tiles()[1].textContent.includes("$9.00"));
const zenTile = tiles().find((t) => t.textContent.includes("ZEN #126"));
const znrTile = tiles().find((t) => t.textContent.includes("ZNR #141"));
const mm3Tile = tiles().find((t) => t.textContent.includes("MM3 #97"));
check("only the printing you own is marked owned", zenTile.textContent.includes("Owned ×2") && !znrTile.textContent.includes("Owned"));
check("a treatment is spelled out under the printing", mm3Tile.textContent.toLowerCase().includes("showcase"));
check("the newest printing is selected by default and shown in the panel", znrTile.getAttribute("aria-pressed") === "true" && m.querySelector("aside").textContent.includes("Zendikar Rising"));

// pick a different printing
await click(mm3Tile);
const aside = () => m.querySelector("aside");
check("clicking a printing selects it", mm3Tile.getAttribute("aria-pressed") === "true" && znrTile.getAttribute("aria-pressed") === "false");
check("the panel follows: name, set, number, prices", aside().textContent.includes("Goblin Guide") && aside().textContent.includes("Modern Masters 2017") && aside().textContent.includes("MM3 #97") && aside().textContent.includes("$9.00"));
check("the panel holds the form", !!aside().querySelector("#acm-quantity") && !!aside().querySelector("#acm-collection") && !!btn("Add & next", aside()));
// layout contract: everything needed to add the card is reachable without scrolling the
// details — the form sits in its own column and the buttons in a pinned bar outside the
// scrolling area (jsdom can't lay out, so this checks the structure the CSS relies on)
check("the form is in the panel's form column, the card details in the info column", !!aside().querySelector(".acs-a-form #acm-cost") && !!aside().querySelector(".acs-a-info .acs-pv"));
check("the Add buttons are pinned outside the scrolling area", !!btn("Add & next", aside().querySelector(".acs-a-bar")) && !aside().querySelector(".acs-a-scroll").contains(btn("Add & next", aside())));
const sfLink = aside().querySelector('a[href^="https://scryfall.com/"]');
check("the panel links to the card on Scryfall, in a new tab, without leaking the opener", !!sfLink && sfLink.getAttribute("target") === "_blank" && /noopener/.test(sfLink.getAttribute("rel") || ""));

// ---------------------------------------------------------------- add and keep going
await setValue(aside().querySelector("#acm-quantity"), "3");
await click(btn("Add & next", aside()));
await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
const saved = JSON.parse(putCalls[putCalls.length - 1].value).cards;
const added = saved.find((c) => c.scryfallId === "gg-mm3");
check("the chosen printing was added", !!added && added.set === "mm3" && added.collectorNumber === "97");
check("with the quantity typed", added && added.quantity === 3);
check("the header counts what this visit added", m.textContent.includes("✓ 3 added"));
check("the results stay up for the next pick", modal() && tiles().length === 3 && m.textContent.includes("Printings — Goblin Guide"));
check("nothing is selected, so the panel is empty again", !tiles().some((t) => t.getAttribute("aria-pressed") === "true") && m.textContent.includes("Pick a card, then a printing"));
check("the printing just added now reads as owned", tiles().find((t) => t.textContent.includes("MM3 #97")).textContent.includes("Owned ×3"));
check("Add & next is disabled with nothing selected", btn("Add & next", aside()).disabled === true);

// back to the card results
await click(btn("back to results", m));
check("back to results returns to the cards, still there", tiles().length === 5 && !m.textContent.includes("Printings —"));

// ---------------------------------------------------------------- sizes
const large = m.querySelector('[aria-label="large result size"]');
check("there's a result size control", !!large);
await click(large);
check("it remembers the choice", localStorage.getItem("hk-add-tile-size") === "large");
check("and the grid uses it", (m.querySelector(".acs-grid").getAttribute("style") || "").includes("270px"));

// ---------------------------------------------------------------- clear
await click(btn("Clear", m));
check("Clear empties the search and the results", tiles().length === 0 && m.querySelector('[aria-label="Card name"]').value === "");

// ---------------------------------------------------------------- leaving
document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await settle(20);
check("Escape closes it", !modal());
check("and gives the page its scrolling back", document.body.style.overflow !== "hidden");

await click([...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add card")));
check("it opens again fresh", !!modal() && tiles().length === 0);
await click(modal().querySelector('button[aria-label="Close"]'));
check("the X closes it too", !modal());

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
