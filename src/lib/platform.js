// Where the app is running, and where its server is.
//
// In a browser the app is served BY its server, so every API path is
// same-origin and the base is "" — `/api/health` means exactly what it always
// has. In the Android/iOS app the page comes out of the app bundle instead
// (Capacitor), so there is no server behind "/" at all: the user picks one on
// first launch (ConnectGate), or chooses to keep everything on the phone.
//
// That choice is kept in localStorage under SERVER_KEY:
//   (missing)        native app, not set up yet → show ConnectGate
//   "local"          native app, this device only (the store's "local" mode)
//   "https://…"      native app, talks to that server
// A browser never reads it.

export const SERVER_KEY = "bw-server";

// Capacitor injects window.Capacitor into its WebView before the page's own
// scripts run, so this is answerable synchronously at import time — no need
// to import @capacitor/core just to ask.
export function isNativeApp() {
  try {
    return !!globalThis.Capacitor?.isNativePlatform?.();
  } catch (e) {
    return false;
  }
}

export function nativePlatform() {
  try {
    return isNativeApp() ? globalThis.Capacitor.getPlatform() : "web";
  } catch (e) {
    return "web";
  }
}

function readChoice() {
  try {
    return localStorage.getItem(SERVER_KEY);
  } catch (e) {
    return null;
  }
}

// "unset" | "local" | "server" — only meaningful in the native app.
export function serverChoice() {
  if (!isNativeApp()) return "server";
  const v = readChoice();
  if (!v) return "unset";
  return v === "local" ? "local" : "server";
}

// Accepts what people actually type — "hoard.arinvault.eu", a trailing
// slash, a pasted "/w/name" link — and returns "https://host[:port][/sub]"
// or "" when it isn't a usable address. http:// is kept only when typed
// explicitly (a LAN server with no TLS); the default is https.
export function normalizeServerUrl(input) {
  let s = String(input || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch (e) {
    return "";
  }
  if (!u.hostname) return "";
  // Drop the public-page suffixes someone might paste from a share link.
  let p = u.pathname.replace(/\/(w|v)\/[^/]*\/?$/, "").replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${p}`;
}

export function setServerChoice(value) {
  // A sign-in token belongs to the server that issued it.
  setAuthToken(null);
  try {
    if (value) localStorage.setItem(SERVER_KEY, value);
    else localStorage.removeItem(SERVER_KEY);
  } catch (e) {}
}

// The prefix every API call is built on. "" in a browser (same origin).
export function serverBase() {
  if (!isNativeApp()) return "";
  const v = readChoice();
  return v && v !== "local" ? v : "";
}

export function apiUrl(path) {
  return serverBase() + path;
}

// Where shareable pages (/w/<name>, /v/<name>) live. In a browser that's
// this page's own origin; in the phone app it's the server, since a
// `https://localhost/...` link would mean nothing to whoever receives it.
export function publicOrigin() {
  return serverBase() || window.location.origin;
}

// The accounts edition signs the website in with an HttpOnly cookie, which
// only ever travels same-origin. The phone app's pages aren't on the server's
// origin, and iOS blocks cookies for other sites inside apps — so the app
// signs in with a token instead (see authHeaders) and never needs cookies.
export function apiCredentials() {
  return "same-origin";
}

// The phone app's sign-in token for an accounts-edition server. Kept in the
// app's own storage; dropped when you sign out or change server.
export const TOKEN_KEY = "bw-token";

export function authToken() {
  if (!isNativeApp()) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

// Headers that sign a request in: the bearer token in the phone app, nothing
// in a browser (the cookie does it there).
export function authHeaders() {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// The privacy policy (public/privacy.html). The website links to its own copy;
// the phone app always links to the published one, since that's the policy
// the store listing points at and a bundled page would open with no way back.
export const PUBLISHED_PRIVACY_URL = "https://hoard.arinvault.eu/privacy.html";
export function privacyUrl() {
  return isNativeApp() ? PUBLISHED_PRIVACY_URL : "./privacy.html";
}
