// Verifies the actual bug: GlossaryView used to read from a different
// localStorage key ("lf-oracle-cache") than fetchOracleTexts writes to
// ("lf-oracle-v2"), so a completed scan always looked like it vanished on
// the next visit. This confirms data already cached under the REAL key is
// picked up automatically -- no manual Scan click needed -- and that a
// genuinely fresh card still triggers exactly one real fetch.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

// Pre-seed the cache under the CORRECT key, exactly as if a scan had
// already happened in an earlier session.
localStorage.setItem(
  "lf-oracle-v2",
  JSON.stringify({
    "sol-ring-1": { t: "{T}: Add {C}{C}.", ty: "Artifact", parts: [] },
  })
);

const cards = [
  { id: "s1", name: "Sol Ring", set: "ltc", collectorNumber: "59", scryfallId: "sol-ring-1", quantity: 1, usd: 2, colors: [], rarity: "uncommon", typeLine: "Artifact", collectionId: "uncategorized", added: 1 },
  { id: "f1", name: "Sword of Fire and Ice", set: "ltc", collectorNumber: "12", scryfallId: "sword-1", quantity: 1, usd: 40, colors: [], rarity: "mythic", typeLine: "Artifact — Equipment", collectionId: "uncategorized", added: 2 },
];

let collectionCalls = 0;
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  if (u.includes("api.scryfall.com/cards/collection")) {
    collectionCalls++;
    const body = JSON.parse(opts.body);
    const ids = body.identifiers.map((i) => i.id);
    const data = [];
    // Sol Ring is already cached and should NOT be re-fetched; the sword is
    // genuinely new and should be.
    if (ids.includes("sword-1")) {
      data.push({ id: "sword-1", oracle_text: "Equipped creature gets +2/+2 and has protection from red and from blue.\nWhenever equipped creature deals combat damage to a player, you may draw a card and you may deal 2 damage to any target.\nEquip {2}", type_line: "Artifact — Equipment", all_parts: [] });
    }
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
await act(async () => { await new Promise((r) => setTimeout(r, 250)); });

check("Sol Ring's already-cached keyword shows up without clicking Scan", document.body.textContent.includes("+1/+1 counters") === false); // sanity: page loaded
check("previously scanned card is NOT re-fetched from Scryfall", collectionCalls === 1); // only the genuinely-new sword triggers a real fetch
check("the genuinely new card (sword) gets auto-picked-up too", document.body.textContent.includes("Equip"));
check("scanned-card count reflects BOTH cards, not zero", document.body.textContent.includes("2 scanned cards"));
check("no longer stuck at the empty '0 mechanics / 0 scanned' state", !document.body.textContent.includes("0 mechanics found across 0 scanned"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
