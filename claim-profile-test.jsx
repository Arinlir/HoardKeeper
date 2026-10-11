// Moving old PIN profiles into email accounts, and the public handle that
// replaces profile names: claim with the PIN, the vault comes along, the old
// file stays as a backup, shared links keep working, handles are unique and
// can't take a name an unclaimed profile still holds, and the playgroup list
// and public pages work off handles.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

function call(port, method, p, { headers = {}, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers, ...(cookie ? { Cookie: cookie } : {}) };
    // DELETE has no automatic Content-Length in node's client; send one.
    const payload = body === undefined ? null : JSON.stringify(body);
    if (payload !== null) {
      h["Content-Type"] = "application/json";
      h["Content-Length"] = Buffer.byteLength(payload);
    }
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: h }, (res) => {
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
    if (payload !== null) r.write(payload);
    r.end();
  });
}
const APP = { "x-hk-app": "1" };
const cookieOf = (res) => (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("bw_session=")) || null;
const sha = (x) => createHash("sha256").update(String(x)).digest("hex");

const vaultOf = (extra = {}) =>
  JSON.stringify({
    cards: [{ id: "c1", name: "Sol Ring", set: "c21", collectorNumber: "263", quantity: 1, costOverride: 12.5 }],
    wishlist: [{ id: "w1", name: "Mana Crypt", set: "ema", collectorNumber: "1", quantity: 1 }],
    publicVault: true,
    ...extra,
  });

async function start(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-claim-"));
  fs.mkdirSync(path.join(dir, "profiles"), { recursive: true });
  const put = (n, rec) => fs.writeFileSync(path.join(dir, "profiles", `${n}.json`), JSON.stringify(rec));
  put("mike", { pinHash: sha("4321"), value: vaultOf(), rev: 7 });
  put("kevin", { pinHash: "", value: vaultOf({ publicVault: false }), rev: 2 });
  put("anna", { pinHash: sha("9999"), value: null, rev: 0 });
  const port = 26000 + Math.floor(Math.random() * 3000);
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.cjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, CARD_DB: "off", ...env },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      if ((await call(port, "GET", "/api/health")).status === 200) break;
    } catch (e) {}
  }
  return { port, dir, child };
}

const srv = await start();
const { port } = srv;
const claim = (body, headers = {}) => call(port, "POST", "/api/auth/claim", { headers: { ...APP, ...headers }, body });
try {
  const health = await call(port, "GET", "/api/health");
  check("health says there are profiles to claim", health.json?.mode === "accounts" && health.json?.claim === true);

  // Before anyone claims: the old shared links still answer.
  const wl0 = await call(port, "GET", "/api/public/wishlist/mike");
  check("an unclaimed profile's wishlist link still works", wl0.status === 200 && wl0.json?.wishlist?.[0]?.name === "Mana Crypt");
  const pv0 = await call(port, "GET", "/api/public/vault/mike");
  check("…and so does its opted-in collection view", pv0.status === 200 && pv0.json?.cards?.[0]?.name === "Sol Ring");
  check("…which never carries what was paid", !JSON.stringify(pv0.json).includes("12.5") && !("costOverride" in pv0.json.cards[0]));
  check("a profile that hasn't opted in answers like one that doesn't exist", (await call(port, "GET", "/api/public/vault/kevin")).status === 404);

  // Claiming: failures all look the same.
  const good = { profile: "mike", pin: "4321", email: "Mike@Example.com", password: "a long enough password" };
  const a1 = await claim({ ...good, pin: "0000" }, { "x-forwarded-for": "198.51.100.1" });
  const a2 = await claim({ ...good, profile: "nobody" }, { "x-forwarded-for": "198.51.100.1" });
  check("a wrong PIN is refused", a1.status === 403);
  check("…with the same message as a profile that doesn't exist", a1.json?.error === a2.json?.error && a2.status === 403);
  check("a short password is refused", (await claim({ ...good, password: "short" })).status === 400);
  check("a bad email is refused", (await claim({ ...good, email: "nope" })).status === 400);
  check("claiming without the app header is refused (CSRF)", (await call(port, "POST", "/api/auth/claim", { body: good })).status === 403);

  const ok1 = await claim(good);
  check("the right PIN claims it and signs you in", ok1.status === 200 && ok1.json?.user?.email === "mike@example.com" && !!cookieOf(ok1));
  check("…the profile name becomes the handle", ok1.json?.user?.handle === "mike");
  const cookie = cookieOf(ok1);
  const store = await call(port, "GET", "/api/store", { cookie });
  check("the vault came along", store.status === 200 && JSON.parse(store.json.value).cards?.[0]?.name === "Sol Ring");
  check("…as a fresh account vault", store.json?.rev === 1);
  check("the old file is left as a backup", fs.existsSync(path.join(srv.dir, "profiles", "mike.json")));
  check("it can't be claimed twice", (await claim({ ...good, email: "other@example.com" })).status === 403);
  check("the same email can't claim a second profile", (await claim({ profile: "kevin", pin: "", email: "mike@example.com", password: "a long enough password" })).status === 409);

  const wl1 = await call(port, "GET", "/api/public/wishlist/mike");
  check("shared links keep working, now from the account", wl1.status === 200 && wl1.json?.wishlist?.[0]?.name === "Mana Crypt");
  // Edits go to the account, not the old file.
  await call(port, "PUT", "/api/store", { headers: APP, cookie, body: { value: vaultOf({ wishlist: [{ id: "w2", name: "Black Lotus", set: "lea", collectorNumber: "1", quantity: 1 }] }) } });
  const wl2 = await call(port, "GET", "/api/public/wishlist/mike");
  check("…and follow the account's edits", wl2.json?.wishlist?.[0]?.name === "Black Lotus");

  // A profile with no PIN, and one that was empty.
  const kev = await claim({ profile: "kevin", pin: "", email: "kevin@example.com", password: "a long enough password" });
  check("a profile that never had a PIN can be claimed with none", kev.status === 200 && kev.json?.user?.handle === "kevin");
  const ann = await claim({ profile: "anna", pin: "9999", email: "anna@example.com", password: "a long enough password" });
  const annStore = await call(port, "GET", "/api/store", { cookie: cookieOf(ann) });
  check("an empty profile becomes an empty vault", ann.status === 200 && annStore.json?.value === null);
  check("health stops offering claims once none are left", (await call(port, "GET", "/api/health")).json?.claim === false);

  // Handles.
  const reg = await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "bob@example.com", password: "a long enough password" } });
  const bob = cookieOf(reg);
  check("a new account starts with no handle", reg.json?.user?.handle === null);
  const setH = (cookie, handle) => call(port, "POST", "/api/auth/handle", { headers: APP, cookie, body: { handle } });
  check("an invalid handle is refused", (await setH(bob, "Bad Name!")).status === 400);
  check("a taken handle is refused", (await setH(bob, "mike")).status === 409);
  const okH = await setH(bob, "Bob");
  check("a free handle is saved (lowercased)", okH.status === 200 && okH.json?.user?.handle === "bob");
  check("a handle needs a sign-in", (await call(port, "POST", "/api/auth/handle", { headers: APP, body: { handle: "x" } })).status === 401);

  // Public pages by handle, opt-in respected.
  await call(port, "PUT", "/api/store", { headers: APP, cookie: bob, body: { value: vaultOf({ publicVault: false }) } });
  check("an account that hasn't opted in has no public collection", (await call(port, "GET", "/api/public/vault/bob")).status === 404);
  check("…but its wishlist page answers", (await call(port, "GET", "/api/public/wishlist/bob")).status === 200);
  await call(port, "PUT", "/api/store", { headers: APP, cookie: bob, body: { value: vaultOf() } });
  check("opting in opens the collection view", (await call(port, "GET", "/api/public/vault/bob")).status === 200);

  // Playgroup list.
  const list = await call(port, "GET", "/api/profiles", { cookie: bob });
  check("the playgroup list is every handle", ["mike", "kevin", "anna", "bob"].every((n) => list.json?.profiles?.includes(n)));

  // Clearing the handle unshares everything.
  const clear = await setH(bob, "");
  check("clearing the handle works", clear.status === 200 && clear.json?.user?.handle === null);
  check("…and the public pages disappear", (await call(port, "GET", "/api/public/wishlist/bob")).status === 404 && (await call(port, "GET", "/api/public/vault/bob")).status === 404);
  check("…and the name leaves the playgroup", !(await call(port, "GET", "/api/profiles", { cookie: bob })).json?.profiles?.includes("bob"));

  // Deleting a claimed account doesn't resurrect the old profile.
  await call(port, "DELETE", "/api/auth/account", { headers: APP, cookie, body: { password: "a long enough password" } });
  check("a deleted account's pages are gone", (await call(port, "GET", "/api/public/wishlist/mike")).status === 404);
  check("…and the old profile doesn't come back from its backup file", (await claim(good)).status === 403);
} finally {
  srv.child.kill();
  try {
    fs.rmSync(srv.dir, { recursive: true, force: true });
  } catch (e) {}
}

// Unclaimed names are reserved, and claiming works with sign-ups closed.
const closed = await start({ REGISTRATION: "closed" });
try {
  const reg = await call(closed.port, "POST", "/api/auth/register", { headers: APP, body: { email: "x@example.com", password: "a long enough password" } });
  check("sign-ups are closed here", reg.status === 403);
  const c = await call(closed.port, "POST", "/api/auth/claim", { headers: APP, body: { profile: "mike", pin: "4321", email: "mike@example.com", password: "a long enough password" } });
  check("…but claiming an old profile still works", c.status === 200);
  const h = await call(closed.port, "POST", "/api/auth/handle", { headers: APP, cookie: cookieOf(c), body: { handle: "kevin" } });
  check("an unclaimed profile's name can't be taken as a handle", h.status === 409);
} finally {
  closed.child.kill();
  try {
    fs.rmSync(closed.dir, { recursive: true, force: true });
  } catch (e) {}
}

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
