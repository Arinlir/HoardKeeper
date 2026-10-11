// Verify the responsive rules actually exist in the shipped stylesheet, and
// that the classes that depend on them are applied to the right elements.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => {
  root.render(React.createElement(App));
});

const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");

const checks = {
  "nav-tabs scroll rule shipped": /\.nav-tabs\s*\{[^}]*overflow-x:\s*auto/.test(css),
  "art-roster-row media query shipped": /@media \(max-width: 560px\)[^}]*\{\s*\.art-roster-row/.test(css),
  // The breakpoint itself can move; what matters is that phones get a
  // two-column grid whose tracks are allowed to be narrower than a card name
  // (minmax(0, 1fr), not 1fr — see CardTile).
  "card-grid phone rule shipped": /@media \(max-width: \d+px\)[^}]*\.card-grid[^}]*minmax\(0, 1fr\)/.test(css),
  "search scope switch has a short label for narrow screens": /\.scope-short/.test(css) && /\.scope-long/.test(css),
  "search input reserves room for that switch": /\.search-input\s*\{[^}]*padding-right/.test(css),
  "header buttons collapse to icons on phones": /\.icon-btn-label\s*\{\s*display:\s*none/.test(css),
  // (not [^}]* — this rule sits after another one inside the same media block)
  "nav tabs tighten up on phones": /@media \(max-width: \d+px\)[\s\S]{0,240}\.view-tab/.test(css),
  "stepper mobile-shrink rule shipped": /@media \(max-width: 480px\)[^}]*\.stepper\b/.test(css),
  "qty-btn-sm coarse-pointer rule shipped": /@media \(pointer: coarse\)[^}]*\.qty-btn-sm/.test(css),
  "nav-tabs class applied to an element": !!document.querySelector(".nav-tabs"),
  "card-grid class applied to an element": !!document.querySelector(".card-grid"),
};

let allPass = true;
for (const [label, ok] of Object.entries(checks)) {
  console.log((ok ? "PASS" : "FAIL"), label);
  if (!ok) allPass = false;
}

// Header title must be a clamp() so it can't force horizontal overflow.
const h1 = [...document.querySelectorAll("h1")].find((h) => h.textContent.includes("BINDERWYRM"));
const h1Clamped = h1 && /clamp\(/.test(h1.getAttribute("style") || "");
console.log((h1Clamped ? "PASS" : "FAIL"), "header title uses clamp()");
if (!h1Clamped) allPass = false;

console.log(allPass ? "\nALL PASS" : "\nFAIL");
process.exit(allPass ? 0 : 1);
