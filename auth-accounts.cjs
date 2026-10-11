/*
 * Binderwyrm's accounts: email + password sign-in, one private vault per
 * account. It's the only way in — PIN profiles were retired; their files are
 * kept read-only (legacy-profiles.cjs) so owners can claim them into an
 * account. An account may also have a public handle, which is the name in
 * /w/<handle>, /v/<handle> and the playgroup list.
 *
 * Storage: one SQLite file, DATA_DIR/accounts.db (node:sqlite, built into
 * Node 22+ — still no npm dependencies).
 *
 *   users     email, scrypt password hash, confirmed?, the vault + revision
 *   sessions  SHA-256 of each session token (the token itself is never stored)
 *   tokens    SHA-256 of email-confirmation and password-reset tokens
 *
 * Signing in, two ways, same sessions table:
 *   • the website gets an HttpOnly, Secure, SameSite=Lax cookie;
 *   • the phone app asks for a token instead ({"app": true} at login) and
 *     sends it as `Authorization: Bearer …`. Its pages live on
 *     capacitor://localhost / https://localhost, where a cookie for this
 *     server is a third-party cookie — which iOS blocks outright.
 *
 * Cross-site request forgery: every state-changing request made with the
 * cookie must carry `X-HK-App: 1`. A plain HTML form can't add headers, and
 * a script on another site would need a CORS preflight this server refuses.
 * Bearer requests can't be forged that way, so they don't need it.
 *
 * Email (confirm address, reset password) goes through mailer.cjs when
 * SMTP_* is configured. Without it, new accounts are confirmed straight away
 * and password resets are only possible through the CLI at the bottom of this
 * file — say so in the docs rather than silently pretending to send mail.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const totpLib = require("./totp.cjs");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

const SESSION_DAYS = 30;
const VERIFY_HOURS = 48;
const RESET_MINUTES = 60;
const MIN_PASSWORD = 10;
// Wrong passwords tolerated per account per hour before it is locked.
const MAX_WRONG = 5;
const WRONG_WINDOW_MS = 60 * 60 * 1000;
const MAX_PASSWORD = 256;
const COOKIE = "bw_session";
// scrypt: N=2^15, r=8 → 32 MiB and ~100 ms per hash. Slow on purpose.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");

// Every hash costs ~100 ms and 32 MiB, and anonymous requests can trigger them
// (login, register, claim). Cap how many run at once so a flood gets a quick
// "busy" instead of starving the server's thread pool for everyone else.
let hashing = 0;
const MAX_HASHING = 12;
async function limited(fn) {
  if (hashing >= MAX_HASHING) {
    const e = new Error("busy");
    e.code = "BUSY";
    throw e;
  }
  hashing++;
  try {
    return await fn();
  } finally {
    hashing--;
  }
}

async function hashPassword(pw) {
  return limited(() => hashPasswordNow(pw));
}

async function hashPasswordNow(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw).normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function checkPassword(pw, stored) {
  return limited(() => checkPasswordNow(pw, stored));
}

async function checkPasswordNow(pw, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, key] = parts;
  const want = Buffer.from(key, "base64");
  const got = await scrypt(String(pw).normalize("NFKC"), Buffer.from(salt, "base64"), want.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(got, want);
}

function normalizeEmail(e) {
  const s = String(e || "").trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(s)) return null;
  return s;
}

function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i > 0) {
        const raw = part.slice(i + 1).trim();
        try {
          out[part.slice(0, i).trim()] = decodeURIComponent(raw);
        } catch (e) {
          out[part.slice(0, i).trim()] = raw; // a malformed cookie is just a cookie that won't match
        }
      }
    });
  return out;
}

function createAccounts({ dataDir, env = process.env, json, readBody, guard, clientKey, mailer, legacy = null, log = console }) {
  // Loaded only in accounts mode, so the PIN edition never touches the
  // (still experimental in Node 22) SQLite module.
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "accounts.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      pw_hash TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      vault TEXT,
      rev INTEGER NOT NULL DEFAULT 0,
      updated INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      created INTEGER NOT NULL,
      expires INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
    -- Old PIN profiles that have been moved into an account. The profile file
    -- stays on disk as a backup; this row is what stops it being claimed twice
    -- (and keeps its name from being served as an unclaimed profile). If the
    -- account is later deleted the row stays, with no owner.
    CREATE TABLE IF NOT EXISTS claims (
      profile TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created INTEGER NOT NULL
    );
    -- Finished Life Counter games, shared by everyone on this server so the
    -- table's stats don't depend on whose phone was running the counter. The
    -- submitting account is kept only so a deleted account's games can be told
    -- apart from the rest; it is never sent out.
    CREATE TABLE IF NOT EXISTS life_games (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS life_games_at ON life_games(at);
  `);
  // The public handle: the name that /w/<handle> and /v/<handle> and the
  // playgroup use. Optional — an account with none shares nothing. Added to
  // databases created before handles existed.
  if (!db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "handle")) {
    db.exec("ALTER TABLE users ADD COLUMN handle TEXT");
  }
  // Wrong-password lockout. After MAX_WRONG wrong passwords within an hour the
  // account is locked until the server's admin unlocks it (or sends a reset
  // link). Kept in the database, so a restart doesn't undo it.
  if (!db.prepare("PRAGMA table_info(sessions)").all().some((c) => c.name === "label")) db.exec("ALTER TABLE sessions ADD COLUMN label TEXT");
  for (const [col, def] of [["locked", "INTEGER NOT NULL DEFAULT 0"], ["fails", "INTEGER NOT NULL DEFAULT 0"], ["fail_since", "INTEGER"], ["mfa_secret", "TEXT"], ["mfa_pending", "TEXT"], ["mfa_step", "INTEGER NOT NULL DEFAULT 0"], ["mfa_recovery", "TEXT"]]) {
    if (!db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_handle ON users(handle) WHERE handle IS NOT NULL");

  const LIFE_SERVED = 1000; // games sent per request
  const LIFE_KEPT = 20000; // games kept on the server
  const lifeGames = {
    insert: db.prepare("INSERT OR IGNORE INTO life_games (id, user_id, at, data) VALUES (?, ?, ?, ?)"),
    recent: db.prepare("SELECT id, at, data FROM life_games ORDER BY at DESC LIMIT ?"),
    trim: db.prepare("DELETE FROM life_games WHERE id IN (SELECT id FROM life_games ORDER BY at DESC LIMIT -1 OFFSET ?)"),
  };
  const lifeText = (v) => (typeof v === "string" ? v.trim().slice(0, 60) : "");
  // Only the fields the stats read, with sane sizes; anything else is dropped.
  function cleanLifeGame(g) {
    if (!g || typeof g !== "object") return null;
    const id = typeof g.id === "string" && /^[\w.-]{1,64}$/.test(g.id) ? g.id : null;
    const at = Number.isFinite(g.at) && g.at > 0 && g.at < Date.now() + 86400000 ? Math.floor(g.at) : null;
    if (!id || !at || !Array.isArray(g.seats) || g.seats.length < 2 || g.seats.length > 8) return null;
    const seats = g.seats.map((s) => ({ name: lifeText(s?.name), commander: lifeText(s?.commander) || null, won: s?.won === true }));
    if (seats.some((s) => !s.name) || seats.filter((s) => s.won).length !== 1) return null;
    return { id, at, format: g.format === "normal" ? "normal" : "commander", winnerName: seats.find((s) => s.won).name, seats };
  }

  const q = {
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    userById: db.prepare("SELECT * FROM users WHERE id = ?"),
    insertUser: db.prepare("INSERT INTO users (email, pw_hash, verified, created) VALUES (?, ?, ?, ?)"),
    insertClaimedUser: db.prepare("INSERT INTO users (email, pw_hash, verified, created, vault, rev, updated, handle) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"),
    userByHandle: db.prepare("SELECT * FROM users WHERE handle = ?"),
    setHandle: db.prepare("UPDATE users SET handle = ? WHERE id = ?"),
    handles: db.prepare("SELECT handle FROM users WHERE handle IS NOT NULL ORDER BY handle"),
    claimedNames: db.prepare("SELECT profile FROM claims"),
    claimOf: db.prepare("SELECT * FROM claims WHERE profile = ?"),
    insertClaim: db.prepare("INSERT INTO claims (profile, user_id, created) VALUES (?, ?, ?)"),
    setVerified: db.prepare("UPDATE users SET verified = 1 WHERE id = ?"),
    setPassword: db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?"),
    setFails: db.prepare("UPDATE users SET fails = ?, fail_since = ? WHERE id = ?"),
    lock: db.prepare("UPDATE users SET locked = 1 WHERE id = ?"),
    unlock: db.prepare("UPDATE users SET locked = 0, fails = 0, fail_since = NULL WHERE id = ?"),
    setMfaPending: db.prepare("UPDATE users SET mfa_pending = ? WHERE id = ?"),
    enableMfa: db.prepare("UPDATE users SET mfa_secret = ?, mfa_pending = NULL, mfa_step = ?, mfa_recovery = ? WHERE id = ?"),
    setMfaStep: db.prepare("UPDATE users SET mfa_step = ? WHERE id = ?"),
    setMfaRecovery: db.prepare("UPDATE users SET mfa_recovery = ? WHERE id = ?"),
    clearMfa: db.prepare("UPDATE users SET mfa_secret = NULL, mfa_pending = NULL, mfa_step = 0, mfa_recovery = NULL WHERE id = ?"),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
    getVault: db.prepare("SELECT vault, rev FROM users WHERE id = ?"),
    putVault: db.prepare("UPDATE users SET vault = ?, rev = rev + 1, updated = ? WHERE id = ? AND rev = ?"),
    putVaultAnyRev: db.prepare("UPDATE users SET vault = ?, rev = rev + 1, updated = ? WHERE id = ?"),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, kind, created, expires, last_seen, label) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    sessionsOf: db.prepare("SELECT token_hash, kind, label, created, last_seen FROM sessions WHERE user_id = ? AND expires > ? ORDER BY last_seen DESC"),
    deleteSessionOf: db.prepare("DELETE FROM sessions WHERE token_hash = ? AND user_id = ?"),
    session: db.prepare("SELECT * FROM sessions WHERE token_hash = ?"),
    touchSession: db.prepare("UPDATE sessions SET last_seen = ?, expires = ? WHERE token_hash = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    deleteSessionsExcept: db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?"),
    deleteAllSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
    insertToken: db.prepare("INSERT INTO tokens (token_hash, user_id, purpose, expires) VALUES (?, ?, ?, ?)"),
    token: db.prepare("SELECT * FROM tokens WHERE token_hash = ? AND purpose = ?"),
    deleteToken: db.prepare("DELETE FROM tokens WHERE token_hash = ?"),
    deleteTokens: db.prepare("DELETE FROM tokens WHERE user_id = ? AND purpose = ?"),
    sweep: db.prepare("DELETE FROM sessions WHERE expires < ?"),
    sweepTokens: db.prepare("DELETE FROM tokens WHERE expires < ?"),
  };

  // Settings the admin page can change while the server runs. configure()
  // validates first and only then swaps them in, so a bad change leaves the
  // running settings untouched.
  let registrationOpen = true;
  let publicUrl = "";
  let cookieSecure = true;
  let claimOpen = true;
  let contact = "";
  function configure({ env: e = env, mailer: m = mailer } = {}) {
    const url = String(e.PUBLIC_URL || "").replace(/\/+$/, "");
    // Links in emails must never be built from the request's Host header — a
    // forged Host would put a reset token into a link to someone else's site.
    if (m && !/^https?:\/\//.test(url)) {
      throw new Error("PUBLIC_URL (e.g. https://cards.example.com) is required when SMTP is configured — email links are built from it.");
    }
    registrationOpen = !/^(closed|0|false|no|off)$/i.test(e.REGISTRATION || "");
    publicUrl = url;
    cookieSecure = !/^(0|false|no|off)$/i.test(e.COOKIE_SECURE || "");
    claimOpen = !/^(closed|0|false|no|off)$/i.test(e.CLAIM_PROFILES || "");
    contact = String(e.CONTACT_INFO || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
    mailer = m;
  }
  configure();

  // A hash to check against when the email doesn't exist, so "no such
  // account" takes as long as "wrong password" and can't be told apart.
  let dummyHash = null;
  hashPassword(newToken()).then((h) => (dummyHash = h), () => {});

  function sweep() {
    const now = Date.now();
    q.sweep.run(now);
    q.sweepTokens.run(now);
    // Sign-ups nobody confirmed within a week, with nothing in them, go away
    // (bulk sign-ups with made-up addresses would otherwise pile up forever).
    db.prepare("DELETE FROM users WHERE verified = 0 AND vault IS NULL AND created < ?").run(now - 7 * 86400 * 1000);
  }
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();

  // --- small helpers ---

  // Emails are the one thing an anonymous visitor can make the server send,
  // so cap them per address and per client.
  const sendLog = new Map();
  function mayEmail(key, max) {
    const now = Date.now();
    const list = (sendLog.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
    if (list.length >= max) return false;
    list.push(now);
    sendLog.set(key, list);
    return true;
  }

  async function sendMail(req, to, subject, text) {
    if (!mailer) return false;
    if (!mayEmail(`to:${to}`, 3) || !mayEmail(`ip:${clientKey(req)}`, 10)) {
      log.warn(`[binderwyrm] not emailing ${to}: too many emails this hour`);
      return false;
    }
    try {
      await mailer.send({ to, subject, text });
      return true;
    } catch (e) {
      log.error(`[binderwyrm] email to ${to} failed:`, e.message);
      return false;
    }
  }

  function issueToken(userId, purpose, ms) {
    const t = newToken();
    q.deleteTokens.run(userId, purpose);
    q.insertToken.run(sha256(t), userId, purpose, Date.now() + ms);
    return t;
  }

  function takeToken(t, purpose) {
    if (!t || typeof t !== "string") return null;
    const row = q.token.get(sha256(t), purpose);
    if (!row) return null;
    q.deleteToken.run(row.token_hash);
    if (row.expires < Date.now()) return null;
    return row;
  }

  async function sendVerification(req, user) {
    const t = issueToken(user.id, "verify", VERIFY_HOURS * 3600 * 1000);
    return sendMail(
      req,
      user.email,
      "Confirm your Binderwyrm account",
      `Hi,\n\nconfirm this address to finish setting up your Binderwyrm account:\n\n${publicUrl}/api/auth/verify?token=${t}\n\nThe link works for ${VERIFY_HOURS} hours. If you didn't sign up, ignore this email and nothing will happen.\n\n— Binderwyrm`
    );
  }

  // "Firefox on Windows", "Phone app (Android)" — a hint for the person's own
  // device list, so they can tell which session is which. Not an identifier.
  function deviceLabel(req, app) {
    const ua = String(req?.headers?.["user-agent"] || "");
    const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Linux|X11/i.test(ua) ? "Linux" : "";
    if (app) return `Phone app${os ? ` (${os})` : ""}`;
    const br = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    return os ? `${br} on ${os}` : br;
  }

  function startSession(res, userId, app, req) {
    const t = newToken();
    const now = Date.now();
    q.insertSession.run(sha256(t), userId, app ? "bearer" : "cookie", now, now + SESSION_DAYS * 86400 * 1000, now, deviceLabel(req, app));
    if (!app) res.setHeader("Set-Cookie", cookieHeader(t, SESSION_DAYS * 86400));
    return t;
  }

  function cookieHeader(value, maxAge) {
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cookieSecure ? "; Secure" : ""}`;
  }

  // Who's asking: { user, session, via } or null.
  function currentSession(req) {
    const auth = String(req.headers.authorization || "");
    let token = null;
    let via = null;
    if (/^Bearer\s+/i.test(auth)) {
      token = auth.replace(/^Bearer\s+/i, "").trim();
      via = "bearer";
    } else {
      token = parseCookies(req.headers.cookie)[COOKIE];
      via = "cookie";
    }
    if (!token) return null;
    const s = q.session.get(sha256(token));
    if (!s || s.expires < Date.now()) return null;
    const user = q.userById.get(s.user_id);
    if (!user) return null;
    // Sliding expiry, but write at most once an hour.
    const now = Date.now();
    if (now - s.last_seen > 3600 * 1000) q.touchSession.run(now, now + SESSION_DAYS * 86400 * 1000, s.token_hash);
    return { user, session: s, via };
  }

  const publicUser = (u) => ({ id: u.id, email: u.email, verified: !!u.verified, handle: u.handle || null, mfa: !!u.mfa_secret });

  // --- two-factor sign-in ---
  // Between the right password and the code, the browser holds a short-lived
  // ticket (memory only). It is worth nothing on its own and allows 5 tries.
  const tickets = new Map(); // sha(ticket) → { userId, app, expires, tries }
  function issueTicket(userId, app) {
    const t = newToken();
    const now = Date.now();
    for (const [k, v] of tickets) if (v.expires < now) tickets.delete(k);
    tickets.set(sha256(t), { userId, app: !!app, expires: now + 5 * 60 * 1000, tries: 0 });
    return t;
  }

  // One wrong password or wrong code: counts toward the lock. true = just locked.
  function countWrong(user) {
    const now = Date.now();
    const fresh = !user.fail_since || now - user.fail_since > WRONG_WINDOW_MS;
    const fails = (fresh ? 0 : user.fails) + 1;
    q.setFails.run(fails, fresh ? now : user.fail_since, user.id);
    if (fails >= MAX_WRONG) {
      q.lock.run(user.id);
      q.deleteTokens.run(user.id, "reset");
      log.warn(`[binderwyrm] account ${user.id} locked after ${fails} wrong passwords or codes — unlock it from the admin page.`);
      return true;
    }
    return false;
  }

  // Checks an authenticator code or a recovery code. Returns "totp", "recovery" or null,
  // and records what was used so it can't be used again.
  function checkSecondFactor(user, code) {
    const secret = user.mfa_secret ? totpLib.open(dataDir, user.mfa_secret) : null;
    if (!secret) return null;
    const step = totpLib.verify(secret, code, user.mfa_step || 0);
    if (step) {
      q.setMfaStep.run(step, user.id);
      return "totp";
    }
    let hashes = [];
    try {
      hashes = JSON.parse(user.mfa_recovery || "[]");
    } catch (e) {}
    const left = totpLib.useRecovery(hashes, code);
    if (left) {
      q.setMfaRecovery.run(JSON.stringify(left), user.id);
      return "recovery";
    }
    return null;
  }

  const lockedReply = (res, text) => json(res, 423, { error: "locked", message: text, ...(contact ? { contact } : {}) });

  async function body(req, res) {
    try {
      return JSON.parse((await readBody(req)) || "{}");
    } catch (e) {
      json(res, 400, { error: "Bad JSON" });
      return null;
    }
  }

  // Throttle guesses the same way PINs are throttled (pin-guard.cjs).
  function throttled(req, res, key) {
    const wait = guard.blocked(clientKey(req), key);
    if (!wait) return false;
    res.setHeader("Retry-After", String(wait));
    const m = Math.ceil(wait / 60);
    json(res, 429, {
      error: wait < 60 ? `Too many attempts. Try again in ${wait} seconds.` : `Too many attempts. Try again in ${m} minute${m === 1 ? "" : "s"}.`,
      retryAfter: wait,
    });
    return true;
  }

  // --- old PIN profiles and public handles ---

  const HANDLE_RE = /^[a-z0-9_-]{1,24}$/;
  const claimedSet = () => new Set(q.claimedNames.all().map((r) => r.profile));
  // Profiles still waiting for their owner. Reserved: nobody else can take
  // the name as a handle, and their public pages keep working.
  const unclaimedProfiles = () => {
    if (!legacy) return [];
    const claimed = claimedSet();
    return legacy.names().filter((n) => !claimed.has(n));
  };

  // The vault behind a public name, parsed — an account's handle first, then
  // an unclaimed old profile of that name — or null when there's no such page.
  function vaultFor(name) {
    const n = String(name || "").toLowerCase();
    if (!HANDLE_RE.test(n)) return null;
    const user = q.userByHandle.get(n);
    const parse = (v) => {
      try {
        return v ? JSON.parse(v) : {};
      } catch (e) {
        return null;
      }
    };
    if (user) return parse(user.vault);
    if (legacy && !q.claimOf.get(n)) {
      const rec = legacy.read(n);
      if (rec) return parse(rec.value);
    }
    return null;
  }

  // Names that show up in the playgroup: every handle, plus unclaimed profiles.
  const publicNames = () => [...new Set([...q.handles.all().map((r) => r.handle), ...unclaimedProfiles()])].sort();

  // --- routes ---

  async function handle(req, res, url) {
    const p = url.pathname;
    const method = req.method;

    if (p === "/api/health")
      return json(res, 200, { ok: true, mode: "accounts", registration: registrationOpen, claim: claimOpen && unclaimedProfiles().length > 0, ...(contact ? { contact } : {}) }), true;

    // Email confirmation link — a plain GET from a mail client, so no header
    // requirement; the unguessable token is the proof.
    if (p === "/api/auth/verify" && method === "GET") {
      const row = takeToken(url.searchParams.get("token"), "verify");
      if (row) q.setVerified.run(row.user_id);
      res.writeHead(302, { Location: `${publicUrl || ""}/?verified=${row ? 1 : 0}`, "Cache-Control": "no-store" });
      res.end();
      return true;
    }

    const isAuth = p.startsWith("/api/auth/");
    const isStore = p === "/api/store";
    const isProfiles = p === "/api/profiles";
    const isLife = p === "/api/life/games";
    if (!isAuth && !isStore && !isProfiles && !isLife) return false;

    const who = currentSession(req);
    // CSRF: cookie-authenticated (or anonymous) writes need the app's header.
    if (method !== "GET" && method !== "HEAD" && (!who || who.via === "cookie") && req.headers["x-hk-app"] !== "1") {
      return json(res, 403, { error: "Missing X-HK-App header" }), true;
    }

    if (p === "/api/auth/register" && method === "POST") {
      if (!registrationOpen) return json(res, 403, { error: "This server isn't taking new accounts." }), true;
      const b = await body(req, res);
      if (!b) return true;
      const email = normalizeEmail(b.email);
      const password = String(b.password || "");
      if (!email) return json(res, 400, { error: "That doesn't look like an email address." }), true;
      if (password.length < MIN_PASSWORD) return json(res, 400, { error: `Use at least ${MIN_PASSWORD} characters for the password.` }), true;
      if (password.length > MAX_PASSWORD) return json(res, 400, { error: "That password is too long." }), true;
      // Account creation is cheap for a script and each one may send an
      // email: at most 10 new accounts per client an hour.
      if (!mayEmail(`register:${clientKey(req)}`, 10)) {
        res.setHeader("Retry-After", "3600");
        return json(res, 429, { error: "Too many new accounts from here. Try again later.", retryAfter: 3600 }), true;
      }
      // And a ceiling for the whole server, in case "per client" has been
      // sidestepped (see pin-guard.cjs on X-Forwarded-For).
      if (!mayEmail("register:all", 60)) {
        res.setHeader("Retry-After", "3600");
        return json(res, 429, { error: "Lots of sign-ups right now. Try again later.", retryAfter: 3600 }), true;
      }
      const existing = q.userByEmail.get(email);
      if (existing) {
        if (mailer) {
          // Don't reveal who has an account: answer exactly as for a new
          // one, and tell the real owner instead.
          await sendMail(
            req,
            email,
            "Someone tried to sign up with your email",
            `Hi,\n\nsomeone (hopefully you) tried to create a Binderwyrm account with this address, but you already have one.\n\nSign in at ${publicUrl}/ — or use "Forgot password" there if you've lost it.\n\n— Binderwyrm`
          );
          return json(res, 200, { ok: true, verify: true }), true;
        }
        return json(res, 409, { error: "An account with that email already exists." }), true;
      }
      const hash = await hashPassword(password);
      const verified = mailer ? 0 : 1;
      const info = q.insertUser.run(email, hash, verified, Date.now());
      const user = q.userById.get(Number(info.lastInsertRowid));
      if (mailer) {
        await sendVerification(req, user);
        return json(res, 200, { ok: true, verify: true }), true;
      }
      // No email configured: the account is ready — sign straight in.
      const token = startSession(res, user.id, !!b.app, req);
      return json(res, 200, { ok: true, verify: false, user: publicUser(user), ...(b.app ? { token } : {}) }), true;
    }

    // Moving an old PIN profile into an account: prove the PIN once, choose an
    // email and password, and the profile's vault becomes the account's. The
    // profile's name becomes the account's handle, so its /w/ and /v/ links
    // keep working. Works even when sign-ups are closed — it's an existing
    // user arriving, not a new one. The profile file is left as a backup.
    if (p === "/api/auth/claim" && method === "POST") {
      if (!legacy || !claimOpen) return json(res, 404, { error: "Not found" }), true;
      const b = await body(req, res);
      if (!b) return true;
      const profile = String(b.profile || "").trim().toLowerCase();
      const email = normalizeEmail(b.email);
      const password = String(b.password || "");
      if (!email) return json(res, 400, { error: "That doesn't look like an email address." }), true;
      if (password.length < MIN_PASSWORD) return json(res, 400, { error: `Use at least ${MIN_PASSWORD} characters for the password.` }), true;
      if (password.length > MAX_PASSWORD) return json(res, 400, { error: "That password is too long." }), true;
      const key = `claim:${profile}`;
      if (throttled(req, res, key)) return true;
      const rec = q.claimOf.get(profile) ? null : legacy.read(profile);
      // One answer for "no such profile", "already claimed" and "wrong PIN",
      // so this can't be used to find out who has what.
      if (!rec || !legacy.pinMatches(rec, String(b.pin || ""))) {
        guard.fail(clientKey(req), key);
        return json(res, 403, { error: "That profile name and PIN don't match an unclaimed profile." }), true;
      }
      guard.succeed(clientKey(req), key);
      if (q.userByEmail.get(email)) return json(res, 409, { error: "An account with that email already exists. Use a different address." }), true;
      const hash = await hashPassword(password);
      // Re-check after the (slow) hash: nothing below awaits, so this is atomic.
      if (q.claimOf.get(profile) || q.userByEmail.get(email)) return json(res, 409, { error: "That profile was just claimed." }), true;
      const handle = q.userByHandle.get(profile) ? null : profile;
      const verified = mailer ? 0 : 1;
      const now = Date.now();
      let user;
      db.exec("BEGIN");
      try {
        const info = q.insertClaimedUser.run(email, hash, verified, now, rec.value == null ? null : String(rec.value), now, handle);
        q.insertClaim.run(profile, Number(info.lastInsertRowid), now);
        db.exec("COMMIT");
        user = q.userById.get(Number(info.lastInsertRowid));
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch (e2) {}
        throw e;
      }
      log.log(`[binderwyrm] profile "${profile}" claimed by ${email}`);
      if (mailer) {
        await sendVerification(req, user);
        return json(res, 200, { ok: true, verify: true }), true;
      }
      const token = startSession(res, user.id, !!b.app, req);
      return json(res, 200, { ok: true, verify: false, user: publicUser(user), ...(b.app ? { token } : {}) }), true;
    }

    if (p === "/api/auth/login" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      const email = normalizeEmail(b.email) || "";
      const user = email ? q.userByEmail.get(email) : null;
      // A locked account isn't even checked against the password, so the
      // lock can't be used to test guesses. Only the admin can open it again.
      if (user && user.locked) {
        return json(res, 423, { error: "locked", message: "This account is locked after too many wrong passwords. Ask the server's admin to unlock it or send you a reset link.", ...(contact ? { contact } : {}) }), true;
      }
      const key = `login:${email}`;
      // Wrong guesses are also counted per client across ALL emails, so one
      // address can't walk a list of accounts (each guess costs a 32 MiB hash).
      if (throttled(req, res, key) || throttled(req, res, "ip:login")) return true;
      const ok = await checkPassword(String(b.password || ""), user ? user.pw_hash : dummyHash);
      if (!user || !ok) {
        guard.fail(clientKey(req), key);
        guard.fail(clientKey(req), "ip:login");
        if (user && countWrong(user)) return lockedReply(res, "Too many wrong passwords — this account is now locked. Ask the server's admin to unlock it or send you a reset link."), true;
        return json(res, 401, { error: "Wrong email or password." }), true;
      }
      guard.succeed(clientKey(req), key);
      guard.succeed(clientKey(req), "ip:login");
      // With two-factor on, the count only resets after the code too — otherwise
      // the right password would wipe the wrong-code count and codes could be
      // guessed forever.
      if (user.fails && !user.mfa_secret) q.setFails.run(0, null, user.id);
      if (!user.verified) return json(res, 403, { error: "unverified" }), true;
      if (user.mfa_secret) return json(res, 200, { mfaRequired: true, ticket: issueTicket(user.id, !!b.app) }), true;
      const token = startSession(res, user.id, !!b.app, req);
      return json(res, 200, { user: publicUser(user), ...(b.app ? { token } : {}) }), true;
    }

    // Second step of a sign-in with two-factor on.
    if (p === "/api/auth/mfa/login" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      const th = sha256(String(b.ticket || ""));
      const tk = tickets.get(th);
      if (!tk || tk.expires < Date.now()) return json(res, 401, { error: "expired", message: "That sign-in took too long. Enter your password again." }), true;
      const user = q.userById.get(tk.userId);
      if (!user || !user.mfa_secret) return tickets.delete(th), json(res, 401, { error: "expired", message: "Enter your password again." }), true;
      if (user.locked) return lockedReply(res, "This account is locked. Ask the server's admin to unlock it."), true;
      const key = `mfa:${user.id}`;
      if (throttled(req, res, key)) return true;
      if (!checkSecondFactor(user, b.code)) {
        guard.fail(clientKey(req), key);
        tk.tries += 1;
        if (countWrong(user)) {
          tickets.delete(th);
          return lockedReply(res, "Too many wrong codes — this account is now locked. Ask the server's admin to unlock it or send you a reset link."), true;
        }
        if (tk.tries >= 5) {
          tickets.delete(th);
          return json(res, 401, { error: "expired", message: "Too many wrong codes. Enter your password again." }), true;
        }
        return json(res, 401, { error: "Wrong code." }), true;
      }
      guard.succeed(clientKey(req), key);
      tickets.delete(th);
      if (user.fails) q.setFails.run(0, null, user.id);
      const token = startSession(res, user.id, tk.app, req);
      return json(res, 200, { user: publicUser(q.userById.get(user.id)), ...(tk.app ? { token } : {}) }), true;
    }

    if (p === "/api/auth/resend" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      const email = normalizeEmail(b.email);
      const user = email ? q.userByEmail.get(email) : null;
      if (user && !user.verified) await sendVerification(req, user);
      return json(res, 200, { ok: true }), true;
    }

    if (p === "/api/auth/forgot" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      const email = normalizeEmail(b.email);
      const user = email ? q.userByEmail.get(email) : null;
      // A locked account is the admin's to open: no self-service link.
      if (user && !user.locked) {
        const t = issueToken(user.id, "reset", RESET_MINUTES * 60 * 1000);
        const sent = await sendMail(
          req,
          user.email,
          "Reset your Binderwyrm password",
          `Hi,\n\nsomeone asked to reset the password for this Binderwyrm account. If it was you, choose a new one here:\n\n${publicUrl}/?reset=${t}\n\nThe link works for ${RESET_MINUTES} minutes and only once. If it wasn't you, ignore this email — your password hasn't changed.\n\n— Binderwyrm`
        );
        if (!sent && !mailer) log.warn(`[binderwyrm] password reset asked for ${user.email}, but SMTP isn't configured. Reset it with: node auth-accounts.cjs reset-password ${user.email}`);
      }
      // Same answer either way: this must not reveal who has an account.
      return json(res, 200, { ok: true }), true;
    }

    if (p === "/api/auth/reset" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      const password = String(b.password || "");
      if (password.length < MIN_PASSWORD) return json(res, 400, { error: `Use at least ${MIN_PASSWORD} characters for the password.` }), true;
      if (password.length > MAX_PASSWORD) return json(res, 400, { error: "That password is too long." }), true;
      const row = takeToken(b.token, "reset");
      if (!row) return json(res, 400, { error: "That reset link has expired or was already used. Ask for a new one." }), true;
      q.setPassword.run(await hashPassword(password), row.user_id);
      // Getting the email proves control of the address.
      q.setVerified.run(row.user_id);
      q.unlock.run(row.user_id); // only an admin-sent link can exist for a locked account
      q.deleteAllSessions.run(row.user_id);
      return json(res, 200, { ok: true }), true;
    }

    // Everything below needs a signed-in user.
    if (!who) return json(res, 401, { error: "Not signed in" }), true;
    const me = who.user;

    if (p === "/api/auth/me" && method === "GET") return json(res, 200, { user: publicUser(me) }), true;

    // Life Counter results, server-wide. Any signed-in account may add finished
    // games and read the lot; names are whatever was typed at the table.
    if (isLife && method === "GET") {
      const rows = lifeGames.recent.all(LIFE_SERVED);
      const games = rows.map((r) => {
        try {
          return { id: r.id, at: r.at, ...JSON.parse(r.data) };
        } catch (e) {
          return null;
        }
      });
      return json(res, 200, { games: games.filter(Boolean) }), true;
    }
    if (isLife && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      const list = Array.isArray(b.games) ? b.games.slice(0, 50) : [];
      let stored = 0;
      for (const g of list) {
        const clean = cleanLifeGame(g);
        if (!clean) continue;
        const r = lifeGames.insert.run(clean.id, me.id, clean.at, JSON.stringify({ format: clean.format, winnerName: clean.winnerName, seats: clean.seats }));
        stored += r.changes;
      }
      if (stored) lifeGames.trim.run(LIFE_KEPT);
      return json(res, 200, { ok: true, stored }), true;
    }

    // The names on this server that share something (playgroup). Signed-in
    // users only: it's a list of people.
    if (isProfiles && method === "GET") return json(res, 200, { profiles: publicNames() }), true;

    // Set or clear the public handle. With none, nothing of this account is
    // reachable without signing in.
    if (p === "/api/auth/handle" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      const h = String(b.handle == null ? "" : b.handle).trim().toLowerCase();
      if (h) {
        if (!HANDLE_RE.test(h)) return json(res, 400, { error: "Handles use lowercase letters, numbers, - and _, up to 24 characters." }), true;
        const taken = q.userByHandle.get(h);
        if ((taken && taken.id !== me.id) || (legacy && !q.claimOf.get(h) && legacy.read(h))) {
          return json(res, 409, { error: "That handle is taken." }), true;
        }
      }
      q.setHandle.run(h || null, me.id);
      return json(res, 200, { ok: true, user: publicUser(q.userById.get(me.id)) }), true;
    }

    // The signed-in devices of this account (browsers and phone apps), and
    // signing them out one by one. The id is the stored hash of the session
    // token — useless as a credential, only a handle to pick one.
    if (p === "/api/auth/sessions" && method === "GET") {
      const list = q.sessionsOf.all(me.id, Date.now()).map((s) => ({
        id: s.token_hash,
        label: s.label || (s.kind === "bearer" ? "Phone app" : "Browser"),
        kind: s.kind,
        created: s.created,
        lastSeen: s.last_seen,
        current: s.token_hash === who.session.token_hash,
      }));
      return json(res, 200, { sessions: list }), true;
    }
    if (p === "/api/auth/sessions/others" && method === "POST") {
      const n = q.deleteSessionsExcept.run(me.id, who.session.token_hash).changes;
      return json(res, 200, { ok: true, signedOut: n }), true;
    }
    const sm = p.match(/^\/api\/auth\/sessions\/([0-9a-f]{64})$/);
    if (sm && method === "DELETE") {
      if (sm[1] === who.session.token_hash) return json(res, 400, { error: "That's this device — use Sign out." }), true;
      const done = q.deleteSessionOf.run(sm[1], me.id).changes;
      return json(res, done ? 200 : 404, done ? { ok: true } : { error: "No such device." }), true;
    }

    if (p === "/api/auth/logout" && method === "POST") {
      q.deleteSession.run(who.session.token_hash);
      if (who.via === "cookie") res.setHeader("Set-Cookie", cookieHeader("", 0));
      return json(res, 200, { ok: true }), true;
    }

    if (p === "/api/auth/password" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      const key = `password:${me.id}`;
      if (throttled(req, res, key)) return true;
      if (!(await checkPassword(String(b.current || ""), me.pw_hash))) {
        guard.fail(clientKey(req), key);
        return json(res, 403, { error: "The current password is wrong." }), true;
      }
      guard.succeed(clientKey(req), key);
      const next = String(b.next || "");
      if (next.length < MIN_PASSWORD) return json(res, 400, { error: `Use at least ${MIN_PASSWORD} characters for the password.` }), true;
      if (next.length > MAX_PASSWORD) return json(res, 400, { error: "That password is too long." }), true;
      q.setPassword.run(await hashPassword(next), me.id);
      q.deleteSessionsExcept.run(me.id, who.session.token_hash);
      return json(res, 200, { ok: true }), true;
    }

    // ---- two-factor: set up, turn off, new recovery codes ----
    if (p === "/api/auth/mfa/setup" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      if (me.mfa_secret) return json(res, 409, { error: "Two-factor is already on." }), true;
      const key = `password:${me.id}`;
      if (throttled(req, res, key)) return true;
      if (!(await checkPassword(String(b.password || ""), me.pw_hash))) {
        guard.fail(clientKey(req), key);
        return json(res, 403, { error: "The password is wrong." }), true;
      }
      guard.succeed(clientKey(req), key);
      const secret = totpLib.newSecret();
      q.setMfaPending.run(totpLib.seal(dataDir, secret), me.id);
      return json(res, 200, { secret: totpLib.base32(secret), uri: totpLib.otpauthUri(me.email, "Binderwyrm", secret) }), true;
    }
    if (p === "/api/auth/mfa/enable" && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      const key = `mfa:${me.id}`;
      if (throttled(req, res, key)) return true;
      const secret = me.mfa_pending ? totpLib.open(dataDir, me.mfa_pending) : null;
      if (!secret) return json(res, 409, { error: "Start the setup again." }), true;
      const step = totpLib.verify(secret, b.code, 0);
      if (!step) {
        guard.fail(clientKey(req), key);
        return json(res, 400, { error: "That code doesn't match. Check the app and try the current one." }), true;
      }
      guard.succeed(clientKey(req), key);
      const codes = totpLib.newRecoveryCodes();
      q.enableMfa.run(totpLib.seal(dataDir, secret), step, JSON.stringify(totpLib.hashRecovery(codes)), me.id);
      return json(res, 200, { ok: true, recovery: codes, user: publicUser(q.userById.get(me.id)) }), true;
    }
    if ((p === "/api/auth/mfa/disable" || p === "/api/auth/mfa/recovery") && method === "POST") {
      const b = await body(req, res);
      if (!b) return true;
      if (!me.mfa_secret) return json(res, 409, { error: "Two-factor is not on." }), true;
      const pk = `password:${me.id}`;
      const ck = `mfa:${me.id}`;
      if (throttled(req, res, pk) || throttled(req, res, ck)) return true;
      if (!(await checkPassword(String(b.password || ""), me.pw_hash))) {
        guard.fail(clientKey(req), pk);
        return json(res, 403, { error: "The password is wrong." }), true;
      }
      if (!checkSecondFactor(me, b.code)) {
        guard.fail(clientKey(req), ck);
        return json(res, 403, { error: "That code isn't right." }), true;
      }
      guard.succeed(clientKey(req), pk);
      guard.succeed(clientKey(req), ck);
      if (p.endsWith("/disable")) {
        q.clearMfa.run(me.id);
        return json(res, 200, { ok: true, user: publicUser(q.userById.get(me.id)) }), true;
      }
      const codes = totpLib.newRecoveryCodes();
      q.setMfaRecovery.run(JSON.stringify(totpLib.hashRecovery(codes)), me.id);
      return json(res, 200, { ok: true, recovery: codes }), true;
    }

    if (p === "/api/auth/account" && method === "DELETE") {
      const b = await body(req, res);
      if (!b) return true;
      const key = `delete:${me.id}`;
      if (throttled(req, res, key)) return true;
      if (!(await checkPassword(String(b.password || ""), me.pw_hash))) {
        guard.fail(clientKey(req), key);
        return json(res, 403, { error: "The password is wrong." }), true;
      }
      // ON DELETE CASCADE takes the sessions and tokens with it; the vault
      // lives in the user row itself.
      q.deleteUser.run(me.id);
      if (who.via === "cookie") res.setHeader("Set-Cookie", cookieHeader("", 0));
      return json(res, 200, { ok: true, deleted: true }), true;
    }

    if (isStore && method === "GET") {
      const row = q.getVault.get(me.id);
      return json(res, 200, { value: row?.vault ?? null, rev: row?.rev ?? 0 }), true;
    }

    if (isStore && method === "PUT") {
      const b = await body(req, res);
      if (!b) return true;
      const value = b.value === undefined || b.value === null ? null : String(b.value);
      const base = req.headers["x-base-rev"];
      let result;
      // Same rule as the PIN edition: a device that says which revision it
      // loaded is refused if someone else has saved since.
      if (base !== undefined && base !== "") result = q.putVault.run(value, Date.now(), me.id, Number(base));
      else result = q.putVaultAnyRev.run(value, Date.now(), me.id);
      const row = q.getVault.get(me.id);
      if (!result.changes) return json(res, 409, { error: "Changed on another device", rev: row.rev }), true;
      return json(res, 200, { ok: true, rev: row.rev }), true;
    }

    return json(res, 404, { error: "Not found" }), true;
  }

  function close() {
    try {
      db.close();
    } catch (e) {}
  }

  // --- operator actions, used by the admin page (admin.cjs) ---
  const operator = {
    configure,
    hasMailer: () => !!mailer,
    mailer: () => mailer,
    stats: () => ({
      accounts: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
      unconfirmed: db.prepare("SELECT COUNT(*) AS n FROM users WHERE verified = 0").get().n,
      sessions: db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
      unclaimedProfiles: unclaimedProfiles().length,
    }),
    // Old profiles still waiting for their owner. A profile saved without a PIN
    // can be claimed by anyone who types its name — worth knowing about.
    unclaimed: () =>
      unclaimedProfiles().map((n) => {
        const rec = legacy.read(n);
        return { name: n, hasPin: !!(rec && rec.pinHash) };
      }),
    list: () =>
      db
        .prepare("SELECT id, email, handle, verified, locked, mfa_secret IS NOT NULL AS mfa, created, updated, rev, length(vault) AS size FROM users ORDER BY id")
        .all()
        .map((u) => ({ id: u.id, email: u.email, handle: u.handle || null, verified: !!u.verified, locked: !!u.locked, mfa: !!u.mfa, created: u.created, updated: u.updated || null, size: u.size || 0 })),
    confirm: (id) => q.setVerified.run(id).changes > 0,
    // Lost phone and lost recovery codes: the admin turns two-factor off for that account.
    resetMfa(id) {
      const had = !!q.userById.get(id)?.mfa_secret;
      q.clearMfa.run(id);
      q.deleteAllSessions.run(id);
      return had;
    },
    // Gives the account a throw-away password and signs it out everywhere.
    // The temporary password is returned once and stored nowhere.
    async tempPassword(id) {
      if (!q.userById.get(id)) return null;
      const temp = crypto.randomBytes(9).toString("base64url");
      q.setPassword.run(await hashPassword(temp), id);
      q.setVerified.run(id);
      q.unlock.run(id);
      guard.forgetProfile(`login:${q.userById.get(id).email}`);
      q.deleteAllSessions.run(id);
      return temp;
    },
    unlock(id) {
      const u = q.userById.get(id);
      if (u) guard.forgetProfile(`login:${u.email}`); // clear the in-memory throttle too
      return q.unlock.run(id).changes > 0;
    },
    // A one-time reset link, valid for a day. Emailed when email is set up;
    // either way it's returned so the admin can pass it on by hand.
    async resetLink(id) {
      const user = q.userById.get(id);
      if (!user) return null;
      if (!publicUrl) throw new Error("Set the public address first — reset links are built from it.");
      const t = issueToken(id, "reset", 24 * 3600 * 1000);
      const link = `${publicUrl}/?reset=${t}`;
      let emailed = false;
      if (mailer) {
        try {
          await mailer.send({
            to: user.email,
            subject: "Reset your Binderwyrm password",
            text: `Hi,\n\nthe server's admin sent you a link to choose a new Binderwyrm password:\n\n${link}\n\nThe link works for 24 hours and only once. If you weren't expecting this, ignore it.\n\n— Binderwyrm`,
          });
          emailed = true;
        } catch (e) {
          log.error(`[binderwyrm] reset email to ${user.email} failed:`, e.message);
        }
      }
      return { link, emailed, email: user.email };
    },
    signOut: (id) => q.deleteAllSessions.run(id).changes,
    signOutAll: () => db.prepare("DELETE FROM sessions").run().changes,
    remove: (id) => q.deleteUser.run(id).changes > 0,
  };

  return { handle, close, db, hashPassword, vaultFor, operator };
}

module.exports = { createAccounts, hashPassword, checkPassword, normalizeEmail, parseCookies };

// ---- operator CLI ----
//   node auth-accounts.cjs reset-password someone@example.com
//   node auth-accounts.cjs verify someone@example.com
//   node auth-accounts.cjs list
// For servers without email, and for support. Uses DATA_DIR like the server.
if (require.main === module) {
  (async () => {
    const [cmd, arg] = process.argv.slice(2);
    const { DatabaseSync } = require("node:sqlite");
    const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
    const file = path.join(dataDir, "accounts.db");
    if (!fs.existsSync(file)) {
      console.error(`No accounts database at ${file} (set DATA_DIR).`);
      process.exit(1);
    }
    const db = new DatabaseSync(file);
    const email = normalizeEmail(arg);
    if (cmd === "list") {
      for (const u of db.prepare("SELECT id, email, verified, locked, created, rev, handle FROM users ORDER BY id").all())
        console.log(`${u.id}\t${u.email}\t${u.handle || "-"}\t${u.verified ? "confirmed" : "unconfirmed"}${u.locked ? "\tLOCKED" : ""}\trev ${u.rev}\t${new Date(u.created).toISOString()}`);
    } else if (cmd === "verify" && email) {
      const r = db.prepare("UPDATE users SET verified = 1 WHERE email = ?").run(email);
      console.log(r.changes ? `Confirmed ${email}.` : `No account ${email}.`);
    } else if (cmd === "unlock" && email) {
      const r = db.prepare("UPDATE users SET locked = 0, fails = 0, fail_since = NULL WHERE email = ?").run(email);
      console.log(r.changes ? `Unlocked ${email}.` : `No account ${email}.`);
    } else if (cmd === "reset-mfa" && email) {
      const r = db.prepare("UPDATE users SET mfa_secret = NULL, mfa_pending = NULL, mfa_step = 0, mfa_recovery = NULL WHERE email = ?").run(email);
      if (r.changes) db.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email);
      console.log(r.changes ? `Two-factor turned off for ${email}; signed out everywhere.` : `No account ${email}.`);
    } else if (cmd === "reset-password" && email) {
      const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (!user) {
        console.error(`No account ${email}.`);
        process.exit(1);
      }
      const temp = crypto.randomBytes(9).toString("base64url");
      db.prepare("UPDATE users SET pw_hash = ?, verified = 1, locked = 0, fails = 0, fail_since = NULL WHERE id = ?").run(await hashPassword(temp), user.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      console.log(`Temporary password for ${email}: ${temp}\nSigned out everywhere. Ask them to change it in Settings → Account.`);
    } else {
      console.log("Usage: node auth-accounts.cjs list | verify <email> | unlock <email> | reset-mfa <email> | reset-password <email>");
      process.exit(cmd ? 1 : 0);
    }
    db.close();
  })();
}
