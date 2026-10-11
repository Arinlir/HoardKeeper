// Two-sided cards: the back face is kept alongside the front and any large
// enough view can turn the card over. Plus the Sets roster's own route onto the
// wishlist, for a card you're looking at but don't own.
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


const cards = [
  // a transform card, with both faces on file
  { id: "c1", name: "Peter Parker // Amazing Spider-Man", set: "spm", setName: "Marvel's Spider-Man", collectorNumber: "10",
    scryfallId: "sid-peter", quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", location: "",
    imageUrl: "http://x/peter-front.jpg", imageUrlLarge: "http://x/peter-front-large.jpg",
    imageUrlBack: "http://x/spidey-back.jpg", imageUrlBackLarge: "http://x/spidey-back-large.jpg",
    usd: 12, colors: ["G", "W"], rarity: "mythic", typeLine: "Legendary Creature — Human Scientist Hero", added: 2 },
  // an ordinary one-faced card
  { id: "c2", name: "Sol Ring", set: "spm", setName: "Marvel's Spider-Man", collectorNumber: "59",
    scryfallId: "sid-solring", quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", location: "",
    imageUrl: "http://x/sol.jpg", usd: 2, colors: [], rarity: "uncommon", typeLine: "Artifact", added: 1 },
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
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  if (u.includes("api.scryfall.com/sets/"))
    return Promise.resolve({ ok: true, json: async () => ({ name: "Marvel's Spider-Man", code: "spm", card_count: 2, released_at: "2025-01-01" }) });
  if (u.includes("api.scryfall.com/cards/search"))
    return Promise.resolve({
      ok: true,
      json: async () => ({
        has_more: false,
        data: [
          // Scryfall gives a transform card no top-level image: one per face.
          {
            object: "card", id: "sid-peter", name: "Peter Parker // Amazing Spider-Man", layout: "transform",
            set: "spm", set_name: "Marvel's Spider-Man", collector_number: "10", rarity: "mythic",
            prices: { usd: "12.00" },
            card_faces: [
              { name: "Peter Parker", type_line: "Legendary Creature — Human Scientist Hero", image_uris: { normal: "http://x/peter-front.jpg", large: "http://x/peter-front-large.jpg" } },
              { name: "Amazing Spider-Man", type_line: "Legendary Creature — Human Hero", image_uris: { normal: "http://x/spidey-back.jpg", large: "http://x/spidey-back-large.jpg" } },
            ],
          },
          {
            object: "card", id: "sid-venom", name: "Venom", layout: "normal", set: "spm", set_name: "Marvel's Spider-Man",
            collector_number: "11", rarity: "rare", type_line: "Legendary Creature — Symbiote",
            image_uris: { normal: "http://x/venom.jpg" }, prices: { usd: "20.00" },
          },
        ],
      }),
    });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;
const { normalizeCard, hasBackFace } = await import("./src/lib/scryfall.js");

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}
const buttons = () => [...document.querySelectorAll("button")];
// the Sets tab's set headers are role="button" divs, not <button> elements
const clickables = (root = document) => [...root.querySelectorAll('button, [role="button"]')];
const byLabel = (re, root = document) =>
  clickables(root).find((b) => re.test(b.getAttribute("aria-label") || ""));

// ---- 1. the back face survives normalizeCard ----
const normalized = normalizeCard({
  id: "x", name: "A // B", layout: "transform", set: "spm", collector_number: "1", prices: {},
  card_faces: [
    { image_uris: { normal: "front.jpg", large: "front-large.jpg" } },
    { image_uris: { normal: "back.jpg", large: "back-large.jpg" } },
  ],
});
check("the front face is still the card's image", normalized.imageUrl === "front.jpg");
check("the back face is kept too", normalized.imageUrlBack === "back.jpg" && normalized.imageUrlBackLarge === "back-large.jpg");
check("a two-sided card reports itself as one", hasBackFace(normalized));
check("a one-faced card doesn't", !hasBackFace(normalizeCard({ id: "y", name: "C", set: "spm", collector_number: "2", prices: {}, image_uris: { normal: "c.jpg" } })));

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

// ---- 2. flipping in the collection grid ----
const tile = document.querySelector('[data-card-id="c1"]');
const plainTile = document.querySelector('[data-card-id="c2"]');
const flip = [...tile.querySelectorAll("button")].find((b) => /Show the back/.test(b.getAttribute("aria-label") || ""));
check("a two-sided card offers a flip", !!flip);
check("a one-faced card doesn't", ![...plainTile.querySelectorAll("button")].some((b) => /Show the (back|front)/.test(b.getAttribute("aria-label") || "")));
check("it starts on the front", tile.querySelector("img").getAttribute("src") === "http://x/peter-front.jpg");

await act(async () => { flip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("flipping shows the other side", document.querySelector('[data-card-id="c1"] img').getAttribute("src") === "http://x/spidey-back.jpg");
check("flipping doesn't open the card", !document.querySelector('[data-role="modal-backdrop"]'));

const flipBack = [...document.querySelector('[data-card-id="c1"]').querySelectorAll("button")].find((b) => /Show the front/.test(b.getAttribute("aria-label") || ""));
await act(async () => { flipBack.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("and back again", document.querySelector('[data-card-id="c1"] img').getAttribute("src") === "http://x/peter-front.jpg");

// ---- 3. the card detail view can flip the large art ----
await act(async () => { document.querySelector('[data-card-id="c1"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
// scoped to the dialog: the tile behind it carries the same label
const modal = document.querySelector('[role="dialog"]');
const modalFlip = byLabel(/Show the back of Peter Parker/, modal);
check("the detail view offers the flip on the big art", !!modalFlip);
await act(async () => { modalFlip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("and shows the large back image", [...modal.querySelectorAll("img")].some((i) => i.getAttribute("src") === "http://x/spidey-back-large.jpg"));
const backdrop = document.querySelector('[data-role="modal-backdrop"]');
await act(async () => { backdrop.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

// ---- 4. wishlisting straight from the Sets roster ----
const setsTab = buttons().find((b) => b.textContent.trim() === "Sets");
await act(async () => { setsTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const expander = byLabel(/expand roster/);
await act(async () => { expander.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 250)); });

const wishVenom = byLabel(/Add Venom to your wishlist/);
check("every roster card offers the wishlist", !!wishVenom);
await act(async () => { wishVenom.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 700)); });

const saved = putCalls.length ? JSON.parse(putCalls[putCalls.length - 1].value) : null;
check("the roster card lands on the wishlist", saved?.wishlist?.length === 1 && saved.wishlist[0].name === "Venom");
check("it keeps the printing you were looking at", saved?.wishlist?.[0]?.scryfallId === "sid-venom" && saved.wishlist[0].collectorNumber === "11");
check("it did not become a card you own", saved?.cards?.length === 2);
check("the button now says it's on the list", !!byLabel(/Remove Venom from your wishlist/));

await act(async () => { byLabel(/Remove Venom from your wishlist/).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
check("clicking again takes it off", JSON.parse(putCalls[putCalls.length - 1].value).wishlist.length === 0);

// ---- 5. a roster card's back face comes through the set lookup too ----
const peterTile = [...document.querySelectorAll("img")].find((i) => i.getAttribute("src") === "http://x/peter-front.jpg");
await act(async () => { peterTile.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
check("the roster preview can turn a transform card over", !!byLabel(/Show the back of Peter Parker/));

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
