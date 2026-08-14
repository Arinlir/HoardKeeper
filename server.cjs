/*
 * HoardKeeper server — static hosting + per-profile storage.
 *
 * Zero dependencies: plain Node http. Profiles are JSON files under DATA_DIR,
 * each holding a PIN hash and the profile's collection blob. This is
 * friend-tier access control, not hardened auth: PINs travel as headers
 * (put TLS in front — Zoraxy does this) and there's no rate limiting.
 * Good enough for a trusted circle; not for the open internet.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8420;
const DIST = path.join(__dirname, "dist");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PROFILES = path.join(DATA_DIR, "profiles");

fs.mkdirSync(PROFILES, { recursive: true });

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

const hash = (pin) => crypto.createHash("sha256").update(String(pin || "")).digest("hex");
const safeName = (n) => /^[a-z0-9_-]{1,24}$/.test(n);
const profilePath = (n) => path.join(PROFILES, `${n}.json`);

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
  // GET /api/health
  if (url.pathname === "/api/health") return json(res, 200, { ok: true, mode: "pin" });

  // GET /api/profiles → names only, never pins
  if (url.pathname === "/api/profiles" && req.method === "GET") {
    const names = fs
      .readdirSync(PROFILES)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .sort();
    return json(res, 200, { profiles: names });
  }

  // /api/store/:name
  const m = url.pathname.match(/^\/api\/store\/([^/]+)$/);
  if (m) {
    const name = m[1].toLowerCase();
    if (!safeName(name))
      return json(res, 400, { error: "Profile names: 1-24 chars, a-z 0-9 - _" });
    const file = profilePath(name);
    const pin = req.headers["x-pin"] || "";

    if (req.method === "GET") {
      if (!fs.existsSync(file)) return json(res, 404, { error: "No such profile" });
      const rec = JSON.parse(fs.readFileSync(file, "utf8"));
      if (rec.pinHash && rec.pinHash !== hash(pin))
        return json(res, 403, { error: "Wrong PIN" });
      return json(res, 200, { value: rec.value || null });
    }

    if (req.method === "PUT") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return json(res, 400, { error: "Bad JSON" });
      }
      const exists = fs.existsSync(file);
      if (exists) {
        const rec = JSON.parse(fs.readFileSync(file, "utf8"));
        if (rec.pinHash && rec.pinHash !== hash(pin))
          return json(res, 403, { error: "Wrong PIN" });
        rec.value = body.value;
        rec.updated = Date.now();
        // atomic-ish write
        fs.writeFileSync(file + ".tmp", JSON.stringify(rec));
        fs.renameSync(file + ".tmp", file);
        return json(res, 200, { ok: true });
      }
      // create: the first PUT sets the PIN (may be empty for none)
      const rec = {
        pinHash: body.pin ? hash(body.pin) : "",
        value: body.value ?? null,
        created: Date.now(),
        updated: Date.now(),
      };
      fs.writeFileSync(file + ".tmp", JSON.stringify(rec));
      fs.renameSync(file + ".tmp", file);
      return json(res, 201, { ok: true, created: true });
    }

    // DELETE /api/store/:name — remove a profile entirely, authenticated
    // with its own current PIN (or no header at all if it has none set).
    if (req.method === "DELETE") {
      if (!fs.existsSync(file)) return json(res, 404, { error: "No such profile" });
      const rec = JSON.parse(fs.readFileSync(file, "utf8"));
      if (rec.pinHash && rec.pinHash !== hash(pin))
        return json(res, 403, { error: "Wrong PIN" });
      fs.unlinkSync(file);
      return json(res, 200, { ok: true, deleted: true });
    }
  }

  // PUT /api/store/:name/pin — change a profile's PIN. Authenticated with
  // the CURRENT pin via the x-pin header; the new one travels in the body
  // so it never lands in a URL or a proxy's access log.
  const pm = url.pathname.match(/^\/api\/store\/([^/]+)\/pin$/);
  if (pm && req.method === "PUT") {
    const name = pm[1].toLowerCase();
    if (!safeName(name))
      return json(res, 400, { error: "Profile names: 1-24 chars, a-z 0-9 - _" });
    const file = profilePath(name);
    if (!fs.existsSync(file)) return json(res, 404, { error: "No such profile" });
    const rec = JSON.parse(fs.readFileSync(file, "utf8"));
    const currentPin = req.headers["x-pin"] || "";
    if (rec.pinHash && rec.pinHash !== hash(currentPin))
      return json(res, 403, { error: "Current PIN is wrong" });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return json(res, 400, { error: "Bad JSON" });
    }
    rec.pinHash = body.newPin ? hash(body.newPin) : "";
    rec.updated = Date.now();
    fs.writeFileSync(file + ".tmp", JSON.stringify(rec));
    fs.renameSync(file + ".tmp", file);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found" });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(DIST, "index.html"), (err2, html) => {
        if (err2) {
          res.writeHead(404);
          return res.end("Build missing — run npm run build first.");
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
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

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) {
      console.error(`[hoardkeeper] ${req.method} ${url.pathname} failed:`, e.code || "", e.message);
      return json(res, 500, {
        error: e.code === "EACCES" || e.code === "EPERM"
          ? "The server can't write to its data folder — check the volume permissions."
          : "Server error",
      });
    }
  })
  .listen(PORT, () => {
    console.log(`HoardKeeper serving on :${PORT}, data in ${DATA_DIR}`);
  });
