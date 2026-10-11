// Signed-in devices list, whole-vault backup/restore parsing, the admin's
// contact line, and link-preview tags for shared pages.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { DevicesPanel, parseBackup } from "./src/features/collection/modals/AccountExtras.jsx";
import { ContactLine } from "./src/features/auth/AuthGate.jsx";

const require = createRequire(import.meta.url);
let ok = true;
const check = (l, c) => { console.log(c ? "PASS" : "FAIL", l); if (!c) ok = false; };

// ---------- backup file parsing ----------
check("a backup file is accepted", parseBackup(JSON.stringify({ format: "binderwyrm-backup", version: 1, vault: { cards: [{ id: "1" }], decks: [] } })).ok);
check("a bare vault object is accepted", parseBackup(JSON.stringify({ cards: [], wishlist: [] })).ok);
check("not JSON is refused", !parseBackup("hello").ok);
check("an array is refused", !parseBackup("[1,2]").ok);
check("an unrelated object is refused", !parseBackup(JSON.stringify({ name: "x" })).ok);
check("a damaged list is refused", !parseBackup(JSON.stringify({ cards: "oops" })).ok);
check("a wrapper with no vault is refused", !parseBackup(JSON.stringify({ format: "binderwyrm-backup" })).ok);
check("a huge file is refused", !parseBackup("x".repeat(12 * 1024 * 1024)).ok);

// ---------- settings: contact line ----------
const { createSettings } = require(path.join(process.cwd(), "settings.cjs"));
const st = createSettings(fs.mkdtempSync(path.join(os.tmpdir(), "bw-set-")), {});
check("a contact line is accepted", st.plan({ set: { CONTACT_INFO: " admin@example.com " } }).next.CONTACT_INFO === "admin@example.com");
let tooLong = false;
try { st.plan({ set: { CONTACT_INFO: "x".repeat(201) } }); } catch (e) { tooLong = true; }
check("…but not 201 characters", tooLong);
let nl = false;
try { st.plan({ set: { CONTACT_INFO: "a\nb" } }); } catch (e) { nl = true; }
check("…or a line break", nl);

// ---------- UI: contact line ----------
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(ContactLine, { contact: "admin@example.com" })); });
check("an email contact becomes a mailto link", document.querySelector("a")?.getAttribute("href") === "mailto:admin@example.com");
await act(async () => { root.render(React.createElement(ContactLine, { contact: "https://chat.example.com/help" })); });
check("a web address becomes a link", document.querySelector("a")?.getAttribute("href") === "https://chat.example.com/help");
await act(async () => { root.render(React.createElement(ContactLine, { contact: "javascript:alert(1)" })); });
check("anything else is plain text, never a link", !document.querySelector("a") && /javascript:alert/.test(document.body.textContent));
await act(async () => { root.render(React.createElement(ContactLine, { contact: "" })); });
check("no contact, no line", !document.querySelector("[data-testid=contact-line]"));

// ---------- UI: devices ----------
const calls = [];
let sessions = [
  { id: "a".repeat(64), label: "Firefox on Windows", kind: "cookie", created: Date.now() - 86400000, lastSeen: Date.now() - 60000, current: true },
  { id: "b".repeat(64), label: "Phone app (Android)", kind: "bearer", created: Date.now() - 5 * 86400000, lastSeen: Date.now() - 3 * 3600000, current: false },
];
globalThis.fetch = async (url, opts = {}) => {
  calls.push(`${opts.method || "GET"} ${url}`);
  const j = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
  if (/\/api\/auth\/sessions$/.test(url)) return j({ sessions });
  if (/\/api\/auth\/sessions\/others$/.test(url)) { sessions = sessions.filter((s) => s.current); return j({ ok: true }); }
  if (/\/api\/auth\/sessions\/[0-9a-f]{64}$/.test(url)) { sessions = sessions.filter((s) => !url.endsWith(s.id)); return j({ ok: true }); }
  return j({}, 404);
};
await act(async () => { root.render(React.createElement(DevicesPanel)); });
await act(async () => { [...document.querySelectorAll("button")].find((b) => /Signed-in devices/.test(b.textContent)).click(); });
await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
check("both devices are listed", /Firefox on Windows/.test(document.body.textContent) && /Phone app \(Android\)/.test(document.body.textContent));
check("this device is marked and has no sign-out button", /this device/.test(document.body.textContent) && document.querySelectorAll("button[aria-label^='Sign out']").length === 1);
await act(async () => { document.querySelector("button[aria-label='Sign out Phone app (Android)']").click(); });
await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
check("signing a device out calls DELETE and refreshes", calls.some((c) => c.startsWith("DELETE ")) && !/Phone app \(Android\)/.test(document.body.textContent));
check("with one device left there is no 'sign out all others'", !/all other devices/.test(document.body.textContent));

// ---------- server: devices, contact, previews ----------
function call(port, method, p, { headers = {}, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers, ...(cookie ? { Cookie: cookie } : {}) };
    const payload = body === undefined ? null : JSON.stringify(body);
    if (payload !== null) { h["Content-Type"] = "application/json"; h["Content-Length"] = Buffer.byteLength(payload); }
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: h }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { let json = null; try { json = JSON.parse(data); } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, json, text: data }); });
    });
    r.on("error", reject);
    if (payload !== null) r.write(payload);
    r.end();
  });
}
const APP = { "x-hk-app": "1" };
const cookieOf = (res) => (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("bw_session=")) || null;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-extras-"));
const port = 33000 + Math.floor(Math.random() * 2500);
fs.mkdirSync(path.join(dir, "dist-fake"), { recursive: true });
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.cjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DATA_DIR: dir, CARD_DB: "off", COOKIE_SECURE: "off", CONTACT_INFO: "admin@example.com", PUBLIC_URL: "https://hoard.example.com", SMTP_HOST: "", },
  stdio: "ignore",
});
try {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { if ((await call(port, "GET", "/api/health")).status === 200) break; } catch (e) {}
  }
  const health = await call(port, "GET", "/api/health");
  check("health carries the contact line", health.json?.contact === "admin@example.com");

  const reg = await call(port, "POST", "/api/auth/register", { headers: { ...APP, "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0" }, body: { email: "me@example.com", password: "my-long-password" } });
  const c1 = cookieOf(reg);
  const login2 = await call(port, "POST", "/api/auth/login", { headers: { ...APP, "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36" }, body: { email: "me@example.com", password: "my-long-password" } });
  const c2 = cookieOf(login2);
  const list = await call(port, "GET", "/api/auth/sessions", { cookie: c1 });
  const labels = (list.json?.sessions || []).map((s) => s.label).sort();
  check("two sessions with readable labels", labels.length === 2 && labels.includes("Firefox on Windows") && labels.includes("Chrome on Android"));
  check("exactly one is marked current", list.json.sessions.filter((s) => s.current).length === 1 && list.json.sessions.find((s) => s.current).label === "Firefox on Windows");
  check("the list needs a sign-in", (await call(port, "GET", "/api/auth/sessions")).status === 401);
  const mine = list.json.sessions.find((s) => s.current);
  const other = list.json.sessions.find((s) => !s.current);
  check("you can't use the per-device button on this device", (await call(port, "DELETE", `/api/auth/sessions/${mine.id}`, { cookie: c1, headers: APP })).status === 400);
  check("a delete needs the app header", (await call(port, "DELETE", `/api/auth/sessions/${other.id}`, { cookie: c1 })).status === 403);

  // someone else's device can't be touched
  await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "you@example.com", password: "your-long-password" } });
  const youLogin = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "you@example.com", password: "your-long-password" } });
  const youList = await call(port, "GET", "/api/auth/sessions", { cookie: cookieOf(youLogin) });
  const yourSession = youList.json.sessions[0];
  check("another account's device id is a 404, not a deletion", (await call(port, "DELETE", `/api/auth/sessions/${yourSession.id}`, { cookie: c1, headers: APP })).status === 404);
  check("…and that device is still signed in", (await call(port, "GET", "/api/auth/me", { cookie: cookieOf(youLogin) })).status === 200);

  check("signing the other device out works", (await call(port, "DELETE", `/api/auth/sessions/${other.id}`, { cookie: c1, headers: APP })).status === 200);
  check("…and it really is signed out", (await call(port, "GET", "/api/auth/me", { cookie: c2 })).status === 401);
  const login3 = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "me@example.com", password: "my-long-password" } });
  check("'sign out all others' keeps this one", (await call(port, "POST", "/api/auth/sessions/others", { cookie: c1, headers: APP, body: {} })).json?.signedOut === 1 && (await call(port, "GET", "/api/auth/me", { cookie: c1 })).status === 200 && (await call(port, "GET", "/api/auth/me", { cookie: cookieOf(login3) })).status === 401);

  // lock carries the contact
  let last;
  for (let i = 0; i < 5; i++) last = await call(port, "POST", "/api/auth/login", { headers: { ...APP, "x-forwarded-for": `192.0.2.${i + 1}` }, body: { email: "you@example.com", password: "nope-" + i } });
  check("the locked answer carries the contact line", last.status === 423 && last.json?.contact === "admin@example.com");

  // previews
  const hostile = { id: "h", name: "Evil", set: "x", collectorNumber: "1", quantity: 1, imageUrl: "https://tracker.example/p.gif" };
  const good = { id: "g", name: "Mana Crypt", set: "ema", collectorNumber: "1", quantity: 2, imageUrl: "https://cards.scryfall.io/normal/front/a/b/ab.jpg" };
  await call(port, "POST", "/api/auth/handle", { headers: APP, cookie: c1, body: { handle: "mike" } });
  await call(port, "PUT", "/api/store", { headers: APP, cookie: c1, body: { value: JSON.stringify({ cards: [hostile, good], wishlist: [good], publicVault: true }) } });
  const w = await call(port, "GET", "/w/mike");
  check("/w/<handle> carries a title, description and card image", /og:title" content="mike&#39;s wishlist · Binderwyrm"/.test(w.text) && /2 cards mike is looking for/.test(w.text) && /og:image" content="https:\/\/cards\.scryfall\.io\//.test(w.text));
  check("…and a canonical address from the public URL", /og:url" content="https:\/\/hoard\.example\.com\/w\/mike"/.test(w.text));
  check("…marked noindex", /noindex/.test(w.text));
  const v = await call(port, "GET", "/v/mike");
  check("/v/<handle> previews a shared collection", /mike&#39;s collection/.test(v.text) && /3 cards in mike/.test(v.text));
  check("…and never a tracker's image", !v.text.includes("tracker.example") && !w.text.includes("tracker.example"));
  const none = await call(port, "GET", "/w/nobody");
  check("an unknown handle gets the plain page (no preview)", none.status === 200 && !/og:title/.test(none.text));
  await call(port, "PUT", "/api/store", { headers: APP, cookie: c1, body: { value: JSON.stringify({ cards: [good], wishlist: [good], publicVault: false }) } });
  await new Promise((r) => setTimeout(r, 50));
  // cache is 5 minutes, so check a handle that never opted in instead
  const yourHandle = await call(port, "POST", "/api/auth/handle", { headers: APP, cookie: cookieOf(youLogin), body: { handle: "closed" } });
  await call(port, "PUT", "/api/store", { headers: APP, cookie: cookieOf(youLogin), body: { value: JSON.stringify({ cards: [good], wishlist: [], publicVault: false }) } });
  const closed = await call(port, "GET", "/v/closed");
  check("a collection that isn't shared gets no preview, same as a missing one", closed.status === 200 && !/og:title/.test(closed.text));
} catch (e) {
  console.log("FAIL threw", e);
  ok = false;
} finally {
  child.kill();
}
process.exit(ok ? 0 : 1);
