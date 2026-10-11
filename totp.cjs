/*
 * Two-factor codes (TOTP, RFC 6238) — the 6-digit codes of an authenticator
 * app. No dependencies: HMAC-SHA1, 30 s steps, 6 digits, one step of clock
 * slack either way, and a step that was used once is never accepted again.
 *
 * Secrets are kept encrypted (AES-256-GCM) with a key in DATA_DIR/totp.key,
 * so a copy of accounts.db alone doesn't hand out everyone's second factor.
 * Recovery codes are stored only as hashes and work once.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

function base32(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[\s=-]/g, "")) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("bad base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

const stepAt = (ms) => Math.floor(ms / 1000 / STEP_SECONDS);
const totp = (secret, ms = Date.now(), digits = 6) => hotp(secret, stepAt(ms), digits);

function same(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// The step a code belongs to (within ±1 of now) and is newer than lastStep, or null.
function verify(secret, code, lastStep = 0, ms = Date.now()) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const now = stepAt(ms);
  let found = null;
  for (const s of [now - 1, now, now + 1]) if (same(hotp(secret, s), c) && s > lastStep) found = s;
  return found;
}

const newSecret = () => crypto.randomBytes(20);

function otpauthUri(account, issuer, secret) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// --- encrypted storage ---
const keys = new Map();
function keyFor(dataDir) {
  if (keys.has(dataDir)) return keys.get(dataDir);
  const file = path.join(dataDir, "totp.key");
  let key = null;
  try {
    key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  } catch (e) {}
  if (!key || key.length !== 32) {
    key = crypto.randomBytes(32);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, key.toString("hex"), { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch (e) {}
  }
  keys.set(dataDir, key);
  return key;
}

function seal(dataDir, buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFor(dataDir), iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

function open(dataDir, text) {
  try {
    const raw = Buffer.from(String(text), "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", keyFor(dataDir), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
  } catch (e) {
    return null; // wrong key or damaged — treated as "can't verify", never as a pass
  }
}

// --- recovery codes ---
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const normRecovery = (s) => String(s || "").toLowerCase().replace(/[^a-z2-7]/g, "");
function newRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const s = base32(crypto.randomBytes(7)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
const hashRecovery = (codes) => codes.map((c) => sha(normRecovery(c)));
// Returns the remaining hashes if the code was one of them, else null.
function useRecovery(hashes, code) {
  const n = normRecovery(code);
  if (n.length !== 10) return null;
  const h = sha(n);
  const i = hashes.findIndex((x) => same(x, h));
  if (i < 0) return null;
  return hashes.filter((_, j) => j !== i);
}

module.exports = { base32, unbase32, hotp, totp, verify, stepAt, newSecret, otpauthUri, seal, open, newRecoveryCodes, hashRecovery, useRecovery };
