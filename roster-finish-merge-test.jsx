// Verifies the roster +/- fix: a foil-only row of a card must NOT absorb a
// nonfoil pull added via the set roster -- it should create a separate
// nonfoil row instead, since the roster always adds nonfoil copies.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

// own ONLY a foil copy of this card
const cards = [
  {
    id: "c1", name: "Attercop", set: "hob", collectorNumber: "4", scryfallId: "attercop-hob",
    quantity: 1, finish: "foil", condition: "NM", collectionId: "uncategorized", location: "",
    usd: 1, usdFoil: 3, colors: ["G"], rarity: "common", typeLine: "Creature", added: Date.now(),
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
  if (u.includes("api.scryfall.com/sets"))
    return Promise.resolve({ ok: true, json: async () => ({ name: "The Hobbit", code: "hob", card_count: 280, released_at: "2026-01-01" }) });
  if (u.includes("api.scryfall.com/cards/search"))
    return Promise.resolve({
      ok: true,
      json: async () => ({
        data: [{
          object: "card", id: "attercop-hob", name: "Attercop", set: "hob", set_name: "The Hobbit",
          collector_number: "4", rarity: "common", type_line: "Creature — Spider",
          image_uris: { normal: "http://x/a.jpg" }, prices: { usd: "1.00", usd_foil: "3.00" },
          color_identity: ["G"],
        }],
        has_more: false,
      }),
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

const setsTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Sets");
await act(async () => { setsTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const setRow = [...document.querySelectorAll("div")].find(
  (d) => d.textContent.includes("The Hobbit") && (d.getAttribute("style") || "").includes("cursor: pointer")
);
check("found The Hobbit set row", !!setRow);
await act(async () => { setRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

check("roster loaded with Attercop", document.body.textContent.includes("Attercop"));

const rosterRow = [...document.querySelectorAll(".roster-row")].find((d) => d.textContent.includes("Attercop"));
const plusBtn = rosterRow ? [...rosterRow.querySelectorAll("button")].find((b) => b.textContent.trim() === "+") : null;
check("found the roster's + stepper for Attercop", !!plusBtn);

await act(async () => { plusBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 700)); });

const last = putCalls[putCalls.length - 1];
const saved = last ? JSON.parse(last.value).cards : [];
const attercops = saved.filter((c) => c.name === "Attercop");

check("now TWO Attercop rows (foil untouched + new nonfoil)", attercops.length === 2);
check("original foil row still quantity 1, untouched", attercops.find((c) => c.finish === "foil")?.quantity === 1);
check("new nonfoil row created via the roster, quantity 1", attercops.find((c) => c.finish === "nonfoil")?.quantity === 1);

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
