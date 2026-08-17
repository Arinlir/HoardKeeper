// Verifies: a Duplicate button exists on an owned card, clicking it opens
// Add Card pre-loaded with that exact printing (no search needed), defaults
// match the source card's finish/condition/collection, changing the finish
// (the actual foil-you-just-pulled case) works, and confirming adds a
// genuinely separate new card row -- the original is untouched.
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

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

const cards = [
  {
    id: "c1", name: "Sol Ring", set: "ltc", collectorNumber: "59", scryfallId: "sol-ring-1",
    quantity: 1, finish: "nonfoil", condition: "LP", collectionId: "col1", location: "Binder 2",
    usd: 2, usdFoil: 6, finishes: ["nonfoil", "foil"], typeLine: "Artifact", colors: [], rarity: "uncommon",
    added: Date.now(),
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
    return Promise.resolve({
      ok: true,
      json: async () => ({ value: JSON.stringify({ collections: [{ id: "col1", name: "Commander", purchasePrice: 10 }], cards }) }),
    });
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

// open the card's detail view
const tile = document.querySelector('[data-card-id="c1"]');
check("card tile found", !!tile);
await act(async () => { tile.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const dupBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().includes("Duplicate"));
check("Duplicate button present on the card's detail view", !!dupBtn);

await act(async () => { dupBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const bodyText = document.body.textContent;
check("opens straight to the duplicate flow (no search box)", bodyText.includes("Duplicating") && !document.querySelector('input[placeholder*="Card name"]'));
check("names the exact same printing", bodyText.includes("Sol Ring") && bodyText.includes("LTC") && bodyText.includes("59"));

// finish defaults to the source card's own finish (nonfoil)
const normalBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Normal");
const foilBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Foil");
check("Normal finish pre-selected to match the source card", (normalBtn?.getAttribute("style") || "").includes("font-weight: 700"));

// switch to Foil -- the actual "I pulled a foil this time" case
await act(async () => { foilBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const addBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add to vault" || b.textContent.includes("Add & close"));
check("an add/confirm button exists", !!addBtn);
await act(async () => { addBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 700)); }); // debounced save

const lastSave = putCalls[putCalls.length - 1];
const savedCards = lastSave ? JSON.parse(lastSave.value).cards : [];
check("original card still present, untouched", savedCards.some((c) => c.id === "c1" && c.finish === "nonfoil"));
check("a genuinely NEW card row was added (not just a quantity bump)", savedCards.length === 2);

const dup = savedCards.find((c) => c.id !== "c1");
check("duplicate is the SAME printing (set + collector number)", dup && dup.set === "ltc" && dup.collectorNumber === "59");
check("duplicate carries the FOIL finish that was picked", dup && dup.finish === "foil");
check("duplicate defaulted into the same collection as the source", dup && dup.collectionId === "col1");

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
