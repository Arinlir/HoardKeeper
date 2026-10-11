/*
 * Server settings that can be changed from the admin page.
 *
 * Every setting is an environment variable the server already understood
 * (REGISTRATION, PUBLIC_URL, SMTP_*, …). This file adds one more place to set
 * them: DATA_DIR/config.json. Precedence, highest first:
 *
 *     config.json  >  environment variable  >  built-in default
 *
 * A key saved as "" in config.json means "explicitly empty" (e.g. SMTP_HOST
 * blank = no email even if the environment has one). "Reset" removes the key,
 * handing control back to the environment.
 *
 * Secrets (the SMTP password) are stored here in plain text, the same as they
 * would be in docker-compose.yml, so the file is written 0600. They are never
 * returned by the API — only whether one is set.
 *
 * Zero dependencies.
 */

const fs = require("fs");
const path = require("path");

const noLines = (v, label) => {
  if (/[\r\n]/.test(v)) throw new Error(`${label} can't contain a line break.`);
  return v.trim();
};
const bool = (label) => (v) => {
  const s = v.trim().toLowerCase();
  if (s === "") return "";
  if (/^(1|true|yes|on)$/.test(s)) return "true";
  if (/^(0|false|no|off)$/.test(s)) return "false";
  throw new Error(`${label} must be on or off.`);
};
const origin = (s) => /^[a-z][a-z0-9+.-]*:\/\/[^\s/,]+$/i.test(s);

// key → { group, label, help, type, restart?, secret?, validate(value) → normalised value }
const SCHEMA = {
  REGISTRATION: {
    group: "Accounts",
    label: "New sign-ups",
    help: "Closed stops anyone new creating an account. Existing accounts are unaffected.",
    type: "choice",
    choices: ["open", "closed"],
    validate: (v) => {
      const s = v.trim().toLowerCase();
      if (s === "") return "";
      if (s === "open" || s === "closed") return s;
      throw new Error("New sign-ups must be open or closed.");
    },
  },
  CLAIM_PROFILES: {
    group: "Accounts",
    label: "Moving old PIN profiles",
    help: "Open lets owners of old profiles move them into an account. Close it once everyone has — a profile that never had a PIN can be taken by anyone who types its name.",
    type: "choice",
    choices: ["open", "closed"],
    validate: (v) => {
      const s = v.trim().toLowerCase();
      if (s === "") return "";
      if (s === "open" || s === "closed") return s;
      throw new Error("Moving old profiles must be open or closed.");
    },
  },
  CONTACT_INFO: {
    group: "Accounts",
    label: "Contact line",
    help: "Shown on the sign-in and locked-account screens so people know how to reach you — an email address, a link, or a few words (up to 200 characters).",
    type: "text",
    placeholder: "admin@example.com",
    validate: (v) => {
      const s = noLines(v, "Contact line");
      if (s.length > 200) throw new Error("Contact line is too long (200 characters at most).");
      return s;
    },
  },
  PUBLIC_URL: {
    group: "Accounts",
    label: "Public address",
    help: "Where people reach this server, e.g. https://hoard.example.com. Links in emails are built from it. Required for email.",
    type: "text",
    placeholder: "https://hoard.example.com",
    validate: (v) => {
      const s = noLines(v, "Public address").replace(/\/+$/, "");
      if (s && !/^https?:\/\/[^\s/]+(\/\S*)?$/i.test(s)) throw new Error("Public address must start with http:// or https://.");
      return s;
    },
  },
  COOKIE_SECURE: {
    group: "Accounts",
    label: "Secure cookies",
    help: "Keep on behind HTTPS. Turn off only to test over plain http on your own network — otherwise nobody can stay signed in.",
    type: "bool",
    validate: bool("Secure cookies"),
  },
  SMTP_HOST: {
    group: "Email (SMTP)",
    label: "SMTP server",
    help: "Blank = no email: accounts are confirmed immediately and password resets are done from the admin page.",
    type: "text",
    placeholder: "smtp.example.com",
    validate: (v) => {
      const s = noLines(v, "SMTP server");
      if (/[\s/:]/.test(s)) throw new Error("SMTP server is just a host name, e.g. smtp.example.com.");
      return s;
    },
  },
  SMTP_PORT: {
    group: "Email (SMTP)",
    label: "Port",
    help: "Usually 587 (STARTTLS) or 465 (TLS). Blank picks one from the “Use TLS directly” setting.",
    type: "text",
    placeholder: "587",
    validate: (v) => {
      const s = v.trim();
      if (s === "") return "";
      if (!/^\d{1,5}$/.test(s) || +s < 1 || +s > 65535) throw new Error("Port must be a number from 1 to 65535.");
      return String(+s);
    },
  },
  SMTP_SECURE: {
    group: "Email (SMTP)",
    label: "Use TLS directly",
    help: "On for port 465. Off for 587 and 25, which upgrade with STARTTLS.",
    type: "bool",
    validate: bool("Use TLS directly"),
  },
  SMTP_USER: {
    group: "Email (SMTP)",
    label: "Username",
    type: "text",
    validate: (v) => noLines(v, "Username"),
  },
  SMTP_PASS: {
    group: "Email (SMTP)",
    label: "Password",
    help: "Stored in config.json (readable only by the server's user) and never shown again.",
    type: "secret",
    secret: true,
    validate: (v) => noLines(v, "Password").length ? v.trim() : "",
  },
  SMTP_FROM: {
    group: "Email (SMTP)",
    label: "Send as",
    help: "The From address, e.g. Binderwyrm <no-reply@example.com>.",
    type: "text",
    placeholder: "Binderwyrm <no-reply@example.com>",
    validate: (v) => noLines(v, "Send as"),
  },
  SMTP_TLS_VERIFY: {
    group: "Email (SMTP)",
    label: "Check the server's certificate",
    help: "Turn off only for a mail server with a self-signed certificate.",
    type: "bool",
    validate: bool("Check the server's certificate"),
  },
  SMTP_ALLOW_INSECURE_AUTH: {
    group: "Email (SMTP)",
    label: "Allow sign-in without TLS",
    help: "Sends the SMTP password unencrypted. Only for a trusted local relay.",
    type: "bool",
    validate: bool("Allow sign-in without TLS"),
  },
  CORS_ORIGINS: {
    group: "Apps & data",
    label: "Extra allowed app origins",
    help: "Comma-separated. The phone app is always allowed; add e.g. http://localhost:5173 for development.",
    type: "text",
    validate: (v) => {
      const list = noLines(v, "App origins").split(",").map((s) => s.trim()).filter(Boolean);
      for (const o of list) if (!origin(o)) throw new Error(`“${o}” isn't an origin like https://example.com.`);
      return list.join(",");
    },
  },
  CARD_DB: {
    group: "Apps & data",
    label: "Local card database",
    help: "A daily copy of Scryfall's card data kept on this server. Off = the app talks to Scryfall directly.",
    type: "choice",
    choices: ["on", "off"],
    restart: true,
    validate: (v) => {
      const s = v.trim().toLowerCase();
      if (s === "") return "";
      if (s === "on" || s === "off") return s;
      throw new Error("Local card database must be on or off.");
    },
  },
  CARD_DB_BULK_URL: {
    group: "Apps & data",
    label: "Card data source",
    help: "Leave blank for Scryfall's own bulk-data index.",
    type: "text",
    restart: true,
    validate: (v) => {
      const s = noLines(v, "Card data source");
      if (s && !/^https:\/\/[^\s]+$/i.test(s)) throw new Error("Card data source must be an https:// address.");
      return s;
    },
  },
};

function createSettings(dataDir, env = process.env) {
  const file = path.join(dataDir, "config.json");
  let saved = {};

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const out = {};
      for (const k of Object.keys(SCHEMA)) if (raw && typeof raw.values?.[k] === "string") out[k] = raw.values[k];
      saved = out;
    } catch (e) {
      if (e.code !== "ENOENT") console.warn(`[binderwyrm] ${file} is unreadable (${e.message}) — ignoring it.`);
      saved = {};
    }
  }
  load();

  function persist(next) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ values: next }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch (e) {}
    saved = next;
  }

  // What the server runs on: the real environment with saved values laid over
  // it. An empty saved value removes the variable (rather than setting "").
  function effectiveEnv(map = saved) {
    const out = { ...env };
    for (const [k, v] of Object.entries(map)) {
      if (v === "") delete out[k];
      else out[k] = v;
    }
    return out;
  }

  function sourceOf(k) {
    if (k in saved) return "file";
    if (env[k] !== undefined && env[k] !== "") return "env";
    return "default";
  }

  // Environment values like COOKIE_SECURE=off are shown the way the page's
  // dropdowns spell them (false), so the right option is selected.
  function shown(s, raw) {
    if (s.type !== "bool" && s.type !== "choice") return raw;
    try {
      return s.validate(String(raw));
    } catch (e) {
      return raw;
    }
  }

  // What the page shows. Secrets are reported only as set / not set.
  function describe() {
    const eff = effectiveEnv();
    return Object.entries(SCHEMA).map(([key, s]) => ({
      key,
      group: s.group,
      label: s.label,
      help: s.help || "",
      type: s.type,
      choices: s.choices || null,
      placeholder: s.placeholder || "",
      restart: !!s.restart,
      source: sourceOf(key),
      set: eff[key] !== undefined && eff[key] !== "",
      value: s.secret ? null : shown(s, eff[key] ?? ""),
    }));
  }

  // Validates a whole change before saving any of it. `set` maps key → string;
  // `reset` lists keys to hand back to the environment. Returns the new saved
  // map and the keys that need a restart; throws Error with a user-facing
  // message (and saves nothing) if anything is invalid.
  function plan({ set = {}, reset = [] }) {
    const next = { ...saved };
    const restartKeys = [];
    for (const k of reset) {
      if (!SCHEMA[k]) throw new Error(`Unknown setting ${k}.`);
      if (k in next) {
        delete next[k];
        if (SCHEMA[k].restart) restartKeys.push(k);
      }
    }
    for (const [k, v] of Object.entries(set)) {
      const s = SCHEMA[k];
      if (!s) throw new Error(`Unknown setting ${k}.`);
      if (typeof v !== "string") throw new Error(`${s.label} must be text.`);
      if (v.length > 2000) throw new Error(`${s.label} is too long.`);
      const clean = s.validate(v);
      if (next[k] !== clean) {
        next[k] = clean;
        if (s.restart) restartKeys.push(k);
      }
    }
    return { next, restartKeys };
  }

  return {
    file,
    describe,
    effectiveEnv,
    plan,
    commit: persist,
    get: (k) => effectiveEnv()[k],
    keys: () => Object.keys(SCHEMA),
  };
}

module.exports = { createSettings, SCHEMA };
