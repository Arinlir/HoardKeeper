// Mount the app, open Life, and verify: full-screen overlay + exit works,
// rapid taps accumulate into one badge (not one per tap), the badge lingers
// while tapping continues, and it poofs away after taps stop.
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

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

const lifeTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Life");
await act(async () => { lifeTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

check("Life Counter opened", document.body.textContent.includes("Life Counter"));
check("shows a full-screen overlay", !!document.querySelector('[style*="position: fixed"][style*="inset: 0"]'));
check("Exit button present", [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Exit")));

// find Player 1's -1 button (first "−1" button on the page)
const minusOne = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "−1");
check("found a -1 button", !!minusOne);

await act(async () => { minusOne.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("first tap shows -1 badge", document.body.textContent.includes("-1"));

await act(async () => { minusOne.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { minusOne.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("three rapid taps accumulate to one -3 badge", document.body.textContent.includes("-3"));
check("no separate -1/-2 badges left over from earlier taps", !document.querySelectorAll(".life-badge").length || document.querySelectorAll(".life-badge").length === 1);

// still within the linger window: badge should not be poofing yet
check("badge not fading during active tapping", !document.querySelector(".life-badge.poofing"));

// let the linger timer fire (900ms) -- badge should start poofing
await new Promise((r) => setTimeout(r, 950));
await act(async () => {});
check("badge starts poofing after taps stop", !!document.querySelector(".life-badge.poofing"));

// let the poof animation duration pass -- badge should be gone
await new Promise((r) => setTimeout(r, 600));
await act(async () => {});
check("badge removed after poof completes", !document.querySelector(".life-badge"));

// CSS shipped -- check while the Life overlay (and its local <style>) is still mounted
const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
check("poof keyframes shipped", /@keyframes life-badge-poof/.test(css));
check("reduced-motion disables the badge animation", /prefers-reduced-motion[\s\S]*\.life-badge/.test(css));

// exit returns to the normal app (Collection view)
const exitBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Exit"));
await act(async () => { exitBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("exit closes the overlay", !document.querySelector('[style*="position: fixed"][style*="inset: 0"]'));
check("back on the normal collection page", document.body.textContent.includes("Add card"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
