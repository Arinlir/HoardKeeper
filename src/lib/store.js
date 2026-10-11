import { Settings } from "lucide-react";
import { apiCredentials, apiUrl, authHeaders, setAuthToken } from "./platform";

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Storage: localStorage by default. When the app is served by server.cjs the
// boot sequence detects /api/health and switches to the signed-in account's
// server vault, so collections follow the account rather than the browser.
export const store = {
  mode: "local",
  // The server revision this device last loaded or saved (see server.cjs,
  // X-Base-Rev). null = unknown — a server that doesn't report revisions, or
  // nothing loaded yet — and then saves go out without the check, as before.
  rev: null,
  configure(mode) {
    this.mode = mode;
    this.rev = null;
  },
  // Remembers the revision a response reports, if it reports one.
  _noteRev(d) {
    this.rev = d && Number.isInteger(d.rev) ? d.rev : this.rev;
  },
  async get(key) {
    if (this.mode === "accounts") {
      const res = await fetch(apiUrl("/api/store"), {
        credentials: apiCredentials(),
        headers: { "x-hk-app": "1", ...authHeaders() },
      });
      if (res.status === 401) {
        setAuthToken(null);
        throw new Error("signed-out");
      }
      if (!res.ok) throw await storeError(res);
      const d = await res.json();
      this.rev = Number.isInteger(d?.rev) ? d.rev : null;
      return d.value === null ? null : { key, value: d.value };
    }
    const value = localStorage.getItem(key);
    return value === null ? null : { key, value };
  },
  // Resolves to { key, value } on success, null on failure, or
  // { conflict: true } when the server refused because another device has
  // saved since this one loaded — the caller must reload, not retry.
  async set(key, value) {
    const revHeader = this.rev === null ? {} : { "x-base-rev": String(this.rev) };
    if (this.mode === "accounts") {
      const res = await fetch(apiUrl("/api/store"), {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-hk-app": "1", ...authHeaders(), ...revHeader },
        credentials: apiCredentials(),
        body: JSON.stringify({ value }),
      });
      if (res.status === 409) return { conflict: true };
      if (res.ok) this._noteRev(await readJson(res));
      return res.ok ? { key, value } : null;
    }
    try {
      localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
};

// A failed load, carrying the HTTP status and the server's own message, so
// the app can tell "wrong PIN" from "locked out for a bit" from "server down".
async function storeError(res) {
  const d = await readJson(res);
  const e = new Error((d && d.error) || "store get failed");
  e.status = res.status;
  if (d && d.retryAfter) e.retryAfter = d.retryAfter;
  return e;
}

// A save's answer body is a nice-to-have (it carries the new revision), not
// something to fail the save over — tests and older servers may send none.
async function readJson(res) {
  try {
    return typeof res.json === "function" ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

// Display currency is global so every panel formats consistently.
// All figures are stored in USD; EUR and CZK are
// conversions using rates you set in Settings.
