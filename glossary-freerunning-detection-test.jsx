// End-to-end confirmation, no search-box typing needed: a real card with
// Freerunning (Ezio's actual, verbatim Scryfall oracle text) gets correctly
// detected and shown in the default (unfiltered) keyword list once scanned.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

const ezioText =
  "Assassin spells you cast have freerunning {B}{B}. (You may cast a spell for its freerunning cost if you dealt combat damage to a player this turn with an Assassin or commander.)\nWhenever Ezio deals combat damage to a player, you may pay {W}{U}{B}{R}{G} if that player has 10 or less life. When you do, that player loses the game.";
const cards = [
  { id: "ezio1", name: "Ezio Auditore da Firenze", set: "acr", collectorNumber: "25", scryfallId: "ezio", quantity: 1, usd: 20, colors: ["B"], rarity: "mythic", typeLine: "Legendary Creature — Human Assassin", collectionId: "uncategorized", added: 1 },
  { id: "murder1", name: "Murder", set: "acr", collectorNumber: "92", scryfallId: "murder", quantity: 1, usd: 6, colors: ["B"], rarity: "uncommon", typeLine: "Instant", collectionId: "uncategorized", added: 2 },
];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  if (u.includes("api.scryfall.com/cards/collection")) {
    const body = JSON.parse(opts.body);
    const ids = body.identifiers.map((i) => i.id);
    const data = [];
    if (ids.includes("ezio")) data.push({ id: "ezio", oracle_text: ezioText, type_line: "Legendary Creature — Human Assassin", all_parts: [] });
    if (ids.includes("murder")) data.push({ id: "murder", oracle_text: "Destroy target creature.", type_line: "Instant", all_parts: [] });
    return Promise.resolve({ ok: true, json: async () => ({ data }) });
  }
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

const glossaryTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Glossary");
await act(async () => { glossaryTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 300)); });

const bodyText = document.body.textContent;
check("Freerunning appears in the default keyword list", bodyText.includes("Freerunning"));
check("shows exactly 1 card for it (only Ezio has it, not Murder)", bodyText.includes("1 card") && !bodyText.includes("2 cards"));
check("no 'unscanned' button shown -- both cards scanned successfully", !bodyText.includes("unread cards"));
check("header confirms both cards were scanned", bodyText.includes("2 scanned cards"));
check("no search diagnostic shown when nothing was searched", !bodyText.includes("worth reporting") && !bodyText.includes("likely don't own"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
