import React, { useState } from "react";
import { Check } from "lucide-react";
import { C, STOCK_BG, ROOT_BG, NOTCH, NOTCH_SM } from "../../lib/tokens";

export async function authPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hk-app": "1" },
    credentials: "same-origin",
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

export function AuthGate({ onSignedIn, registrationOpen }) {
  // signin | register | forgot | reset | sent | verify-needed
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get("reset");
  const verifiedFlag = params.get("verified");

  const [view, setView] = useState(resetToken ? "reset" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState(
    verifiedFlag === "1"
      ? "Email confirmed — you can sign in now."
      : verifiedFlag === "0"
      ? "That confirmation link has expired. Sign in and we'll send a new one."
      : ""
  );

  function clearQuery() {
    window.history.replaceState({}, "", window.location.pathname);
  }

  async function signIn() {
    setBusy(true);
    setError("");
    const { ok, status, data } = await authPost("/api/auth/login", { email, password });
    setBusy(false);
    if (ok) {
      clearQuery();
      return onSignedIn(data.user);
    }
    if (status === 403 && data.error === "unverified") {
      setView("verify-needed");
      return;
    }
    setError(data.error || "Couldn't sign in.");
  }

  async function register() {
    if (password !== password2) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    const { ok, data } = await authPost("/api/auth/register", { email, password });
    setBusy(false);
    if (!ok) return setError(data.error || "Couldn't create the account.");
    setNote("");
    setView("sent");
  }

  async function forgot() {
    setBusy(true);
    setError("");
    await authPost("/api/auth/forgot", { email });
    setBusy(false);
    setView("sent-reset");
  }

  async function doReset() {
    if (password !== password2) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    const { ok, data } = await authPost("/api/auth/reset", { token: resetToken, password });
    setBusy(false);
    if (!ok) return setError(data.error || "Couldn't reset the password.");
    clearQuery();
    setPassword("");
    setPassword2("");
    setNote("Password changed — sign in with it now.");
    setView("signin");
  }

  async function resend() {
    setBusy(true);
    await authPost("/api/auth/resend", { email });
    setBusy(false);
    setNote("If that address needs confirming, a new link is on its way.");
  }

  const input = {
    width: "100%",
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 0,
    clipPath: NOTCH_SM,
    padding: "11px 12px",
    color: C.parchment,
    fontSize: 14,
    marginBottom: 10,
  };
  const primary = {
    width: "100%",
    background: STOCK_BG,
    color: C.stockInk,
    border: "none",
    borderRadius: 0,
    clipPath: NOTCH,
    padding: "12px",
    fontWeight: 700,
    fontSize: 14.5,
    cursor: busy ? "default" : "pointer",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16), 0 4px 14px -8px rgba(0,0,0,0.7)",
    opacity: busy ? 0.7 : 1,
  };
  const link = {
    background: "none",
    border: "none",
    color: C.parchmentDim,
    fontSize: 12.5,
    cursor: "pointer",
    textDecoration: "underline",
    padding: 4,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: ROOT_BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Archivo', sans-serif",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: C.bgPanel,
          border: `1px solid ${C.border}`,
          borderRadius: 3,
          padding: 28,
          position: "relative",
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.8)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, marginBottom: 6 }}>
          <div aria-hidden="true" style={{ width: 18, height: 18, flexShrink: 0, background: C.accent, clipPath: NOTCH_SM }} />
          <h1
            style={{
              fontFamily: "'Cinzel', serif",
              fontWeight: 700,
              fontSize: 23,
              letterSpacing: 1.5,
              margin: 0,
              textAlign: "center",
              color: C.goldBright,
            }}
          >
            HOARDKEEPER
          </h1>
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9.5,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: C.parchmentDim,
            textAlign: "center",
            marginBottom: 22,
          }}
        >
          {view === "register"
            ? "Create your vault"
            : view === "forgot"
            ? "Recover your account"
            : view === "reset"
            ? "Choose a new password"
            : "Sign in to your vault"}
        </div>

        {note && (
          <div style={{ fontSize: 12.5, color: C.greenBright, marginBottom: 12, lineHeight: 1.5 }}>
            {note}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12.5, color: C.redBright, marginBottom: 12, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {view === "signin" && (
          <>
            <input
              style={input}
              type="email"
              autoComplete="username"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              style={input}
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
            />
            <button style={primary} onClick={signIn} disabled={busy}>
              {busy ? "…" : "Sign in"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
              <button style={link} onClick={() => { setView("forgot"); setError(""); }}>
                Forgot password
              </button>
              {registrationOpen && (
                <button style={link} onClick={() => { setView("register"); setError(""); setNote(""); }}>
                  Create account
                </button>
              )}
            </div>
          </>
        )}

        {view === "register" && (
          <>
            <input
              style={input}
              type="email"
              autoComplete="username"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              style={input}
              type="password"
              autoComplete="new-password"
              placeholder="Password (10+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              style={input}
              type="password"
              autoComplete="new-password"
              placeholder="Repeat password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && register()}
            />
            <button style={primary} onClick={register} disabled={busy}>
              {busy ? "…" : "Create account"}
            </button>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: C.parchmentDim,
                marginTop: 10,
                lineHeight: 1.5,
              }}
            >
              A long phrase beats a short jumble. We'll email you a link to confirm the address.
            </div>
            <button style={{ ...link, marginTop: 8 }} onClick={() => { setView("signin"); setError(""); }}>
              ← Back to sign in
            </button>
          </>
        )}

        {view === "forgot" && (
          <>
            <input
              style={input}
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && forgot()}
            />
            <button style={primary} onClick={forgot} disabled={busy}>
              {busy ? "…" : "Send reset link"}
            </button>
            <button style={{ ...link, marginTop: 10 }} onClick={() => { setView("signin"); setError(""); }}>
              ← Back to sign in
            </button>
          </>
        )}

        {view === "reset" && (
          <>
            <input
              style={input}
              type="password"
              autoComplete="new-password"
              placeholder="New password (10+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              style={input}
              type="password"
              autoComplete="new-password"
              placeholder="Repeat new password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doReset()}
            />
            <button style={primary} onClick={doReset} disabled={busy}>
              {busy ? "…" : "Set new password"}
            </button>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: C.parchmentDim,
                marginTop: 10,
                lineHeight: 1.5,
              }}
            >
              This signs you out everywhere else.
            </div>
          </>
        )}

        {view === "sent" && (
          <div style={{ fontSize: 13.5, color: C.parchment, lineHeight: 1.6 }}>
            Check <b>{email}</b> for a confirmation link. It's valid for 24 hours.
            <div style={{ marginTop: 14 }}>
              <button style={link} onClick={() => { setView("signin"); setNote(""); }}>
                ← Back to sign in
              </button>
            </div>
          </div>
        )}

        {view === "sent-reset" && (
          <div style={{ fontSize: 13.5, color: C.parchment, lineHeight: 1.6 }}>
            If an account exists for <b>{email}</b>, a reset link is on its way. It's valid for one
            hour.
            <div style={{ marginTop: 14 }}>
              <button style={link} onClick={() => { setView("signin"); setNote(""); }}>
                ← Back to sign in
              </button>
            </div>
          </div>
        )}

        {view === "verify-needed" && (
          <div style={{ fontSize: 13.5, color: C.parchment, lineHeight: 1.6 }}>
            This account still needs its email confirmed. Check your inbox for the link.
            <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
              <button style={link} onClick={resend} disabled={busy}>
                Send another link
              </button>
              <button style={link} onClick={() => { setView("signin"); setError(""); }}>
                ← Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   PROFILE GATE — pick who's opening the vault (server mode only)
   ============================================================ */
