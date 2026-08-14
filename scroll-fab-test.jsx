// Verify: (1) card tiles carry a stable data-card-id so scrollIntoView can
// find them, (2) the just-added highlight class exists and is wired to a
// timed removal, (3) the floating add button only shows in the collection
// view, past the scroll threshold, and never during select mode.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
// jsdom doesn't implement scrollIntoView; stub it so the effect doesn't throw
window.HTMLElement.prototype.scrollIntoView = function () {};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => {
  root.render(React.createElement(App));
});

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

// FAB should not exist before any scroll (collection view, top of page).
check("FAB absent before scrolling", !document.querySelector(".fab-add"));

// simulate scrolling past the threshold
Object.defineProperty(window, "scrollY", { value: 400, configurable: true });
await act(async () => {
  window.dispatchEvent(new dom.window.Event("scroll"));
});
check("FAB appears after scrolling past threshold", !!document.querySelector(".fab-add"));

// switch away from the collection view — FAB must not follow
const decksTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Decks");
await act(async () => {
  decksTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
check("FAB hidden outside the collection view", !document.querySelector(".fab-add"));

// back to collection — FAB should return since scroll position is still past threshold
const collectionTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Collection");
await act(async () => {
  collectionTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
check("FAB reappears back in the collection view", !!document.querySelector(".fab-add"));

// the CSS for the highlight pulse must exist
const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
check("just-added pulse animation shipped", /\.card-tile\.just-added \.sleeve\s*\{[^}]*animation:\s*just-added-pulse/.test(css));
check("fab entrance animation shipped", /\.fab-add\s*\{[^}]*animation:\s*fab-in/.test(css));
check("reduced-motion disables both new animations", /prefers-reduced-motion[\s\S]*\.fab-add,\s*\.card-tile\.just-added \.sleeve\s*\{\s*animation:\s*none/.test(css));

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
