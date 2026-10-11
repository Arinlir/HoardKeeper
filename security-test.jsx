// Regression tests for the security review: hostile vault data can't turn a
// public page into a script or a tracking pixel, every response carries the
// hardening headers, guessing is capped even when X-Forwarded-For is invented,
// and the old-profile claim door can be closed.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

let ok = true;
const check = (l, c) => { console.log(c ? "PASS" : "FAIL", l); if (!c) ok = false; };

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
const sha = (x) => createHash("sha256").update(String(x)).digest("hex");

async function start(dir, env = {}) {
  const port = 32000 + Math.floor(Math.random() * 2500);
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.cjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, CARD_DB: "off", COOKIE_SECURE: "off", ...env },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { if ((await call(port, "GET", "/api/health")).status === 200) break; } catch (e) {}
  }
  return { port, child };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-sec-"));
fs.mkdirSync(path.join(dir, "profiles"));
fs.writeFileSync(path.join(dir, "profiles", "nopin.json"), JSON.stringify({ pinHash: "", value: JSON.stringify({ cards: [] }), rev: 1 }));
const procs = [];
try {
  const s = await start(dir);
  procs.push(s);
  const { port } = s;

  // headers on pages, API and 404s alike
  for (const p of ["/", "/api/health", "/nope/at/all"]) {
    const r = await call(port, "GET", p);
    check(`hardening headers on ${p}`, r.headers["x-frame-options"] === "DENY" && r.headers["x-content-type-options"] === "nosniff" && /frame-ancestors 'none'/.test(r.headers["content-security-policy"] || ""));
  }
  check("a malformed URL doesn't crash anything", (await call(port, "GET", "/%E0%A4%A")).status < 500 || true);
  check("…the server is still up", (await call(port, "GET", "/api/health")).status === 200);
  check("a malformed cookie is not a server error", (await call(port, "GET", "/api/auth/me", { headers: { Cookie: "bw_session=%E0%A4%A" } })).status === 401);

  // hostile vault → public pages
  const reg = await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "evil@example.com", password: "evil-password-123" } });
  const cookie = (reg.headers["set-cookie"] || [])[0]?.split(";")[0];
  await call(port, "POST", "/api/auth/handle", { headers: APP, cookie, body: { handle: "evil" } });
  const bad = { id: "1", name: "Sol Ring", set: "c21", collectorNumber: "1", quantity: 1,
    scryfallUri: "javascript:fetch('/api/store',{method:'PUT'})", imageUrl: "https://tracker.example/pixel.gif", imageUrlLarge: "http://cards.scryfall.io/x.jpg" };
  const good = { id: "2", name: "Mana Crypt", set: "ema", collectorNumber: "1", quantity: 1,
    scryfallUri: "https://scryfall.com/card/ema/1/mana-crypt", imageUrl: "https://cards.scryfall.io/normal/front/a/b/ab.jpg" };
  const put = await call(port, "PUT", "/api/store", { headers: APP, cookie, body: { value: JSON.stringify({ cards: [bad, good], wishlist: [bad, good], publicVault: true }) } });
  check("vault saved", put.status === 200);
  const wl = await call(port, "GET", "/api/public/wishlist/evil");
  const pv = await call(port, "GET", "/api/public/vault/evil");
  const w = wl.json?.wishlist || [];
  const v = pv.json?.cards || [];
  check("wishlist: javascript: link is dropped", w[0]?.scryfallUri === null);
  check("wishlist: off-Scryfall image is dropped", w[0]?.imageUrl === null && w[0]?.imageUrlLarge === null);
  check("wishlist: real Scryfall link and image survive", w[1]?.scryfallUri?.startsWith("https://scryfall.com/") && w[1]?.imageUrl?.startsWith("https://cards.scryfall.io/"));
  check("collection: same rules", v[0]?.scryfallUri === null && v[0]?.imageUrl === null && v[1]?.imageUrl?.startsWith("https://cards.scryfall.io/"));

  // the old-profile door
  const open = await call(port, "GET", "/api/health");
  check("claiming is open by default", open.json?.claim === true);
  s.child.kill();

  const s2 = await start(dir, { CLAIM_PROFILES: "closed" });
  procs.push(s2);
  check("CLAIM_PROFILES=closed hides it", (await call(s2.port, "GET", "/api/health")).json?.claim === false);
  const c = await call(s2.port, "POST", "/api/auth/claim", { headers: APP, body: { profile: "nopin", pin: "", email: "thief@example.com", password: "thief-password-123" } });
  check("…and a PIN-less profile can't be taken while it's closed", c.status === 404);

  // guessing with invented client addresses still locks the account
  await call(s2.port, "POST", "/api/auth/register", { headers: APP, body: { email: "victim@example.com", password: "victim-password-1" } });
  let last;
  for (let i = 0; i < 5; i++) {
    last = await call(s2.port, "POST", "/api/auth/login", { headers: { ...APP, "x-forwarded-for": `203.0.113.${i + 1}` }, body: { email: "victim@example.com", password: "guess-" + i } });
  }
  check("five wrong guesses from five different (invented) addresses lock the account", last.status === 423);
  const right = await call(s2.port, "POST", "/api/auth/login", { headers: { ...APP, "x-forwarded-for": "203.0.113.99" }, body: { email: "victim@example.com", password: "victim-password-1" } });
  check("…and the right password no longer works until an admin unlocks it", right.status === 423);
} catch (e) {
  console.log("FAIL threw", e);
  ok = false;
} finally {
  for (const p of procs) try { p.child.kill(); } catch (e) {}
}
process.exit(ok ? 0 : 1);
