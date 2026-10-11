// Guests — no profile, no PIN — see both markets' prices too: on the public
// wishlist, the trade list, and a card opened in the public vault. The owner's
// chosen market is the one the totals use; the other sits alongside it, each
// in its own currency, so a visitor from the EU or the US reads their price.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div><div id='root2'></div></body></html>", { url: "http://localhost/w/arin" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

import { publicWishlistPayload } from "./public-wishlist.cjs";
import { publicVaultPayload } from "./public-vault.cjs";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// ---- the server payloads carry both markets --------------------------------
const vault = {
  currency: "CZK", czkRate: 22.5, eurRate: 0.9, priceSource: "cardmarket",
  publicVault: true, publicTrade: true,
  wishlist: [{ id: "w1", name: "Mana Crypt", usd: 150, eur: 90, quantity: 1, priority: "high", finish: "nonfoil" }],
  cards: [
    { id: "c1", name: "Sol Ring", set: "ltc", collectorNumber: "59", quantity: 1, usd: 2, eur: 1, forTrade: true, finish: "nonfoil", typeLine: "Artifact", rarity: "uncommon", colors: [], cmc: 1 },
  ],
  decks: [],
};
const wl = publicWishlistPayload(vault, "arin");
check("wishlist payload: owner's market travels", wl.priceSource === "cardmarket");
check("wishlist payload: wanted cards carry both prices", wl.wishlist[0].usd === 150 && wl.wishlist[0].eur === 90);
check("wishlist payload: trade cards carry both prices", (wl.trade || [])[0]?.usd === 2 && (wl.trade || [])[0]?.eur === 1);
const vp = publicVaultPayload(vault, "arin");
check("vault payload: owner's market and both prices travel", vp.priceSource === "cardmarket" && vp.cards[0].eur === 1 && vp.cards[0].usd === 2);

// ---- the public wishlist page ------------------------------------------------
let payload = wl;
globalThis.fetch = (url) => {
  if (String(url).includes("api.scryfall.com")) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  return Promise.resolve({ ok: true, status: 200, json: async () => payload });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const { PublicWishlist } = await import("./src/features/wishlist/PublicWishlist.jsx");
const { PublicVault } = await import("./src/features/vault/PublicVault.jsx");

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(PublicWishlist, { name: "arin" })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const host = document.getElementById("root");
const panels = [...host.querySelectorAll('[data-testid="market-prices"]')];
check("every card on the page shows the markets (wishlist + trade)", panels.length === 2);
const panelFor = (name) => panels.find((p) => p.parentElement?.textContent.includes(name));
const crypt = panelFor("Mana Crypt");
const sol = panelFor("Sol Ring");
check("a wanted card: Cardmarket in euros, marked as the owner's", crypt?.querySelector('[data-market="cardmarket"]')?.textContent.includes("€90.00") && crypt?.querySelector('[data-market="cardmarket"]')?.getAttribute("data-active") === "true");
check("a wanted card: TCGplayer in dollars beside it", crypt?.querySelector('[data-market="tcgplayer"]')?.textContent.includes("$150.00"));
check("a trade card shows both too", sol?.querySelector('[data-market="cardmarket"]')?.textContent.includes("€1.00") && sol?.querySelector('[data-market="tcgplayer"]')?.textContent.includes("$2.00"));
check("the headline price is Cardmarket's, in the owner's koruna (€90 → 2,250 Kč)", host.textContent.includes("2,250 Kč"));
const links = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");
check("guests get a TCGplayer link as well as Cardmarket", links.some((h) => h.includes("tcgplayer.com")) && links.some((h) => h.includes("cardmarket.com")));

// an owner on TCGplayer: same two figures, the other one marked
payload = publicWishlistPayload({ ...vault, priceSource: "tcgplayer" }, "arin");
const host2 = document.getElementById("root2");
const root2 = createRoot(host2);
await act(async () => { root2.render(React.createElement(PublicWishlist, { name: "arin" })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const p2 = host2.querySelector('[data-testid="market-prices"] [data-market="tcgplayer"]');
check("an owner on TCGplayer: TCGplayer is the one marked", p2?.getAttribute("data-active") === "true");
await act(async () => { root.unmount(); root2.unmount(); });

// ---- a card opened in the public vault --------------------------------------
payload = vp;
const root3 = createRoot(host);
await act(async () => { root3.render(React.createElement(PublicVault, { name: "arin" })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const tile = host.querySelector('[data-card-id="c1"]') || [...host.querySelectorAll('[role="button"], button')].find((b) => b.textContent.includes("Sol Ring"));
check("the vault lists the card", !!tile);
if (tile) await act(async () => { tile.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const overlay = document.querySelector('[role="dialog"]');
const vpanel = overlay?.querySelector('[data-testid="market-prices"]');
check("opening it shows both markets", !!vpanel && vpanel.querySelectorAll("[data-market]").length === 2);
check("each in its own currency", vpanel?.textContent.includes("€1.00") && vpanel?.textContent.includes("$2.00"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
