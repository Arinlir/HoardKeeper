// Verifies the app's behaviour when it runs inside the Android/iOS shell
// (Capacitor), where its pages come from the app bundle rather than from a
// server:
//   • first launch asks for a server (ConnectGate) instead of silently
//     falling back to an empty on-device collection;
//   • once set, every /api call goes to that server;
//   • an unreachable server brings the Connect screen back with a reason;
//   • a save refused because another device saved first (409) stops saving,
//     says so, and "Load latest" pulls the newer copy without writing it
//     straight back;
//   • coming back to the app picks up another device's newer save.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://localhost/",
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

// What Capacitor's native bridge injects into its WebView.
globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
dom.window.Capacitor = globalThis.Capacitor;

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
};

// ---- a scripted server ----
const calls = [];
let handler = () => ({ status: 404, body: {} });
globalThis.fetch = (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {} });
  const r = handler(u, opts);
  if (r === "down") return Promise.reject(new TypeError("Failed to fetch"));
  return Promise.resolve({
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.body,
  });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;
const { normalizeServerUrl, apiUrl, publicOrigin, serverChoice } = await import("./src/lib/platform.js");
const { checkServer } = await import("./src/features/auth/ConnectGate.jsx");
const { store } = await import("./src/lib/store.js");

async function mount() {
  const holder = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(holder);
  const root = createRoot(holder);
  await act(async () => {
    root.render(React.createElement(App));
  });
  await act(async () => {
    await wait(80);
  });
  return root;
}

// ---- 1. addresses ----
check("bare host becomes https", normalizeServerUrl("hoard.arinvault.eu") === "https://hoard.arinvault.eu");
check("trailing slash dropped", normalizeServerUrl("https://hoard.arinvault.eu/") === "https://hoard.arinvault.eu");
check("pasted share link trimmed to the server", normalizeServerUrl("https://hoard.arinvault.eu/w/michael") === "https://hoard.arinvault.eu");
check("port and sub-path kept", normalizeServerUrl("https://home.example:8443/bw") === "https://home.example:8443/bw");
check("explicit http kept (so it can be refused with a reason)", normalizeServerUrl("http://192.168.18.35:8420") === "http://192.168.18.35:8420");
check("garbage is rejected", normalizeServerUrl("   ") === "" && normalizeServerUrl("http://") === "");

// ---- 2. first launch ----
localStorage.clear();
check("nothing chosen yet", serverChoice() === "unset");
let root = await mount();
check("first launch shows the Connect screen", !!document.querySelector('[data-testid="connect-gate"]'));
check("…without calling any server first", calls.length === 0);
root.unmount();

handler = (u) => (u === "https://good.example/api/health" ? { status: 200, body: { ok: true, mode: "accounts" } } : { status: 200, body: "<html>" });
check("checkServer accepts a Binderwyrm server", (await checkServer("https://good.example")) === "");
check("checkServer rejects something else", /isn't a Binderwyrm server/.test(await checkServer("https://other.example")));
handler = () => "down";
check("checkServer explains an unreachable address", /Couldn't reach/.test(await checkServer("https://gone.example")));

// ---- 3. this phone only ----
localStorage.setItem("bw-server", "local");
calls.length = 0;
root = await mount();
check("local-only skips the Connect screen", !document.querySelector('[data-testid="connect-gate"]'));
check("…and never calls a server", calls.every((c) => !c.url.includes("/api/")));
root.unmount();

// ---- 4. saved server is down ----
localStorage.setItem("bw-server", "https://hoard.example");
calls.length = 0;
handler = () => "down";
root = await mount();
check("unreachable server brings back the Connect screen", !!document.querySelector('[data-testid="connect-gate"]'));
check("…saying which server", document.body.textContent.includes("Couldn't reach https://hoard.example"));
check("…and the health check went to that server", calls.some((c) => c.url === "https://hoard.example/api/health"));
root.unmount();

// ---- 5. connected, and another device saves first ----
check("apiUrl prefixes the server", apiUrl("/api/profiles") === "https://hoard.example/api/profiles");
check("share links point at the server, not the app bundle", publicOrigin() === "https://hoard.example");

const vault = (decks) => JSON.stringify({ collections: [], cards: [], wishlist: [], decks });
let serverRev = 1;
let serverValue = vault([]);
const puts = [];
let refusePuts = true;
handler = (u, opts) => {
  if (u === "https://hoard.example/api/auth/me") return { status: 200, body: { user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } } };
  if (u === "https://hoard.example/api/health") return { status: 200, body: { ok: true, mode: "accounts" } };
  if (u === "https://hoard.example/api/store" && (opts.method || "GET") === "GET")
    return { status: 200, body: { value: serverValue, rev: serverRev } };
  if (u === "https://hoard.example/api/store" && opts.method === "PUT") {
    puts.push({ base: opts.headers["x-base-rev"] });
    if (refusePuts) return { status: 409, body: { error: "Changed on another device", rev: serverRev } };
    serverRev += 1;
    return { status: 200, body: { ok: true, rev: serverRev } };
  }
  return { status: 404, body: {} };
};
calls.length = 0;
root = await mount();
check("vault loaded from the configured server", calls.some((c) => c.url === "https://hoard.example/api/store"));
check("store knows the loaded revision", store.rev === 1);

// The app writes once after loading; pretend the desktop saved meanwhile.
serverRev = 2;
serverValue = vault([{ id: "d1", name: "Desktop deck", cards: [] }]);
await act(async () => {
  await wait(700);
});
check("the save carried the revision it was based on", puts.length >= 1 && puts[0].base === "1");
check("a refused save shows the conflict banner", !!document.querySelector('[data-testid="save-conflict"]'));
const putsAtConflict = puts.length;
await act(async () => {
  await wait(700);
});
check("…and saving stops (no retry loop)", puts.length === putsAtConflict);

refusePuts = false;
const loadLatest = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Load latest");
await click(loadLatest);
await act(async () => {
  await wait(700);
});
check("Load latest clears the banner", !document.querySelector('[data-testid="save-conflict"]'));
check("…picks up the newer revision", store.rev === 2);
check("…and doesn't write the fresh copy straight back", puts.length === putsAtConflict);

// ---- 6. coming back to the app ----
serverRev = 7;
serverValue = vault([{ id: "d2", name: "Phone-away deck", cards: [] }]);
Object.defineProperty(dom.window.document, "visibilityState", { value: "visible", configurable: true });
await act(async () => {
  dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
  await wait(50);
});
await act(async () => {
  await wait(700);
});
check("returning to the app pulls another device's newer save", store.rev === 7);
check("…without writing it back", puts.length === putsAtConflict);
root.unmount();

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
