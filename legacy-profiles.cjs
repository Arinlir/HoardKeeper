/*
 * Read-only access to the old PIN profiles (DATA_DIR/profiles/<name>.json).
 *
 * PIN sign-in no longer exists. These files are kept only so their owners can
 * move them to an email account ("claim" — see auth-accounts.cjs), and so
 * links to /w/<name> and /v/<name> keep working until then. Nothing in here
 * ever writes: a claim copies the vault into the account and leaves the file
 * where it is, as a backup.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const safeName = (n) => /^[a-z0-9_-]{1,24}$/.test(String(n || ""));
const sha256 = (s) => crypto.createHash("sha256").update(String(s == null ? "" : s)).digest("hex");

function createLegacyProfiles(dataDir) {
  const dir = path.join(dataDir, "profiles");
  const file = (n) => path.join(dir, `${n}.json`);
  return {
    safeName,
    // Every profile name on disk.
    names() {
      try {
        return fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => f.slice(0, -5))
          .filter(safeName)
          .sort();
      } catch (e) {
        return [];
      }
    },
    // The parsed profile record ({ pinHash, value, rev, … }) or null.
    read(name) {
      if (!safeName(name)) return null;
      try {
        return JSON.parse(fs.readFileSync(file(name), "utf8"));
      } catch (e) {
        return null;
      }
    },
    // A profile saved without a PIN has always been open to whoever typed its name.
    pinMatches(rec, pin) {
      if (!rec || !rec.pinHash) return true;
      const a = Buffer.from(sha256(pin));
      const b = Buffer.from(String(rec.pinHash));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
  };
}

module.exports = { createLegacyProfiles, safeName };
