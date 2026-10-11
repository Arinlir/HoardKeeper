// The /v/<profile> page renders for someone with no profile, no PIN and no
// stored data: it asks the server for one collection and shows it, read-only.
// What's under test is that it shows the cards, searches them, opens the
// decks — and that there is nothing on it that could change anything.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/v/arin" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!("oninput" in dom.window.document)) {
  Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });
}

const payload = {
  profile: "arin",
  currency: "USD",
  collections: [
    { id: "z", name: "Zebra box", parentId: null },
    { id: "a", name: "Alpha box", parentId: null },
    { id: "s", name: "Spare part", parentId: "a" },
  ],
  cards: [
    { id: "c1", name: "Sol Ring", collectionId: "z", set: "ltc", collectorNumber: "59", quantity: 2, usd: 2, typeLine: "Artifact", colors: [], cmc: 1, rarity: "uncommon", finish: "nonfoil" },
    { id: "c2", name: "Treebeard, Gracious Host", collectionId: "s", set: "ltr", collectorNumber: "168", quantity: 1, usd: 6, typeLine: "Legendary Creature — Treefolk", colors: ["G"], cmc: 5, rarity: "rare", finish: "nonfoil" },
    { id: "c3", name: "Fake Bolt", set: "2xm", collectorNumber: "129", quantity: 1, usd: 5, proxy: true, typeLine: "Instant", colors: ["R"], cmc: 1, rarity: "uncommon", finish: "nonfoil" },
  ],
  decks: [
    {
      id: "d1", name: "Treebeard EDH", format: "commander", commanderId: "c2",
      entries: [{ cardId: "c1", qty: 1, role: "ramp" }],
      basics: { Forest: 20 }, categories: [], external: [],
    },
  ],
};

let status = 200;
let asked = [];
globalThis.fetch = (url) => {
  asked.push(String(url));
  if (String(url).includes("api.scryfall.com")) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  return Promise.resolve({ ok: status === 200, status, json: async () => payload });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const { PublicVault } = await import("./src/features/vault/PublicVault.jsx");

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(PublicVault, { name: "arin" })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const text = () => document.body.textContent;
const click = async (el) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
const byText = (t, tag = "button") => [...document.querySelectorAll(tag)].find((b) => b.textContent.trim() === t);

check("it asks the public vault endpoint, with no PIN header", asked.some((u) => u.includes("/api/public/vault/arin")));
check("the collection renders", text().includes("Sol Ring") && text().includes("Treebeard"));
check("it says whose it is, and that it's read only", text().includes("arin's collection") && text().toLowerCase().includes("read only"));
check("counts are shown", text().includes("4 cards"));
check("a proxy shows no value", (() => {
  const tile = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Fake Bolt"));
  return tile.textContent.includes("—") && !tile.textContent.includes("$5");
})());

// ---- nothing here can change anything ----
check("there is no add, edit, sell or settings control", (() => {
  const labels = [...document.querySelectorAll("button, a")].map((b) => (b.textContent || "").toLowerCase());
  return !labels.some((l) => /add card|refresh prices|settings|import|sell|delete|got it|\+ new/.test(l));
})());
check("no quantity steppers", ![...document.querySelectorAll("button")].some((b) => ["+", "−", "-"].includes(b.textContent.trim())));
check("nothing was written to storage", localStorage.length === 0);

// ---- collections, in the owner's order ----
const chipRow = document.querySelector('[data-testid="pv-collections"]');
const chipLabels = () => [...chipRow.querySelectorAll("button.chip")].map((b) => b.textContent.trim());
check("collection chips follow the owner's order, not alphabetical", chipLabels().slice(1, 3).map((l) => l.split(" (")[0]).join() === "Zebra box,Alpha box");
await click(byText("Zebra box (1)"));
check("picking a collection filters to it", text().includes("Sol Ring") && !text().includes("Treebeard"));
await click([...chipRow.querySelectorAll("button.chip")].find((b) => b.textContent.startsWith("Alpha box")));
check("a parent includes its parts", text().includes("Treebeard") && !text().includes("Sol Ring"));
await click(byText("All (3)"));

// ---- search ----
const box = document.querySelector("input.pv-search");
const props = Object.keys(box).find((k) => k.startsWith("__reactProps$"));
const type = async (v) => { await act(async () => { box[props].onChange({ target: { value: v } }); }); };
await type("t:creature");
check("the owner's search syntax works for a guest too", text().includes("Treebeard") && !text().includes("Sol Ring"));
await type("is:proxy");
check("is: works", text().includes("Fake Bolt") && !text().includes("Treebeard,"));
await type("zzzz");
check("an empty result says so", text().includes("Nothing matches"));
await type("");

// ---- decks ----
await click(byText("Decks"));
check("the decks are listed", text().includes("Treebeard EDH"));
await click([...document.querySelectorAll("button")].find((b) => b.textContent.includes("Treebeard EDH")));
check("a deck opens with its cards", text().includes("Sol Ring") && text().includes("Forest"));
check("the deck's format and value are shown", text().includes("Commander") && text().includes("$"));
check("you can get back to the list", !!byText("← All decks"));

// ---- a vault that hasn't opted in ----
// A link across to the wishlist, but only when there's something on it.
check("no wishlist link when the wishlist is empty", !document.querySelector('[data-testid="wishlist-link"]'));
payload.wishlistCount = 3;
{
  const wHost = document.createElement("div");
  document.body.appendChild(wHost);
  const wRoot = createRoot(wHost);
  await act(async () => { wRoot.render(React.createElement(PublicVault, { name: "arin" })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const link = wHost.querySelector('[data-testid="wishlist-link"]');
  check("a wishlist with cards on it gets a link", !!link && link.textContent.includes("3"));
  check("it goes to the owner's public wishlist page", link?.getAttribute("href") === "/w/arin");
  await act(async () => { wRoot.unmount(); });
  wHost.remove();
}
delete payload.wishlistCount;

status = 404;
const root2 = createRoot(document.createElement("div"));
const host = document.createElement("div");
document.body.appendChild(host);
const root3 = createRoot(host);
await act(async () => { root3.render(React.createElement(PublicVault, { name: "nobody" })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
check("a closed or missing vault says nothing is here, without confirming the profile exists", host.textContent.includes("nothing to browse"));
check("and never says 'private' in a way that confirms a profile", !host.textContent.includes("wrong PIN"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
