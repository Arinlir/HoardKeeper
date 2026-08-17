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
  "roster-row media query shipped": /@media \(max-width: 560px\)[^}]*\{\s*\.roster-row/.test(css),
  "card-grid media query shipped": /@media \(max-width: 420px\)[^}]*\.card-grid/.test(css),
  "nav-tabs class applied to an element": !!document.querySelector(".nav-tabs"),
  "card-grid class applied to an element": !!document.querySelector(".card-grid"),
};

let allPass = true;
for (const [label, ok] of Object.entries(checks)) {
  console.log((ok ? "PASS" : "FAIL"), label);
  if (!ok) allPass = false;
}

// Header title must be a clamp() so it can't force horizontal overflow.
const h1 = [...document.querySelectorAll("h1")].find((h) => h.textContent.includes("HOARDKEEPER"));
const h1Clamped = h1 && /clamp\(/.test(h1.getAttribute("style") || "");
console.log((h1Clamped ? "PASS" : "FAIL"), "header title uses clamp()");
if (!h1Clamped) allPass = false;

console.log(allPass ? "\nALL PASS" : "\nFAIL");
process.exit(allPass ? 0 : 1);
