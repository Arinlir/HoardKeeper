// Card prices can come from Cardmarket (EU) or TCGplayer (US), chosen in
// Settings and independent of the display currency. Pins down: the pricing
// helpers, the migration from the old euro-only tick-box, the public payloads,
// and — in the real App — that switching market re-values the header and the
// tiles at once and that a card's details show both markets side by side.
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
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

import { CUR, legacySource, fmtNative } from "./src/lib/format";
import { priceForFinish, priceSourceOf, priceMove, pricePatch, printingPrice, sortPrintings } from "./src/lib/scryfall";
import { publicWishlistPayload } from "./public-wishlist.cjs";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}
const near = (a, b) => a !== null && a !== undefined && Math.abs(a - b) < 1e-9;

// ---- helpers ----------------------------------------------------------------
CUR.code = "USD";
CUR.eurRate = 0.9;
CUR.czkRate = 22.5;

const bolt = { finish: "nonfoil", usd: 10, usdFoil: 30, eur: 4, eurFoil: 12 };
CUR.source = "tcgplayer";
check("TCGplayer reads the dollar price", priceForFinish(bolt) === 10);
check("and says it came from TCGplayer", priceSourceOf(bolt) === "tcgplayer");
CUR.source = "cardmarket";
check("Cardmarket reads the euro price, carried in dollars", near(priceForFinish(bolt), 4 / 0.9));
check("and says it came from Cardmarket", priceSourceOf(bolt) === "cardmarket");
check("foils read the foil euro price", near(priceForFinish({ ...bolt, finish: "foil" }), 12 / 0.9));
const usOnly = { finish: "nonfoil", usd: 5, eur: null };
check("no Cardmarket price falls back to TCGplayer", priceForFinish(usOnly) === 5 && priceSourceOf(usOnly) === "tcgplayer");
CUR.source = "tcgplayer";
const euOnly = { finish: "nonfoil", usd: null, eur: 9 };
check("no TCGplayer price falls back to Cardmarket", near(priceForFinish(euOnly), 10) && priceSourceOf(euOnly) === "cardmarket");
check("no price anywhere is null", priceForFinish({ finish: "nonfoil" }) === null && priceSourceOf({}) === null);

// printing pickers and their price sort follow the market
CUR.source = "cardmarket";
const a = { name: "A", usd: 1, eur: 9 }, b = { name: "B", usd: 9, eur: 1 };
check("a printing lists its Cardmarket price", near(printingPrice(a), 10));
check("sorting printings by price uses Cardmarket", sortPrintings([a, b], "price", "asc")[0].name === "B");
CUR.source = "tcgplayer";
check("…and TCGplayer when that's chosen", sortPrintings([a, b], "price", "asc")[0].name === "A");

// Movers compare like with like
const refreshed = { ...bolt, ...pricePatch(bolt, { usd: 11, usdFoil: 30, eur: 5, eurFoil: 12 }) };
check("a refresh keeps the old prices of both markets", refreshed.prevUsd === 10 && refreshed.prevEur === 4 && refreshed.eur === 5);
CUR.source = "cardmarket";
const m = priceMove(refreshed);
check("Cardmarket movement is euros to euros", m && near(m.prev, 4 / 0.9) && near(m.now, 5 / 0.9));
const legacyCard = { finish: "nonfoil", usd: 11, prevUsd: 10, eur: 5 }; // no prevEur from before this change
const lm = priceMove(legacyCard);
check("without an old Cardmarket price it doesn't compare euros with dollars", lm && lm.prev === 10 && lm.now === 11);
check("a new printing starts with no history", pricePatch({}, bolt).prevUsd === null && pricePatch({}, bolt).prevEur === null);

// migration from the old "use Cardmarket's euro prices" box
check("old euro vault, box ticked → Cardmarket", legacySource({ currency: "EUR", eurNative: true }) === "cardmarket");
check("old euro vault, never touched → Cardmarket", legacySource({ currency: "EUR" }) === "cardmarket");
check("old euro vault, box unticked → TCGplayer", legacySource({ currency: "EUR", eurNative: false }) === "tcgplayer");
check("old koruna vault → TCGplayer, as it always was", legacySource({ currency: "CZK", eurNative: true }) === "tcgplayer");
check("a saved choice wins", legacySource({ currency: "USD", priceSource: "cardmarket" }) === "cardmarket");
check("native formatting uses the market's own currency", fmtNative(4, "cardmarket").includes("€") && fmtNative(10, "tcgplayer").includes("$"));

// public wishlist carries what it needs to price on Cardmarket
const wl = publicWishlistPayload({ priceSource: "cardmarket", wishlist: [{ id: "w1", name: "X", usd: 3, eur: 2, eurFoil: 5 }] }, "arin");
check("the public wishlist knows the owner's market", wl.priceSource === "cardmarket");
check("and carries euro prices", wl.wishlist[0].eur === 2 && wl.wishlist[0].eurFoil === 5);

// ---- the real App -------------------------------------------------------------
CUR.source = "tcgplayer";
const cards = [
  { id: "c1", name: "Rhystic Study", set: "prp", setName: "Prophecy", collectorNumber: "45", scryfallId: "sid-rhystic",
    quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "uncategorized", location: "",
    usd: 10, eur: 4, colors: ["U"], rarity: "common", typeLine: "Enchantment", added: 1 },
];
let lastSaved = null;
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") {
    try { lastSaved = JSON.parse(JSON.parse(opts.body).value); } catch { /* shape varies */ }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store"))
    return Promise.resolve({
      ok: true,
      json: async () => ({
        // A koruna vault from before this change, box ticked: meant TCGplayer.
        value: JSON.stringify({ collections: [], cards, currency: "CZK", czkRate: 22.5, eurRate: 0.9, eurNative: true, ratesAuto: false, ratesUpdated: Date.now() }),
      }),
    });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const text = () => document.body.textContent;
const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const reactProps = (el) => el[Object.keys(el).find((k) => k.startsWith("__reactProps$"))];

check("an old koruna vault still opens on TCGplayer: $10 → 225 Kč", text().includes("225 Kč"));

await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Settings"));
const select = document.getElementById("sm-price-source");
check("Settings offers the price market whatever the currency", !!select && select.value === "tcgplayer");
check("both markets are on offer", !!select && [...select.options].map((o) => o.value).join(",") === "cardmarket,tcgplayer");

await act(async () => { reactProps(select).onChange({ target: { value: "cardmarket" } }); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
check("the hint follows the choice", document.querySelector('[data-testid="price-source-hint"]')?.textContent.includes("Cardmarket's trend price"));
// €4 at 22.5/0.9 = 100 Kč — in the header and on the tile, at once
check("switching to Cardmarket re-values straight away: €4 → 100 Kč", text().includes("100 Kč"));
check("no stale TCGplayer figure is left anywhere", !text().includes("225 Kč"));

// close settings, open the card
const esc = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
await act(async () => { document.dispatchEvent(esc); window.dispatchEvent(esc); });
let backdrop = document.querySelector('[data-role="modal-backdrop"]');
if (backdrop) await click(backdrop);
await click(document.querySelector('[data-card-id="c1"]'));
const panel = document.querySelector('[data-testid="market-prices"]');
check("a card's details show both markets", !!panel && panel.querySelectorAll("[data-market]").length === 2);
const cm = panel?.querySelector('[data-market="cardmarket"]');
const tcg = panel?.querySelector('[data-market="tcgplayer"]');
check("Cardmarket in euros, marked as the one in use", cm?.textContent.includes("€4.00") && cm?.getAttribute("data-active") === "true");
check("TCGplayer in dollars alongside it", tcg?.textContent.includes("$10.00") && tcg?.getAttribute("data-active") === "false");
check("each also shown in koruna", cm?.textContent.includes("100 Kč") && tcg?.textContent.includes("225 Kč"));

await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
check("the choice is saved with the vault", lastSaved?.priceSource === "cardmarket");

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
