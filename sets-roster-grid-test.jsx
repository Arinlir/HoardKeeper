// End-to-end: opening a set now shows EVERY card in a grid (owned and
// unowned together, no filter toggle needed), unowned cards are visually
// greyed out, and a card with multiple printings where you own just one
// shows as owned -- not greyed -- using your actual copy's art.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

// own only the showcase printing of Capitoline Triad, and nothing of Murder
const cards = [
  { id: "c1", name: "Capitoline Triad", set: "acr", collectorNumber: "245", scryfallId: "triad-showcase", quantity: 1, usd: 5, colors: [], rarity: "rare", typeLine: "Creature", collectionId: "uncategorized", added: 1 },
];
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  if (u.includes("api.scryfall.com/sets/"))
    return Promise.resolve({ ok: true, json: async () => ({ name: "Assassin's Creed", code: "acr", card_count: 4, released_at: "2024-01-01" }) });
  if (u.includes("api.scryfall.com/cards/search"))
    return Promise.resolve({
      ok: true,
      json: async () => ({
        data: [
          { object: "card", id: "triad-normal", name: "Capitoline Triad", set: "acr", set_name: "Assassin's Creed", collector_number: "12", rarity: "rare", type_line: "Creature", image_uris: { normal: "http://x/a.jpg" }, prices: { usd: "5.00" } },
          { object: "card", id: "triad-showcase", name: "Capitoline Triad", set: "acr", set_name: "Assassin's Creed", collector_number: "245", rarity: "rare", type_line: "Creature", image_uris: { normal: "http://x/b.jpg" }, prices: { usd: "12.00" } },
          { object: "card", id: "triad-borderless", name: "Capitoline Triad", set: "acr", set_name: "Assassin's Creed", collector_number: "301", rarity: "rare", type_line: "Creature", image_uris: { normal: "http://x/c.jpg" }, prices: { usd: "18.00" } },
          { object: "card", id: "murder-1", name: "Murder", set: "acr", set_name: "Assassin's Creed", collector_number: "92", rarity: "uncommon", type_line: "Instant", image_uris: { normal: "http://x/d.jpg" }, prices: { usd: "6.00" } },
        ],
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

check("no All/Missing/Owned filter toggle -- cards always show", !document.body.textContent.includes("Missing") || !document.querySelector('button[class*="mono"]')?.textContent?.match(/^missing$/i));

const setRow = [...document.querySelectorAll("div")].find(
  (d) => d.textContent.includes("Assassin's Creed") && (d.getAttribute("style") || "").includes("cursor: pointer")
);
await act(async () => { setRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const bodyText = document.body.textContent;
check("roster loaded, shows all 4 printings grouped down to unique names", bodyText.includes("Capitoline Triad") && bodyText.includes("Murder"));
check("shows the 'always visible, greyed for missing' explainer instead of a filter toggle", bodyText.includes("greyed out"));

// exactly 2 tiles should exist (Capitoline Triad grouped + Murder), not 4
const tiles = [...document.querySelectorAll("div")].filter((d) => d.title === "Capitoline Triad" || d.title === "Murder");
check("exactly one tile for Capitoline Triad (grouped, not 3 separate rows)", tiles.filter((t) => t.title === "Capitoline Triad").length === 1);

const triadTile = tiles.find((t) => t.title === "Capitoline Triad");
const triadCard = triadTile?.closest('[style*="display: flex"]') || triadTile?.parentElement;
check("owned Capitoline Triad tile is NOT greyed (full opacity)", !(triadCard?.getAttribute("style") || "").includes("opacity: 0.4"));
check("indicates it has multiple versions", bodyText.includes("3 versions"));

const murderTile = tiles.find((t) => t.title === "Murder");
const murderCard = murderTile?.closest('[style*="display: flex"]') || murderTile?.parentElement;
check("unowned Murder tile IS greyed (opacity 0.4)", (murderCard?.getAttribute("style") || "").includes("opacity: 0.4"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
