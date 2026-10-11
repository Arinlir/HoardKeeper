// Verifies the accounts edition end to end (AUTH_MODE=accounts): a real
// server.cjs child process, a fake SMTP server capturing the emails, and the
// same HTTP calls the web app and the phone app make.
//
// Covers: sign-up → confirmation email → confirm → sign in (cookie for the
// website, bearer token for the phone app), the vault with revisions, the
// CSRF header rule, wrong-password throttling, change password (other devices
// signed out), forgot → reset, account deletion, not revealing who has an
// account, the PIN-only routes being gone, and running without email.
// (Handles, claiming old profiles and public pages: claim-profile-test.jsx.)
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const load = createRequire(import.meta.url);
const { buildMessage, encodeHeader } = load(path.join(process.cwd(), "mailer.cjs"));
const { normalizeEmail } = load(path.join(process.cwd(), "auth-accounts.cjs"));

// ---- a fake SMTP server ----
const mails = [];
const smtp = net.createServer((sock) => {
  let inData = false;
  let data = "";
  let buf = "";
  const env = { from: "", to: [] };
  sock.write("220 fake.smtp ready\r\n");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          const [head, ...rest] = data.split("\r\n\r\n");
          const body = Buffer.from(rest.join("\r\n\r\n").replace(/\r\n/g, ""), "base64").toString("utf8");
          const subject = (head.match(/^Subject: (.*)$/m) || [])[1];
          mails.push({ from: env.from, to: env.to.slice(), subject, body, head });
          env.to = [];
          data = "";
          sock.write("250 queued\r\n");
        } else data += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
        continue;
      }
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO")) sock.write("250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
      else if (cmd.startsWith("AUTH PLAIN")) sock.write("235 ok\r\n");
      else if (cmd.startsWith("MAIL FROM")) {
        env.from = line.slice(10);
        sock.write("250 ok\r\n");
      } else if (cmd.startsWith("RCPT TO")) {
        env.to.push(line.slice(8));
        sock.write("250 ok\r\n");
      } else if (cmd === "DATA") {
        inData = true;
        sock.write("354 go\r\n");
      } else if (cmd === "QUIT") {
        sock.write("221 bye\r\n");
        sock.end();
      } else sock.write("250 ok\r\n");
    }
  });
});
await new Promise((r) => smtp.listen(0, "127.0.0.1", r));
const smtpPort = smtp.address().port;

function call(port, method, p, { headers = {}, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload !== undefined) {
      h["Content-Type"] = "application/json";
      // Browsers always send the length; Node's client doesn't for DELETE.
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
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}
const APP = { "x-hk-app": "1" };
const cookieOf = (res) => (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("bw_session=")) || null;
const lastMailTo = (addr) => [...mails].reverse().find((m) => m.to.some((t) => t.includes(addr)));
const linkIn = (mail, re) => (mail?.body.match(re) || [])[0];

async function startServer(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-acct-"));
  const port = 24000 + Math.floor(Math.random() * 3000);
  let stderr = "";
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.cjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, CARD_DB: "off", AUTH_MODE: "accounts", ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (c) => (stderr += c));
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      if ((await call(port, "GET", "/api/health")).status === 200) break;
    } catch (e) {}
  }
  return { port, child, dir, stderr: () => stderr };
}

// ---- unit bits ----
check("emails are normalised", normalizeEmail("  Mike@Example.COM ") === "mike@example.com");
check("junk isn't an email", normalizeEmail("mike@") === null && normalizeEmail("a b@c.de") === null);
check("non-ASCII subjects are encoded", encodeHeader("Heslo změněno").startsWith("=?UTF-8?B?"));
let threw = false;
try {
  buildMessage({ from: "a@b.cz", to: "x@y.cz\r\nBcc: evil@z.cz", subject: "s", text: "t" });
} catch (e) {
  threw = true;
}
check("a line break in an address can't inject headers", threw);

// ---- with email ----
const srv = await startServer({
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(smtpPort),
  SMTP_SECURE: "false",
  SMTP_FROM: "Binderwyrm <no-reply@example.com>",
  PUBLIC_URL: "https://cards.example.com",
});
const port = srv.port;
try {
  const health = await call(port, "GET", "/api/health");
  check("health says accounts", health.json?.mode === "accounts" && health.json?.registration === true);
  check("the profile list needs a sign-in", (await call(port, "GET", "/api/profiles")).status === 401);
  check("PIN stores are gone", (await call(port, "GET", "/api/store/mike")).status === 404);
  check("a public page needs a handle that exists", (await call(port, "GET", "/api/public/wishlist/mike")).status === 404);
  check("the store needs a sign-in", (await call(port, "GET", "/api/store")).status === 401);

  // sign up
  check("sign-up without the app header is refused (CSRF)", (await call(port, "POST", "/api/auth/register", { body: { email: "mike@example.com", password: "correct horse battery" } })).status === 403);
  check("a short password is refused", (await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "mike@example.com", password: "short" } })).status === 400);
  const reg = await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "Mike@Example.com", password: "correct horse battery" } });
  check("sign-up succeeds and asks for confirmation", reg.status === 200 && reg.json?.verify === true && !reg.json?.user);
  await new Promise((r) => setTimeout(r, 150));
  const confirm = lastMailTo("mike@example.com");
  check("a confirmation email went out", !!confirm && /Confirm/.test(confirm.subject));
  const verifyLink = linkIn(confirm, /https:\/\/cards\.example\.com\/api\/auth\/verify\?token=[\w-]+/);
  check("…with a link on PUBLIC_URL (never the request's Host)", !!verifyLink);

  const early = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "mike@example.com", password: "correct horse battery" } });
  check("sign-in before confirming says so", early.status === 403 && early.json?.error === "unverified");

  const dup = await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "mike@example.com", password: "another long password" } });
  check("signing up again with a taken email looks the same as a new sign-up", dup.status === 200 && dup.json?.verify === true);
  await new Promise((r) => setTimeout(r, 150));
  check("…and the owner is told instead", /already have one/.test(lastMailTo("mike@example.com")?.body || ""));

  const v = await call(port, "GET", verifyLink.replace("https://cards.example.com", ""));
  check("the confirmation link redirects to the app", v.status === 302 && v.headers.location === "https://cards.example.com/?verified=1");
  const v2 = await call(port, "GET", verifyLink.replace("https://cards.example.com", ""));
  check("…and works only once", v2.headers.location === "https://cards.example.com/?verified=0");

  // website sign-in: cookie
  const login = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "mike@example.com", password: "correct horse battery" } });
  const cookie = cookieOf(login);
  check("website sign-in sets a session cookie", login.status === 200 && !!cookie && !login.json?.token);
  const setCookie = (login.headers["set-cookie"] || []).join(";");
  check("…HttpOnly, Secure, SameSite=Lax", /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Lax/.test(setCookie));
  const me = await call(port, "GET", "/api/auth/me", { cookie });
  check("/me knows who's signed in", me.json?.user?.email === "mike@example.com");

  // vault
  const empty = await call(port, "GET", "/api/store", { cookie });
  check("a new account's vault is empty at revision 0", empty.json?.value === null && empty.json?.rev === 0);
  const put1 = await call(port, "PUT", "/api/store", { cookie, headers: { ...APP, "x-base-rev": "0" }, body: { value: "v1" } });
  check("saving works and bumps the revision", put1.status === 200 && put1.json?.rev === 1);
  check("a cookie save without the app header is refused (CSRF)", (await call(port, "PUT", "/api/store", { cookie, body: { value: "forged" } })).status === 403);

  // phone app sign-in: bearer token
  const appLogin = await call(port, "POST", "/api/auth/login", {
    headers: { ...APP, Origin: "capacitor://localhost" },
    body: { email: "mike@example.com", password: "correct horse battery", app: true },
  });
  const token = appLogin.json?.token;
  check("the phone app gets a token instead of a cookie", appLogin.status === 200 && !!token && !cookieOf(appLogin));
  check("…and CORS lets the app read it", appLogin.headers["access-control-allow-origin"] === "capacitor://localhost");
  const pre = await call(port, "OPTIONS", "/api/store", { headers: { Origin: "capacitor://localhost", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization,content-type,x-base-rev" } });
  check("the preflight allows the Authorization header", /authorization/i.test(pre.headers["access-control-allow-headers"] || ""));
  const bearer = { Authorization: `Bearer ${token}` };
  const appGet = await call(port, "GET", "/api/store", { headers: bearer });
  check("the app reads the same vault", appGet.json?.value === "v1" && appGet.json?.rev === 1);
  const stale = await call(port, "PUT", "/api/store", { headers: { ...bearer, "x-base-rev": "0" }, body: { value: "stale" } });
  check("a save based on an old revision is refused (409)", stale.status === 409 && stale.json?.rev === 1);
  const appPut = await call(port, "PUT", "/api/store", { headers: { ...bearer, "x-base-rev": "1" }, body: { value: "from phone" } });
  check("bearer saves don't need the CSRF header", appPut.status === 200 && appPut.json?.rev === 2);
  check("a made-up token gets nothing", (await call(port, "GET", "/api/store", { headers: { Authorization: "Bearer nope" } })).status === 401);

  // lockout: five wrong passwords lock the account until an admin opens it
  const wrongLogin = (i) => call(port, "POST", "/api/auth/login", { headers: { ...APP, "x-forwarded-for": "198.51.100.9" }, body: { email: "mike@example.com", password: `wrong ${i}` } });
  const first4 = [];
  for (let i = 0; i < 4; i++) first4.push((await wrongLogin(i)).status);
  check("wrong passwords are 401 at first", first4.every((x) => x === 401));
  const fifth = await wrongLogin(4);
  check("the fifth wrong password locks the account (423)", fifth.status === 423 && fifth.json?.error === "locked");
  const blocked = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "mike@example.com", password: "correct horse battery" } });
  check("…and even the right password is refused while locked", blocked.status === 423);
  const unknown = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "nobody@example.com", password: "whatever at all" } });
  check("an unknown email gets the same answer as a wrong password", unknown.status === 401 && unknown.json?.error === "Wrong email or password.");

  // change password: other devices signed out
  const change = await call(port, "POST", "/api/auth/password", { cookie, headers: APP, body: { current: "correct horse battery", next: "a brand new passphrase" } });
  check("changing the password works", change.status === 200);
  check("…this device stays signed in", (await call(port, "GET", "/api/auth/me", { cookie })).status === 200);
  check("…the phone is signed out", (await call(port, "GET", "/api/auth/me", { headers: bearer })).status === 401);

  // forgot / reset
  const forgotUnknown = await call(port, "POST", "/api/auth/forgot", { headers: APP, body: { email: "nobody@example.com" } });
  const forgot = await call(port, "POST", "/api/auth/forgot", { headers: APP, body: { email: "mike@example.com" } });
  check("forgot-password answers the same for unknown and real emails", forgotUnknown.status === 200 && forgot.status === 200);
  await new Promise((r) => setTimeout(r, 150));
  check("a locked account gets no self-service reset email", !mails.some((m) => m.to.some((t) => t.includes("mike@")) && /Reset/.test(m.subject || "")));
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "auth-accounts.cjs", "unlock", "mike@example.com"], { env: { ...process.env, DATA_DIR: srv.dir } });
  check("the admin's unlock lets the right password in again", (await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "mike@example.com", password: "a brand new passphrase" } })).status === 200);
  await call(port, "POST", "/api/auth/forgot", { headers: APP, body: { email: "mike@example.com" } });
  await new Promise((r) => setTimeout(r, 150));
  const resetMail = lastMailTo("mike@example.com");
  const resetToken = (linkIn(resetMail, /\?reset=([\w-]+)/) || "").replace("?reset=", "");
  check("a reset email went out with a link to the app", /Reset/.test(resetMail?.subject || "") && resetToken.length > 20);
  check("a bad reset token is refused", (await call(port, "POST", "/api/auth/reset", { headers: APP, body: { token: "nope", password: "whatever long enough" } })).status === 400);
  const reset = await call(port, "POST", "/api/auth/reset", { headers: APP, body: { token: resetToken, password: "reset to this one" } });
  check("resetting works", reset.status === 200);
  check("…signs every device out", (await call(port, "GET", "/api/auth/me", { cookie })).status === 401);
  check("…and the link works only once", (await call(port, "POST", "/api/auth/reset", { headers: APP, body: { token: resetToken, password: "again and again" } })).status === 400);
  const relog = await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "mike@example.com", password: "reset to this one" } });
  const cookie2 = cookieOf(relog);
  check("the new password signs in", relog.status === 200 && !!cookie2);
  check("…and the vault survived it all", (await call(port, "GET", "/api/store", { cookie: cookie2 })).json?.value === "from phone");

  // delete
  const delWrong = await call(port, "DELETE", "/api/auth/account", { cookie: cookie2, headers: APP, body: { password: "wrong password here" } });
  check("deleting needs the password", delWrong.status === 403);
  const del = await call(port, "DELETE", "/api/auth/account", { cookie: cookie2, headers: APP, body: { password: "reset to this one" } });
  check("deleting the account works", del.status === 200 && del.json?.deleted === true);
  check("…the session is gone", (await call(port, "GET", "/api/auth/me", { cookie: cookie2 })).status === 401);
  check("…and so is the account", (await call(port, "POST", "/api/auth/login", { headers: APP, body: { email: "mike@example.com", password: "reset to this one" } })).status === 401);
  const reuse = await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "mike@example.com", password: "fresh start password" } });
  check("the email can sign up again afterwards", reuse.status === 200);
} finally {
  srv.child.kill();
}

// ---- misconfiguration stops the server ----
const bad = await startServer({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtpPort), SMTP_FROM: "a@b.cz" });
await new Promise((r) => setTimeout(r, 300));
check("SMTP without PUBLIC_URL refuses to start, and says why", bad.child.exitCode !== null && /PUBLIC_URL/.test(bad.stderr()));
bad.child.kill();

// ---- without email ----
const plain = await startServer({ REGISTRATION: "open" });
try {
  const r = await call(plain.port, "POST", "/api/auth/register", { headers: APP, body: { email: "anna@example.com", password: "no email server here" } });
  check("without email, sign-up confirms at once and signs in", r.status === 200 && r.json?.user?.email === "anna@example.com" && !!cookieOf(r));
  const r2 = await call(plain.port, "POST", "/api/auth/register", { headers: APP, body: { email: "anna@example.com", password: "no email server here" } });
  check("…and a taken email is simply refused (there's no owner to email)", r2.status === 409);
  const appReg = await call(plain.port, "POST", "/api/auth/register", { headers: APP, body: { email: "phone@example.com", password: "from the phone app", app: true } });
  check("…the phone app gets a token from sign-up too", !!appReg.json?.token);
} finally {
  plain.child.kill();
}
const closed = await startServer({ REGISTRATION: "closed" });
try {
  check("health says when sign-up is closed", (await call(closed.port, "GET", "/api/health")).json?.registration === false);
  check("…and sign-up is refused", (await call(closed.port, "POST", "/api/auth/register", { headers: APP, body: { email: "x@example.com", password: "long enough password" } })).status === 403);
} finally {
  closed.child.kill();
}

smtp.close();
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
