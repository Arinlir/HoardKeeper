// jsdom has no real layout engine, so pixel-perfect overlap can't be measured
// here -- what CAN be verified directly is the structural fix: the life
// number's font-size actually shrinks as columns increase, every player cell
// clips horizontally so it can never bleed into a neighbor, and the worst
// case (6 players, commander damage expanded) mounts without error.
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
await act(async () => { root.render(React.createElement(App)); });

const lifeTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Life");
await act(async () => { lifeTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

// Player names live in <input value>, which textContent doesn't see -- find
// the life-total elements by their real, distinguishing style (line-height:1
// numerals) instead.
function lifeNumberEls() {
  return [...document.querySelectorAll(".mono")].filter(
    (el) => /^\d+$/.test(el.textContent.trim()) && (el.getAttribute("style") || "").includes("line-height: 1")
  );
}
function fontSizeOf(el) {
  return (el.getAttribute("style") || "").match(/font-size:\s*([^;]+);/)?.[1] || "";
}

// default is 4 players (2 columns) -- confirm that tier's sizing directly
let numbers = lifeNumberEls();
check("default (4 players / 2 columns) uses the 2-column ceiling (78px)", numbers.length === 4 && numbers.every((n) => fontSizeOf(n).includes("78px")));

// scale up to 6 players (3 columns) -- the exact case from the report
const plus = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "+");
for (let i = 0; i < 2; i++) {
  await act(async () => { plus.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}
numbers = lifeNumberEls();
check("scaled up to 6 players", numbers.length === 6);
check("6 players: number font shrinks to the 3-column ceiling (62px), not 96px", numbers.every((n) => fontSizeOf(n).includes("62px")));
check("6 players: vw factor also shrinks (5vw, not 9vw)", numbers.every((n) => fontSizeOf(n).includes("5vw")));

// every player cell clips horizontally, so it can never visually bleed into
// a neighboring column regardless of what overflows inside it
const cellCandidates = [...document.querySelectorAll("div")].filter(
  (d) => (d.getAttribute("style") || "").includes("overflow-x: hidden") && (d.getAttribute("style") || "").includes("overflow-y: auto")
);
check("all 6 player cells clip horizontally", cellCandidates.length === 6);

// expand commander damage on a player with 5 opponents -- the exact
// configuration from the report -- and confirm it doesn't throw
const cmdToggle = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Commander damage"));
let threw = false;
try {
  await act(async () => { cmdToggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
} catch (e) {
  threw = true;
}
check("expanding commander damage with 5 opponents doesn't throw", !threw);
check("all 5 opponents listed", [1,2,3,4,5,6].filter((n) => document.body.textContent.includes(`from Player ${n}`)).length === 5);

// the expanded list itself stays height-capped so it can't push the toggle
// row (and everything above it) out of the cell
const expandedList = [...document.querySelectorAll("div")].find(
  (d) => (d.getAttribute("style") || "").includes("max-height: 84px")
);
check("expanded list is capped tighter at 3 columns (84px, not 110px)", !!expandedList);

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
