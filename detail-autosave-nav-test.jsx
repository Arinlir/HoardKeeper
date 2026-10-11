// The card detail modal saves edits on its own (no Save button) and can step
// to the previous/next card in the grid without closing — so going through a
// long run of cards is: change what's wrong, press →, repeat.
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


Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

const mk = (id, name, added) => ({
  id, name, set: "m3c", collectorNumber: String(added), scryfallId: "s-" + id,
  quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", location: "",
  usd: 1, colors: [], rarity: "common", typeLine: "Instant", added,
});
// default sort is newest first: c3, c2, c1
const cards = [mk("c1", "Alpha Strike", 1), mk("c2", "Bravo Bolt", 2), mk("c3", "Charlie Charm", 3)];
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
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
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
const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const wait = async (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const dialog = () => document.querySelector('[role="dialog"]');
const title = () => dialog()?.querySelector("h2")?.textContent;
const savedCards = () => JSON.parse(putCalls[putCalls.length - 1].value).cards;
const setValue = async (el, value) => {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  await act(async () => { el[key].onChange({ target: { value } }); });
};

// open the middle card
await click(document.querySelector('[data-card-id="c2"]'));
check("detail opens on the clicked card", title() === "Bravo Bolt");
check("no Save button", ![...dialog().querySelectorAll("button")].some((b) => b.textContent.trim().startsWith("Save")));
check("position shown as 2 / 3", dialog().querySelector('[data-role="card-nav"]')?.textContent.includes("2 / 3"));

// just opening a card writes nothing
// (the app may still do its own post-load save — what matters is that the
// card itself comes through untouched, with no fields added or normalised)
await wait(800);
const c2Before = JSON.stringify(cards.find((c) => c.id === "c2"));
check("opening a card doesn't rewrite it", putCalls.length === 0 || JSON.stringify(savedCards().find((c) => c.id === "c2")) === c2Before);

// a select change saves by itself
await setValue(dialog().querySelector("#dm-condition"), "LP");
await wait(800);
check("condition change saved without clicking anything", savedCards().find((c) => c.id === "c2")?.condition === "LP");

// typed field, then immediately step to the next card — the pending edit
// must land on the card it was typed into, not the next one
await setValue(dialog().querySelector("#dm-location"), "Binder 7");
const next = document.querySelector('[data-role="side-next"]');
await click(next);
check("Next steps to the next card in grid order", title() === "Alpha Strike");
check("stepper shows 3 / 3", dialog().querySelector('[data-role="card-nav"]')?.textContent.includes("3 / 3"));
check("Next disabled on the last card", document.querySelector('[data-role="side-next"]').disabled);
check("the new card's form starts from its own values", dialog().querySelector("#dm-location").value === "");
await wait(800);
let saved = savedCards();
check("location typed before stepping saved to the card it was typed on", saved.find((c) => c.id === "c2")?.location === "Binder 7");
check("…and not to the card stepped to", saved.find((c) => c.id === "c1")?.location === "");

// keyboard: ← goes back (when not typing in a field)
await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
check("← goes to the previous card", title() === "Bravo Bolt");
check("…which shows its saved edits", dialog().querySelector("#dm-location").value === "Binder 7" && dialog().querySelector("#dm-condition").value === "LP");
await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
check("← again reaches the first card", title() === "Charlie Charm");
check("Previous disabled on the first card", document.querySelector('[data-role="side-prev"]').disabled);
check("title bar shows only the position, no small arrow buttons", dialog().querySelectorAll('[data-role="card-nav"] button').length === 0);

// arrows typed inside a text field don't navigate
const loc = dialog().querySelector("#dm-location");
await act(async () => { loc.focus(); });
await act(async () => { loc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
check("→ inside a text field stays on the card", title() === "Charlie Charm");

// the big arrows beside the dialog do the same as the title-bar ones
const backdrop = () => document.querySelector('[data-role="modal-backdrop"]');
const sideNext = () => backdrop().querySelector('[data-role="side-next"]');
const sidePrev = () => backdrop().querySelector('[data-role="side-prev"]');
check("big side arrows sit outside the dialog", !!sideNext() && !dialog().contains(sideNext()) && !dialog().contains(sidePrev()));
check("side Previous disabled on the first card", sidePrev().disabled);
await click(sideNext());
check("side Next steps forward without closing the modal", !!dialog() && title() === "Bravo Bolt");
await click(sidePrev());
check("side Previous steps back", title() === "Charlie Charm");

// phone: swipe left = next card, swipe right = previous; vertical drags and
// swipes that start in a text field don't change card
const touch = async (el, type, x, y) => {
  const ev = new dom.window.Event(type, { bubbles: true });
  const pt = [{ clientX: x, clientY: y }];
  Object.defineProperty(ev, type === "touchend" ? "changedTouches" : "touches", { value: pt });
  if (type === "touchend") Object.defineProperty(ev, "touches", { value: [] });
  await act(async () => { el.dispatchEvent(ev); });
};
const swipe = async (el, dx, dy) => {
  await touch(el, "touchstart", 200, 300);
  await touch(el, "touchend", 200 + dx, 300 + dy);
};
check("starting on the first card", title() === "Charlie Charm");
await swipe(dialog().querySelector("h2"), -120, 10);
check("swipe left goes to the next card", title() === "Bravo Bolt");
await swipe(dialog().querySelector("h2"), 120, -5);
check("swipe right goes back", title() === "Charlie Charm");
await swipe(dialog().querySelector("h2"), -40, 300);
check("a vertical drag (scrolling) doesn't change card", title() === "Charlie Charm");
await swipe(dialog().querySelector("#dm-location"), -150, 0);
check("a swipe starting in a text field doesn't change card", title() === "Charlie Charm");
await swipe(dialog().querySelector("h2"), 150, 0);
check("swipe right on the first card does nothing", title() === "Charlie Charm");

// closing with a pending typed edit still saves it
await setValue(dialog().querySelector("#dm-location"), "Shoebox");
await click(dialog().querySelector('button[aria-label="Close"]'));
check("modal closed", !dialog());
await wait(800);
check("edit pending at close was saved", savedCards().find((c) => c.id === "c3")?.location === "Shoebox");

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
