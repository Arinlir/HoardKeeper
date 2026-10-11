import React, { useState } from "react";
import { C } from "../../../lib/tokens";
import { apiUrl, apiCredentials, authHeaders } from "../../../lib/platform";

// Two small panels inside Settings → Account: the devices that are signed in,
// and a whole-vault backup you can download and restore.

const small = {
  background: "none",
  border: `1px solid ${C.border}`,
  color: C.parchmentDim,
  borderRadius: 6,
  padding: "8px 13px",
  fontSize: 12.5,
  cursor: "pointer",
};
const headers = (extra = {}) => ({ "x-hk-app": "1", ...authHeaders(), ...extra });
const label = { fontSize: 12, color: C.parchmentDim, marginBottom: 6 };

function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// ---- signed-in devices ----

export function DevicesPanel() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setErr("");
    const res = await fetch(apiUrl("/api/auth/sessions"), { headers: headers(), credentials: apiCredentials() }).catch(() => null);
    if (!res || !res.ok) return setErr("Couldn't load your devices.");
    setList((await res.json()).sessions || []);
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    setMsg("");
    if (next) await load();
  }

  async function signOutOne(id) {
    setMsg("");
    const res = await fetch(apiUrl(`/api/auth/sessions/${id}`), { method: "DELETE", headers: headers(), credentials: apiCredentials() }).catch(() => null);
    if (!res || !res.ok) return setErr("Couldn't sign that device out.");
    setMsg("Signed out.");
    await load();
  }

  async function signOutOthers() {
    setMsg("");
    const res = await fetch(apiUrl("/api/auth/sessions/others"), { method: "POST", headers: headers(), credentials: apiCredentials() }).catch(() => null);
    if (!res || !res.ok) return setErr("Couldn't sign the other devices out.");
    setMsg("Every other device is signed out.");
    await load();
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <button style={small} onClick={toggle} aria-expanded={open}>
        {open ? "Hide signed-in devices" : "Signed-in devices"}
      </button>
      {open && (
        <div style={{ marginTop: 10 }} data-testid="devices">
          {err && <div style={{ fontSize: 12, color: C.redBright, marginBottom: 6 }}>{err}</div>}
          {msg && <div style={{ fontSize: 12, color: C.greenBright, marginBottom: 6 }}>{msg}</div>}
          {!list && !err && <div style={{ fontSize: 12, color: C.parchmentDim }}>Loading…</div>}
          {list &&
            list.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: C.parchment }}>
                    {s.label}
                    {s.current && <span style={{ color: C.greenBright, marginLeft: 8, fontSize: 11 }}>this device</span>}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
                    active {ago(s.lastSeen)} · signed in {new Date(s.created).toLocaleDateString()}
                  </div>
                </div>
                {!s.current && (
                  <button style={small} onClick={() => signOutOne(s.id)} aria-label={`Sign out ${s.label}`}>
                    Sign out
                  </button>
                )}
              </div>
            ))}
          {list && list.length > 1 && (
            <button style={{ ...small, marginTop: 8 }} onClick={signOutOthers}>
              Sign out all other devices
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- backup and restore ----

const MAX_BACKUP_BYTES = 11 * 1024 * 1024;

// Turns the text of a chosen file into a vault object, or says why not.
// Accepts our own backup file ({ format: "binderwyrm-backup", vault }) and a
// bare vault object. Exported for the tests.
export function parseBackup(text) {
  if (typeof text !== "string" || text.length > MAX_BACKUP_BYTES) return { ok: false, error: "That file is too large to be a backup." };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "That isn't a backup file (it isn't valid JSON)." };
  }
  let vault = data;
  if (data && data.format === "binderwyrm-backup") {
    vault = typeof data.vault === "string" ? safeParse(data.vault) : data.vault;
  }
  if (!vault || typeof vault !== "object" || Array.isArray(vault)) return { ok: false, error: "That file doesn't contain a Binderwyrm collection." };
  const arrays = ["cards", "decks", "wishlist", "collections", "history"];
  for (const k of arrays) if (k in vault && vault[k] !== null && !Array.isArray(vault[k])) return { ok: false, error: `The backup looks damaged (“${k}” isn't a list).` };
  if (!arrays.some((k) => Array.isArray(vault[k]))) return { ok: false, error: "That file doesn't contain a Binderwyrm collection." };
  return { ok: true, vault };
}
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

export function BackupPanel() {
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(null); // { vault, name }
  const [busy, setBusy] = useState(false);

  async function fetchVault() {
    const res = await fetch(apiUrl("/api/store"), { headers: headers(), credentials: apiCredentials() }).catch(() => null);
    if (!res || !res.ok) return null;
    return res.json();
  }

  async function download() {
    setErr("");
    setMsg("");
    const d = await fetchVault();
    if (!d) return setErr("Couldn't read your vault from the server.");
    if (d.value === null || d.value === undefined) return setMsg("There's nothing in your vault to back up yet.");
    const vault = safeParse(d.value);
    if (!vault) return setErr("Your stored vault couldn't be read.");
    const body = JSON.stringify({ format: "binderwyrm-backup", version: 1, exportedAt: new Date().toISOString(), vault }, null, 1);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `binderwyrm-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setMsg(`Backup downloaded — ${plural(Array.isArray(vault.cards) ? vault.cards.length : 0, "card")}, ${plural(Array.isArray(vault.decks) ? vault.decks.length : 0, "deck")}.`);
  }

  async function choose(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    setErr("");
    setMsg("");
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) return setErr("That file is too large to be a backup.");
    const r = parseBackup(await file.text());
    if (!r.ok) return setErr(r.error);
    setPending({ vault: r.vault, name: file.name });
  }

  async function restore() {
    setBusy(true);
    setErr("");
    const cur = await fetchVault();
    if (!cur) {
      setBusy(false);
      return setErr("Couldn't reach the server.");
    }
    const res = await fetch(apiUrl("/api/store"), {
      method: "PUT",
      headers: headers({ "Content-Type": "application/json", "x-base-rev": String(cur.rev ?? 0) }),
      credentials: apiCredentials(),
      body: JSON.stringify({ value: JSON.stringify(pending.vault) }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) return setErr(res && res.status === 409 ? "Your vault changed on another device while you were restoring. Try again." : "The restore didn't go through.");
    // The page holds the old collection in memory; reload so it can't be saved back over the restore.
    window.location.reload();
  }

  const n = (v, k) => (Array.isArray(v?.[k]) ? v[k].length : 0);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={label}>
        Backup — your whole vault (cards, decks, wishlist, collections, history and settings) as one file you can keep or restore from.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={small} onClick={download}>
          Download backup
        </button>
        <label style={{ ...small, display: "inline-block" }}>
          Restore from a backup…
          <input type="file" accept="application/json,.json" onChange={choose} style={{ display: "none" }} aria-label="Choose a backup file" />
        </label>
      </div>
      {msg && <div style={{ fontSize: 12, color: C.greenBright, marginTop: 8 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.redBright, marginTop: 8 }}>{err}</div>}
      {pending && (
        <div role="alertdialog" aria-label="Confirm restore" style={{ marginTop: 10, border: `1px solid ${C.redBright}`, padding: 12, borderRadius: 6 }}>
          <div style={{ fontSize: 12.5, color: C.redBright, lineHeight: 1.55, marginBottom: 8 }}>
            Replace everything in your vault with <b>{pending.name}</b> ({plural(n(pending.vault, "cards"), "card")}, {plural(n(pending.vault, "decks"), "deck")}, {plural(n(pending.vault, "wishlist"), "wishlist entry", "wishlist entries")})? What's
            there now is overwritten and can't be brought back — download a backup of it first if you might want it.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...small, borderColor: C.redBright, color: C.redBright }} onClick={restore} disabled={busy}>
              {busy ? "Restoring…" : "Replace my vault"}
            </button>
            <button style={small} onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
