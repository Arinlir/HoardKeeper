import React, { useState } from "react";
import { Check } from "lucide-react";
import { C, STOCK_BG, ROOT_BG, NOTCH, NOTCH_SM } from "../../lib/tokens";
import { apiUrl, apiCredentials, authHeaders, isNativeApp, setAuthToken } from "../../lib/platform";

export async function authPost(path, body) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hk-app": "1", ...authHeaders() },
    credentials: apiCredentials(),
    // `app: true` asks for a sign-in token instead of a cookie (phone app).
    body: JSON.stringify({ ...(body || {}), ...(isNativeApp() ? { app: true } : {}) }),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {}
  if (res.ok && data && data.token) setAuthToken(data.token);
  return { ok: res.ok, status: res.status, data };
}

// The admin's contact line (Settings → Contact line on the admin page): an
// email address or a web link becomes a link, anything else stays plain text.
export function ContactLine({ contact, lead = "Need help?" }) {
  const text = String(contact || "").trim();
  if (!text) return null;
  const isMail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text);
  const isUrl = /^https?:\/\/\S+$/i.test(text);
  return (
    <div data-testid="contact-line" style={{ marginTop: 16, fontSize: 12, color: C.parchmentDim, textAlign: "center", lineHeight: 1.5, overflowWrap: "anywhere" }}>
      {lead}{" "}
      {isMail || isUrl ? (
        <a href={isMail ? `mailto:${text}` : text} target={isUrl ? "_blank" : undefined} rel="noreferrer" style={{ color: C.accent }}>
          {text}
        </a>
      ) : (
        <span style={{ color: C.parchment }}>{text}</span>
      )}
    </div>
  );
}

export function AuthGate({ onSignedIn, registrationOpen, claimAvailable, contact = "" }) {
  // signin | register | claim | forgot | reset | sent | verify-needed
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get("reset");
  const verifiedFlag = params.get("verified");

  const [view, setView] = useState(resetToken ? "reset" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [profile, setProfile] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lockedContact, setLockedContact] = useState("");
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
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
    if (ok && data.mfaRequired) {
      setTicket(data.ticket);
      setCode("");
      setView("mfa");
      return;
    }
    if (ok) {
      clearQuery();
      return onSignedIn(data.user);
    }
    if (status === 403 && data.error === "unverified") {
      setView("verify-needed");
      return;
    }
    if (status === 423) setLockedContact(data.contact || "");
    setError(data.message || data.error || "Couldn't sign in.");
  }

  async function submitCode() {
    setBusy(true);
    setError("");
    const { ok, status, data } = await authPost("/api/auth/mfa/login", { ticket, code });
    setBusy(false);
    if (ok) {
      clearQuery();
      return onSignedIn(data.user);
    }
    if (status === 423) {
      setLockedContact(data.contact || "");
      setView("signin");
    } else if (data.error === "expired") {
      setView("signin");
      setPassword("");
    }
    setError(data.message || data.error || "Couldn't sign in.");
  }

  async function register() {
    if (password !== password2) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    const { ok, data } = await authPost("/api/auth/register", { email, password });
    setBusy(false);
    if (!ok) return setError(data.error || "Couldn't create the account.");
    // A server without email confirms accounts straight away and signs you in.
    if (data.user) return onSignedIn(data.user);
    setNote("");
    setView("sent");
  }

  // Moving an old PIN profile into an account: name + PIN prove it's yours,
  // the email and password are the new sign-in. The profile's data comes
  // with it; the old file stays on the server as a backup.
  async function claim() {
    if (password !== password2) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    const { ok, data } = await authPost("/api/auth/claim", { profile, pin, email, password });
    setBusy(false);
    if (!ok) return setError(data.error || "Couldn't claim the profile.");
    if (data.user) return onSignedIn(data.user);
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
            BINDERWYRM
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
            : view === "claim"
            ? "Move your profile to an account"
            : view === "forgot"
            ? "Recover your account"
            : view === "reset"
            ? "Choose a new password"
            : view === "mfa"
            ? "Two-factor code"
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
            {claimAvailable && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: C.parchmentDim, marginBottom: 2 }}>
                  Used a profile name and PIN before?
                </div>
                <button style={link} onClick={() => { setView("claim"); setError(""); setNote(""); }}>
                  Move it to an account
                </button>
              </div>
            )}
          </>
        )}

        {view === "claim" && (
          <>
            <input
              style={input}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Your old profile name"
              aria-label="Old profile name"
              value={profile}
              onChange={(e) => setProfile(e.target.value.toLowerCase())}
            />
            <input
              style={input}
              type="password"
              autoComplete="off"
              placeholder="Its PIN (empty if it had none)"
              aria-label="Old PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            <input
              style={input}
              type="email"
              autoComplete="username"
              placeholder="Email for the new account"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
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
              placeholder="Repeat password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && claim()}
            />
            <button style={primary} onClick={claim} disabled={busy}>
              {busy ? "…" : "Move my profile"}
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
              Your collection comes with you, and your profile name becomes your public handle so
              shared links keep working. The PIN stops being used.
            </div>
            <button style={{ ...link, marginTop: 8 }} onClick={() => { setView("signin"); setError(""); }}>
              ← Back to sign in
            </button>
          </>
        )}

        {view === "mfa" && (
          <>
            <p style={{ fontSize: 12.5, color: C.parchmentDim, lineHeight: 1.5, marginTop: 0 }}>Enter the 6-digit code from your authenticator app — or one of your recovery codes.</p>
            <input
              style={input}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Two-factor code"
              placeholder="123456"
              value={code}
              autoFocus
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCode()}
            />
            <button style={primary} onClick={submitCode} disabled={busy || !code.trim()}>
              {busy ? "…" : "Verify"}
            </button>
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
        <ContactLine contact={contact || lockedContact} lead={lockedContact || error ? "Contact the admin:" : "Need help?"} />
      </div>
    </div>
  );
}

/* ============================================================
   PROFILE GATE — pick who's opening the vault (server mode only)
   ============================================================ */
