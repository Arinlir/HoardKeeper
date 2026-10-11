// Verifies the client side of the accounts edition, in the phone app and in
// a browser: the phone app signs in with a token (asks for one at login,
// keeps it, sends it as Authorization on every call, drops it on sign-out or
// when it stops working); the website never sends a token and relies on its
// cookie.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://localhost/", pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

let native = true;
globalThis.Capacitor = { isNativePlatform: () => native, getPlatform: () => (native ? "ios" : "web") };

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = "https://cards.example.com";
const calls = [];
let tokenValid = true;
globalThis.fetch = (url, opts = {}) => {
  const u = String(url);
  const headers = opts.headers || {};
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url: u, method: opts.method || "GET", headers, body, credentials: opts.credentials });
  const reply = (status, b) => Promise.resolve({ ok: status < 300, status, json: async () => b });
  const authed = headers.Authorization === "Bearer tok-123" && tokenValid;
  const path = u.replace(BASE, "");
  if (path === "/api/health") return reply(200, { ok: true, mode: "accounts", registration: true });
  if (path === "/api/auth/me") return authed ? reply(200, { user: { id: 1, email: "mike@example.com" } }) : reply(401, { error: "Not signed in" });
  if (path === "/api/auth/login") return reply(200, { user: { id: 1, email: "mike@example.com" }, ...(body?.app ? { token: "tok-123" } : {}) });
  if (path === "/api/auth/logout") return reply(200, { ok: true });
  if (path === "/api/store" && (opts.method || "GET") === "GET") return authed ? reply(200, { value: JSON.stringify({ cards: [], collections: [] }), rev: 3 }) : reply(401, { error: "Not signed in" });
  if (path === "/api/store" && opts.method === "PUT") return authed ? reply(200, { ok: true, rev: 4 }) : reply(401, {});
  return reply(404, {});
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;
const { authPost } = await import("./src/features/auth/AuthGate.jsx");

const typeInto = async (el, value) => {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  await act(async () => el[key].onChange({ target: { value } }));
};
const click = async (el) => {
  await act(async () => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
};

async function mount() {
  document.body.innerHTML = "<div id='root'></div>";
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(App)));
  await act(async () => {
    await wait(100);
  });
  return root;
}

// ---- phone app ----
localStorage.setItem("bw-server", BASE);
let root = await mount();
check("no token yet: the sign-in screen shows", !!document.querySelector('input[type="email"]'));
await typeInto(document.querySelector('input[type="email"]'), "mike@example.com");
await typeInto(document.querySelector('input[type="password"]'), "correct horse battery");
await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Sign in"));
await act(async () => {
  await wait(800);
});
const login = calls.find((c) => c.url.endsWith("/api/auth/login"));
check("the app asks for a token at sign-in", login?.body?.app === true);
check("…and keeps it", localStorage.getItem("bw-token") === "tok-123");
const storeGet = calls.find((c) => c.url === `${BASE}/api/store` && c.method === "GET");
check("the vault is loaded with the token", storeGet?.headers?.Authorization === "Bearer tok-123");
check("…and without cross-site cookies", storeGet?.credentials === "same-origin");
const storePut = calls.find((c) => c.url === `${BASE}/api/store` && c.method === "PUT");
check("saves carry the token too", storePut?.headers?.Authorization === "Bearer tok-123" && storePut?.headers?.["x-base-rev"] === "3");
root.unmount();

calls.length = 0;
root = await mount();
check("next launch: straight in with the kept token", calls.some((c) => c.url.endsWith("/api/auth/me") && c.headers?.Authorization === "Bearer tok-123") && !document.querySelector('input[type="email"]'));
root.unmount();

tokenValid = false;
root = await mount();
await act(async () => {
  await wait(200);
});
check("a token the server no longer accepts shows the sign-in screen", !!document.querySelector('input[type="email"]'));
check("…and is forgotten", localStorage.getItem("bw-token") === null);
root.unmount();

// changing server drops the token
tokenValid = true;
localStorage.setItem("bw-token", "tok-123");
const { setServerChoice } = await import("./src/lib/platform.js");
setServerChoice("https://other.example.com");
check("changing server forgets the token", localStorage.getItem("bw-token") === null);

// ---- browser ----
native = false;
localStorage.clear();
calls.length = 0;
await authPost("/api/auth/login", { email: "mike@example.com", password: "x" });
const webLogin = calls.find((c) => c.url === "/api/auth/login");
check("the website doesn't ask for a token (the cookie does it)", webLogin && webLogin.body.app === undefined && !webLogin.headers.Authorization);
check("…and nothing is stored", localStorage.getItem("bw-token") === null);

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
