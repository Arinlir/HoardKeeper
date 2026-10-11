// Verifies the app never mistakes a FAILED load for an empty vault. Before
// this, any load error (server down, 500, PIN lockout) left the app looking
// empty — and its first autosave then wrote that emptiness over the real
// vault. Now: a banner with a retry, no saves until a load succeeds, and a
// session the server no longer accepts sends you back to the sign-in screen.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let getStatus = 500;
let getBody = { error: "Server error" };
const puts = [];
globalThis.fetch = (url, opts = {}) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ user: { id: 1, email: "mike@example.com", verified: true, handle: "mike" } }) });
  if (u.includes("/api/store") && opts.method === "PUT") {
    puts.push(JSON.parse(opts.body).value);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, rev: 9 }) });
  }
  if (u.includes("/api/store")) {
    const s = getStatus;
    const b = getBody;
    return Promise.resolve({ ok: s >= 200 && s < 300, status: s, json: async () => b });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

async function mount() {
  document.body.innerHTML = "<div id='root'></div>";
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(App)));
  await act(async () => {
    await wait(700);
  });
  return root;
}

// ---- server error ----
let root = await mount();
check("a failed load shows why", !!document.querySelector('[data-testid="load-error"]'));
check("…and saves nothing over the real vault", puts.length === 0);

getStatus = 200;
getBody = { value: JSON.stringify({ collections: [], cards: [], decks: [{ id: "d", name: "Kept deck", cards: [] }] }), rev: 8 };
const retry = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Try again");
await act(async () => {
  retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await wait(700);
});
check("Try again loads it", !document.querySelector('[data-testid="load-error"]'));
await act(async () => {
  await wait(700);
});
check("…and only then does saving start, with the real data", puts.length >= 1 && JSON.parse(puts[puts.length - 1]).decks?.[0]?.name === "Kept deck");
root.unmount();

// ---- locked out ----
puts.length = 0;
getStatus = 429;
getBody = { error: "Too many attempts. Try again in 2 minutes.", retryAfter: 120 };
root = await mount();
check("a lockout says how long", document.querySelector('[data-testid="load-error"]')?.textContent.includes("2 minutes"));
check("…and saves nothing", puts.length === 0);
root.unmount();

// ---- signed out elsewhere ----
getStatus = 401;
getBody = { error: "Not signed in" };
root = await mount();
check("a session the server no longer accepts goes back to sign-in", document.body.textContent.includes("Sign in to your vault"));
check("…and saves nothing", puts.length === 0);
root.unmount();

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
