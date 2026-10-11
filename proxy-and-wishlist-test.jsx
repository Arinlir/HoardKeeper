// Covers the three things a proxy has to do (carry no value, take no share of
// a collection's cost, and stay out of set completion), the wishlist tab and
// its public link, and searching the collection by the words printed on a card
// rather than only its name.
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

// Rules text already scanned for one card, exactly as the glossary and the
// card zoom leave it.
localStorage.setItem(
  "lf-oracle-v4",
  JSON.stringify({
    "sid-displacer": { t: "When this creature enters, venture into the dungeon.", ty: "Creature — Cat Beast", parts: [] },
    "sid-solring": { t: "{T}: Add {C}{C}.", ty: "Artifact", parts: [] },
    "sid-rhystic": { t: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.", ty: "Enchantment", parts: [] },
  })
);

const collections = [{ id: "col1", name: "Box", purchasePrice: 100 }];
const cards = [
  // a real card, alone in the collection that has a 100 purchase total
  { id: "c1", name: "Displacer Beast", set: "afr", setName: "Adventures in the Forgotten Realms", collectorNumber: "305",
    scryfallId: "sid-displacer", quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "col1", location: "",
    usd: 10, usdFoil: 20, colors: ["U"], rarity: "uncommon", typeLine: "Creature — Cat Beast", added: 3 },
  // a proxy in the same collection: no value, and no share of the 100
  { id: "c2", name: "Sol Ring", set: "afr", setName: "Adventures in the Forgotten Realms", collectorNumber: "59",
    scryfallId: "sid-solring", quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "col1", location: "",
    usd: 50, usdFoil: 90, colors: [], rarity: "uncommon", typeLine: "Artifact", added: 2, proxy: true },
  // owned, wanted as a real upgrade, in no collection so it costs nothing
  { id: "c3", name: "Rhystic Study", set: "prp", setName: "Prophecy", collectorNumber: "45",
    scryfallId: "sid-rhystic", quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", location: "",
    usd: 30, usdFoil: 60, colors: ["U"], rarity: "common", typeLine: "Enchantment", added: 1, wanted: true, wantNote: "foil please" },
];
const wishlist = [
  { id: "w1", name: "Mana Crypt", set: "", setName: "", collectorNumber: "", scryfallId: null, quantity: 1,
    finish: "nonfoil", priority: "high", note: "birthday", usd: 80, colors: [], rarity: "mythic", typeLine: "Artifact", added: 9 },
];

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
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections, cards, wishlist }) }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

function tileIds() {
  return [...document.querySelectorAll("[data-card-id]")].map((el) => el.getAttribute("data-card-id"));
}
function tileText(id) {
  const el = document.querySelector(`[data-card-id="${id}"]`);
  return el ? el.textContent : "";
}

// ---- 1. the proxy carries no value and no cost ----
const body = document.body.textContent;
// Worth = 10 (real) + 30 (wanted, still a real card); the 50 proxy adds nothing
check("proxy adds nothing to Worth", body.includes("$40.00"));
// Invested = the whole 100 on the one real card in that collection; a proxy
// sharing the box must not dilute it to 50
check("proxy takes no share of the collection's cost", body.includes("$100.00"));
check("proxy tile shows no price", tileText("c2").includes("NO VALUE"));
check("proxy tile is labelled PROXY", tileText("c2").includes("PROXY") || tileText("c2").includes("Proxy"));
check("a real card still shows its price", tileText("c1").includes("$10.00"));
check("there's a filter chip for proxies", body.includes("Proxies (1)"));

// ---- 2. searching the words printed on the card ----
const searchBox = document.querySelector('input[type="search"]');
// React 18's delegated input events don't fire under this jsdom harness (mouse
// events do, which is why every other test clicks), so typing goes through the
// input's own onChange the way React would have called it. What's under test is
// the filtering, not React's event plumbing.
const reactProps = Object.keys(searchBox).find((k) => k.startsWith("__reactProps$"));
async function type(text) {
  await act(async () => {
    document.querySelector('input[type="search"]')[reactProps].onChange({ target: { value: text } });
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

await type("venture into the dungeon");
check("rules text finds a card its name never would", tileIds().join() === "c1");

await type("opponent casts a spell");
check("rules text matches a second card independently", tileIds().join() === "c3");

await type("sol ring");
check("searching by name still works", tileIds().join() === "c2");

// narrowing the scope back to names only must stop matching rules text
const scopeToggle = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Name + text"));
check("the search scope is switchable", !!scopeToggle);
await act(async () => { scopeToggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await type("venture into the dungeon");
check("name-only scope ignores rules text", tileIds().length === 0);
await type("");

// ---- 3. the wishlist tab ----
const wishTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Wishlist");
check("there's a Wishlist tab", !!wishTab);
await act(async () => { wishTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

const wishText = document.body.textContent;
check("the wishlist entry is listed", wishText.includes("Mana Crypt"));
check("its note is shown", document.querySelector('[data-wishlist-id="w1"] input')?.value === "birthday");
check("the public link is offered", wishText.includes("/w/michael"));
check("an owned card wanted as an upgrade is listed to replace", !!document.querySelector('[data-replace-id="c3"]'));
check("a card that isn't wanted stays out of the replace list", !document.querySelector('[data-replace-id="c1"]'));

// bumping a wishlist quantity saves through the same vault as everything else
const plus = document.querySelector('[data-wishlist-id="w1"] [aria-label="Increase quantity"]');
await act(async () => { plus.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
const savedVault = putCalls.length ? JSON.parse(putCalls[putCalls.length - 1].value) : null;
check("the wishlist is saved into the vault", savedVault?.wishlist?.[0]?.quantity === 2);
check("saving the wishlist doesn't disturb the collection", savedVault?.cards?.length === 3);

// ---- 4. a CSV that leaves here comes back with its flags ----
const { __test_guessMapping: guessMapping } = await import("./src/lib/testExports.js");
const roundTrip = guessMapping(["Name", "Set", "Quantity", "Proxy", "Wanted"]);
check("an exported Proxy column maps itself on re-import", roundTrip.proxy === "Proxy");
check("an exported Wanted column maps itself on re-import", roundTrip.wanted === "Wanted");

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
