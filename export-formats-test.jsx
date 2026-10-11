// The collection export, in each of the shapes another site can actually read.
// Column names and vocabularies here are the ones those importers expect — if
// one of these assertions has to change, check the site's own format first.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Blob = dom.window.Blob;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const E = await import("./src/features/collection/exportFormats.js");

const cards = [
  { id: "c1", name: "Krenko, Mob Boss", set: "ltc", setName: "Commander Legends", collectorNumber: "59",
    scryfallId: "sid-krenko", quantity: 2, finish: "foil", condition: "LP", collectionId: "col1",
    location: "Binder 2", usd: 3, usdFoil: 9, rarity: "rare", added: Date.UTC(2026, 0, 15) },
  { id: "c2", name: "Sol Ring", set: "afr", setName: "Forgotten Realms", collectorNumber: "123",
    scryfallId: "sid-sol", quantity: 1, finish: "nonfoil", condition: "NM", collectionId: "col1",
    usd: 2, rarity: "uncommon", added: Date.UTC(2026, 1, 1), proxy: true },
  { id: "c3", name: "Gone Away", set: "afr", collectorNumber: "7", quantity: 1, finish: "etched",
    condition: "DMG", collectionId: "col2", usd: 5, rarity: "common", added: 0, sold: true, soldPrice: 4 },
];
// The display currency is CZK on purpose: everything but Binderwyrm's own
// format must ignore it and write dollars.
const ctx = {
  collectionName: (id) => (id === "col1" ? "Commander Precon" : "Draft Box"),
  allocatedCost: (c) => ({ c1: 10, c2: 0, c3: 5 })[c.id] ?? 0,
  currentUnitValue: (c) => (c.proxy ? 0 : c.usd),
  convert: (usd) => usd * 23,
  currency: "CZK",
};

// ---- what goes in ----
check("sold cards are left out by default", E.selectCards(cards, {}).every((c) => !c.sold));
check("proxies are left out unless asked for", E.selectCards(cards, {}).every((c) => !c.proxy));
check("and both come along when asked", E.selectCards(cards, { includeSold: true, includeProxies: true }).length === 3);

// ---- Archidekt ----
const arch = E.buildExport("archidekt", cards, { ...ctx, includeProxies: true });
check("archidekt writes its own column names, in order",
  arch.columns.join(",") === "Quantity,Name,Finish,Condition,Date Added,Language,Purchase Price,Tags,Edition Name,Edition Code,Multiverse Id,Scryfall ID,Collector Number");
const a1 = arch.rows[0];
check("archidekt: quantity and name", a1.Quantity === 2 && a1.Name === "Krenko, Mob Boss");
check("archidekt: finish in its vocabulary", a1.Finish === "Foil");
check("archidekt: condition in its vocabulary", a1.Condition === "LP");
check("archidekt: set code and collector number name the printing", a1["Edition Code"] === "LTC" && a1["Collector Number"] === "59");
check("archidekt: scryfall id removes all doubt", a1["Scryfall ID"] === "sid-krenko");
// 10 allocated across 2 copies = 5.00 a copy, in dollars — NOT 230 (the CZK view)
check("archidekt: purchase price is per copy and in USD", a1["Purchase Price"] === "5.00");
check("archidekt: the date is ISO", a1["Date Added"] === "2026-01-15");
check("archidekt: collection and location ride along as tags", a1.Tags.includes("Commander Precon") && a1.Tags.includes("Binder 2"));
check("archidekt: a proxy says so in its tags", arch.rows.find((r) => r.Name === "Sol Ring").Tags.includes("proxy"));

// a damaged card, once sold cards are allowed in
const archAll = E.buildExport("archidekt", cards, { ...ctx, includeSold: true, includeProxies: true });
check("archidekt: DMG becomes D", archAll.rows.find((r) => r.Name === "Gone Away").Condition === "D");
check("archidekt: etched is Etched", archAll.rows.find((r) => r.Name === "Gone Away").Finish === "Etched");

// ---- Moxfield ----
const mox = E.buildExport("moxfield", cards, { ...ctx, includeProxies: true });
check("moxfield writes its own column names, in order",
  mox.columns.join(",") === "Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,Collector Number,Alter,Proxy,Purchase Price");
const m1 = mox.rows[0];
check("moxfield: count, not quantity", m1.Count === 2);
check("moxfield: lowercase set code", m1.Edition === "ltc");
check("moxfield: its own condition words", m1.Condition === "Good (Lightly Played)");
check("moxfield: foil column carries the finish", m1.Foil === "foil");
check("moxfield: a proxy stays a proxy", mox.rows.find((r) => r.Name === "Sol Ring").Proxy === "true");
check("moxfield: a real card doesn't", m1.Proxy === "false");

// ---- ManaBox ----
const mb = E.buildExport("manabox", cards, { ...ctx, includeProxies: true });
check("manabox writes its own column names, in order",
  mb.columns.join(",") === "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency");
check("manabox: conditions on its own scale", mb.rows[0].Condition === "excellent");
check("manabox: says which currency the price is in", mb.rows[0]["Purchase price currency"] === "USD");

// ---- the pasteable list ----
const txt = E.buildExport("text", cards, { ...ctx, includeProxies: true });
check("text export is one line per card", txt.kind === "text");
check("text: quantity, name, set, collector number", txt.content.split("\n")[0] === "2 Krenko, Mob Boss (LTC) 59");
check("text: the example from the docs round-trips", txt.content.includes("1 Sol Ring (AFR) 123"));

// our own parser reads our own list back
const { __test_parseDecklist: parseDecklist } = await import("./src/lib/testExports.js");
const parsed = parseDecklist(txt.content);
check("text: Binderwyrm can read its own list back", parsed.entries.length === 2 && parsed.entries[0].set === "ltc" && parsed.entries[0].num === "59");

// ---- Binderwyrm's own format is unchanged, and stays in the display currency ----
const hk = E.buildExport("binderwyrm", cards, { ...ctx, includeSold: true, includeProxies: true });
check("binderwyrm keeps the printing identity columns",
  ["Name", "Set", "Collector Number", "Set Name", "Scryfall ID", "Quantity", "Finish", "Condition", "Collection", "Location"].every((c) => hk.columns.includes(c)));
check("binderwyrm labels money with the display currency", hk.columns.some((c) => c.includes("(CZK)")));
check("binderwyrm converts into that currency", hk.rows[0]["Purchase Price allocated (CZK)"] === "230.00");
check("binderwyrm records proxy, wanted and sold", hk.rows.find((r) => r.Name === "Sol Ring").Proxy === "Yes" && hk.rows.find((r) => r.Name === "Gone Away").Sold === "Yes");

check("every format names its file after the format", E.buildExport("archidekt", cards, ctx).filename.startsWith("binderwyrm-archidekt-"));
check("and gets the right extension", E.buildExport("text", cards, ctx).filename.endsWith(".txt"));

// ---- the dialog itself ----
let putCalls = [];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") { putCalls.push(1); return Promise.resolve({ ok: true, json: async () => ({}) }); }
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [{ id: "col1", name: "Commander Precon", purchasePrice: 20 }], cards }) }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};
let downloaded = null;
// downloads.js reaches for the global URL, which under Node is Node's own —
// and Node's createObjectURL rejects a jsdom Blob. Stub both.
const captureBlob = (blob) => { downloaded = { ...downloaded, blob }; return "blob:x"; };
dom.window.URL.createObjectURL = captureBlob;
dom.window.URL.revokeObjectURL = () => {};
globalThis.URL.createObjectURL = captureBlob;
globalThis.URL.revokeObjectURL = () => {};
dom.window.HTMLAnchorElement.prototype.click = function () { downloaded = { ...downloaded, name: this.download }; };

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const buttons = () => [...document.querySelectorAll("button")];
const exportBtn = buttons().find((b) => (b.getAttribute("aria-label") || "") === "Export");
check("the header's Export button opens the dialog", !!exportBtn);
await act(async () => { exportBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
check("dialog opened", document.body.textContent.includes("Who's it for"));
check("every format is a button, not a menu", ["Binderwyrm", "Archidekt", "Moxfield", "ManaBox", "Decklist text"].every((l) => buttons().some((b) => b.textContent.trim() === l)));

const preview = () => document.querySelector('[data-role="export-preview"]')?.textContent || "";
check("it previews the real file", preview().startsWith("Name,Set,Collector Number"));
await act(async () => { buttons().find((b) => b.textContent.trim() === "Archidekt").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("switching format changes the preview", preview().startsWith("Quantity,Name,Finish,Condition"));
check("the preview shows a real card", /Krenko/.test(preview()));

const dl = buttons().find((b) => /^Download \d+ cards? as \./.test(b.textContent.trim()));
check("the download button says how many cards and what kind of file", !!dl && /\.csv$/.test(dl.textContent.trim()));
await act(async () => { dl.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
check("a file was handed over", !!downloaded?.name && /^binderwyrm-archidekt-\d{4}-\d{2}-\d{2}\.csv$/.test(downloaded.name));
const text = downloaded?.blob ? await downloaded.blob.text() : "";
check("and it is the Archidekt file", text.split("\n")[0].trim() === "Quantity,Name,Finish,Condition,Date Added,Language,Purchase Price,Tags,Edition Name,Edition Code,Multiverse Id,Scryfall ID,Collector Number");
check("a name with a comma in it is quoted properly", /"Krenko, Mob Boss"/.test(text));
check("the proxy stayed out of the Archidekt file by default", !/Sol Ring/.test(text));

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
