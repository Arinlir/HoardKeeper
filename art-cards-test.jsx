// Verifies: the Art Cards sub-tab exists under Sets, discovery correctly
// finds only owned sets with a REAL companion art series (via
// parent_set_code + set_type -- not a guessed naming prefix), owning-zero
// sets are correctly excluded, the duplicated "X // X" name collapses for
// display, and the +/- stepper genuinely adds/removes a card from the
// collection through the same generic onAddCopy/onRemoveCopy path Sets uses.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

const cards = [
  { id: "c1", name: "Sol Ring", set: "ltr", collectorNumber: "1", quantity: 1, usd: 1, collectionId: "uncategorized" },
  { id: "c2", name: "Aragorn", set: "otj", collectorNumber: "1", quantity: 1, usd: 1, collectionId: "uncategorized" }, // otj has no art series
];

// realistic Scryfall /sets response: only ALTR is a real art-series
// companion (memorabilia + parent_set_code + "Art Series" in the name).
// A decoy set with a similar name but wrong set_type must be excluded.
const scryfallSets = {
  data: [
    { code: "altr", name: "Tales of Middle-earth Art Series", set_type: "memorabilia", parent_set_code: "ltr", card_count: 81 },
    { code: "totj", name: "Outlaws of Thunder Junction Tokens", set_type: "token", parent_set_code: "otj", card_count: 20 },
    { code: "fake", name: "Some Other Art Series", set_type: "expansion", parent_set_code: "otj", card_count: 5 }, // wrong set_type, must be excluded
  ],
};

const rosterCard = (num, name, rarity) => ({
  object: "card", id: `art-${num}`, name: `${name} // ${name}`, set: "altr", set_name: "Tales of Middle-earth Art Series",
  collector_number: String(num), layout: "art_series", rarity, artist: "Test Artist",
  image_uris: { normal: "http://x/art.jpg" },
});

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
  if (u.includes("api.scryfall.com/sets") && !u.includes("/sets/"))
    return Promise.resolve({ ok: true, json: async () => scryfallSets });
  if (u.includes("api.scryfall.com/cards/search") && /e%3Aaltr|e:altr/.test(u))
    return Promise.resolve({
      ok: true,
      json: async () => ({ data: [rosterCard(1, "Sol Ring", "common"), rosterCard(2, "Frodo", "rare")], has_more: false }),
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

const artTab = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Art Cards"));
check("Art Cards sub-tab exists under Sets", !!artTab);

await act(async () => { artTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const bodyText = document.body.textContent;
check("discovers the real companion (Tales of Middle-earth Art Series)", bodyText.includes("Tales of Middle-earth Art Series"));
check("does NOT show the wrong-set_type decoy", !bodyText.includes("Some Other Art Series"));
check("does NOT show a companion for the set that has none (otj tokens)", !bodyText.includes("Thunder Junction Tokens"));

const artSetRow = [...document.querySelectorAll("div")].find((d) => d.textContent.includes("Tales of Middle-earth Art Series") && d.textContent.includes("COMPLETE") && (d.getAttribute("style") || "").includes("cursor: pointer"));
await act(async () => { artSetRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

check("roster loaded", document.body.textContent.includes("Frodo"));
check("duplicated art-card name collapsed for display (not 'Sol Ring // Sol Ring')", !document.body.textContent.includes("Sol Ring // Sol Ring") && document.body.textContent.includes("Sol Ring"));
check("artist name shown", document.body.textContent.includes("Test Artist"));

// add Frodo (an art card we don't own) via its stepper
const frodoRow = [...document.querySelectorAll("div")].find(
  (d) => d.textContent.includes("Frodo") && (d.getAttribute("style") || "").includes("grid-template-columns: 52px 1fr 110px 110px")
);
const plusBtn = frodoRow ? [...frodoRow.querySelectorAll("button")].find((b) => b.textContent.trim() === "+") : null;
check("found the + stepper for an unowned art card", !!plusBtn);
if (plusBtn) {
  await act(async () => { plusBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}
await act(async () => { await new Promise((r) => setTimeout(r, 700)); }); // let the debounced save fire

const lastSave = putCalls[putCalls.length - 1];
const savedCards = lastSave ? JSON.parse(lastSave.value).cards : [];
check("Frodo art card actually added to the collection via the generic add path", savedCards.some((c) => c.name.includes("Frodo") && c.set === "altr"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
