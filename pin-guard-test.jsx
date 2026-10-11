// Verifies wrong-guess throttling (pin-guard.cjs) on its own with a fake clock,
// then wired into server.cjs's claim-a-profile-by-PIN endpoint: 429 + Retry-After once a client burns through
// its free tries, no PIN check while locked out, other clients unaffected,
// and the real client address taken from a local reverse proxy's header.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const load = createRequire(import.meta.url);
const { createPinGuard, clientKey, FREE_TRIES, FIRST_LOCK_MS, MAX_LOCK_MS, PROFILE_MAX } = load(path.join(process.cwd(), "pin-guard.cjs"));

// ---- the guard, with a fake clock ----
let t = 1_000_000;
const g = createPinGuard({ now: () => t, hardMax: 1e9 });
for (let i = 0; i < FREE_TRIES; i++) {
  check(`mistake ${i + 1} of ${FREE_TRIES} is free`, g.blocked("1.1.1.1", "mike") === null);
  g.fail("1.1.1.1", "mike");
}
check("…and still not locked after the free tries", g.blocked("1.1.1.1", "mike") === null);
g.fail("1.1.1.1", "mike");
const w1 = g.blocked("1.1.1.1", "mike");
check("the next mistake locks for 30 s", w1 === FIRST_LOCK_MS / 1000);
check("other clients aren't affected", g.blocked("2.2.2.2", "mike") === null);
check("other profiles aren't affected", g.blocked("1.1.1.1", "anna") === null);
t += FIRST_LOCK_MS + 1;
check("the lock expires", g.blocked("1.1.1.1", "mike") === null);
g.fail("1.1.1.1", "mike");
check("the next lock is twice as long", g.blocked("1.1.1.1", "mike") === (FIRST_LOCK_MS * 2) / 1000);
for (let i = 0; i < 20; i++) {
  t += MAX_LOCK_MS + 1;
  g.fail("1.1.1.1", "mike");
}
check("locks are capped at 15 minutes", g.blocked("1.1.1.1", "mike") === MAX_LOCK_MS / 1000);
t += MAX_LOCK_MS + 1;
g.succeed("1.1.1.1", "mike");
g.fail("1.1.1.1", "mike");
check("a correct PIN resets the count", g.blocked("1.1.1.1", "mike") === null);

// many addresses, one profile
const g2 = createPinGuard({ now: () => t, hardMax: 1e9 });
for (let i = 0; i < PROFILE_MAX; i++) g2.fail(`10.9.${Math.floor(i / 250)}.${i % 250}`, "anna");
check("a spread-out attack locks addresses that already guessed wrong", g2.blocked("10.9.0.3", "anna") > 0);
check("…but the owner on a clean address still gets in", g2.blocked("8.8.8.8", "anna") === null);
g2.fail("9.9.9.9", "anna");
check("…and a fresh attacker address gets one try, then joins the lockout", g2.blocked("9.9.9.9", "anna") > 0);

// who's asking
const req = (peer, headers = {}) => ({ socket: { remoteAddress: peer }, headers });
check("direct client: socket address", clientKey(req("203.0.113.5")) === "203.0.113.5");
check("direct client can't pretend with X-Forwarded-For", clientKey(req("203.0.113.5", { "x-forwarded-for": "1.2.3.4" })) === "203.0.113.5");
check("behind a local proxy: its X-Forwarded-For", clientKey(req("127.0.0.1", { "x-forwarded-for": "198.51.100.7" })) === "198.51.100.7");
check("…only the entry the proxy added (rightmost)", clientKey(req("172.18.0.1", { "x-forwarded-for": "6.6.6.6, 198.51.100.7" })) === "198.51.100.7");
check("IPv4-mapped IPv6 is normalised", clientKey(req("::ffff:203.0.113.5")) === "203.0.113.5");

// ---- wired into server.cjs ----
function call(port, method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bw-pin-"));
// Two old PIN profiles on disk: one with a PIN, one without.
fs.mkdirSync(path.join(tmp, "profiles"), { recursive: true });
const sha = (x) => createHash("sha256").update(String(x)).digest("hex");
fs.writeFileSync(path.join(tmp, "profiles", "mike.json"), JSON.stringify({ pinHash: sha("4321"), value: "vault", rev: 1 }));
fs.writeFileSync(path.join(tmp, "profiles", "open.json"), JSON.stringify({ pinHash: "", value: "x", rev: 1 }));
const port = 22000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, ["server.cjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DATA_DIR: tmp, CARD_DB: "off", NODE_OPTIONS: "--disable-warning=ExperimentalWarning" },
  stdio: "ignore",
});
try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      up = (await call(port, "GET", "/api/health")).status === 200;
    } catch (e) {}
  }
  check("server starts", up);
  const claim = (headers, body) => call(port, "POST", "/api/auth/claim", { "Content-Type": "application/json", "x-hk-app": "1", ...headers }, body);
  // The test talks from 127.0.0.1, so X-Forwarded-For decides who "we" are.
  const attacker = { "x-forwarded-for": "198.51.100.66" };
  const owner = { "x-forwarded-for": "198.51.100.10" };
  const mine = (pin, extra = {}) => ({ profile: "mike", pin, email: "mike@example.com", password: "a long enough password", ...extra });
  let last;
  for (let i = 0; i < 5; i++) last = await claim(attacker, mine(String(1000 + i)));
  check("wrong PINs are 403 up to the fifth", last.status === 403);
  const locked = await claim(attacker, mine("0000"));
  check("then 429", locked.status === 429);
  check("…with Retry-After", Number(locked.headers["retry-after"]) > 0);
  check("…and a readable message", /Too many attempts/.test(locked.json?.error || ""));
  const rightButLocked = await claim(attacker, mine("4321"));
  check("while locked, even the right PIN isn't checked (no oracle)", rightButLocked.status === 429);
  const ownerIn = await claim(owner, mine("4321"));
  check("after 5 wrong PINs the profile is shut for everyone for the hour (owner included)", ownerIn.status === 429);

  const open = await claim(attacker, { profile: "open", pin: "anything", email: "open@example.com", password: "a long enough password" });
  check("profiles without a PIN aren't throttled", open.status === 200);
} finally {
  child.kill();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {}
}

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
// the absolute ceiling: 5 wrong guesses per hour at one key from ANY clients, then nobody gets in
{
  const gh = createPinGuard({ now: () => t });
  for (let i = 0; i < 5; i++) gh.fail(`1.2.3.${i}`, "claim:x");
  check("after 5 wrong guesses from different clients, a clean client is blocked too", gh.blocked("9.9.9.9", "claim:x") > 0);
  check("…but only for that key", gh.blocked("9.9.9.9", "claim:y") === null);
  check("account logins and per-client keys are exempt (the database lock handles accounts)", (() => { for (let i = 0; i < 9; i++) gh.fail(`5.5.5.${i}`, "login:a@b.c"); return gh.blocked("9.9.9.9", "login:a@b.c") === null; })());
}
process.exit(ok ? 0 : 1);
