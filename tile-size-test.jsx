// Verifies: the three tile-size buttons exist, clicking each changes the
// grid's actual gridTemplateColumns, and the choice persists to localStorage
// so it's remembered on reload.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));
const cards = [{ id: "c1", name: "Sol Ring", set: "ltc", collectorNumber: "59", quantity: 1, usd: 2, colors: [], rarity: "uncommon", typeLine: "Artifact", collectionId: "uncategorized", added: 1 }];
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

function gridStyle() {
  const grid = [...document.querySelectorAll("div")].find((d) => (d.getAttribute("style") || "").includes("grid-template-columns: repeat(auto-fill"));
  return grid ? grid.getAttribute("style") : "";
}

check("defaults to comfortable (170px)", gridStyle().includes("170px"));

const compactBtn = document.querySelector('button[title="Compact"]');
const largeBtn = document.querySelector('button[title="Large"]');
check("Compact and Large buttons exist", !!compactBtn && !!largeBtn);

await act(async () => { compactBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("switching to Compact changes the grid to 140px", gridStyle().includes("140px"));
check("Compact choice persisted to localStorage", localStorage.getItem("hk-tile-size") === "compact");

await act(async () => { largeBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("switching to Large changes the grid to 230px", gridStyle().includes("230px"));
check("Large choice persisted to localStorage", localStorage.getItem("hk-tile-size") === "large");

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
