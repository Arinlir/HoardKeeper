import React, { useState, useEffect } from "react";
import { AlertCircle, Check } from "lucide-react";
import { store } from "../../lib/store";
import { C, STOCK_BG, ROOT_BG, NOTCH, NOTCH_SM } from "../../lib/tokens";

export function ProfileGate({ onEnter }) {
  const [profiles, setProfiles] = useState([]);
  const [chosen, setChosen] = useState(null); // existing profile name
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Distinct from "no profiles yet" — a fetch failure (commonly the data
  // volume being unwritable) used to be swallowed silently, which looked
  // identical to there being no way to switch profiles at all.
  const [listError, setListError] = useState("");

  function loadProfiles() {
    setListError("");
    fetch("/api/profiles")
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `Server returned ${r.status}`);
        }
        return r.json();
      })
      .then((d) => setProfiles(d.profiles || []))
      .catch((e) =>
        setListError(
          `Couldn't load existing profiles (${e.message}). Check the server's data volume is writable.`
        )
      );
  }

  useEffect(() => {
    loadProfiles();
  }, []);

  async function enterExisting() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/store/${chosen}`, { headers: { "x-pin": pin } }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Couldn't reach the server.");
    if (res.status === 403) return setError("Wrong PIN.");
    if (!res.ok && res.status !== 404) return setError("Something went wrong.");
    onEnter(chosen, pin);
  }

  async function createProfile() {
    const n = name.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,24}$/.test(n))
      return setError("Names: 1-24 characters, letters, numbers, - or _.");
    if (profiles.includes(n)) return setError("That name is taken — pick it from the list instead.");
    setBusy(true);
    setError("");
    const res = await fetch(`/api/store/${n}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-pin": pin },
      body: JSON.stringify({ value: null, pin }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).error || "";
      } catch (e) {}
      return setError(detail || "Couldn't create the profile — is the HoardKeeper server running?");
    }
    onEnter(n, pin);
  }

  const inputS = {
    width: "100%",
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 0,
    clipPath: NOTCH_SM,
    padding: "10px 12px",
    color: C.parchment,
    fontSize: 14,
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
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: C.bgPanel,
          border: `1px solid ${C.border}`,
          borderRadius: 3,
          padding: 28,
          position: "relative",
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
            fontSize: 10,
            letterSpacing: 2.2,
            textTransform: "uppercase",
            color: C.parchmentDim,
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          Whose vault is this?
        </div>

        {!creating && !chosen && (
          <>
            {listError && (
              <div
                style={{
                  color: C.redBright,
                  fontSize: 12,
                  lineHeight: 1.5,
                  marginBottom: 12,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  {listError}{" "}
                  <button
                    onClick={loadProfiles}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.redBright,
                      textDecoration: "underline",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 12,
                    }}
                  >
                    Retry
                  </button>
                </span>
              </div>
            )}
            {profiles.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setChosen(p);
                  setError("");
                  setPin("");
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  fontFamily: "'Spectral', serif",
                  fontWeight: 600,
                  fontSize: 15,
                  background: "rgba(255,255,255,0.05)",
                  color: C.parchment,
                  border: `1px solid ${C.border}`,
                  borderRadius: 0,
                  clipPath: NOTCH_SM,
                  padding: "12px 15px",
                  marginBottom: 8,
                  cursor: "pointer",
                }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => {
                setCreating(true);
                setError("");
              }}
              style={{
                display: "block",
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
                marginTop: profiles.length ? 10 : 0,
              }}
            >
              + New profile
            </button>
          </>
        )}

        {chosen && (
          <>
            <div
              style={{
                fontFamily: "'Spectral', serif",
                fontWeight: 600,
                fontSize: 17,
                color: C.goldBright,
                marginBottom: 12,
              }}
            >
              {chosen}
            </div>
            <input
              type="password"
              inputMode="numeric"
              placeholder="PIN (leave blank if none)"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && enterExisting()}
              style={inputS}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={enterExisting}
                disabled={busy}
                style={{
                  flex: 1,
                  background: STOCK_BG,
                  color: C.stockInk,
                  border: "none",
                  borderRadius: 0,
                  clipPath: NOTCH,
                  padding: "11px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16), 0 4px 14px -8px rgba(0,0,0,0.7)",
                }}
              >
                {busy ? "…" : "Open vault"}
              </button>
              <button
                onClick={() => setChosen(null)}
                style={{
                  background: "none",
                  border: `1px solid ${C.border}`,
                  color: C.parchmentDim,
                  borderRadius: 6,
                  padding: "11px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Back
              </button>
            </div>
          </>
        )}

        {creating && (
          <>
            <input
              placeholder="Profile name (e.g. michael)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ ...inputS, marginBottom: 10 }}
              autoFocus
            />
            <input
              type="password"
              inputMode="numeric"
              placeholder="Optional PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProfile()}
              style={inputS}
            />
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: C.parchmentDim,
                margin: "8px 2px 0",
                lineHeight: 1.5,
              }}
            >
              The PIN keeps friends out of each other's vaults. It's casual protection, not real
              security — don't reuse a password.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={createProfile}
                disabled={busy}
                style={{
                  flex: 1,
                  background: STOCK_BG,
                  color: C.stockInk,
                  border: "none",
                  borderRadius: 0,
                  clipPath: NOTCH,
                  padding: "11px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16), 0 4px 14px -8px rgba(0,0,0,0.7)",
                }}
              >
                {busy ? "…" : "Create & enter"}
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setError("");
                }}
                style={{
                  background: "none",
                  border: `1px solid ${C.border}`,
                  color: C.parchmentDim,
                  borderRadius: 6,
                  padding: "11px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Back
              </button>
            </div>
          </>
        )}

        {error && (
          <div style={{ color: C.redBright, fontSize: 12.5, marginTop: 12 }}>{error}</div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   GLOSSARY — plain-language keyword guide, built from your cards
   ============================================================ */

// Definitions written in plain language. `re` is tested against oracle text
// plus type line, lowercased. Order roughly: evergreen abilities, then
// keyword actions, then common mechanics and tokens.
