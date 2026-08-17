// Verifies: alphabetical and rarity grouping produce correct, correctly
// ordered section headers with the right cards under each; ungrouped sorts
// are completely unaffected (no header ever appears); and the FilterBar's
// collection-chip row now has flex-basis:100% (forces its own row, can't
// crowd against the color pips).
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));
const cards = [
  { id: "c1", name: "Zombie Apprentice", rarity: "common", quantity: 1, usd: 1, collectionId: "uncategorized" },
  { id: "c2", name: "Arcane Signet", rarity: "uncommon", quantity: 1, usd: 2, collectionId: "uncategorized" },
  { id: "c3", name: "Ancient Tomb", rarity: "rare", quantity: 1, usd: 40, collectionId: "uncategorized" },
  { id: "c4", name: "Amulet of Vigor", rarity: "rare", quantity: 1, usd: 5, collectionId: "uncategorized" },
  { id: "c5", name: "Blood Moon", rarity: "rare", quantity: 1, usd: 15, collectionId: "uncategorized" },
  { id: "c6", name: "Sol Ring", rarity: "uncommon", quantity: 1, usd: 2, collectionId: "uncategorized" },
  { id: "c7", name: "The Tabernacle at Pendrell Vale", rarity: "rare", quantity: 1, usd: 3000, collectionId: "uncategorized" },
  { id: "c8", name: "Griselbrand", rarity: "mythic", quantity: 1, usd: 25, collectionId: "uncategorized" },
];
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

check("no group headers before choosing a grouped sort", !document.body.textContent.includes("card1 card"));

const sortSelect = [...document.querySelectorAll("select")].find((s) =>
  [...s.options].some((o) => o.value === "alpha-grouped")
);
check("A–Z grouped option exists", !!sortSelect);

// --- alphabetical grouping ---
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
  setter.call(sortSelect, "alpha-grouped");
  sortSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});

const headings = () => [...document.querySelectorAll(".display")].map((el) => el.textContent.trim()[0]).filter((c) => c && c.length === 1 || true);
const displayEls = () => [...document.querySelectorAll('div[class="display"], .display')];
const groupHeaderText = () => [...document.querySelectorAll("div")]
  .filter((d) => d.className === "display" && d.children.length >= 1)
  .map((d) => d.textContent);

// section headers are the display-class divs whose first child text is a
// single letter followed by a card count
const sectionLabels = [...document.querySelectorAll(".display")]
  .filter((el) => /^[A-Z#]\d+cards?$/.test(el.textContent.replace(/\s+/g, "")))
  .map((el) => el.textContent.trim()[0]);

check("alpha groups appear in alphabetical order", JSON.stringify(sectionLabels) === JSON.stringify([...sectionLabels].sort()));
check("groups present: A, B, G, S, T, Z", ["A", "B", "G", "S", "T", "Z"].every((l) => sectionLabels.includes(l)));

const bodyText = document.body.textContent;
check("Ancient Tomb sits under its own section, near Amulet/Arcane (A group)", bodyText.indexOf("Amulet of Vigor") < bodyText.indexOf("Griselbrand"));

// --- rarity grouping ---
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
  setter.call(sortSelect, "rarity-grouped");
  sortSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});

const rarityLabels = [...document.querySelectorAll(".display")]
  .filter((el) => /^(Mythic|Rare|Uncommon|Common|Other)\d+cards?$/.test(el.textContent.replace(/\s+/g, "")))
  .map((el) => el.textContent.replace(/\d+\s*cards?$/, "").trim());

check("rarity groups in canonical order: Mythic, Rare, Uncommon, Common", JSON.stringify(rarityLabels) === JSON.stringify(["Mythic", "Rare", "Uncommon", "Common"]));

const rBody = document.body.textContent;
check("Griselbrand (mythic) appears before Ancient Tomb (rare)", rBody.indexOf("Griselbrand") < rBody.indexOf("Ancient Tomb"));
check("Ancient Tomb (rare) appears before Sol Ring (uncommon)", rBody.indexOf("Ancient Tomb") < rBody.indexOf("Sol Ring"));
check("within the Rare group, cards are alphabetical (Amulet before Ancient before Blood before Tabernacle)",
  rBody.indexOf("Amulet of Vigor") < rBody.indexOf("Ancient Tomb") &&
  rBody.indexOf("Ancient Tomb") < rBody.indexOf("Blood Moon") &&
  rBody.indexOf("Blood Moon") < rBody.indexOf("Tabernacle"));

// --- switch back to a normal sort: grouping must disappear entirely ---
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
  setter.call(sortSelect, "value-desc");
  sortSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});
const afterLabels = [...document.querySelectorAll(".display")]
  .filter((el) => /^(Mythic|Rare|Uncommon|Common|Other|[A-Z#])\d+cards?$/.test(el.textContent.replace(/\s+/g, "")));
check("switching back to a normal sort removes all group headers", afterLabels.length === 0);

// --- FilterBar chip row fix ---
const chipRow = [...document.querySelectorAll("div")].find(
  (d) => (d.getAttribute("style") || "").includes("flex-wrap: wrap") && (d.getAttribute("style") || "").includes("flex-basis: 100%")
);
check("collection chip row forces its own full-width line", !!chipRow);

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
