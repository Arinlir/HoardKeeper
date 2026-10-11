// The "pick a printing" list (Add a card, wishlist, DetailModal's "fix the
// printing" panel) can now be ordered by release date, price or set name,
// ascending or descending, and filtered by set name — same three controls
// (PrintingSortBar) everywhere the app lets you choose a specific printing.
// This test drives it through Add a card, since that's the flow people hit
// most and the one whose printing list previously had no sort control at all.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;


// Three printings of one card, deliberately picked so "release date",
// "price desc" and "price asc" each put a different one on top — a test
// that only checked one sort couldn't tell a real re-sort from a no-op.
const PRINTS = [
  {
    id: "solring-lea", name: "Sol Ring", set: "lea", set_name: "Alpha", collector_number: "not on card",
    released_at: "1993-08-05", prices: { usd: "500.00" }, color_identity: [], type_line: "Artifact", rarity: "uncommon",
  },
  {
    id: "solring-c21", name: "Sol Ring", set: "c21", set_name: "Commander 2021", collector_number: "263",
    released_at: "2021-04-23", prices: { usd: "5.00" }, color_identity: [], type_line: "Artifact", rarity: "uncommon",
  },
  {
    id: "solring-fdn", name: "Sol Ring", set: "fdn", set_name: "Foundations", collector_number: "500",
    released_at: "2024-11-15", prices: { usd: "20.00" }, color_identity: [], type_line: "Artifact", rarity: "uncommon",
  },
];

globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  if (u.includes("/api/store")) return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards: [] }) }) });
  if (u.startsWith("https://api.scryfall.com/cards/search")) {
    const params = new URL(u).searchParams;
    if (params.get("unique") === "prints") {
      return Promise.resolve({ ok: true, json: async () => ({ data: PRINTS }) });
    }
    // "cards" search: exactly one match, so AddCardModal auto-advances
    // straight to the printings step without a candidates list in between.
    return Promise.resolve({ ok: true, json: async () => ({ data: [PRINTS[1]] }) });
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

function setNativeValue(el, value) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  el[key].onChange({ target: { value } });
}
function buttonsIn(el, text) {
  return [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
}

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const addBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add a card");
check("empty vault offers Add a card", !!addBtn);
await act(async () => { addBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const backdrop = document.querySelector('[data-role="modal-backdrop"]');
check("the Add a card modal opened", !!backdrop);

const nameInput = backdrop.querySelector('[aria-label="Card name"]');
await act(async () => { setNativeValue(nameInput, "Sol Ring"); });
const searchBtn = buttonsIn(backdrop, "Search");
await act(async () => { searchBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

check("it jumped straight to the printings step", backdrop.textContent.includes("Printings — Sol Ring"));

const sortSelect = backdrop.querySelector('[aria-label="Order printings by"]');
const filterInput = backdrop.querySelector('[aria-label="Search printings"]');
check("the sort/filter bar is there once there's more than one printing", !!sortSelect && !!filterInput);

const rowNames = () => [...backdrop.querySelectorAll("span.serif")].map((s) => s.textContent.trim());

check("default order is release date, newest first", rowNames()[0] === "Foundations");

await act(async () => { setNativeValue(sortSelect, "price"); });
check("switching to price (still descending) puts the priciest printing on top", rowNames()[0] === "Alpha");

const dirBtn = buttonsIn(backdrop, "Desc");
check("the direction toggle reads Desc to start", !!dirBtn);
await act(async () => { dirBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("flipping to ascending price puts the cheapest printing on top", rowNames()[0] === "Commander 2021");
check("the toggle now reads Asc", !!buttonsIn(backdrop, "Asc"));

await act(async () => { setNativeValue(filterInput, "alpha"); });
check("filtering by set name narrows the list to just that one", rowNames().length === 1 && rowNames()[0] === "Alpha");

await act(async () => { setNativeValue(filterInput, "nonexistent set"); });
check("a filter matching nothing says so instead of showing an empty list silently", backdrop.textContent.includes("No printing's set matches"));
check("and really did hide every row", rowNames().length === 0);

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
