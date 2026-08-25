import { Settings } from "lucide-react";

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Storage: localStorage by default. When the app is served by server.js the
// boot sequence detects /api/health and switches to per-profile server storage,
// so collections follow the profile rather than the browser.
export const store = {
  mode: "local",
  profile: null,
  pin: "",
  configure(mode, profile, pin) {
    this.mode = mode;
    this.profile = profile || null;
    this.pin = pin || "";
  },
  async get(key) {
    if (this.mode === "accounts") {
      const res = await fetch("/api/store", {
        credentials: "same-origin",
        headers: { "x-hk-app": "1" },
      });
      if (res.status === 401) throw new Error("signed-out");
      if (!res.ok) throw new Error("store get failed");
      const d = await res.json();
      return d.value === null ? null : { key, value: d.value };
    }
    if (this.mode === "server" && this.profile) {
      const res = await fetch(`/api/store/${this.profile}`, {
        headers: { "x-pin": this.pin },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("store get failed");
      const d = await res.json();
      return d.value === null ? null : { key, value: d.value };
    }
    const value = localStorage.getItem(key);
    return value === null ? null : { key, value };
  },
  async set(key, value) {
    if (this.mode === "accounts") {
      const res = await fetch("/api/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-hk-app": "1" },
        credentials: "same-origin",
        body: JSON.stringify({ value }),
      });
      return res.ok ? { key, value } : null;
    }
    if (this.mode === "server" && this.profile) {
      const res = await fetch(`/api/store/${this.profile}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-pin": this.pin },
        body: JSON.stringify({ value, pin: this.pin }),
      });
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

// Display currency is global so every panel formats consistently.
// All figures are stored in USD; EUR and CZK are
// conversions using rates you set in Settings.
