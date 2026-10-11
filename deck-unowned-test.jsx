// Building a deck out of cards you don't own: adding them from Scryfall, what
// the deck says they'd cost, putting them on the wishlist, buying one, and the
// placeholder quietly standing down when the real card turns up.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom's document has no `oninput`, so React decides input events aren't
// supported and falls back to an IE-era polyfill that calls attachEvent. Give
// it the property and it takes the modern path like a browser would.
if (!("oninput" in dom.window.document)) {
  Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// ---- 1. the rules, on their own ----
const X = await import("./src/features/decks/externals.js");

const printing = { name: "Mana Crypt", set: "2xm", setName: "Double Masters", collectorNumber: "270",
  scryfallId: "sid-crypt", imageUrl: "http://x/crypt.jpg", usd: 180, colors: [], cmc: 0, typeLine: "Artifact", rarity: "mythic" };
const ext = X.makeExternalCard(printing);
check("a placeholder is card-shaped", ext.name === "Mana Crypt" && ext.quantity === 1 && ext.usd === 180);
check("and knows it isn't owned", X.isExternal(ext) && ext.id.startsWith("ext-"));
check("a collection card isn't", !X.isExternal({ id: "c1", name: "Sol Ring" }));

const deck = {
  id: "d1", format: "commander", name: "Test", commanderId: "cmd",
  entries: [{ cardId: "c1", qty: 1, role: "ramp" }, { cardId: ext.id, qty: 1, role: "ramp" }],
  external: [ext],
};
const cardById = { c1: { id: "c1", name: "Sol Ring", usd: 2, quantity: 1 }, [ext.id]: ext };
const sum = X.missingSummary(deck, cardById, (c) => c.usd || 0);
check("the summary counts only what you don't own", sum.count === 1 && sum.rows.length === 1);
check("and prices it", sum.cost === 180);

// buying it elsewhere resolves the placeholder
const owned = { id: "real-1", name: "Mana Crypt", set: "2xm", collectorNumber: "270", scryfallId: "sid-crypt", quantity: 1 };
const linked = X.linkAcquired(deck, [owned]);
check("a matching printing takes the placeholder's place", linked.entries.some((e) => e.cardId === "real-1"));
check("and the placeholder is gone", linked.external.length === 0);
check("nothing else moved", linked.entries.some((e) => e.cardId === "c1") && linked.entries.length === 2);
check("a different printing of the same card still counts", !!X.linkAcquired(deck, [{ id: "r2", name: "Mana Crypt", set: "vma", collectorNumber: "3", scryfallId: "other" }]));
check("a proxy doesn't satisfy a placeholder", !X.linkAcquired(deck, [{ ...owned, id: "p1", proxy: true }]));
check("nor does a card you sold", !X.linkAcquired(deck, [{ ...owned, id: "s1", sold: true }]));
check("a deck with nothing to link is left alone", X.linkAcquired({ ...deck, external: [] }, [owned]) === null);
// the same owned card can't answer two placeholders
const twin = X.makeExternalCard(printing);
const twoPlaceholders = { ...deck, entries: [...deck.entries, { cardId: twin.id, qty: 1, role: "ramp" }], external: [ext, twin] };
const linkedTwo = X.linkAcquired(twoPlaceholders, [owned]);
check("one copy resolves one placeholder, not both", linkedTwo.external.length === 1);

// ---- 2. the deck editor ----
const cards = [
  { id: "cmd", name: "Krenko, Mob Boss", set: "ltc", setName: "Commander", collectorNumber: "1", scryfallId: "sid-krenko",
    quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", usd: 5,
    colors: ["R"], cmc: 4, typeLine: "Legendary Creature — Goblin Warrior", rarity: "rare", added: 2 },
  { id: "c1", name: "Sol Ring", set: "ltc", setName: "Commander", collectorNumber: "59", scryfallId: "sid-sol",
    quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", usd: 2,
    colors: [], cmc: 1, typeLine: "Artifact", rarity: "uncommon", added: 1 },
];
const decks = [{ id: "d1", format: "commander", name: "Krenko deck", commanderId: "cmd", entries: [{ cardId: "c1", qty: 1, role: "ramp" }], basics: {} }];

let putCalls = [];
const scryfallHit = {
  object: "card", id: "sid-crypt", name: "Mana Crypt", set: "2xm", set_name: "Double Masters",
  collector_number: "270", rarity: "mythic", type_line: "Artifact", cmc: 0, color_identity: [],
  image_uris: { normal: "http://x/crypt.jpg" }, prices: { usd: "180.00" },
};
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") {
    putCalls.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards, decks, wishlist: [] }) }) });
  if (u.includes("api.scryfall.com/cards/search"))
    return Promise.resolve({ ok: true, json: async () => ({ data: [scryfallHit], has_more: false }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const all = () => [...document.querySelectorAll('button, [role="button"]')];
const byText = (t) => all().find((b) => b.textContent.trim() === t);
const byLabel = (re) => all().find((b) => re.test(b.getAttribute("aria-label") || ""));
const vault = () => (putCalls.length ? JSON.parse(putCalls[putCalls.length - 1].value) : null);
async function settle(ms = 700) { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); }

await act(async () => { byText("Decks").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await settle(60);
const openDeck = all().find((b) => /Krenko deck/.test(b.textContent) || /Open Krenko/.test(b.getAttribute("aria-label") || ""));
await act(async () => { (openDeck || byText("Krenko deck")).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await settle(60);
check("the deck opened", document.body.textContent.includes("Add cards"));

// the collection search is still the default; "Any card" is the new mode
check("you can still search your own cards", !!byText("Your cards"));
const anyBtn = byText("Any card");
check("and now anything else", !!anyBtn);
await act(async () => { anyBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const box = document.querySelector('input[aria-label="Search all Magic cards to add to this deck"]');
check("the box says it searches everything", !!box);
const props = Object.keys(box).find((k) => k.startsWith("__reactProps$"));
await act(async () => { box[props].onChange({ target: { value: "mana crypt" } }); });
await settle(600);
const result = byLabel(/Add Mana Crypt to deck as a card you don't own/);
check("a card you don't own shows up in the results", !!result);
await act(async () => { result.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await settle();

const saved = vault();
const savedDeck = saved.decks[0];
check("the deck records it as a card to buy", savedDeck.external?.length === 1 && savedDeck.external[0].name === "Mana Crypt");
check("as an entry like any other", savedDeck.entries.some((e) => e.cardId === savedDeck.external[0].id));
check("and it did not become a card you own", saved.cards.length === 2);

const text = document.body.textContent;
check("the deck says what's missing and what it costs", /1 to buy/.test(text) && /\$180\.00/.test(text));
check("the card is flagged in the list", text.includes("TO BUY"));

// wishlist it
await act(async () => { document.querySelector('[data-role="deck-missing"] button').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const wish = byLabel(/Add Mana Crypt to your wishlist/);
check("each missing card can go on the wishlist", !!wish);
await act(async () => { wish.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await settle();
check("and it lands there", vault().wishlist?.[0]?.name === "Mana Crypt");
check("the button flips to say so", !!byLabel(/Remove Mana Crypt from your wishlist/));

// buy it
const own = byLabel(/I own Mana Crypt now/);
check("there's a way to say you bought it", !!own);
await act(async () => { own.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await settle();
const after = vault();
check("it becomes a card in the collection", after.cards.length === 3 && after.cards.some((c) => c.name === "Mana Crypt"));
check("the deck keeps it, now as a real card", after.decks[0].entries.length === 2 && (after.decks[0].external || []).length === 0);
check("nothing is left to buy", !/to buy/.test(document.body.textContent));

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
