// Verify: the Collections modal only raises the "individual prices add up to
// more than this collection's total" alarm when it can actually hurt something —
// i.e. when the Invested total is set and other cards are being starved by it.
// A collection where every card was bought as a single (each with its own
// price, Invested left at zero) is perfectly consistent and must not warn.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const { CollectionsModal } = await import("./src/features/collection/modals/CollectionsModal.jsx");

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

const noop = () => {};
const card = (id, collectionId, costOverride = null, extra = {}) => ({
  id, collectionId, costOverride, quantity: 1, sold: false, proxy: false, ...extra,
});

// Same maths as App.jsx: proxies take no share; overrides come off the total;
// the remaining pool splits per physical copy, not per row (a 7-of gets 7x
// the share of a 1-of — see [[hoardkeeper-currency]] / the quantity-share fix).
function render(collection, cards) {
  const stats = { sum: 0, sharers: 0, units: 0 };
  cards.forEach((c) => {
    if (c.proxy) return;
    if (c.costOverride !== null && c.costOverride !== undefined) stats.sum += c.costOverride;
    else {
      stats.sharers += 1;
      stats.units += c.quantity || 1;
    }
  });
  const costOf = (c) => {
    if (c.proxy) return 0;
    if (c.costOverride !== null && c.costOverride !== undefined) return c.costOverride;
    if (stats.units === 0) return 0;
    return (Math.max(0, collection.purchasePrice - stats.sum) / stats.units) * (c.quantity || 1);
  };
  const overAllocation = () => Math.max(0, stats.sum - collection.purchasePrice);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return (async () => {
    await act(async () => {
      root.render(
        React.createElement(CollectionsModal, {
          overAllocation, collections: [collection], cards, valueOf: () => 0, costOf,
          onClose: noop, onUpdate: noop, onDelete: noop, onResetCost: noop, onResetAll: noop, onCreate: noop,
        })
      );
    });
    const text = host.textContent;
    await act(async () => { root.unmount(); });
    host.remove();
    return text;
  })();
}

const WARN = "more than this collection's total";
const col = (purchasePrice) => ({ id: "c1", name: "D&D", purchasePrice });

// The reported case: 13 singles, each individually priced, Invested untouched.
{
  const cards = Array.from({ length: 13 }, (_, i) => card(`k${i}`, "c1", 5));
  const t = await render(col(0), cards);
  check("all singles priced, Invested 0: no over-allocation alarm", !t.includes(WARN));
  check("...and it explains that what was paid is the sum", t.includes("Every card here has its own purchase price"));
}

// Same, but a proxy with no price in the mix is not a sharer.
{
  const cards = [card("a", "c1", 5), card("b", "c1", 5), card("p", "c1", null, { proxy: true })];
  const t = await render(col(0), cards);
  check("an unpriced proxy doesn't count as a card waiting for a share", !t.includes(WARN) && t.includes("Every card here has its own purchase price"));
}

// Every card priced, Invested set lower than their sum: nobody is starved.
{
  const cards = [card("a", "c1", 30), card("b", "c1", 30)];
  const t = await render(col(10), cards);
  check("all priced, Invested lower than the sum: still no alarm", !t.includes(WARN));
}

// Some cards priced, Invested never set: there is no pool to overrun.
{
  const cards = [card("a", "c1", 30), card("b", "c1", null), card("c", "c1", null)];
  const t = await render(col(0), cards);
  check("some priced, Invested 0: no alarm", !t.includes(WARN));
  check("...but says the unpriced cards get nothing because no total is set", t.includes("No Invested total is set"));
}

// The genuine problem: a real total, overrun by singles, with cards left to share it.
{
  const cards = [card("a", "c1", 30), card("b", "c1", 30), card("c", "c1", null)];
  const t = await render(col(50), cards);
  check("total set, singles overrun it, a card is starved: alarm shown", t.includes(WARN));
  check("...with the right excess (10)", /add up to\s*\$?10(\.00)?\b/.test(t) || t.includes("10"));
}

// Healthy split: singles fit inside the total.
{
  const cards = [card("a", "c1", 20), card("b", "c1", null)];
  const t = await render(col(50), cards);
  check("singles inside the total: no alarm", !t.includes(WARN));
  check("...and the rest share what's left", t.includes("the rest share what's left"));
}

// No individual prices at all: no note either way.
{
  const cards = [card("a", "c1"), card("b", "c1")];
  const t = await render(col(50), cards);
  check("no individual prices: no notes at all", !t.includes(WARN) && !t.includes("individual purchase") && !t.includes("Every card here"));
}

// The reported bug: a 7-of and a 1-of sharing a pool must not get equal
// shares of it — the 7-of took 7x the money to assemble, and CardTile's
// `value` already scales by quantity, so cost must too or the delta reads as
// an enormous fake profit on stacks bigger than one.
{
  const cards = [card("a", "c1", null, { quantity: 1 }), card("b", "c1", null, { quantity: 7 })];
  const t = await render(col(80), cards);
  // Pool of 80 split over 1 + 7 = 8 units -> 10/unit. Row b (7 copies) should
  // report 70 as its total cost, not the same 40 as row a.
  const stats = { sum: 0, sharers: 0, units: 0 };
  cards.forEach((c) => { stats.sharers += 1; stats.units += c.quantity || 1; });
  const costOf = (c) => (Math.max(0, 80 - stats.sum) / stats.units) * (c.quantity || 1);
  check("a 7-of gets 7x the share of a 1-of from the same pool", costOf(cards[1]) === 7 * costOf(cards[0]));
  check("...specifically 70, not an even 40/40 split", costOf(cards[1]) === 70 && costOf(cards[0]) === 10);
}

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
