import React, { useState } from "react";
import { Heart, Settings, Users } from "lucide-react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { CURRENCIES, convert } from "../../../lib/format";
import { store } from "../../../lib/store";
import { C, STOCK_BG, STOCK_SHADOW } from "../../../lib/tokens";

export function AccountPanel({ account }) {
  const [mode, setMode] = useState(null); // null | password | delete
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const input = {
    width: "100%",
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "9px 11px",
    color: C.parchment,
    fontSize: 13,
    marginBottom: 8,
  };
  const small = {
    background: "none",
    border: `1px solid ${C.border}`,
    color: C.parchmentDim,
    borderRadius: 6,
    padding: "8px 13px",
    fontSize: 12.5,
    cursor: "pointer",
  };

  async function signOut() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-hk-app": "1" },
      credentials: "same-origin",
    });
    window.location.reload();
  }

  async function changePassword() {
    setErr("");
    setMsg("");
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hk-app": "1" },
      credentials: "same-origin",
      body: JSON.stringify({ current, next }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Couldn't change the password.");
    setMsg("Password changed. Other devices have been signed out.");
    setCurrent("");
    setNext("");
    setMode(null);
  }

  async function deleteAccount() {
    setErr("");
    const res = await fetch("/api/auth/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-hk-app": "1" },
      credentials: "same-origin",
      body: JSON.stringify({ password: pw }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Couldn't delete the account.");
    window.location.reload();
  }

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 22, paddingTop: 16 }}>
      <div
        style={{
          fontSize: 12,
          color: C.parchmentDim,
          letterSpacing: 1,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Account
      </div>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Signed in as <b style={{ color: C.parchment }}>{account?.email}</b>.
      </p>

      {msg && <div style={{ fontSize: 12, color: C.greenBright, marginBottom: 8 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.redBright, marginBottom: 8 }}>{err}</div>}

      {mode === "password" && (
        <div style={{ marginBottom: 10 }}>
          <input
            style={input}
            type="password"
            placeholder="Current password"
            aria-label="Current password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <input
            style={input}
            type="password"
            placeholder="New password (10+ characters)"
            aria-label="New password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={changePassword}
              style={{
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 6,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              Save
            </button>
            <button style={small} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "delete" && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 12.5, color: C.redBright, lineHeight: 1.55, marginTop: 0 }}>
            This permanently erases your account and everything in your vault. Export a CSV first if
            you want a copy — this cannot be undone.
          </p>
          <input
            style={input}
            type="password"
            placeholder="Confirm with your password"
            aria-label="Confirm with your password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={deleteAccount}
              style={{
                background: "transparent",
                border: `1px solid ${C.redBright}`,
                color: C.redBright,
                borderRadius: 6,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              Delete everything
            </button>
            <button style={small} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === null && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={small} onClick={signOut}>
            Sign out
          </button>
          <button style={small} onClick={() => { setMode("password"); setErr(""); setMsg(""); }}>
            Change password
          </button>
          <button
            style={{ ...small, borderColor: "rgba(222,115,134,0.4)", color: C.redBright }}
            onClick={() => { setMode("delete"); setErr(""); setMsg(""); }}
          >
            Delete account
          </button>
        </div>
      )}
    </div>
  );
}

export function SettingsSection({ label, tone, children }) {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 22, paddingTop: 16 }}>
      <div
        style={{
          fontSize: 12,
          color: tone === "danger" ? C.redBright : C.parchmentDim,
          letterSpacing: 1,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

export function ProfilePinPanel() {
  const [mode, setMode] = useState(null); // null | pin | delete | rename
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [deletePin, setDeletePin] = useState("");
  const [renamePin, setRenamePin] = useState("");
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const input = {
    width: "100%",
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "9px 11px",
    color: C.parchment,
    fontSize: 13,
    marginBottom: 8,
  };
  const small = {
    background: "none",
    border: `1px solid ${C.border}`,
    color: C.parchmentDim,
    borderRadius: 6,
    padding: "8px 13px",
    fontSize: 12.5,
    cursor: "pointer",
  };

  function switchUser() {
    localStorage.removeItem("lf-profile");
    window.location.reload();
  }

  async function changePin() {
    if (newPin !== confirmPin) return setErr("The new PINs don't match.");
    setErr("");
    setMsg("");
    setBusy(true);
    const res = await fetch(`/api/store/${store.profile}/pin`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-pin": currentPin },
      body: JSON.stringify({ newPin }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error || "Couldn't change the PIN.");
    // the device needs to remember the new PIN going forward
    try {
      localStorage.setItem("lf-profile", JSON.stringify({ name: store.profile, pin: newPin }));
    } catch (e) {}
    store.configure("server", store.profile, newPin);
    setMsg(newPin ? "PIN changed." : "PIN removed — this vault now opens without one.");
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setMode(null);
  }

  async function deleteProfile() {
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/store/${store.profile}`, {
      method: "DELETE",
      headers: { "x-pin": deletePin },
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error || "Couldn't delete the profile.");
    localStorage.removeItem("lf-profile");
    window.location.reload();
  }

  async function renameProfile() {
    const target = newName.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,24}$/.test(target)) {
      return setErr("Names can only use lowercase letters, numbers, - and _, up to 24 characters.");
    }
    setErr("");
    setMsg("");
    setBusy(true);
    const res = await fetch(`/api/store/${store.profile}/rename`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-pin": renamePin },
      body: JSON.stringify({ newName: target }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error || "Couldn't rename the profile.");
    // the device needs to remember the new name going forward, using
    // whichever PIN this profile already has (rename doesn't change it)
    try {
      localStorage.setItem("lf-profile", JSON.stringify({ name: d.name, pin: renamePin }));
    } catch (e) {}
    store.configure("server", d.name, renamePin);
    setMsg(`Renamed to "${d.name}".`);
    setRenamePin("");
    setNewName("");
    setMode(null);
  }

  return (
    <SettingsSection label="Profile">
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Signed in as <b style={{ color: C.parchment }}>{store.profile}</b>.
      </p>

      {msg && <div style={{ fontSize: 12, color: C.greenBright, marginBottom: 8 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.redBright, marginBottom: 8 }}>{err}</div>}

      {mode === "pin" && (
        <div style={{ marginBottom: 10 }}>
          <input
            style={input}
            type="password"
            inputMode="numeric"
            placeholder="Current PIN (leave blank if none)"
            aria-label="Current PIN"
            autoComplete="off"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
          />
          <input
            style={input}
            type="password"
            inputMode="numeric"
            placeholder="New PIN (leave blank to remove it)"
            aria-label="New PIN"
            autoComplete="off"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
          />
          <input
            style={input}
            type="password"
            inputMode="numeric"
            placeholder="Confirm new PIN"
            aria-label="Confirm new PIN"
            autoComplete="off"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && changePin()}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={changePin}
              disabled={busy}
              style={{
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 6,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: busy ? "default" : "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              Save
            </button>
            <button
              style={small}
              onClick={() => {
                setMode(null);
                setErr("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "rename" && (
        <div style={{ marginBottom: 10 }}>
          <input
            style={input}
            placeholder="New name (e.g. mike)"
            aria-label="New profile name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            style={input}
            type="password"
            inputMode="numeric"
            placeholder="Confirm with this profile's PIN (leave blank if none)"
            aria-label="Confirm with this profile's PIN"
            autoComplete="off"
            value={renamePin}
            onChange={(e) => setRenamePin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && renameProfile()}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={renameProfile}
              disabled={busy}
              style={{
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 6,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: busy ? "default" : "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              Save
            </button>
            <button
              style={small}
              onClick={() => {
                setMode(null);
                setErr("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "delete" && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 12.5, color: C.redBright, lineHeight: 1.55, marginTop: 0 }}>
            This permanently deletes the <b>{store.profile}</b> profile and everything in its
            vault from the server. Export a CSV first if you want a copy — this can't be undone.
          </p>
          <input
            style={input}
            type="password"
            inputMode="numeric"
            placeholder="Confirm with this profile's PIN (leave blank if none)"
            aria-label="Confirm with this profile's PIN"
            autoComplete="off"
            value={deletePin}
            onChange={(e) => setDeletePin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && deleteProfile()}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={deleteProfile}
              disabled={busy}
              style={{
                background: "transparent",
                border: `1px solid ${C.redBright}`,
                color: C.redBright,
                borderRadius: 6,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: busy ? "default" : "pointer",
              }}
            >
              Delete this profile
            </button>
            <button
              style={small}
              onClick={() => {
                setMode(null);
                setErr("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === null && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={small} onClick={switchUser}>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Users size={14} /> Switch user
            </span>
          </button>
          <button
            style={small}
            onClick={() => {
              setMode("pin");
              setErr("");
              setMsg("");
            }}
          >
            Change PIN
          </button>
          <button
            style={small}
            onClick={() => {
              setNewName(store.profile);
              setMode("rename");
              setErr("");
              setMsg("");
            }}
          >
            Rename profile
          </button>
          <button
            style={{ ...small, borderColor: "rgba(222,115,134,0.4)", color: C.redBright }}
            onClick={() => {
              setMode("delete");
              setErr("");
              setMsg("");
            }}
          >
            Delete this profile
          </button>
        </div>
      )}
    </SettingsSection>
  );
}

export function SettingsModal({
  serverMode,
  authMode,
  account,
  currency,
  setCurrency,
  czkRate,
  setCzkRate,
  eurRate,
  setEurRate,
  cardCount,
  onDeleteAll,
  onClose,
}) {
  const [wipeConfirm, setWipeConfirm] = useState("");
  return (
    <ModalShell title="Settings" onClose={onClose} width={420}>
      <div
        style={{
          fontSize: 12,
          color: C.parchmentDim,
          letterSpacing: 1,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Currency &amp; display
      </div>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Card prices are tracked in US dollars. Pick how you'd like totals displayed and
        set the rates you want to convert at.
      </p>

      <Field label="Display totals in" htmlFor="sm-currency">
        <select id="sm-currency" style={inputStyle} value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {Object.entries(CURRENCIES).map(([code, meta]) => (
            <option key={code} value={code}>
              {code} — {meta.label}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <Field label="EUR per 1 USD" htmlFor="sm-eur-rate">
          <input
            id="sm-eur-rate"
            type="number"
            step="0.01"
            style={inputStyle}
            value={eurRate}
            onChange={(e) => setEurRate(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="CZK per 1 USD" htmlFor="sm-czk-rate">
          <input
            id="sm-czk-rate"
            type="number"
            step="0.1"
            style={inputStyle}
            value={czkRate}
            onChange={(e) => setCzkRate(Number(e.target.value) || 0)}
          />
        </Field>
      </div>

      <button
        onClick={onClose}
        style={{
          width: "100%",
          background: STOCK_BG,
          color: C.stockInk,
          border: "none",
          borderRadius: 6,
          padding: "11px",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Done
      </button>

      {serverMode && authMode === "accounts" && <AccountPanel account={account} />}

      {serverMode && authMode !== "accounts" && <ProfilePinPanel />}

      <SettingsSection label="Support HoardKeeper">
        <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0, lineHeight: 1.55 }}>
          HoardKeeper is free and always will be. If it's saved you some spreadsheet
          headaches, a coffee is appreciated but never expected.
        </p>
        <a
          href="https://ko-fi.com/Arinlir"
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 6,
            padding: "9px 16px",
            fontWeight: 700,
            fontSize: 12.5,
            textDecoration: "none",
            boxShadow: STOCK_SHADOW,
          }}
        >
          <Heart size={14} /> Buy me a coffee on Ko-fi
        </a>
      </SettingsSection>

      <SettingsSection label="Delete everything" tone="danger">
        <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
          Removes all {cardCount} cards from the vault. Collections and their purchase prices
          stay. This can't be undone — export a CSV first if you want a backup.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={wipeConfirm}
            onChange={(e) => setWipeConfirm(e.target.value)}
            placeholder="Type DELETE to confirm"
            aria-label="Type DELETE to confirm"
          />
          <button
            onClick={onDeleteAll}
            disabled={wipeConfirm.trim().toUpperCase() !== "DELETE"}
            style={{
              background: wipeConfirm.trim().toUpperCase() === "DELETE" ? C.red : "transparent",
              border: `1px solid ${C.red}`,
              color: wipeConfirm.trim().toUpperCase() === "DELETE" ? C.parchment : C.redBright,
              borderRadius: 6,
              padding: "0 14px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: wipeConfirm.trim().toUpperCase() === "DELETE" ? "pointer" : "default",
              opacity: wipeConfirm.trim().toUpperCase() === "DELETE" ? 1 : 0.5,
            }}
          >
            Delete all
          </button>
        </div>
      </SettingsSection>
    </ModalShell>
  );
}

