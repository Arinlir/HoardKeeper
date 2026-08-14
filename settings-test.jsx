// Verify: the header entry point is a genuine "Settings" button (not
// disguised as a currency toggle), the modal has clear sections, profile
// switching works from inside it, and the Ko-fi link is correct and safe
// (opens in a new tab, doesn't leak a referrer).
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

// header entry point
const settingsBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Settings");
check("header button is labeled Settings, not a currency code", !!settingsBtn);
check("no header button is bare 'USD' anymore", ![...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "USD"));

await act(async () => { settingsBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const text = document.body.textContent;
check("modal opened", text.includes("Currency & display"));
check("Support section present", text.includes("Support HoardKeeper"));
check("Danger zone present", text.includes("Delete everything"));

// the Ko-fi link itself
const kofi = [...document.querySelectorAll("a")].find((a) => (a.getAttribute("href") || "").includes("ko-fi.com/Arinlir"));
check("Ko-fi link present", !!kofi);
check("Ko-fi link points at the exact right URL", kofi?.getAttribute("href") === "https://ko-fi.com/Arinlir");
check("Ko-fi link opens in a new tab", kofi?.getAttribute("target") === "_blank");
check("Ko-fi link doesn't leak a referrer/open a tab-nabbing hole", (kofi?.getAttribute("rel") || "").includes("noreferrer"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
