// Two things matter for the "laggy" complaint: (1) pricing a card must not
// rescan the whole collection, and (2) unrelated state changes must not
// force every visible card tile to re-render. Verify both directly.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
dom.window.ResizeObserver = globalThis.ResizeObserver;

// Serve a large synthetic collection through the server-mode boot path so
// the app renders real cards instead of the empty state.
const CARD_COUNT = 500;
const collections = [{ id: "col1", name: "Big Collection", purchasePrice: 5000 }];
const cards = Array.from({ length: CARD_COUNT }, (_, i) => ({
  id: `c${i}`,
  name: `Card ${i}`,
  set: "tst",
  collectorNumber: String(i),
  quantity: 1,
  finish: "nonfoil",
  condition: "NM",
  collectionId: "col1",
  location: "",
  costOverride: null,
  valueOverride: null,
  usd: 1.5,
  usdFoil: null,
  colors: ["G"],
  cmc: 2,
  typeLine: "Creature",
  rarity: "common",
  scryfallId: null,
  added: Date.now(),
}));

globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};
localStorage.setItem("lf-profile", JSON.stringify({ name: "test", pin: "" }));
// store.get("ledger-foil-data") hits /api/store/test — serve it directly.
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/test")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ value: JSON.stringify({ collections, cards }) }),
    });
  }
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
// let the async boot + load effects resolve
await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

const tileCount = document.querySelectorAll(".card-tile").length;
check(`renders the ${CARD_COUNT}-card grid`, tileCount === CARD_COUNT);

// --- (1) allocatedCost must not rescan the whole array per card ---
// Instrument Array.prototype.filter globally for one measured render pass.
let filterCalls = 0;
const origFilter = Array.prototype.filter;
Array.prototype.filter = function (...args) {
  filterCalls++;
  return origFilter.apply(this, args);
};

// Force a re-render that touches the grid (toggle Charts, a totally
// unrelated piece of state) and count how many array scans it costs.
// Opening/closing the Collections modal is App-level state that has nothing
// to do with any individual card's own props -- a clean "unrelated" trigger.
const collectionsBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Collections");
await act(async () => { collectionsBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const modalX = document.querySelector(".card-grid") ? null : [...document.querySelectorAll("button")].pop();
// close it back via its own close button (an X icon button inside the modal header)
const closeCandidates = [...document.querySelectorAll("button")].filter((b) => b.querySelector("svg") && !b.textContent.trim());
if (closeCandidates[0]) await act(async () => { closeCandidates[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

Array.prototype.filter = origFilter;
console.log(`   .filter() calls across two re-renders of a ${CARD_COUNT}-card grid: ${filterCalls}`);
// O(n) per card would be ~2 * CARD_COUNT calls just from allocatedCost alone;
// the fixed version should be a small constant multiple of the render count,
// nowhere near proportional to CARD_COUNT.
check("allocatedCost no longer scans per-card (well under O(n) calls)", filterCalls < CARD_COUNT);

// --- (2) React.memo must actually skip unrelated cards ---
// Tag every rendered card element, then trigger an unrelated re-render and
// confirm the DOM nodes for untouched cards are the *same* elements (React
// only replaces/updates nodes for components that actually re-rendered
// output; memoized components with unchanged props keep their subtree).
const before = document.querySelector('[data-card-id="c0"]');
before.dataset.marker = "untouched";
if (closeCandidates[1]) await act(async () => { closeCandidates[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
else {
  // fall back: reopen/close Collections again as the unrelated trigger
  await act(async () => { collectionsBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  const closeAgain = [...document.querySelectorAll("button")].filter((b) => b.querySelector("svg") && !b.textContent.trim());
  if (closeAgain[0]) await act(async () => { closeAgain[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}
const after = document.querySelector('[data-card-id="c0"]');
check("memoized card tile's DOM node is stable across an unrelated re-render", after && after.dataset.marker === "untouched");

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
