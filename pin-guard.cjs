/*
 * Wrong-PIN throttling for server.cjs.
 *
 * A profile's PIN is often four digits: 10,000 guesses, which an unthrottled
 * server answers in minutes. Now that a phone app in the stores can point at
 * anyone's internet-facing server, that's no longer "friend-tier" enough.
 *
 * Two limits, both counting WRONG PINs only (a right one costs nothing):
 *
 *  1. Per client + profile. The first FREE_TRIES mistakes are free — typos
 *     happen. After that each further mistake locks that client out of that
 *     profile for twice as long as the last: 30 s, 1 min, 2 min … capped at
 *     15 min. A correct PIN clears it.
 *
 *  2. Per profile, across all clients. More than PROFILE_MAX mistakes in
 *     PROFILE_WINDOW (someone spreading guesses over many addresses) locks
 *     the profile — but only against clients that have themselves got the PIN
 *     wrong recently. The owner, on an address with a clean record, still gets
 *     in; a botnet's addresses each get a single try, then join the lockout.
 *
 * While locked out, the PIN isn't even checked — otherwise the lockout would
 * still be a yes/no oracle. The answer is 429 with Retry-After.
 *
 * State is in memory: a restart forgets it, which only ever errs towards
 * letting people in, and keeps this dependency-free.
 */

const FREE_TRIES = 5;
const FIRST_LOCK_MS = 30 * 1000;
const MAX_LOCK_MS = 15 * 60 * 1000;
const CLIENT_FORGET_MS = 60 * 60 * 1000; // a clean hour wipes a client's record
const PROFILE_MAX = 30;
const PROFILE_WINDOW_MS = 60 * 60 * 1000;
// Absolute ceiling on wrong guesses at one old profile / the admin login per
// window, from ALL clients, whatever their record. The per-client limits above
// trust X-Forwarded-For when the peer looks local; if the server's port is
// reachable directly that header can be invented, giving every guess a fresh
// "client". This ceiling doesn't depend on who the client claims to be.
const HARD_MAX = 5;
// (Account logins are exempt: their ceiling is the database lock in auth-accounts.cjs,
// which no client address can dodge and which only an admin can clear.)
// Bound on tracked clients, so invented addresses can't grow memory forever.
const MAX_CLIENTS = 20000;

// Private, loopback and link-local addresses: the peer is our own reverse
// proxy (Zoraxy on the same host, Docker's bridge), not the real client.
function isLocalPeer(ip) {
  const a = String(ip || "").replace(/^::ffff:/, "");
  return (
    a === "::1" ||
    /^127\./.test(a) ||
    /^10\./.test(a) ||
    /^192\.168\./.test(a) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a) ||
    /^169\.254\./.test(a) ||
    /^f[cd][0-9a-f]{2}:/i.test(a) ||
    /^fe80:/i.test(a)
  );
}

// Who is asking. Behind a reverse proxy every request arrives from the proxy,
// so its X-Forwarded-For is used — but only when the direct peer really is a
// local proxy, and only its RIGHTMOST entry: that's the one our proxy added,
// while anything to its left came from the client and can be made up.
function clientKey(req) {
  const peer = req.socket?.remoteAddress || "";
  if (isLocalPeer(peer)) {
    const xff = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (xff.length) return xff[xff.length - 1].replace(/^::ffff:/, "");
    const real = String(req.headers["x-real-ip"] || "").trim();
    if (real) return real.replace(/^::ffff:/, "");
  }
  return peer.replace(/^::ffff:/, "");
}

function createPinGuard(opts = {}) {
  const now = opts.now || (() => Date.now());
  const hardMax = opts.hardMax || HARD_MAX;
  const clients = new Map(); // `${ip}|${profile}` → { fails, lockedUntil, lastFail }
  const profiles = new Map(); // profile → [timestamps of recent failures]

  function recentProfileFails(profile, t) {
    const list = (profiles.get(profile) || []).filter((x) => t - x < PROFILE_WINDOW_MS);
    if (list.length) profiles.set(profile, list);
    else profiles.delete(profile);
    return list;
  }

  // Before checking a PIN: null to go ahead, or the seconds to wait.
  function blocked(ip, profile) {
    const t = now();
    if (!profile.startsWith("ip:") && !profile.startsWith("login:") && !profile.startsWith("mfa:") && recentProfileFails(profile, t).length >= hardMax) {
      const pf0 = recentProfileFails(profile, t);
      return Math.max(1, Math.ceil((pf0[pf0.length - hardMax] + PROFILE_WINDOW_MS - t) / 1000));
    }
    const c = clients.get(`${ip}|${profile}`);
    if (c && t - c.lastFail > CLIENT_FORGET_MS) clients.delete(`${ip}|${profile}`);
    const rec = clients.get(`${ip}|${profile}`);
    if (rec && rec.lockedUntil > t) return Math.ceil((rec.lockedUntil - t) / 1000);
    const pf = recentProfileFails(profile, t);
    if (pf.length >= PROFILE_MAX && rec && rec.fails > 0) {
      const oldest = pf[pf.length - PROFILE_MAX];
      return Math.max(1, Math.ceil((oldest + PROFILE_WINDOW_MS - t) / 1000));
    }
    return null;
  }

  function fail(ip, profile) {
    const t = now();
    const key = `${ip}|${profile}`;
    if (!clients.has(key) && clients.size >= MAX_CLIENTS) {
      for (const k of clients.keys()) {
        clients.delete(k); // oldest first
        break;
      }
    }
    const rec = clients.get(key) || { fails: 0, lockedUntil: 0, lastFail: 0 };
    rec.fails += 1;
    rec.lastFail = t;
    if (rec.fails > FREE_TRIES) {
      const n = rec.fails - FREE_TRIES - 1;
      rec.lockedUntil = t + Math.min(MAX_LOCK_MS, FIRST_LOCK_MS * 2 ** n);
    }
    clients.set(key, rec);
    const pf = recentProfileFails(profile, t);
    pf.push(t);
    profiles.set(profile, pf);
  }

  function succeed(ip, profile) {
    clients.delete(`${ip}|${profile}`);
  }

  // Forget everything about a profile (deleted or renamed away).
  function forgetProfile(profile) {
    profiles.delete(profile);
    for (const k of clients.keys()) if (k.endsWith(`|${profile}`)) clients.delete(k);
  }

  // Drop stale entries now and then, so a long-running server doesn't
  // accumulate a record of every address that ever mistyped.
  function sweep() {
    const t = now();
    for (const [k, v] of clients) if (t - v.lastFail > CLIENT_FORGET_MS && v.lockedUntil <= t) clients.delete(k);
    for (const p of [...profiles.keys()]) recentProfileFails(p, t);
  }

  return { blocked, fail, succeed, forgetProfile, sweep, size: () => clients.size + profiles.size };
}

module.exports = { createPinGuard, clientKey, isLocalPeer, FREE_TRIES, FIRST_LOCK_MS, MAX_LOCK_MS, PROFILE_MAX, HARD_MAX };
