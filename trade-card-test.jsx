// Trading is the card-for-card sibling of Selling: same "sold" plumbing under
// the hood (see App.jsx's onTrade), so the same stacking rules apply — the
// trade dialog has to open ON TOP of the card's own detail view. Unlike
// selling, confirming a trade also resolves whatever you say you got back
// against Scryfall itself and adds it directly — no second "Add a card"
// modal, no manual search.
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
// React's synthetic input events need this defined before anything types
// into a controlled input (see hoardkeeper_build_env memory notes).
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

const cards = [
  { id: "c1", name: "Rhystic Study", set: "prp", setName: "Prophecy", collectorNumber: "45", scryfallId: "sid-rhystic",
    quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "vault", location: "",
    usd: 30, colors: ["U"], rarity: "common", typeLine: "Enchantment", added: 1 },
  { id: "c2", name: "Sensei's Divining Top", set: "chk", setName: "Champions of Kamigawa", collectorNumber: "220", scryfallId: "sid-top",
    quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "vault", location: "",
    usd: 40, colors: [], rarity: "rare", typeLine: "Artifact", added: 1 },
];
let saved = null;
let scryfallCalls = 0;
let maxConcurrentScryfall = 0;
let inFlightScryfall = 0;
const CARD_DATA = {
  "mana crypt": { name: "Mana Crypt", set: "vma", set_name: "Vintage Masters", collector_number: "10", id: "sid-manacrypt", prices: { usd: "150.00" }, color_identity: [], type_line: "Artifact", rarity: "mythic" },
  "sol ring": { name: "Sol Ring", set: "c21", set_name: "Commander 2021", collector_number: "263", id: "sid-solring", prices: { usd: "2.00" }, color_identity: [], type_line: "Artifact", rarity: "uncommon" },
  "arcane signet": { name: "Arcane Signet", set: "eld", set_name: "Throne of Eldraine", collector_number: "331", id: "sid-signet", prices: { usd: "3.00" }, color_identity: [], type_line: "Artifact", rarity: "common" },
};
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") {
    // body is { value, pin }; value is itself a JSON-encoded snapshot string.
    saved = JSON.parse(JSON.parse(opts.body).value);
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store")) return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  if (u.startsWith("https://api.scryfall.com/cards/named")) {
    const name = decodeURIComponent(new URL(u).searchParams.get("fuzzy") || "").toLowerCase();
    scryfallCalls++;
    inFlightScryfall++;
    maxConcurrentScryfall = Math.max(maxConcurrentScryfall, inFlightScryfall);
    // A real delay here matters: it's what makes overlapping requests actually
    // overlap in this mock, so maxConcurrentScryfall can catch a regression
    // back to firing every lookup at once instead of one at a time.
    const data = CARD_DATA[name];
    return new Promise((resolve) => {
      setTimeout(() => {
        inFlightScryfall--;
        if (data) resolve({ ok: true, json: async () => ({ ...data }) });
        else resolve({ ok: false, json: async () => ({}) });
      }, 15);
    });
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

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const backdrops = () => [...document.querySelectorAll('[data-role="modal-backdrop"]')];
const titleOf = (backdrop) => backdrop.querySelector("h2")?.textContent.trim();
const buttonsIn = (el, text) => [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const tileNamed = (name) => [...document.querySelectorAll("[data-card-id]")].find((t) => t.textContent.includes(name));

await act(async () => {
  document.querySelector('[data-card-id="c1"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
check("the card's detail view opened", backdrops().length === 1 && titleOf(backdrops()[0]) === "Rhystic Study");

const tradeBtn = buttonsIn(document, "Trade");
check("it offers to trade the card, alongside Sell", !!tradeBtn && !!buttonsIn(document, "Sell"));
await act(async () => { tradeBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

let open = backdrops();
check("both the card and the trade dialog are open", open.length === 2);
check("the trade dialog is the one on top", /^Trade /.test(titleOf(open[open.length - 1]) || ""));
const tradeDialog = open[open.length - 1];

// Two cards typed in: one Scryfall knows, one it doesn't.
await act(async () => { setNativeValue(tradeDialog.querySelector("#trade-for"), "Mana Crypt"); });
const addAnotherBtn = buttonsIn(tradeDialog, "Another card");
await act(async () => { addAnotherBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const nameInputs = tradeDialog.querySelectorAll('[aria-label="Card name received"]');
check("a second card row can be added", nameInputs.length === 2);
await act(async () => { setNativeValue(nameInputs[1], "Not A Real Magic Card"); });

// First confirm: the unmatched name should stop it short of committing, and
// say so, rather than silently dropping it.
let confirmBtn = buttonsIn(tradeDialog, "Mark traded");
await act(async () => { confirmBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
// Two rows now means one RATE_MS (100ms) gap plus the mock's own per-request
// delay in between the two sequential lookups — wait past that comfortably.
await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
check("the dialog is still open after a partial match", backdrops().length === 2);
check("it names what it couldn't find", tradeDialog.textContent.includes("Not A Real Magic Card"));

// Second confirm: go ahead without the one that didn't match.
confirmBtn = buttonsIn(tradeDialog, "Mark traded anyway");
check("the button now offers to proceed anyway", !!confirmBtn);
await act(async () => { confirmBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
// Only one row is left unresolved here (resolved already holds the match), so
// this path skips the lookups entirely — but give it the same headroom.
await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

open = backdrops();
check("confirming closes both the trade dialog and the card — no Add a card modal", open.length === 0);
check("the traded card is off the main grid", !document.querySelector('[data-card-id="c1"]'));
check("the card that resolved was added for real, no manual search", !!tileNamed("Mana Crypt"));
check("the one that didn't match was not invented as a card", !tileNamed("Not A Real Magic Card"));

// The vault write is debounced 500ms after the last edit — give it time to fire.
await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
const rhystic = saved?.cards?.find((c) => c.name === "Rhystic Study");
const manaCrypt = saved?.cards?.find((c) => c.name === "Mana Crypt");
check(
  "the outgoing card's own record names everything typed, matched or not",
  rhystic?.sold === true && rhystic?.tradedFor === "Mana Crypt, Not A Real Magic Card"
);
check(
  "the incoming card carries the traded-away value as its cost, not a free lunch",
  manaCrypt && manaCrypt.costOverride === 30 && manaCrypt.collectionId === "vault"
);
check(
  "the two lookups in that trade never overlapped — one at a time, not a burst",
  maxConcurrentScryfall <= 1
);

// The bug report: trading for MULTIPLE cards that both resolve. This is the
// scenario a naive Promise.allSettled/parallel fetch would break under a
// mock that penalizes overlapping requests — sequential lookups (with the
// RATE_MS gap) are what make it work here.
await act(async () => {
  document.querySelector('[data-card-id="c2"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
check("the second card's detail view opened", backdrops().length === 1 && titleOf(backdrops()[0]) === "Sensei's Divining Top");

const tradeBtn2 = buttonsIn(document, "Trade");
await act(async () => { tradeBtn2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
open = backdrops();
check("the second trade dialog opened on top", open.length === 2 && /^Trade /.test(titleOf(open[open.length - 1]) || ""));
const tradeDialog2 = open[open.length - 1];

await act(async () => { setNativeValue(tradeDialog2.querySelector("#trade-for"), "Sol Ring"); });
await act(async () => { buttonsIn(tradeDialog2, "Another card").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const nameInputs2 = tradeDialog2.querySelectorAll('[aria-label="Card name received"]');
check("a second row is available for the second trade too", nameInputs2.length === 2);
await act(async () => { setNativeValue(nameInputs2[1], "Arcane Signet"); });

const confirmBtn2 = buttonsIn(tradeDialog2, "Mark traded");
await act(async () => { confirmBtn2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
// Two sequential lookups now cost ~RATE_MS (100ms) plus the mock's own 15ms
// delay each — give it comfortable headroom.
await act(async () => { await new Promise((r) => setTimeout(r, 400)); });

open = backdrops();
check("both cards matching closes the dialog outright, no failure banner", open.length === 0);
check("the traded-away card is off the main grid", !document.querySelector('[data-card-id="c2"]'));
check("both cards traded for were added, not just the first one", !!tileNamed("Sol Ring") && !!tileNamed("Arcane Signet"));
check(
  "the multi-card lookups still never overlapped",
  maxConcurrentScryfall <= 1
);

await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
const top = saved?.cards?.find((c) => c.name === "Sensei's Divining Top");
const solRing = saved?.cards?.find((c) => c.name === "Sol Ring");
const arcaneSignet = saved?.cards?.find((c) => c.name === "Arcane Signet");
check(
  "the outgoing card records both names it was traded for",
  top?.sold === true && top?.tradedFor === "Sol Ring, Arcane Signet"
);
check(
  "the value traded away split evenly across both cards that came back",
  solRing && solRing.costOverride === 20 && solRing.collectionId === "vault" &&
  arcaneSignet && arcaneSignet.costOverride === 20 && arcaneSignet.collectionId === "vault"
);

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
