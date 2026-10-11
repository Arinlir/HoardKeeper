// Mount the app, open Life, and verify: full-screen board + exit works (through
// the hub's menu — there is no top bar any more), rapid taps accumulate into one
// badge (not one per tap), the badge lingers while tapping continues, and it
// poofs away after taps stop.
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
const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const all = () => [...document.querySelectorAll('button, [role="button"]')];
const byLabel = (re) => all().find((b) => re.test(b.getAttribute("aria-label") || ""));

const lifeTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Life");
await click(lifeTab);

check("shows a full-screen board", !!document.querySelector('[data-bw-back="life"][style*="position: fixed"][style*="inset: 0"]'));
check("the board is bare: four seats and a hub, no title bar or Exit button until the menu opens",
  document.querySelectorAll(".life-num").length === 4 && !document.body.textContent.includes("Life Counter") && !all().some((b) => b.textContent.includes("Exit")));
check("the hub is there", !!byLabel(/^Menu$/));

// Player 1's minus half — the left/top/bottom half of their seat, whichever way it faces
const minusOne = byLabel(/^Player 1: decrease life by 1$/);
check("found Player 1's minus half", !!minusOne);

await click(minusOne);
check("first tap shows -1 badge", document.body.textContent.includes("-1"));

await click(minusOne);
await click(minusOne);
check("three rapid taps accumulate to one -3 badge", document.body.textContent.includes("-3"));
check("no separate -1/-2 badges left over from earlier taps", document.querySelectorAll(".life-badge").length === 1);
check("the life total follows", [...document.querySelectorAll(".life-num")][0].textContent === "37");

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

// the menu carries what the top bar used to
await click(byLabel(/^Menu$/));
check("the hub opens the menu", !!document.querySelector('[aria-label="Life counter menu"]') && document.body.textContent.includes("Life Counter"));
check("the menu has its own close button and the hub steps aside", !!byLabel(/^Close$/) && !byLabel(/^Menu$/));

// exit returns to the normal app (Collection view)
const exitBtn = all().find((b) => b.textContent.includes("Exit"));
check("Exit is in the menu", !!exitBtn);
await click(exitBtn);
check("exit closes the board", !document.querySelector('[data-bw-back="life"]'));
check("back on the normal collection page", document.body.textContent.includes("Add card"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
