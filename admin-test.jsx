// The admin space (admin.cjs + settings.cjs): first-password setup with a log
// code, sign-in and throttling, same-origin/CSRF rails, settings that apply
// live and ones that wait for a restart, secrets that never come back out,
// SMTP test against a fake mail server, account help, and restart.
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

function call(port, method, p, { headers = {}, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers, ...(cookie ? { Cookie: cookie } : {}) };
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
        resolve({ status: res.statusCode, headers: res.headers, json, text: data });
      });
    });
    r.on("error", reject);
    if (payload !== null) r.write(payload);
    r.end();
  });
}
const APP = { "x-hk-app": "1" };
const cookieOf = (res, name) => (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`)) || null;

async function start(env = {}, dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-admin-"))) {
  const port = 29000 + Math.floor(Math.random() * 3000);
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.cjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, CARD_DB: "off", COOKIE_SECURE: "off", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (out += c));
  const exited = new Promise((r) => child.once("exit", (code) => r(code)));
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      if ((await call(port, "GET", "/api/health")).status === 200) break;
    } catch (e) {}
  }
  return { port, dir, child, logs: () => out, exited };
}

// A mail server that accepts anything and remembers the messages.
function fakeSmtp() {
  const got = [];
  const server = net.createServer((s) => {
    let data = false;
    let msg = "";
    s.write("220 fake ESMTP\r\n");
    let buf = "";
    s.on("data", (c) => {
      buf += c.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === ".") {
            data = false;
            got.push(msg);
            s.write("250 queued\r\n");
          } else msg += line + "\n";
          continue;
        }
        if (/^EHLO/i.test(line)) s.write("250 fake\r\n");
        else if (/^(MAIL|RCPT)/i.test(line)) s.write("250 ok\r\n");
        else if (/^DATA/i.test(line)) {
          data = true;
          msg = "";
          s.write("354 go\r\n");
        } else if (/^QUIT/i.test(line)) {
          s.write("221 bye\r\n");
          s.end();
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, got, close: () => server.close() })));
}

const PW = "correct horse battery";
const procs = [];
const smtp = await fakeSmtp();
try {
  // ---------- first password via the log's setup code ----------
  const a = await start();
  procs.push(a);
  const { port } = a;
  const code = (a.logs().match(/setup code ([0-9A-F]{5}-[0-9A-F]{5})/) || [])[1];
  check("the server prints a one-time setup code", !!code);

  const st0 = await call(port, "GET", "/api/admin/state");
  check("state: not configured, not signed in", st0.json?.configured === false && st0.json?.signedIn === false);
  check("settings are locked before anyone signs in", (await call(port, "GET", "/api/admin/config")).status === 401);
  check("the admin page is served at /admin", (await call(port, "GET", "/admin")).status === 200);

  check("setup needs the X-HK-App header", (await call(port, "POST", "/api/admin/setup", { body: { code, password: PW } })).status === 400);
  const wrong = await call(port, "POST", "/api/admin/setup", { headers: APP, body: { code: "AAAAA-BBBBB", password: PW } });
  check("a wrong setup code is refused", wrong.status === 403);
  const short = await call(port, "POST", "/api/admin/setup", { headers: APP, body: { code, password: "short" } });
  check("a short password is refused", short.status === 400);
  const evil = await call(port, "POST", "/api/admin/setup", { headers: { ...APP, Origin: "https://evil.example" }, body: { code, password: PW } });
  check("a request from another origin is refused", evil.status === 403);
  const setup = await call(port, "POST", "/api/admin/setup", { headers: APP, body: { code, password: PW } });
  let cookie = cookieOf(setup, "bw_admin");
  check("setup with the code signs in", setup.status === 200 && !!cookie);
  check("the cookie is HttpOnly + SameSite=Strict", /HttpOnly/i.test(setup.headers["set-cookie"][0]) && /SameSite=Strict/i.test(setup.headers["set-cookie"][0]));
  check("setup can't be used twice", (await call(port, "POST", "/api/admin/setup", { headers: APP, body: { code, password: PW + "2" } })).status === 409);
  const adminJson = fs.readFileSync(path.join(a.dir, "admin.json"), "utf8");
  check("only a hash is stored", !adminJson.includes(PW) && adminJson.includes("hash"));
  check("an app origin (phone app) can't reach it", (await call(port, "GET", "/api/admin/config", { cookie, headers: { Origin: "capacitor://localhost" } })).status === 403);
  check("state: signed in", (await call(port, "GET", "/api/admin/state", { cookie })).json?.signedIn === true);

  // ---------- settings ----------
  const cfg0 = await call(port, "GET", "/api/admin/config", { cookie });
  const keys = (cfg0.json?.settings || []).map((s) => s.key);
  check("config lists the settings", ["REGISTRATION", "PUBLIC_URL", "SMTP_HOST", "SMTP_PASS", "CARD_DB"].every((k) => keys.includes(k)));
  check("CARD_DB shows the environment's value", cfg0.json.settings.find((s) => s.key === "CARD_DB").value === "off" && cfg0.json.settings.find((s) => s.key === "CARD_DB").source === "env");

  check("a change needs the header", (await call(port, "PUT", "/api/admin/config", { cookie, body: { set: { REGISTRATION: "closed" } } })).status === 400);
  const bad = await call(port, "PUT", "/api/admin/config", { cookie, headers: APP, body: { set: { PUBLIC_URL: "ftp://nope" } } });
  check("an invalid value is refused", bad.status === 400 && /http/.test(bad.json?.error || ""));
  const noUrl = await call(port, "PUT", "/api/admin/config", { cookie, headers: APP, body: { set: { SMTP_HOST: "127.0.0.1", SMTP_FROM: "Binderwyrm <no-reply@example.com>" } } });
  check("SMTP without a public address is refused", noUrl.status === 400 && /PUBLIC_URL/.test(noUrl.json?.error || ""));
  check("…and nothing was saved", !fs.existsSync(path.join(a.dir, "config.json")) || !JSON.parse(fs.readFileSync(path.join(a.dir, "config.json"), "utf8")).values.SMTP_HOST);
  check("…the server still answers", (await call(port, "GET", "/api/health")).json?.registration === true);

  // a registration while sign-ups are open, to have an account to manage
  const reg = await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "friend@example.com", password: "friend-password-1" } });
  check("an account can register", reg.status === 200 || reg.status === 201);

  const closed = await call(port, "PUT", "/api/admin/config", { cookie, headers: APP, body: { set: { REGISTRATION: "closed" } } });
  check("closing sign-ups saves", closed.status === 200);
  check("…and applies without a restart", (await call(port, "GET", "/api/health")).json?.registration === false);
  const reg2 = await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "late@example.com", password: "late-password-12" } });
  check("…so a new sign-up is refused", reg2.status === 403);

  // the secret and the fake mail server
  const SECRET = "s3cr3t-smtp-pass";
  const mail = await call(port, "PUT", "/api/admin/config", {
    cookie,
    headers: APP,
    body: { set: { PUBLIC_URL: "https://hoard.example.com/", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), SMTP_FROM: "Binderwyrm <no-reply@example.com>", SMTP_PASS: SECRET } },
  });
  check("email settings save", mail.status === 200);
  check("the trailing slash on the public address is dropped", mail.json.settings.find((s) => s.key === "PUBLIC_URL").value === "https://hoard.example.com");
  const pass = mail.json.settings.find((s) => s.key === "SMTP_PASS");
  check("the SMTP password is reported as set, never returned", pass.set === true && pass.value === null && !mail.text.includes(SECRET));
  check("…not on a fresh read either", !(await call(port, "GET", "/api/admin/config", { cookie })).text.includes(SECRET));
  check("…and not in the server log", !a.logs().includes(SECRET));
  const saved = path.join(a.dir, "config.json");
  check("config.json is private (0600)", process.platform === "win32" || (fs.statSync(saved).mode & 0o077) === 0);

  const t1 = await call(port, "POST", "/api/admin/smtp-test", { cookie, headers: APP, body: { to: "me@example.com" } });
  check("the test email goes through the fake server", t1.status === 200 && smtp.got.length === 1 && /To: me@example.com/.test(smtp.got[0]));
  const t2 = await call(port, "POST", "/api/admin/smtp-test", { cookie, headers: APP, body: { to: "me@example.com", set: { SMTP_PORT: "1" } } });
  check("it tests what's on the form (a dead port fails)", t2.status === 502 && /Sending failed/.test(t2.json?.error || ""));
  check("…and a bad address is caught", (await call(port, "POST", "/api/admin/smtp-test", { cookie, headers: APP, body: { to: "nope" } })).status === 400);

  const cardDb = await call(port, "PUT", "/api/admin/config", { cookie, headers: APP, body: { set: { CARD_DB: "on" } } });
  check("a restart-only setting is flagged pending", cardDb.json?.pendingRestart?.includes("CARD_DB"));
  const back = await call(port, "PUT", "/api/admin/config", { cookie, headers: APP, body: { reset: ["CARD_DB"] } });
  check("resetting it back clears the pending flag", back.json?.pendingRestart?.length === 0);

  const status = await call(port, "GET", "/api/admin/status", { cookie });
  check("status reports accounts and email", status.json?.accounts?.accounts >= 1 && /127\.0\.0\.1/.test(status.json?.email || ""));

  // ---------- accounts ----------
  const users = await call(port, "GET", "/api/admin/users", { cookie });
  const friend = (users.json?.users || []).find((u) => u.email === "friend@example.com");
  check("accounts are listed", !!friend);
  check("…with their confirmation state", friend && friend.verified === true);
  check("confirm works", (await call(port, "POST", `/api/admin/users/${friend.id}/confirm`, { cookie, headers: APP, body: {} })).status === 200);
  const temp = await call(port, "POST", `/api/admin/users/${friend.id}/temp-password`, { cookie, headers: APP, body: {} });
  check("a temporary password comes back once", temp.status === 200 && typeof temp.json?.password === "string" && temp.json.password.length >= 10);
  const loginOld = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "friend@example.com", password: "friend-password-1" } });
  const loginNew = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "friend@example.com", password: temp.json.password } });
  check("the old password stops working, the temporary one works", loginOld.status === 401 && loginNew.status === 200);
  // ---------- lockout: unlock and reset link ----------
  const guess = (xff, pw) => call(port, "POST", "/api/auth/login", { headers: { ...APP, "x-forwarded-for": xff }, body: { email: "friend@example.com", password: pw } });
  let lastGuess;
  for (let i = 0; i < 5; i++) lastGuess = await guess("198.51.100.1", "wrong-" + i);
  check("five wrong passwords lock the account", lastGuess.status === 423);
  check("the list shows it as locked", (await call(port, "GET", "/api/admin/users", { cookie })).json.users.find((u) => u.id === friend.id).locked === true);
  const mailsBefore = smtp.got.length;
  await call(port, "POST", "/api/auth/forgot", { headers: APP, body: { email: "friend@example.com" } });
  await new Promise((r) => setTimeout(r, 400));
  check("a locked account can't ask for its own reset email", smtp.got.length === mailsBefore);
  check("the admin can unlock it", (await call(port, "POST", `/api/admin/users/${friend.id}/unlock`, { cookie, headers: APP, body: {} })).status === 200);
  check("…and the right password works again", (await guess("198.51.100.2", temp.json.password)).status === 200);
  for (let i = 0; i < 5; i++) lastGuess = await guess("198.51.100.3", "wrong-" + i);
  check("locked a second time", lastGuess.status === 423);
  const rl = await call(port, "POST", `/api/admin/users/${friend.id}/reset-link`, { cookie, headers: APP, body: {} });
  check("the admin can send a reset link (emailed, so not echoed back)", rl.status === 200 && rl.json.emailed === true && !rl.json.link);
  await new Promise((r) => setTimeout(r, 300));
  const raw = smtp.got[smtp.got.length - 1] || "";
  const mailed = Buffer.from((raw.split(/\n\n/)[1] || "").replace(/\s+/g, ""), "base64").toString("utf8");
  const token = (mailed.match(/\?reset=([\w-]+)/) || [])[1];
  check("the email carries a link built from the public address", /https:\/\/hoard\.example\.com\/\?reset=/.test(mailed) && !!token);
  const useIt = await call(port, "POST", "/api/auth/reset", { headers: APP, body: { token, password: "friend-new-password-9" } });
  check("using the link sets a new password…", useIt.status === 200);
  check("…and unlocks the account", (await guess("198.51.100.4", "friend-new-password-9")).status === 200);

  check("unknown account → 404", (await call(port, "POST", "/api/admin/users/9999/confirm", { cookie, headers: APP, body: {} })).status === 404);
  const so = await call(port, "POST", "/api/admin/sign-out-everyone", { cookie, headers: APP, body: {} });
  check("sign everyone out", so.status === 200 && so.json.sessions >= 1);

  // ---------- admin password + sessions ----------
  check("a wrong current password is refused", (await call(port, "POST", "/api/admin/password", { cookie, headers: APP, body: { current: "x", next: PW + "!!" } })).status === 403);
  const chg = await call(port, "POST", "/api/admin/password", { cookie, headers: APP, body: { current: PW, next: PW + "!!" } });
  check("the admin password can be changed", chg.status === 200);
  const out = await call(port, "POST", "/api/admin/logout", { cookie, headers: APP, body: {} });
  check("logout", out.status === 200);
  check("…then the old cookie is dead", (await call(port, "GET", "/api/admin/config", { cookie })).status === 401);
  check("the old password no longer signs in", (await call(port, "POST", "/api/admin/login", { headers: APP, body: { password: PW } })).status === 403);
  const login = await call(port, "POST", "/api/admin/login", { headers: APP, body: { password: PW + "!!" } });
  cookie = cookieOf(login, "bw_admin");
  check("the new password does", login.status === 200 && !!cookie);

  // ---------- restart ----------
  check("restart wants a confirmation", (await call(port, "POST", "/api/admin/restart", { cookie, headers: APP, body: {} })).status === 400);
  const rs = await call(port, "POST", "/api/admin/restart", { cookie, headers: APP, body: { confirm: true } });
  check("restart answers first", rs.status === 200);
  const code2 = await Promise.race([a.exited, new Promise((r) => setTimeout(() => r("timeout"), 5000))]);
  check("…then the process exits with 75 for the supervisor", code2 === 75);

  // settings survive a restart
  const a2 = await start({}, a.dir);
  procs.push(a2);
  check("saved settings survive the restart", (await call(a2.port, "GET", "/api/health")).json?.registration === false);
  check("…and so does the admin password (no new setup code)", !/setup code/.test(a2.logs()) && (await call(a2.port, "GET", "/api/admin/state")).json?.configured === true);

  // ---------- password from the environment ----------
  const b = await start({ ADMIN_PASSWORD: "an-env-supplied-pass" });
  procs.push(b);
  check("env password: configured, no setup code", (await call(b.port, "GET", "/api/admin/state")).json?.passwordFromEnv === true && !/setup code/.test(b.logs()));
  const bl = await call(b.port, "POST", "/api/admin/login", { headers: APP, body: { password: "an-env-supplied-pass" } });
  const bc = cookieOf(bl, "bw_admin");
  check("…and it signs in", bl.status === 200 && !!bc);
  check("…and can't be changed from the page", (await call(b.port, "POST", "/api/admin/password", { cookie: bc, headers: APP, body: { current: "an-env-supplied-pass", next: "another-long-password" } })).status === 409);
  let locked = 0;
  for (let i = 0; i < 12; i++) {
    const r = await call(b.port, "POST", "/api/admin/login", { headers: APP, body: { password: "guess" + i } });
    if (r.status === 429) locked++;
  }
  check("repeated wrong passwords get throttled", locked > 0);
  check("…even the right one waits", (await call(b.port, "POST", "/api/admin/login", { headers: APP, body: { password: "an-env-supplied-pass" } })).status === 429);

  const short2 = await start({ ADMIN_PASSWORD: "tooshort" });
  procs.push(short2);
  check("a too-short env password leaves the admin locked", /shorter than 12/.test(short2.logs()) && (await call(short2.port, "GET", "/api/admin/state")).json?.configured === false);

  const off = await start({ ADMIN: "off" });
  procs.push(off);
  check("ADMIN=off removes it", (await call(off.port, "GET", "/api/admin/state")).status === 404);
} catch (e) {
  console.log("FAIL threw", e);
  ok = false;
} finally {
  smtp.close();
  for (const p of procs) {
    try {
      p.child.kill();
    } catch (e) {}
  }
}
process.exit(ok ? 0 : 1);
