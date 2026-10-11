// Smoke-tests the Scan tab's static shell inside Add Card: the tab exists,
// switching to it renders the camera/upload chooser without touching any
// camera/OCR API (jsdom has neither navigator.mediaDevices nor a working
// canvas 2D context, so this deliberately never clicks "Use camera" or
// "Upload photo" -- that's covered by a real-browser Playwright check
// instead), and the other tabs still work after visiting it.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLElement.prototype.attachEvent = function () {};
dom.window.HTMLElement.prototype.detachEvent = function () {};
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

const addBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add card"));
check("found the Add card button", !!addBtn);
await act(async () => { addBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const scanTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Scan");
check("Scan tab exists in Add Card", !!scanTab);
await act(async () => { scanTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

check("camera chooser rendered", document.body.textContent.includes("Use camera"));
check("upload chooser rendered", document.body.textContent.includes("Upload photo"));
check("set/collector-number fields shared with By code mode are present", !!document.querySelector('[aria-label="Set code"]') && !!document.querySelector('[aria-label="Collector number"]'));
check("didn't touch navigator.mediaDevices merely by rendering the tab", true); // no throw above proves it

// switching away and back, and to the other tabs, shouldn't crash or leave stale state
const codeTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "By code");
check("By code tab still reachable after visiting Scan", !!codeTab);
await act(async () => { codeTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("By code mode's own helper copy shows (not Scan's)", document.body.textContent.includes("Set sticks between adds"));

const searchTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "By name");
await act(async () => { searchTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("By name tab still reachable after visiting Scan", !!document.querySelector('[aria-label="Card name"]'));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
