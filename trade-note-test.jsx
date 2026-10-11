// "Up for trade" takes an optional note — condition, what you'd want back,
// whatever the other side should know. It is written for the trade list, so it
// travels wherever that list is shared (public /w/ page, the vault's Trade tab,
// a playgroup's matches) and nowhere it isn't; it round-trips through the
// Binderwyrm export; and it goes away when the card leaves the trade list.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div><div id='root2'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

import { publicWishlistPayload } from "./public-wishlist.cjs";
import { publicVaultPayload } from "./public-vault.cjs";
import { matchWithProfile } from "./src/features/playgroup/matching";
import { buildExport } from "./src/features/collection/exportFormats";
import { guessMapping } from "./src/features/collection/modals/ImportModal";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// ---- where the note travels ----------------------------------------------------
const vault = {
  publicVault: true,
  publicTrade: true,
  wishlist: [],
  cards: [
    { id: "t1", name: "Sol Ring", set: "ltc", quantity: 2, usd: 2, forTrade: true, tradeNote: "only for Commander staples", note: "private" },
    { id: "t2", name: "Arcane Signet", set: "m3c", quantity: 1, usd: 1, forTrade: false, tradeNote: "stale", note: "private" },
  ],
  decks: [],
};
const wl = publicWishlistPayload(vault, "arin");
check("public trade list carries the note", wl.trade.length === 1 && wl.trade[0].note === "only for Commander staples");
check("a card's private note never rides along", !JSON.stringify(wl).includes("private"));
check("an unshared trade list carries nothing", publicWishlistPayload({ ...vault, publicTrade: false }, "arin").trade.length === 0);

const vp = publicVaultPayload(vault, "arin");
check("the vault's trade tab carries the note", vp.cards.find((c) => c.id === "t1").tradeNote === "only for Commander staples");
check("…but not a leftover note on a card that's off the list", vp.cards.find((c) => c.id === "t2").tradeNote === "");
const vpNo = publicVaultPayload({ ...vault, publicTrade: false }, "arin");
check("a vault without a shared trade list shows no trade note at all", vpNo.cards.every((c) => c.tradeNote === undefined));

const m = matchWithProfile({ profile: "arin", myCards: [], myWishlist: [{ name: "Sol Ring", quantity: 1 }], theirWishlist: [], theirTrade: wl.trade });
check("a playgroup match shows what they wrote", m.youWant[0]?.tradeNote === "only for Commander staples");

// ---- export → import ----------------------------------------------------------
const ex = buildExport("binderwyrm", vault.cards, { currency: "USD", collectionName: () => "", allocatedCost: () => 0, currentUnitValue: () => 0 });
const row1 = ex.rows.find((r) => r.Name === "Sol Ring");
const row2 = ex.rows.find((r) => r.Name === "Arcane Signet");
check("the export has a Trade Note column", ex.columns.includes("Trade Note") && row1["Trade Note"] === "only for Commander staples");
check("…empty for a card not up for trade", row2["Trade Note"] === "");
check("importing it back maps the column", guessMapping(ex.columns).tradeNote === "Trade Note" && guessMapping(ex.columns).forTrade === "For Trade");

// ---- public pages -------------------------------------------------------------
let payload = wl;
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("api.scryfall.com")) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  if (u.includes("/api/public/")) return Promise.resolve({ ok: true, status: 200, json: async () => payload });
  return appFetch(url, opts);
};
let appFetch = () => Promise.resolve({ ok: false, json: async () => ({}) });

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { PublicWishlist } = await import("./src/features/wishlist/PublicWishlist.jsx");
const { PublicVault } = await import("./src/features/vault/PublicVault.jsx");
const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const host = document.getElementById("root");
let root = createRoot(host);
await act(async () => { root.render(React.createElement(PublicWishlist, { name: "arin" })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
check("the public trade list shows the note", host.textContent.includes("only for Commander staples"));
const tradeSection = [...host.querySelectorAll("section")].find((sec) => sec.querySelector("h2")?.textContent === "Up for trade");
check("trade cards aren't labelled as wanted", !!tradeSection && !/Wanted|Top of the list|Someday/.test(tradeSection.textContent));
await act(async () => { root.unmount(); });

payload = vp;
root = createRoot(host);
await act(async () => { root.render(React.createElement(PublicVault, { name: "arin" })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const tile = host.querySelector('[data-card-id="t1"]') || [...host.querySelectorAll('[role="button"], button')].find((b) => b.textContent.includes("Sol Ring"));
if (tile) await click(tile);
check("opening a trade card in the vault shows the note", document.querySelector('[role="dialog"] [data-testid="trade-note"]')?.textContent.includes("only for Commander staples"));
await act(async () => { root.unmount(); });

// ---- the owner's side: the card's detail view ----------------------------------
const cards = [
  { id: "c1", name: "Rhystic Study", set: "pcy", setName: "Prophecy", collectorNumber: "45", quantity: 1, finish: "nonfoil",
    condition: "NM", collectionId: "uncategorized", location: "", usd: 30, colors: ["U"], rarity: "common", typeLine: "Enchantment", added: 1 },
];
let lastSaved = null;
appFetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") {
    try { lastSaved = JSON.parse(JSON.parse(opts.body).value); } catch { /* ignore */ }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store")) return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards, ratesAuto: false, ratesUpdated: Date.now() }) }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};
const App = (await import("./src/App.jsx")).default;
const host2 = document.getElementById("root2");
const root2 = createRoot(host2);
await act(async () => { root2.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const reactProps = (el) => el[Object.keys(el).find((k) => k.startsWith("__reactProps$"))];
const dialog = () => host2.querySelector('[role="dialog"]') || host2;
const noteInput = () => dialog().querySelector('input[aria-label="Trade note"]');
const tradeBox = () => [...dialog().querySelectorAll("label")].find((l) => l.textContent.includes("Up for trade"))?.querySelector("input");
// No Save button any more: edits save themselves, and closing writes anything
// still pending — so "save" here is just closing the dialog.
const closeBtn = () => dialog().querySelector('button[aria-label="Close"]');

await click(host2.querySelector('[data-card-id="c1"]'));
check("no note box while the card isn't up for trade", !noteInput());
await click(tradeBox());
check("ticking Up for trade offers the note box", !!noteInput());
await act(async () => { reactProps(noteInput()).onChange({ target: { value: "  NM, from a sealed precon  " } }); });
await click(closeBtn());
await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
const saved = lastSaved?.cards?.find((c) => c.id === "c1");
check("the note is saved with the card, trimmed", saved?.forTrade === true && saved?.tradeNote === "NM, from a sealed precon");

await click(host2.querySelector('[data-card-id="c1"]'));
check("reopening the card shows the note", noteInput()?.value === "NM, from a sealed precon");
await click(tradeBox());
await click(closeBtn());
await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
const cleared = lastSaved?.cards?.find((c) => c.id === "c1");
check("taking it off the trade list clears the note", cleared?.forTrade === false && cleared?.tradeNote === "");

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
