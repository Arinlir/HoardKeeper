// Exchange rates fetch themselves: the app asks a rate source on boot when what
// it has is stale, falls back to a second source, refuses nonsense, and leaves
// the last known rates alone when nothing answers.
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
globalThis.AbortController = dom.window.AbortController;

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const { fetchRates, ratesAreStale, ratesAgeLabel, RATE_SOURCES } = await import("./src/lib/rates.js");

// ---- 1. fetchRates on its own ----
const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

globalThis.fetch = (url) =>
  String(url).includes("frankfurter")
    ? json({ base: "USD", date: "2026-09-05", rates: { EUR: 0.86, CZK: 21.5 } })
    : Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
let r = await fetchRates();
check("reads the primary source", r.eur === 0.86 && r.czk === 21.5);
check("reports which source answered", /Frankfurter/i.test(r.source));
check("keeps the rate date", r.date === "2026-09-05");

// primary down, second source picks it up
globalThis.fetch = (url) =>
  String(url).includes("frankfurter")
    ? Promise.resolve({ ok: false, status: 503, json: async () => ({}) })
    : json({ time_last_update_utc: "Fri, 05 Sep 2026 00:00:01 +0000", rates: { EUR: 0.87, CZK: 21.9 } });
r = await fetchRates();
check("falls back to the second source", r.eur === 0.87 && r.czk === 21.9);

// a source that answers with something implausible is not trusted
globalThis.fetch = () => json({ rates: { EUR: 0, CZK: 999999 } });
let threw = false;
try {
  await fetchRates();
} catch (e) {
  threw = true;
}
check("refuses rates that can't be right", threw);

// nothing answers at all
globalThis.fetch = () => Promise.reject(new Error("offline"));
threw = false;
try {
  await fetchRates();
} catch (e) {
  threw = true;
}
check("fails loudly when nothing answers", threw);

check("rates with no timestamp count as stale", ratesAreStale(null));
check("rates from an hour ago don't", !ratesAreStale(Date.now() - 3600 * 1000));
check("rates from two days ago do", ratesAreStale(Date.now() - 2 * 864e5));
check("the age reads in plain words", ratesAgeLabel(Date.now() - 3 * 3600 * 1000) === "3 hours ago");
check("two sources are configured", RATE_SOURCES.length >= 2);

// ---- 2. the app fetches on boot and converts with what it got ----
const vault = {
  collections: [],
  cards: [
    { id: "c1", name: "Sol Ring", set: "ltc", collectorNumber: "59", scryfallId: "sid-sol", quantity: 1,
      usd: 10, colors: [], rarity: "uncommon", typeLine: "Artifact", collectionId: "uncategorized", added: 1 },
  ],
  currency: "CZK",
  czkRate: 23,
  eurRate: 0.92,
};
let putCalls = [];
let askedForRates = 0;
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return json({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } });
  if (u.includes("/api/health")) return json({ ok: true, mode: "accounts" });
  if (u.includes("/api/store") && opts?.method === "PUT") {
    putCalls.push(JSON.parse(opts.body));
    return json({ ok: true });
  }
  if (u.includes("/api/store")) return json({ value: JSON.stringify(vault) });
  if (u.includes("frankfurter")) {
    askedForRates++;
    return json({ base: "USD", date: "2026-09-05", rates: { EUR: 0.86, CZK: 21.5 } });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r2) => setTimeout(r2, 800)); });

check("it went and got the rates", askedForRates === 1);
const saved = putCalls.length ? JSON.parse(putCalls[putCalls.length - 1].value) : null;
check("the fetched rates are stored", saved?.czkRate === 21.5 && saved?.eurRate === 0.86);
check("and stamped with when they arrived", typeof saved?.ratesUpdated === "number" && saved.ratesUpdated > 0);
check("totals convert at the fetched rate", document.body.textContent.includes("215 Kč"));
check("a memoized card tile picks the new rate up too", !document.body.textContent.includes("230 Kč"));

// ---- 3. a vault that opted out is left alone ----
root.unmount();
document.getElementById("root").remove();
const host = dom.window.document.createElement("div");
host.id = "root";
dom.window.document.body.appendChild(host);
askedForRates = 0;
putCalls = [];
vault.ratesAuto = false;
vault.ratesUpdated = null;
const root2 = createRoot(host);
await act(async () => { root2.render(React.createElement(App)); });
await act(async () => { await new Promise((r2) => setTimeout(r2, 500)); });
check("manual rates are never overwritten behind your back", askedForRates === 0);
check("and manual rates still convert", host.textContent.includes("230 Kč"));

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
