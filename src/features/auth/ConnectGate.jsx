import React, { useState } from "react";
import { AlertCircle, Loader2, Server, Smartphone } from "lucide-react";
import { C, STOCK_BG, ROOT_BG, NOTCH, NOTCH_SM } from "../../lib/tokens";
import { normalizeServerUrl, privacyUrl, serverBase, setServerChoice } from "../../lib/platform";

// First screen of the phone app. The web app never shows it: a browser page
// is served by its server, so it already knows where that is. The phone app
// is installed from a store and knows nothing, so it asks — the same thing
// the Immich or Jellyfin apps do.
//
// Two ways out:
//   • a Binderwyrm server's address → checked with /api/health before it's
//     kept, then the normal sign-in takes over;
//   • "on this phone only" → the store's local mode, nothing leaves the phone.
//
// Also shown again when a saved server can't be reached at launch (`error`),
// so a phone that's offline gets a clear message and a way to retry instead
// of an empty collection it might start saving into.
export async function checkServer(url, fetchImpl = fetch) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetchImpl(`${url}/api/health`, { signal: ctl.signal });
    if (!res.ok) return `The server answered ${res.status} — is that the right address?`;
    const d = await res.json().catch(() => null);
    if (!d || d.ok !== true) return "That address answered, but it isn't a Binderwyrm server.";
    return "";
  } catch (e) {
    return e?.name === "AbortError"
      ? "No answer from that address — check it, and that the phone is online."
      : "Couldn't reach that address. If the server is new, check it allows the app (it needs a recent Binderwyrm version).";
  } finally {
    clearTimeout(t);
  }
}

export function ConnectGate({ error: initialError = "", onDone }) {
  const [url, setUrl] = useState(serverBase() || "");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function connect() {
    const normalized = normalizeServerUrl(url);
    if (!normalized) return setError("That doesn't look like a web address.");
    // The app's own pages are https://localhost (or capacitor://), and a
    // phone's WebView refuses plain-http calls from a secure page. A server
    // behind a reverse proxy with TLS (Zoraxy, Caddy, Traefik…) works.
    if (normalized.startsWith("http://"))
      return setError("The app needs an https:// address — put the server behind a reverse proxy with TLS.");
    setBusy(true);
    setError("");
    const problem = await checkServer(normalized);
    setBusy(false);
    if (problem) return setError(problem);
    setServerChoice(normalized);
    // Coming back from an unreachable server to a different one: the saved
    // profile belonged to the old server.
    try {
      localStorage.removeItem("lf-profile");
    } catch (e) {}
    onDone?.();
  }

  function localOnly() {
    setServerChoice("local");
    onDone?.();
  }

  const primary = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    background: STOCK_BG,
    color: C.stockInk,
    border: "none",
    borderRadius: 0,
    clipPath: NOTCH,
    padding: "12px 15px",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16), 0 4px 14px -8px rgba(0,0,0,0.7)",
  };

  return (
    <div
      data-testid="connect-gate"
      style={{
        minHeight: "100vh",
        background: ROOT_BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Archivo', sans-serif",
        padding: "max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))",
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: C.bgPanel,
          border: `1px solid ${C.border}`,
          borderRadius: 3,
          padding: 28,
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.8)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, marginBottom: 4 }}>
          <div aria-hidden="true" style={{ width: 18, height: 18, flexShrink: 0, background: C.accent, clipPath: NOTCH_SM }} />
          <h1
            style={{
              fontFamily: "'Cinzel', serif",
              fontWeight: 700,
              fontSize: 24,
              letterSpacing: 1.5,
              margin: 0,
              color: C.goldBright,
            }}
          >
            BINDERWYRM
          </h1>
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            letterSpacing: 2.2,
            textTransform: "uppercase",
            color: C.parchmentDim,
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          Where does your vault live?
        </div>

        <label htmlFor="bw-server-url" style={{ display: "block", fontSize: 12, color: C.parchmentDim, marginBottom: 6 }}>
          Your Binderwyrm server
        </label>
        <input
          id="bw-server-url"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="hoard.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && connect()}
          style={{
            width: "100%",
            background: C.bgPanel2,
            border: `1px solid ${C.border}`,
            borderRadius: 0,
            clipPath: NOTCH_SM,
            padding: "11px 12px",
            color: C.parchment,
            fontSize: 15,
            marginBottom: 12,
          }}
        />

        {error && (
          <div
            role="alert"
            style={{ color: C.redBright, fontSize: 12.5, lineHeight: 1.5, marginBottom: 12, display: "flex", gap: 8 }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        <button onClick={connect} disabled={busy} style={primary}>
          {busy ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Server size={16} />}
          {busy ? "Checking…" : "Connect"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0", color: C.parchmentDim, fontSize: 11 }}>
          <div style={{ flex: 1, height: 1, background: C.border }} />
          or
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>

        <button
          onClick={localOnly}
          style={{
            ...primary,
            background: "transparent",
            color: C.parchment,
            boxShadow: "none",
            border: `1px solid ${C.border}`,
          }}
        >
          <Smartphone size={16} /> Keep it on this phone only
        </button>
        <p style={{ fontSize: 11.5, color: C.parchmentDim, lineHeight: 1.5, margin: "10px 0 0" }}>
          Everything stays on the phone: no account, no sync. You can connect a server later in
          Settings.
        </p>
        <p style={{ fontSize: 11.5, margin: "16px 0 0", textAlign: "center" }}>
          <a href={privacyUrl()} target="_blank" rel="noreferrer" style={{ color: C.accent }}>
            Privacy policy
          </a>
        </p>
      </div>
    </div>
  );
}
