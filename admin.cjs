/*
 * The admin API: /api/admin/*. A password-locked space for the person who runs
 * the server — settings (the things that used to need the config file or
 * docker-compose.yml), email setup with a test button, account help, and a
 * restart button.
 *
 * Deliberately separate from user accounts: the admin password is not any
 * user's password, the session cookie is its own (bw_admin), and a normal
 * user — or the phone app — can't reach any of this.
 *
 *   Admin password:  ADMIN_PASSWORD in the environment (then it can only be
 *                    changed there), otherwise DATA_DIR/admin.json. With
 *                    neither, the server prints a one-time setup code in its
 *                    log; whoever can read the log can choose the password.
 *   ADMIN=off        switches the whole thing off.
 *
 * Safety rails: same-origin only (Origin must match this server), every
 * change needs the X-HK-App header, SameSite=Strict HttpOnly cookie, sign-in
 * attempts throttled like PINs were, sessions expire after 12 hours (or 2
 * idle), and no secret ever leaves the server in a response or the log.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createMailerFromEnv } = require("./mailer.cjs");
const { hashPassword, checkPassword } = require("./auth-accounts.cjs");
const totpLib = require("./totp.cjs");

const COOKIE = "bw_admin";
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 256;
const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const THROTTLE_KEY = "admin";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function createAdmin({ dataDir, env = process.env, settings, accounts, guard, clientKey, json, readBody, getCardDb = () => null, onApply = () => {}, restart, log = console, now = () => Date.now() }) {
  const disabled = /^(off|0|false|no)$/i.test(env.ADMIN || "");
  const file = path.join(dataDir, "admin.json");
  const envPassword = String(env.ADMIN_PASSWORD || "");
  const envPasswordUsable = envPassword.length >= MIN_PASSWORD;
  const startedAt = now();

  let storedHash = null;
  let mfa = null; // { secret (sealed), step, recovery: [hashes] } once two-factor is on
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    storedHash = d.hash || null;
    mfa = d.mfa && d.mfa.secret ? d.mfa : null;
  } catch (e) {}
  let pendingSecret = null; // sealed, during setup (memory only)
  const tickets = new Map(); // sha(ticket) → { expires, tries }

  const sessions = new Map(); // sha(token) → { created, seen }
  const configured = () => envPasswordUsable || !!storedHash;
  // One-time code for choosing the first password. Never written to disk.
  const setupCode = !disabled && !configured() ? crypto.randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})(.{5})/, "$1-$2") : null;

  if (disabled) log.log("[binderwyrm] admin space is switched off (ADMIN=off).");
  else if (envPassword && !envPasswordUsable) log.warn(`[binderwyrm] ADMIN_PASSWORD is shorter than ${MIN_PASSWORD} characters, so the admin space stays locked. Use a longer one.`);
  else if (setupCode) log.log(`[binderwyrm] Admin space: open /admin and use setup code ${setupCode} to choose the admin password. (The code changes every restart.)`);

  // What the restart-needed settings were at boot, to say which are pending.
  const restartKeys = settings.describe().filter((d) => d.restart).map((d) => d.key);
  const bootValues = Object.fromEntries(restartKeys.map((k) => [k, settings.get(k) || ""]));
  const pendingRestart = () => restartKeys.filter((k) => (settings.get(k) || "") !== bootValues[k]);

  // --- helpers ---

  function cookieOf(req, name) {
    for (const part of String(req.headers.cookie || "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return "";
  }

  const secureCookie = () => !/^(0|false|no|off)$/i.test(settings.get("COOKIE_SECURE") || "");
  const cookieHeader = (value, maxAge) =>
    `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie() ? "; Secure" : ""}`;

  function startSession(res) {
    const token = crypto.randomBytes(32).toString("base64url");
    const t = now();
    sessions.set(sha(token), { created: t, seen: t });
    res.setHeader("Set-Cookie", cookieHeader(token, SESSION_MAX_MS / 1000));
  }

  function sessionOf(req) {
    const token = cookieOf(req, COOKIE);
    if (!token) return null;
    const key = sha(token);
    const s = sessions.get(key);
    if (!s) return null;
    const t = now();
    if (t - s.created > SESSION_MAX_MS || t - s.seen > SESSION_IDLE_MS) {
      sessions.delete(key);
      return null;
    }
    s.seen = t;
    return key;
  }

  // The page and API are the same origin, so a real request's Origin names
  // this server. Anything else — another site, the phone app — is refused.
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // not a cross-site browser request
    let host;
    try {
      host = new URL(origin).host;
    } catch (e) {
      return false;
    }
    if (host === req.headers.host) return true;
    try {
      return !!settings.get("PUBLIC_URL") && new URL(settings.get("PUBLIC_URL")).host === host;
    } catch (e) {
      return false;
    }
  }

  async function body(req, res) {
    try {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (b && typeof b === "object" && !Array.isArray(b)) return b;
      throw new Error("not an object");
    } catch (e) {
      json(res, 400, { error: "Bad JSON" });
      return null;
    }
  }

  function throttled(req, res) {
    const wait = guard.blocked(clientKey(req), THROTTLE_KEY);
    if (!wait) return false;
    res.setHeader("Retry-After", String(wait));
    const m = Math.ceil(wait / 60);
    json(res, 429, {
      error: wait < 60 ? `Too many attempts. Try again in ${wait} seconds.` : `Too many attempts. Try again in ${m} minute${m === 1 ? "" : "s"}.`,
      retryAfter: wait,
    });
    return true;
  }

  const who = (req) => clientKey(req);
  const state = (req) => ({
    configured: configured(),
    passwordFromEnv: envPasswordUsable,
    signedIn: !!sessionOf(req),
    mfa: !!mfa,
  });

  function view() {
    return { settings: settings.describe(), pendingRestart: pendingRestart(), configFile: settings.file };
  }

  async function checkAdminPassword(pw) {
    if (envPasswordUsable) return safeEqual(sha(pw), sha(envPassword));
    if (!storedHash) return false;
    return checkPassword(pw, storedHash);
  }

  function validNewPassword(res, pw) {
    if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return json(res, 400, { error: `Use at least ${MIN_PASSWORD} characters for the admin password.` }), false;
    if (pw.length > MAX_PASSWORD) return json(res, 400, { error: "That password is too long." }), false;
    return true;
  }

  async function savePassword(pw) {
    storedHash = await hashPassword(pw);
    writeData();
  }

  function writeData() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ hash: storedHash, ...(mfa ? { mfa } : {}) }), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch (e) {}
  }

  // Authenticator code or recovery code; remembers what was used.
  function checkCode(code) {
    const secret = mfa ? totpLib.open(dataDir, mfa.secret) : null;
    if (!secret) return false;
    const step = totpLib.verify(secret, code, mfa.step || 0);
    if (step) {
      mfa.step = step;
      writeData();
      return true;
    }
    const left = totpLib.useRecovery(mfa.recovery || [], code);
    if (left) {
      mfa.recovery = left;
      writeData();
      return true;
    }
    return false;
  }

  // --- the router ---

  // Returns true when it answered the request.
  async function handle(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith("/api/admin")) return false;
    res.setHeader("Cache-Control", "no-store");
    if (disabled) return json(res, 404, { error: "Not found" }), true;
    if (!sameOrigin(req)) return json(res, 403, { error: "The admin space only works from this server's own page." }), true;
    const method = req.method;
    const sub = p.replace(/^\/api\/admin\/?/, "");

    if (sub === "state" && method === "GET") return json(res, 200, state(req)), true;

    // Everything else changes something or reads private data, so it must come
    // from our own page.
    if (method !== "GET" && req.headers["x-hk-app"] !== "1") return json(res, 400, { error: "Missing X-HK-App header." }), true;

    if (sub === "setup" && method === "POST") {
      if (configured() || !setupCode) return json(res, 409, { error: "An admin password is already set." }), true;
      if (throttled(req, res)) return true;
      const b = await body(req, res);
      if (!b) return true;
      if (!safeEqual(String(b.code || "").trim().toUpperCase(), setupCode)) {
        guard.fail(clientKey(req), THROTTLE_KEY);
        return json(res, 403, { error: "That setup code isn't right. It's printed in the server's log." }), true;
      }
      if (!validNewPassword(res, b.password)) return true;
      guard.succeed(clientKey(req), THROTTLE_KEY);
      await savePassword(b.password);
      startSession(res);
      log.log(`[binderwyrm] admin password set from ${who(req)}.`);
      return json(res, 200, { ok: true }), true;
    }

    if (sub === "login" && method === "POST") {
      if (!configured()) return json(res, 409, { error: "No admin password is set yet." }), true;
      if (throttled(req, res)) return true;
      const b = await body(req, res);
      if (!b) return true;
      const ok = typeof b.password === "string" && b.password.length <= MAX_PASSWORD && (await checkAdminPassword(b.password));
      if (!ok) {
        guard.fail(clientKey(req), THROTTLE_KEY);
        log.warn(`[binderwyrm] failed admin sign-in from ${who(req)}.`);
        return json(res, 403, { error: "Wrong password." }), true;
      }
      guard.succeed(clientKey(req), THROTTLE_KEY);
      if (mfa) {
        const t = crypto.randomBytes(24).toString("base64url");
        const n = now();
        for (const [k, v] of tickets) if (v.expires < n) tickets.delete(k);
        tickets.set(sha(t), { expires: n + 5 * 60 * 1000, tries: 0 });
        return json(res, 200, { mfaRequired: true, ticket: t }), true;
      }
      startSession(res);
      log.log(`[binderwyrm] admin signed in from ${who(req)}.`);
      return json(res, 200, { ok: true }), true;
    }

    if (sub === "login-mfa" && method === "POST") {
      if (!mfa) return json(res, 409, { error: "Two-factor is not on." }), true;
      if (throttled(req, res)) return true;
      const b = await body(req, res);
      if (!b) return true;
      const th = sha(String(b.ticket || ""));
      const tk = tickets.get(th);
      if (!tk || tk.expires < now()) return json(res, 401, { error: "That sign-in took too long. Enter the password again.", expired: true }), true;
      if (!checkCode(b.code)) {
        guard.fail(clientKey(req), THROTTLE_KEY);
        log.warn(`[binderwyrm] wrong admin two-factor code from ${who(req)}.`);
        if (++tk.tries >= 5) {
          tickets.delete(th);
          return json(res, 401, { error: "Too many wrong codes. Enter the password again.", expired: true }), true;
        }
        return json(res, 403, { error: "Wrong code." }), true;
      }
      tickets.delete(th);
      guard.succeed(clientKey(req), THROTTLE_KEY);
      startSession(res);
      log.log(`[binderwyrm] admin signed in (two-factor) from ${who(req)}.`);
      return json(res, 200, { ok: true }), true;
    }

    // ---- signed in from here on ----
    const key = sessionOf(req);
    if (!key) return json(res, 401, { error: "Sign in to the admin space first." }), true;

    if (sub === "logout" && method === "POST") {
      sessions.delete(key);
      res.setHeader("Set-Cookie", cookieHeader("", 0));
      return json(res, 200, { ok: true }), true;
    }

    if (sub === "password" && method === "POST") {
      if (envPasswordUsable) return json(res, 409, { error: "The admin password is set by ADMIN_PASSWORD in the server's environment. Change it there." }), true;
      if (throttled(req, res)) return true;
      const b = await body(req, res);
      if (!b) return true;
      if (!(await checkAdminPassword(String(b.current || "")))) {
        guard.fail(clientKey(req), THROTTLE_KEY);
        return json(res, 403, { error: "The current password is wrong." }), true;
      }
      if (!validNewPassword(res, b.next)) return true;
      guard.succeed(clientKey(req), THROTTLE_KEY);
      await savePassword(b.next);
      for (const k of [...sessions.keys()]) if (k !== key) sessions.delete(k); // other admin sessions end
      log.log(`[binderwyrm] admin password changed from ${who(req)}.`);
      return json(res, 200, { ok: true }), true;
    }

    // ---- admin two-factor ----
    if (sub === "mfa/setup" && method === "POST") {
      if (mfa) return json(res, 409, { error: "Two-factor is already on." }), true;
      if (throttled(req, res)) return true;
      const b = await body(req, res);
      if (!b) return true;
      if (!(await checkAdminPassword(String(b.password || "")))) {
        guard.fail(clientKey(req), THROTTLE_KEY);
        return json(res, 403, { error: "The password is wrong." }), true;
      }
      guard.succeed(clientKey(req), THROTTLE_KEY);
      const secret = totpLib.newSecret();
      pendingSecret = totpLib.seal(dataDir, secret);
      return json(res, 200, { secret: totpLib.base32(secret), uri: totpLib.otpauthUri("admin", "Binderwyrm", secret) }), true;
    }
    if (sub === "mfa/enable" && method === "POST") {
      if (throttled(req, res)) return true;
      const b = await body(req, res);
      if (!b) return true;
      const secret = pendingSecret ? totpLib.open(dataDir, pendingSecret) : null;
      if (!secret) return json(res, 409, { error: "Start the setup again." }), true;
      const step = totpLib.verify(secret, b.code, 0);
      if (!step) {
        guard.fail(clientKey(req), THROTTLE_KEY);
        return json(res, 400, { error: "That code doesn't match. Try the current one." }), true;
      }
      guard.succeed(clientKey(req), THROTTLE_KEY);
      const codes = totpLib.newRecoveryCodes();
      mfa = { secret: totpLib.seal(dataDir, secret), step, recovery: totpLib.hashRecovery(codes) };
      pendingSecret = null;
      writeData();
      log.log(`[binderwyrm] admin two-factor turned on from ${who(req)}.`);
      return json(res, 200, { ok: true, recovery: codes }), true;
    }
    if ((sub === "mfa/disable" || sub === "mfa/recovery") && method === "POST") {
      if (!mfa) return json(res, 409, { error: "Two-factor is not on." }), true;
      if (throttled(req, res)) return true;
      const b = await body(req, res);
      if (!b) return true;
      if (!(await checkAdminPassword(String(b.password || ""))) || !checkCode(b.code)) {
        guard.fail(clientKey(req), THROTTLE_KEY);
        return json(res, 403, { error: "The password or code is wrong." }), true;
      }
      guard.succeed(clientKey(req), THROTTLE_KEY);
      if (sub === "mfa/disable") {
        mfa = null;
        writeData();
        log.log(`[binderwyrm] admin two-factor turned off from ${who(req)}.`);
        return json(res, 200, { ok: true }), true;
      }
      const codes = totpLib.newRecoveryCodes();
      mfa.recovery = totpLib.hashRecovery(codes);
      writeData();
      return json(res, 200, { ok: true, recovery: codes }), true;
    }

    if (sub === "config" && method === "GET") return json(res, 200, view()), true;

    if (sub === "config" && method === "PUT") {
      const b = await body(req, res);
      if (!b) return true;
      let plan;
      try {
        plan = settings.plan({ set: b.set || {}, reset: Array.isArray(b.reset) ? b.reset : [] });
        const env2 = settings.effectiveEnv(plan.next);
        // Throws (e.g. SMTP without a public address) before anything is saved.
        accounts.operator.configure({ env: env2, mailer: createMailerFromEnv(env2) });
        settings.commit(plan.next);
        onApply(env2);
      } catch (e) {
        // configure() may have thrown before swapping anything in; make sure
        // the running state still matches what's saved.
        try {
          const cur = settings.effectiveEnv();
          accounts.operator.configure({ env: cur, mailer: createMailerFromEnv(cur) });
        } catch (e2) {}
        return json(res, 400, { error: e.message }), true;
      }
      const changed = Object.keys(b.set || {}).concat(Array.isArray(b.reset) ? b.reset : []);
      log.log(`[binderwyrm] admin changed settings (${changed.join(", ") || "none"}) from ${who(req)}.`);
      return json(res, 200, view()), true;
    }

    if (sub === "smtp-test" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      const to = String(b.to || "").trim();
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) return json(res, 400, { error: "Enter an email address to send the test to." }), true;
      let mailer;
      try {
        // Test what is on the form, not just what's saved. A blank password
        // field means "keep the saved one", which effectiveEnv already does.
        const draft = settings.plan({ set: b.set || {}, reset: Array.isArray(b.reset) ? b.reset : [] });
        mailer = createMailerFromEnv(settings.effectiveEnv(draft.next));
      } catch (e) {
        return json(res, 400, { error: e.message }), true;
      }
      if (!mailer) return json(res, 400, { error: "Enter an SMTP server (and a Send-as address) first." }), true;
      try {
        await mailer.send({
          to,
          subject: "Binderwyrm test email",
          text: "If you can read this, Binderwyrm can send email through the server you set up.\n\n— Binderwyrm admin",
        });
      } catch (e) {
        return json(res, 502, { error: `Sending failed: ${e.message}` }), true;
      }
      return json(res, 200, { ok: true, via: mailer.describe }), true;
    }

    if (sub === "status" && method === "GET") {
      let cards = null;
      try {
        cards = getCardDb()?.status?.() ?? null;
      } catch (e) {}
      const mem = process.memoryUsage();
      return json(res, 200, {
        uptime: Math.round((now() - startedAt) / 1000),
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        dataDir,
        memoryMb: Math.round(mem.rss / 1048576),
        accounts: accounts.operator.stats(),
        unclaimed: accounts.operator.unclaimed(),
        email: accounts.operator.hasMailer() ? accounts.operator.mailer().describe : null,
        cards,
        pendingRestart: pendingRestart(),
      }), true;
    }

    if (sub === "users" && method === "GET") return json(res, 200, { users: accounts.operator.list() }), true;

    const um = sub.match(/^users\/(\d+)\/(confirm|temp-password|sign-out|unlock|reset-link|mfa-off)$/);
    if (um && method === "POST") {
      const id = Number(um[1]);
      const user = accounts.operator.list().find((u) => u.id === id);
      if (!user) return json(res, 404, { error: "No such account." }), true;
      if (um[2] === "confirm") {
        accounts.operator.confirm(id);
        log.log(`[binderwyrm] admin confirmed account ${id}.`);
        return json(res, 200, { ok: true }), true;
      }
      if (um[2] === "mfa-off") {
        accounts.operator.resetMfa(id);
        log.log(`[binderwyrm] admin turned off two-factor for account ${id}.`);
        return json(res, 200, { ok: true }), true;
      }
      if (um[2] === "unlock") {
        accounts.operator.unlock(id);
        log.log(`[binderwyrm] admin unlocked account ${id}.`);
        return json(res, 200, { ok: true }), true;
      }
      if (um[2] === "reset-link") {
        try {
          const r = await accounts.operator.resetLink(id);
          log.log(`[binderwyrm] admin sent a reset link for account ${id}${r.emailed ? "" : " (not emailed)"}.`);
          // The link itself is only shown when it wasn't emailed.
          return json(res, 200, { ok: true, email: r.email, emailed: r.emailed, ...(r.emailed ? {} : { link: r.link }) }), true;
        } catch (e) {
          return json(res, 400, { error: e.message }), true;
        }
      }
      if (um[2] === "sign-out") {
        accounts.operator.signOut(id);
        return json(res, 200, { ok: true }), true;
      }
      const temp = await accounts.operator.tempPassword(id);
      log.log(`[binderwyrm] admin reset the password for account ${id}.`);
      return json(res, 200, { ok: true, email: user.email, password: temp }), true;
    }

    if (sub === "sign-out-everyone" && method === "POST") {
      const n = accounts.operator.signOutAll();
      log.log(`[binderwyrm] admin signed out every account (${n} sessions).`);
      return json(res, 200, { ok: true, sessions: n }), true;
    }

    if (sub === "restart" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      if (b.confirm !== true) return json(res, 400, { error: "Confirm the restart." }), true;
      log.log(`[binderwyrm] admin asked for a restart from ${who(req)}.`);
      json(res, 200, { ok: true });
      // Let the answer reach the browser, then exit. Docker's restart policy
      // (restart: unless-stopped) brings the server straight back up.
      setTimeout(() => restart(), 400).unref();
      return true;
    }

    return json(res, 404, { error: "Not found" }), true;
  }

  return { handle, disabled, setupCode };
}

module.exports = { createAdmin };

// Locked out of the admin space (lost phone and recovery codes)? On the server:
//   node admin.cjs reset-mfa
if (require.main === module) {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
  const file = path.join(dataDir, "admin.json");
  if (process.argv[2] === "reset-mfa") {
    try {
      const d = JSON.parse(fs.readFileSync(file, "utf8"));
      delete d.mfa;
      fs.writeFileSync(file, JSON.stringify(d), { mode: 0o600 });
      console.log("Admin two-factor turned off. Sign in with the password, then turn it on again.");
    } catch (e) {
      console.log("Nothing to reset (no admin.json at " + file + ").");
    }
  } else {
    console.log("Usage: node admin.cjs reset-mfa");
  }
}
