// Two-factor sign-in: TOTP vectors, user enrol/login/replay/recovery/disable,
// the wrong-code lock, admin enrol/login, admin "turn off", and the QR panel.
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
import { MfaPanel, QrCode } from "./src/features/auth/MfaPanel.jsx";

const require = createRequire(import.meta.url);
const T = require(path.join(process.cwd(), "totp.cjs"));
let ok = true;
const check = (l, c) => { console.log(c ? "PASS" : "FAIL", l); if (!c) ok = false; };

// ---------- RFC 6238 / 4226 ----------
const k = Buffer.from("12345678901234567890");
check("RFC 4226 vector", T.hotp(k, 1, 6) === "287082");
check("RFC 6238 vector at t=59", T.totp(k, 59000, 8) === "94287082");
check("RFC 6238 vector at t=1111111109", T.totp(k, 1111111109000, 8) === "07081804");
check("base32 round-trips", T.unbase32(T.base32(k)).equals(k));
const now = Date.now();
const code = T.totp(k, now);
check("a current code verifies", T.verify(k, code, 0, now) === T.stepAt(now));
check("a replayed step is refused", T.verify(k, code, T.stepAt(now), now) === null);
check("a code from 5 minutes ago is refused", T.verify(k, T.totp(k, now - 300000), 0, now) === null);
check("one step of clock drift is allowed", T.verify(k, T.totp(k, now - 30000), 0, now) !== null);
check("junk is refused", T.verify(k, "abcdef", 0, now) === null && T.verify(k, "", 0, now) === null);
const dd = fs.mkdtempSync(path.join(os.tmpdir(), "bw-key-"));
const sealed = T.seal(dd, k);
check("secrets are stored encrypted and open again", !sealed.includes(T.base32(k)) && T.open(dd, sealed).equals(k));
check("a damaged secret opens to nothing", T.open(dd, sealed.slice(0, -4) + "AAAA") === null);
const rc = T.newRecoveryCodes();
const hs = T.hashRecovery(rc);
check("a recovery code works once", T.useRecovery(hs, rc[0]).length === 7 && T.useRecovery(T.useRecovery(hs, rc[0]), rc[0]) === null);

// ---------- QR / panel ----------
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(QrCode, { text: "otpauth://totp/x?secret=ABC" })); });
check("the QR is drawn as plain SVG (no HTML injection)", !!document.querySelector("svg[data-testid=mfa-qr] path") && !document.querySelector("svg script"));
let enabledFlag = null;
const posted = [];
const secretB32 = T.base32(k);
const post = async (name, body) => {
  posted.push(name);
  if (name === "setup") return { ok: true, data: { secret: secretB32, uri: `otpauth://totp/Binderwyrm:me?secret=${secretB32}` } };
  if (name === "enable") return body.code === "111111" ? { ok: true, data: { recovery: ["aaaaa-bbbbb", "ccccc-ddddd"] } } : { ok: false, data: { error: "That code doesn't match." } };
  return { ok: true, data: {} };
};
const setVal = (el, value) => { const key = Object.keys(el).find((k) => k.startsWith("__reactProps$")); el[key].onChange({ target: { value } }); };
await act(async () => { root.render(React.createElement(MfaPanel, { enabled: false, post, onChanged: (on) => (enabledFlag = on) })); });
const btn = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent));
await act(async () => { btn(/Turn on two-factor/).click(); });
await act(async () => { setVal(document.querySelector("input[aria-label=Password]"), "pw"); });
await act(async () => { btn(/Continue/).click(); });
check("setup shows a QR and the manual key", !!document.querySelector("[data-testid=mfa-qr]") && document.querySelector("[data-testid=mfa-secret]").textContent === secretB32);
await act(async () => { setVal(document.querySelector("input[aria-label='Code from the app']"), "000000"); });
await act(async () => { btn(/^Turn on$/).click(); });
check("a wrong code shows the error and stays on the scan step", /doesn't match/.test(document.body.textContent) && !!document.querySelector("[data-testid=mfa-qr]"));
await act(async () => { setVal(document.querySelector("input[aria-label='Code from the app']"), "111111"); });
await act(async () => { btn(/^Turn on$/).click(); });
check("recovery codes are shown once, with the change reported", /aaaaa-bbbbb/.test(document.body.textContent) && enabledFlag === true);
await act(async () => { btn(/saved them/).click(); });
check("…and gone after 'I've saved them'", !/aaaaa-bbbbb/.test(document.body.textContent));

// ---------- server ----------
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
const cookieOf = (res, name = "bw_session") => (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).find((c) => c.startsWith(name + "=")) || null;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-mfa-"));
const port = 33000 + Math.floor(Math.random() * 2500);
const PW = "my-long-password";
const ADMIN_PW = "admin-long-password";
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.cjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DATA_DIR: dir, CARD_DB: "off", COOKIE_SECURE: "off", SMTP_HOST: "", PUBLIC_URL: "https://hoard.example.com", ADMIN_PASSWORD: ADMIN_PW },
  stdio: "ignore",
});
// Wait out the current 30 s step so the "next" code is a different step.
const freshCode = (secret, notStep) => {
  let c = T.totp(secret);
  return c;
};
try {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { if ((await call(port, "GET", "/api/health")).status === 200) break; } catch (e) {}
  }
  const reg = await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "me@example.com", password: PW } });
  const c1 = cookieOf(reg);
  check("a new account starts without two-factor", reg.json?.user?.mfa === false);

  check("setup needs the password", (await call(port, "POST", "/api/auth/mfa/setup", { headers: APP, cookie: c1, body: { password: "wrong-password!!" } })).status === 403);
  const setup = await call(port, "POST", "/api/auth/mfa/setup", { headers: APP, cookie: c1, body: { password: PW } });
  check("setup returns a key and an otpauth link", setup.status === 200 && /^otpauth:\/\/totp\//.test(setup.json?.uri) && /^[A-Z2-7]{32}$/.test(setup.json?.secret));
  const secret = T.unbase32(setup.json.secret);
  check("a wrong first code doesn't turn it on", (await call(port, "POST", "/api/auth/mfa/enable", { headers: APP, cookie: c1, body: { code: "000000" } })).status === 400);
  const en = await call(port, "POST", "/api/auth/mfa/enable", { headers: APP, cookie: c1, body: { code: T.totp(secret) } });
  check("the right code turns it on and gives 8 recovery codes", en.status === 200 && en.json.recovery.length === 8 && en.json.user.mfa === true);
  const recovery = en.json.recovery;
  const dbBytes = fs.readFileSync(path.join(dir, "accounts.db"));
  check("the key isn't in the database in the clear", !dbBytes.includes(Buffer.from(setup.json.secret)));
  check("the encryption key file is private", (fs.statSync(path.join(dir, "totp.key")).mode & 0o077) === 0 || process.platform === "win32");

  // sign in
  const l1 = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "me@example.com", password: PW } });
  check("the password alone no longer signs in", l1.status === 200 && l1.json.mfaRequired === true && !cookieOf(l1) && !!l1.json.ticket);
  check("…and the ticket doesn't open the app", (await call(port, "GET", "/api/auth/me", { cookie: "bw_session=" + l1.json.ticket })).status === 401);
  const bad = await call(port, "POST", "/api/auth/mfa/login", { headers: APP, body: { ticket: l1.json.ticket, code: "000000" } });
  check("a wrong code is refused", bad.status === 401 && !cookieOf(bad));
  // The enable step used the current step; wait for the next one so the login code is newer.
  await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 300));
  const good = await call(port, "POST", "/api/auth/mfa/login", { headers: APP, body: { ticket: l1.json.ticket, code: T.totp(secret) } });
  const c2 = cookieOf(good);
  check("the right code signs in", good.status === 200 && !!c2 && good.json.user.mfa === true && (await call(port, "GET", "/api/auth/me", { cookie: c2 })).status === 200);
  check("the ticket is single-use", (await call(port, "POST", "/api/auth/mfa/login", { headers: APP, body: { ticket: l1.json.ticket, code: T.totp(secret) } })).status === 401);
  const l2 = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "me@example.com", password: PW } });
  const replay = await call(port, "POST", "/api/auth/mfa/login", { headers: APP, body: { ticket: l2.json.ticket, code: T.totp(secret) } });
  check("the same code can't be used twice (replay)", replay.status === 401);
  const l3 = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "me@example.com", password: PW } });
  const rec = await call(port, "POST", "/api/auth/mfa/login", { headers: APP, body: { ticket: l3.json.ticket, code: recovery[0] } });
  check("a recovery code signs in", rec.status === 200 && !!cookieOf(rec));
  const l4 = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "me@example.com", password: PW } });
  check("…but only once", (await call(port, "POST", "/api/auth/mfa/login", { headers: APP, body: { ticket: l4.json.ticket, code: recovery[0] } })).status === 401);

  // app (bearer) sign-in also needs the code
  const la = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "me@example.com", password: PW, app: true } });
  check("the phone app is asked for the code too", la.json.mfaRequired === true && !la.json.token);
  const rec2 = await call(port, "POST", "/api/auth/mfa/login", { headers: APP, body: { ticket: la.json.ticket, code: recovery[1] } });
  check("…and then gets its token", rec2.status === 200 && typeof rec2.json.token === "string");

  // wrong codes lock the account
  // different client addresses each time: the account lock must hold even against a spread-out guesser
  let last = null;
  for (let i = 0; i < 5; i++) {
    const t = await call(port, "POST", "/api/auth/login", { headers: { ...APP, "x-forwarded-for": `10.1.0.${i}` }, body: { email: "me@example.com", password: PW } });
    if (!t.json?.ticket) { last = t; break; }
    last = await call(port, "POST", "/api/auth/mfa/login", { headers: { ...APP, "x-forwarded-for": `10.1.0.${i}` }, body: { ticket: t.json.ticket, code: "999999" } });
  }
  check("five wrong codes lock the account", last.status === 423 || (await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "me@example.com", password: PW } })).status === 423);

  // admin side
  const adminLogin = await call(port, "POST", "/api/admin/login", { headers: APP, body: { password: ADMIN_PW } });
  const ac = cookieOf(adminLogin, "bw_admin");
  check("admin signs in with just the password while two-factor is off", adminLogin.status === 200 && !!ac);
  const users = await call(port, "GET", "/api/admin/users", { cookie: ac });
  const me = users.json.users.find((u) => u.email === "me@example.com");
  check("the admin list shows who has two-factor and who is locked", me.mfa === true && me.locked === true);
  await call(port, "POST", `/api/admin/users/${me.id}/unlock`, { headers: APP, cookie: ac, body: {} });
  const l5 = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "me@example.com", password: PW } });
  check("unlocking keeps two-factor on", l5.json?.mfaRequired === true);
  const reset = await call(port, "POST", `/api/admin/users/${me.id}/reset-link`, { headers: APP, cookie: ac, body: {} });
  const resetToken = (reset.json?.link || "").split("reset=")[1];
  if (resetToken) {
    await call(port, "POST", "/api/auth/reset", { headers: APP, body: { token: resetToken, password: "another-long-password" } });
    const l6 = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "me@example.com", password: "another-long-password" } });
    check("a password reset does not switch two-factor off", l6.json?.mfaRequired === true);
  } else console.log("note: no PUBLIC_URL here, reset-link path not exercised");
  const off = await call(port, "POST", `/api/admin/users/${me.id}/mfa-off`, { headers: APP, cookie: ac, body: {} });
  check("the admin can turn a user's two-factor off", off.status === 200);
  const l7 = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "me@example.com", password: (resetToken ? "another-long-password" : PW) } });
  check("…and the user signs in with the password again", l7.status === 200 && !l7.json.mfaRequired && !!cookieOf(l7));

  // admin two-factor
  const amSetup = await call(port, "POST", "/api/admin/mfa/setup", { headers: APP, cookie: ac, body: { password: "wrong-admin-pass" } });
  check("admin setup needs the admin password", amSetup.status === 403);
  const as = await call(port, "POST", "/api/admin/mfa/setup", { headers: APP, cookie: ac, body: { password: ADMIN_PW } });
  const asecret = T.unbase32(as.json.secret);
  const ae = await call(port, "POST", "/api/admin/mfa/enable", { headers: APP, cookie: ac, body: { code: T.totp(asecret) } });
  check("admin can turn two-factor on", ae.status === 200 && ae.json.recovery.length === 8);
  check("the admin state says so", (await call(port, "GET", "/api/admin/state")).json.mfa === true);
  const al = await call(port, "POST", "/api/admin/login", { headers: APP, body: { password: ADMIN_PW } });
  check("the admin password alone no longer signs in", al.json.mfaRequired === true && !cookieOf(al, "bw_admin"));
  check("a wrong admin code is refused", (await call(port, "POST", "/api/admin/login-mfa", { headers: APP, body: { ticket: al.json.ticket, code: "000000" } })).status === 403);
  const arec = await call(port, "POST", "/api/admin/login-mfa", { headers: APP, body: { ticket: al.json.ticket, code: ae.json.recovery[0] } });
  const ac2 = cookieOf(arec, "bw_admin");
  check("an admin recovery code signs in", arec.status === 200 && !!ac2 && (await call(port, "GET", "/api/admin/config", { cookie: ac2 })).status === 200);
  const adminFile = fs.readFileSync(path.join(dir, "admin.json"), "utf8");
  check("the admin key is stored encrypted", !adminFile.includes(as.json.secret));
  const ad = await call(port, "POST", "/api/admin/mfa/disable", { headers: APP, cookie: ac2, body: { password: ADMIN_PW, code: ae.json.recovery[1] } });
  check("admin can turn it off with password + code", ad.status === 200 && (await call(port, "GET", "/api/admin/state")).json.mfa === false);
} catch (e) {
  console.log("FAIL threw", e);
  ok = false;
} finally {
  child.kill();
}
process.exit(ok ? 0 : 1);
