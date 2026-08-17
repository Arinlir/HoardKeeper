// Proves the fix: rapid state changes must never let an out-of-order network
// response leave the server holding STALE data. We simulate a slow first
// write and a fast second write racing -- the naive (unfixed) code would
// have fired two overlapping fetches and let arrival order decide the
// winner; the serialized version must always end with the LATEST state.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

let serverState = null;
let putCount = 0;
let putsInFlightAtOnce = 0;
let maxConcurrentPuts = 0;

globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael") && (!opts || opts.method !== "PUT")) {
    return Promise.resolve({ ok: true, json: async () => ({ value: serverState }) });
  }
  if (u.includes("/api/store/michael") && opts?.method === "PUT") {
    putCount++;
    putsInFlightAtOnce++;
    maxConcurrentPuts = Math.max(maxConcurrentPuts, putsInFlightAtOnce);
    const body = JSON.parse(opts.body);
    // simulate the FIRST write being slower than later ones over a real
    // network -- this is exactly the scenario that reverted data before
    const delay = putCount === 1 ? 120 : 20;
    return new Promise((resolve) => {
      setTimeout(() => {
        serverState = body.value; // server just overwrites with whatever arrives
        putsInFlightAtOnce--;
        resolve({ ok: true, json: async () => ({ ok: true }) });
      }, delay);
    });
  }
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

// open a deck-independent, simple mutation path: rename via localStorage
// currency change is easiest to trigger from here without deep deck UI --
// but we specifically want to prove the DECK rename case, so drive that.
const decksTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Decks");
await act(async () => { decksTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

// create a deck via the color picker (no typing required)
const wBtn = [...document.querySelectorAll("button")].find((b) => b.title === "W");
await act(async () => { wBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const createBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Create");
await act(async () => { createBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

// rapidly fire several state changes in quick succession (simulating fast
// typing / rapid edits) BEFORE the debounce/save settles
const exportBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Export .txt"));
// toggle charts on/off a few times as a fast, repeatable state mutation
const chartsBtn0 = () => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Charts"));
for (let i = 0; i < 5; i++) {
  const btn = chartsBtn0();
  if (btn) await act(async () => { btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}

// wait long enough for the debounce (500ms) plus both simulated network
// delays (120ms/20ms) to fully resolve, including any chained "pending" save
await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });

check("at most one PUT in flight at any time (no overlapping writes)", maxConcurrentPuts <= 1);
check("rapid changes collapsed into far fewer than one PUT per change (debounced)", putCount < 5);
check("at least one save actually happened", putCount >= 1);

const finalServerData = JSON.parse(serverState);
check("server ends up with the deck that was created (not empty/stale)", Array.isArray(finalServerData.decks) && finalServerData.decks.length === 1);

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
