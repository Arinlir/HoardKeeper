// Selling is reached from a card's own detail view. The sell dialog has to open
// ON TOP of it — both use the same z-index, so what settles it is which one
// React renders last.
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

const cards = [
  { id: "c1", name: "Rhystic Study", set: "prp", setName: "Prophecy", collectorNumber: "45", scryfallId: "sid-rhystic",
    quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", location: "",
    usd: 30, colors: ["U"], rarity: "common", typeLine: "Enchantment", added: 1 },
];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  if (u.includes("/api/store")) return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
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

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const backdrops = () => [...document.querySelectorAll('[data-role="modal-backdrop"]')];
const titleOf = (backdrop) => backdrop.querySelector("h2")?.textContent.trim();

await act(async () => {
  document.querySelector('[data-card-id="c1"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
check("the card's detail view opened", backdrops().length === 1 && titleOf(backdrops()[0]) === "Rhystic Study");

const sellBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Sell");
check("it offers to sell the card", !!sellBtn);
await act(async () => { sellBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const open = backdrops();
check("both the card and the sell dialog are open", open.length === 2);
// Same z-index, same stacking context: the one that comes last in the document
// is the one on top. That's the whole bug — the sell dialog used to be first.
check("the sell dialog is the one on top", /^Sell /.test(titleOf(open[open.length - 1]) || ""));
check("the card's detail view is the one behind", titleOf(open[0]) === "Rhystic Study");

// backing out of the sale puts you back on the card, not in the grid
const cancel = [...open[open.length - 1].querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel");
if (cancel) {
  await act(async () => { cancel.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  check("cancelling the sale leaves you on the card", backdrops().length === 1 && titleOf(backdrops()[0]) === "Rhystic Study");
} else {
  await act(async () => { open[open.length - 1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  check("dismissing the sale leaves you on the card", backdrops().length === 1 && titleOf(backdrops()[0]) === "Rhystic Study");
}

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
