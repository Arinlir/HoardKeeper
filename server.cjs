/*
 * Binderwyrm server — static hosting + email accounts.
 *
 * Zero dependencies: plain Node http. Sign-in is email + password with one
 * private vault per account, in SQLite (auth-accounts.cjs). The old PIN
 * profiles (DATA_DIR/profiles/*.json) no longer sign anyone in; they're read
 * only so their owners can claim them into an account (legacy-profiles.cjs).
 * Put TLS in front — Zoraxy does this.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { publicWishlistPayload } = require("./public-wishlist.cjs");
const { publicVaultPayload } = require("./public-vault.cjs");
const { createCardDb, handleCardsApi } = require("./cards-db.cjs");
const { createPinGuard, clientKey } = require("./pin-guard.cjs");
const { createAccounts } = require("./auth-accounts.cjs");
const { createLegacyProfiles } = require("./legacy-profiles.cjs");
const { createMailerFromEnv } = require("./mailer.cjs");
const { createSettings } = require("./settings.cjs");
const { createAdmin } = require("./admin.cjs");

const PORT = process.env.PORT || 8420;
const DIST = path.join(__dirname, "dist");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

// Settings come from the environment, overridden by whatever was saved on the
// admin page (DATA_DIR/config.json) — see settings.cjs. PORT and DATA_DIR stay
// environment-only: they decide where the settings themselves live.
const settings = createSettings(DATA_DIR);
const cfg = settings.effectiveEnv();

// Local copy of Scryfall's card data, refreshed daily, so scanning, searching
// and imports don't wait on api.scryfall.com. CARD_DB=off turns it off; the
// client then talks to Scryfall directly, exactly as before.
const cardDb =
  cfg.CARD_DB === "off"
    ? null
    : createCardDb({
        dir: path.join(DATA_DIR, "cards"),
        bulkIndexUrl: cfg.CARD_DB_BULK_URL || undefined,
      }).start();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

// ---- cross-origin access for the phone app ----
//
// The web app is served from this server, so it never needs CORS. The
// Android/iOS app is not: its pages come out of the app bundle, from an
// origin of its own — `https://localhost` in Capacitor's Android WebView,
// `capacitor://localhost` in its iOS one. Those two are allowed by default;
// CORS_ORIGINS (comma-separated) adds more, e.g. `http://localhost:5173` for
// `vite dev` against a real server. Anything else gets no CORS headers at
// all, which is the browser's cue to refuse the response.
//
// This is not what keeps a vault private — the sign-in is. It only decides
// which apps' JavaScript is allowed to read the answers.
const corsOrigins = (e) =>
  new Set(
    ["capacitor://localhost", "https://localhost", "ionic://localhost"].concat(
      String(e.CORS_ORIGINS || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    )
  );
let CORS_ORIGINS = corsOrigins(cfg);
const CORS_HEADERS = "Content-Type, X-Base-Rev, X-HK-App, Authorization";

// Adds the CORS headers when the request comes from an allowed app. Returns
// true when it has answered the request itself (a preflight).
function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !CORS_ORIGINS.has(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": CORS_HEADERS,
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return true;
  }
  return false;
}

// PIN profiles were removed. Say so loudly rather than quietly ignoring a
// setting someone is relying on.
if (/^pin$/i.test(process.env.AUTH_MODE || "")) {
  console.warn("[binderwyrm] AUTH_MODE=pin no longer exists: PIN profiles were replaced by email accounts. Old profiles can be claimed from the sign-in screen.");
}

// Wrong-password / wrong-PIN throttling — see pin-guard.cjs.
const pinGuard = createPinGuard();
setInterval(() => pinGuard.sweep(), 10 * 60 * 1000).unref();

const legacy = createLegacyProfiles(DATA_DIR);

// Built at startup so bad settings (e.g. SMTP without PUBLIC_URL) stop the
// server with a clear message rather than failing on the first sign-up.
const accounts = createAccounts({
  dataDir: DATA_DIR,
  json,
  readBody,
  guard: pinGuard,
  clientKey,
  env: cfg,
  mailer: createMailerFromEnv(cfg),
  legacy,
});

// The admin space (admin.cjs). Settings that can change while running are
// applied here; the rest are flagged "restart needed" on the page.
const admin = createAdmin({
  dataDir: DATA_DIR,
  settings,
  accounts,
  guard: pinGuard,
  clientKey,
  json,
  readBody,
  getCardDb: () => cardDb,
  onApply: (env) => {
    CORS_ORIGINS = corsOrigins(env);
  },
  restart: () => {
    console.log("[binderwyrm] restarting (exit 75) — a supervisor such as Docker's restart policy starts it again.");
    accounts.close();
    process.exit(75);
  },
});

// ---- hardening ----

// Sent with every response. The app is never meant to be framed (clickjacking
// on the sign-in and admin pages), and nothing it serves should be sniffed
// into another content type.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
};

// Light per-client limits for the endpoints that answer without signing in and
// cost real work (parsing a stored collection; searching the whole card
// database). Generous for a person, a wall for a script. In memory.
const hits = new Map();
function overLimit(req, bucket, max, windowMs = 60 * 1000) {
  const k = `${bucket}|${clientKey(req)}`;
  const t = Date.now();
  const list = (hits.get(k) || []).filter((x) => t - x < windowMs);
  list.push(t);
  hits.set(k, list);
  return list.length > max;
}
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 120 * 1000) hits.delete(k);
  if (hits.size > 50000) hits.clear();
}, 60 * 1000).unref();
function tooMany(res) {
  res.setHeader("Retry-After", "30");
  return json(res, 429, { error: "Too many requests. Slow down a little.", retryAfter: 30 });
}

// A bug in one request must never take the whole server (and everyone's
// session) down with it.
process.on("unhandledRejection", (e) => console.error("[binderwyrm] unhandled rejection:", e && e.message ? e.message : e));
process.on("uncaughtException", (e) => console.error("[binderwyrm] uncaught exception:", e && e.message ? e.message : e));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 12 * 1024 * 1024) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function api(req, res, url) {
  // /api/cards/* works the same in both editions.
  if (url.pathname.startsWith("/api/cards/")) {
    if (overLimit(req, "cards", 600)) return tooMany(res);
    if (!cardDb) return json(res, 503, { error: "Card database disabled", ready: false });
    await handleCardsApi(cardDb, req, res, url, { json, readBody });
    return;
  }

  // The one pair of routes that answers without signing in: a shared wishlist
  // and a read-only collection, looked up by public handle (or by the name of
  // an old profile nobody has claimed yet). They read the same vault as
  // everything else but only ever hand back what the allow-lists in
  // public-wishlist.cjs / public-vault.cjs permit — the collection, cost basis,
  // totals, decks and history never leave here. A vault that hasn't opted in
  // answers exactly like one that doesn't exist, so these can't be used to
  // enumerate who's here.
  if (url.pathname.startsWith("/api/public/") && overLimit(req, "public", 90)) return tooMany(res);
  const wl = url.pathname.match(/^\/api\/public\/wishlist\/([^/]+)$/);
  if (wl && req.method === "GET") {
    const name = wl[1].toLowerCase();
    const vault = accounts.vaultFor(name);
    if (vault === null) return json(res, 404, { error: "No such wishlist" });
    return json(res, 200, publicWishlistPayload(vault, name));
  }
  const pv = url.pathname.match(/^\/api\/public\/vault\/([^/]+)$/);
  if (pv && req.method === "GET") {
    const name = pv[1].toLowerCase();
    const vault = accounts.vaultFor(name);
    const payload = vault === null ? null : publicVaultPayload(vault, name);
    if (!payload) return json(res, 404, { error: "No such collection" });
    return json(res, 200, payload);
  }

  if (await admin.handle(req, res, url)) return;

  // Health, /api/auth/*, /api/store and /api/profiles belong to the accounts code.
  if (await accounts.handle(req, res, url)) return;
  return json(res, 404, { error: "Not found" });
}

// ---- link previews for shared pages ----
//
// A chat app that unfurls a /w/<handle> or /v/<handle> link reads the page's
// <meta> tags without running any JavaScript, so the server writes them into
// index.html for those two addresses. They carry only what the page itself
// shows to anyone — built from the same allow-listed payloads as the public
// API, and nothing at all for a handle that hasn't shared (it looks exactly
// like one that doesn't exist). Pages are marked noindex: meant for friends,
// not for search engines.
const PREVIEW_RE = /^\/([wv])\/([A-Za-z0-9_-]{1,24})\/?$/;
const previewCache = new Map(); // "w:handle" → { t, info }
const escHtml = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function previewInfo(kind, name) {
  const key = `${kind}:${name}`;
  const hit = previewCache.get(key);
  if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.info;
  let info = null;
  const vault = accounts.vaultFor(name);
  if (vault !== null) {
    const firstImage = (list) => (list.find((c) => c && c.imageUrl) || {}).imageUrl || null;
    if (kind === "w") {
      const list = publicWishlistPayload(vault, name).wishlist || [];
      const n = list.reduce((sum, c) => sum + (c.quantity || 1), 0);
      info = { title: `${name}'s wishlist`, desc: n ? `${n} card${n === 1 ? "" : "s"} ${name} is looking for.` : `${name}'s wishlist.`, image: firstImage(list) };
    } else {
      const payload = publicVaultPayload(vault, name);
      if (payload) {
        const list = payload.cards || [];
        const n = list.reduce((sum, c) => sum + (c.quantity || 1), 0);
        info = { title: `${name}'s collection`, desc: n ? `${n} card${n === 1 ? "" : "s"} in ${name}'s collection.` : `${name}'s collection.`, image: firstImage(list) };
      }
    }
  }
  if (previewCache.size > 500) previewCache.clear();
  previewCache.set(key, { t: Date.now(), info });
  return info;
}

function withPreview(html, req, p, kind, name) {
  if (overLimit(req, "public", 90)) return html; // plain page; the app still loads
  const info = previewInfo(kind, name.toLowerCase());
  if (!info) return html;
  const title = `${info.title} · Binderwyrm`;
  const base = String(settings.get("PUBLIC_URL") || "").replace(/\/+$/, "");
  const tags = [
    `<meta name="robots" content="noindex, nofollow" />`,
    `<meta property="og:site_name" content="Binderwyrm" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escHtml(title)}" />`,
    `<meta property="og:description" content="${escHtml(info.desc)}" />`,
    ...(base ? [`<meta property="og:url" content="${escHtml(base + p.replace(/\/+$/, ""))}" />`] : []),
    ...(info.image ? [`<meta property="og:image" content="${escHtml(info.image)}" />`] : []),
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escHtml(title)}" />`,
    `<meta name="twitter:description" content="${escHtml(info.desc)}" />`,
    ...(info.image ? [`<meta name="twitter:image" content="${escHtml(info.image)}" />`] : []),
  ].join("\n    ");
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escHtml(title)}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${escHtml(info.desc)}" />`)
    .replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  // The built site uses RELATIVE asset paths (vite's `base: "./"`, so it can be
  // hosted from a subfolder or a proxy path). /w/<profile> and /v/<profile>
  // are one level deeper
  // than the app itself, so a browser sitting there asks for /w/assets/… rather
  // than /assets/… . Point those back at the real asset: without this the
  // request falls through to the SPA fallback below, the browser gets HTML
  // where it asked for a module script, and the wishlist page renders blank.
  // Same for app routes more than one level deep (/decks/<id>): their relative
  // asset URLs resolve under /decks/… .
  const nested = p.match(/^\/[wv]\/(?:[^/]*\/)?(assets\/.+)$/) || p.match(/^\/(?:[^/]+\/)+((?:assets|tesseract)\/.+)$/);
  if (nested) p = `/${nested[1]}`;
  const file = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback — but only for routes. Anything with a file extension is a
      // genuine 404: answering a .js or .css request with index.html is how a
      // missing asset turns into a silent blank page instead of an error.
      if (path.extname(file)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not found");
      }
      fs.readFile(path.join(DIST, "index.html"), (err2, html) => {
        if (err2) {
          res.writeHead(404);
          return res.end("Build missing — run npm run build first.");
        }
        // Real pages get 200; an address the app has no page for still gets
        // the app (it draws the 404 page) but with an honest 404 status.
        const first = p.split("/").filter(Boolean)[0];
        const known = !first || ["sets", "decks", "wishlist", "glossary", "playgroup", "life", "collection", "admin", "w", "v"].includes(first.toLowerCase());
        res.writeHead(known ? 200 : 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        const pm = p.match(PREVIEW_RE);
        res.end(pm ? withPreview(html.toString("utf8"), req, p, pm[1], pm[2]) : html);
      });
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=86400",
    });
    res.end(data);
  });
}

const server = http
  .createServer(async (req, res) => {
    for (const [h, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(h, v);
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch (e) {
      res.writeHead(400);
      return res.end();
    }
    try {
      if (url.pathname.startsWith("/api/")) {
        if (cors(req, res)) return;
        return await api(req, res, url);
      }
      return serveStatic(req, res, url);
    } catch (e) {
      console.error(`[binderwyrm] ${req.method} ${url.pathname} failed:`, e.code || "", e.message);
      if (e && e.code === "BUSY") {
        res.setHeader("Retry-After", "5");
        return json(res, 503, { error: "The server is busy. Try again in a moment." });
      }
      return json(res, 500, {
        error: e.code === "EACCES" || e.code === "EPERM"
          ? "The server can't write to its data folder — check the volume permissions."
          : "Server error",
      });
    }
  })
  .listen(PORT, () => {
    console.log(`Binderwyrm serving on :${PORT}, data in ${DATA_DIR}`);
  });
// Slow or stalled clients must not hold connections open forever.
server.headersTimeout = 20 * 1000;
server.requestTimeout = 120 * 1000;
server.keepAliveTimeout = 15 * 1000;
