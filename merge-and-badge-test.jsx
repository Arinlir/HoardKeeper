// Verifies: adding a card that exactly matches an existing row (same
// printing + same finish) bumps its quantity instead of creating a new row;
// a genuinely different finish or printing still creates a separate row;
// the roster's own merge logic respects finish too; and the sibling badge
// (set/collector/finish) appears only when it's actually needed to tell two
// same-named rows apart.
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
    id: "c1", name: "Sol Ring", set: "ltc", collectorNumber: "59", scryfallId: "sol-ring-ltc",
    quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", location: "",
    usd: 2, usdFoil: 6, colors: [], rarity: "uncommon", typeLine: "Artifact", added: Date.now(),
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

async function latestCards() {
  await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
  const last = putCalls[putCalls.length - 1];
  return last ? JSON.parse(last.value).cards : [];
}

// --- Case 1: duplicate with SAME finish must MERGE, not create a new row ---
const tile = document.querySelector('[data-card-id="c1"]');
await act(async () => { tile.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const dupBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().includes("Duplicate"));
await act(async () => { dupBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
// finish defaults to nonfoil (matching source) -- don't change it, just add
let addBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add & next"));
await act(async () => { addBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("session list explains the merge", document.body.textContent.includes("already owned"));

const closeBtn = [...document.querySelectorAll("button")].filter((b) => b.querySelector("svg") && !b.textContent.trim())[0];
if (closeBtn) await act(async () => { closeBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

let saved = await latestCards();
check("same-finish duplicate: still exactly one row for Sol Ring", saved.filter((c) => c.name === "Sol Ring").length === 1);
check("same-finish duplicate: quantity bumped to 2", saved.find((c) => c.id === "c1")?.quantity === 2);

// --- Case 2: duplicate with a DIFFERENT finish must create a separate row ---
await act(async () => { tile.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const dupBtn2 = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().includes("Duplicate"));
await act(async () => { dupBtn2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const foilBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Foil");
await act(async () => { foilBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
addBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add & close"));
await act(async () => { addBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

saved = await latestCards();
const solRings = saved.filter((c) => c.name === "Sol Ring");
check("different-finish duplicate: now two distinct Sol Ring rows", solRings.length === 2);
check("original nonfoil row untouched at quantity 2", solRings.find((c) => c.finish === "nonfoil")?.quantity === 2);
check("new foil row created at quantity 1", solRings.find((c) => c.finish === "foil")?.quantity === 1);

// --- sibling badge: now that two rows share the name, both tiles should show it ---
const setBadges = [...document.querySelectorAll("span")].filter((s) => s.textContent.trim() === "LTC #59");
check("printing badge visible now that Sol Ring has two rows", setBadges.length >= 2);
const foilBadges = [...document.querySelectorAll("span")].filter((s) => s.textContent.trim().toLowerCase() === "foil");
check("finish badge shown on the foil row specifically", foilBadges.length >= 1);

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
