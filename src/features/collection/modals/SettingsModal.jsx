import React, { useState } from "react";
import { AlertCircle, Check, Copy, ExternalLink, Heart, RefreshCw, Settings, Users } from "lucide-react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { CURRENCIES, convert } from "../../../lib/format";
import { ratesAgeLabel } from "../../../lib/rates";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH_SM } from "../../../lib/tokens";
import { DevicesPanel, BackupPanel } from "./AccountExtras";
import { MfaPanel } from "../../auth/MfaPanel";
import { authPost } from "../../auth/AuthGate";
import { apiUrl, apiCredentials, authHeaders, isNativeApp, privacyUrl, publicOrigin, serverBase, setAuthToken, setServerChoice } from "../../../lib/platform";

export function AccountPanel({ account, onAccountChange }) {
  const [mode, setMode] = useState(null); // null | password | delete
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [handle, setHandle] = useState(account?.handle || "");

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
    await fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      headers: { "x-hk-app": "1", ...authHeaders() },
      credentials: apiCredentials(),
    }).catch(() => {});
    setAuthToken(null);
    window.location.reload();
  }

  async function changePassword() {
    setErr("");
    setMsg("");
    const res = await fetch(apiUrl("/api/auth/password"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hk-app": "1", ...authHeaders() },
      credentials: apiCredentials(),
      body: JSON.stringify({ current, next }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Couldn't change the password.");
    setMsg("Password changed. Other devices have been signed out.");
    setCurrent("");
    setNext("");
    setMode(null);
  }

  // The public handle: the name in /w/<handle> and /v/<handle>, and what the
  // playgroup lists. Empty = share nothing.
  async function saveHandle(value) {
    setErr("");
    setMsg("");
    const res = await fetch(apiUrl("/api/auth/handle"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hk-app": "1", ...authHeaders() },
      credentials: apiCredentials(),
      body: JSON.stringify({ handle: value }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Couldn't save the handle.");
    setHandle(d.user?.handle || "");
    onAccountChange?.(d.user);
    setMsg(d.user?.handle ? `Your public name is now "${d.user.handle}".` : "Handle removed — nothing of yours is public now.");
  }

  async function deleteAccount() {
    setErr("");
    const res = await fetch(apiUrl("/api/auth/account"), {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-hk-app": "1", ...authHeaders() },
      credentials: apiCredentials(),
      body: JSON.stringify({ password: pw }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Couldn't delete the account.");
    setAuthToken(null);
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

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.parchmentDim, marginBottom: 6 }}>
          Public handle — the name in your shared links (<span className="mono">/w/{handle || "handle"}</span>,{" "}
          <span className="mono">/v/{handle || "handle"}</span>) and in your playgroup. Leave it empty to
          share nothing.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...input, marginBottom: 0, flex: 1 }}
            placeholder="e.g. michael"
            aria-label="Public handle"
            value={handle}
            maxLength={24}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            onKeyDown={(e) => e.key === "Enter" && saveHandle(handle.trim())}
          />
          <button
            style={small}
            onClick={() => saveHandle(handle.trim())}
            disabled={(handle.trim() || "") === (account?.handle || "")}
          >
            {handle.trim() ? "Save" : "Remove"}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: C.parchmentDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Two-factor sign-in</div>
        <MfaPanel enabled={!!account?.mfa} post={(name, body) => authPost(`/api/auth/mfa/${name}`, body)} onChanged={(on) => onAccountChange?.({ ...account, mfa: on })} />
      </div>

      <BackupPanel />
      <DevicesPanel />

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

/*
 * Phone app only: which server this app talks to, and a way to change it.
 * Changing it goes back through ConnectGate on the next launch. Nothing is
 * copied between servers (or from "this phone only" to a server) — the vault
 * stays wherever it was saved, which the copy says plainly.
 */
export function ServerPanel() {
  const [confirm, setConfirm] = useState(false);
  const base = serverBase();
  function change() {
    setServerChoice(null);
    try {
      localStorage.removeItem("lf-profile");
    } catch (e) {}
    window.location.reload();
  }
  return (
    <SettingsSection label="Server">
      <div data-testid="server-panel" style={{ fontSize: 13, color: C.parchment, marginBottom: 8, wordBreak: "break-all" }}>
        {base ? base : "This phone only — nothing is synced."}
      </div>
      {!confirm ? (
        <button
          onClick={() => setConfirm(true)}
          style={{
            background: "none",
            border: `1px solid ${C.border}`,
            color: C.parchmentDim,
            borderRadius: 0,
            clipPath: NOTCH_SM,
            padding: "8px 13px",
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          {base ? "Change server…" : "Connect a server…"}
        </button>
      ) : (
        <div style={{ fontSize: 12.5, color: C.parchmentDim, lineHeight: 1.5 }}>
          {base
            ? "You'll pick a server again. Your vault stays on this one — nothing is deleted."
            : "Cards saved on this phone stay on the phone; they aren't uploaded to the server. Export them first (Export → Binderwyrm) if you want to import them there."}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              onClick={change}
              style={{
                background: C.accentFill,
                border: `1px solid ${C.accent}`,
                color: C.goldBright,
                borderRadius: 0,
                clipPath: NOTCH_SM,
                padding: "8px 13px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Continue
            </button>
            <button
              onClick={() => setConfirm(false)}
              style={{ background: "none", border: `1px solid ${C.border}`, color: C.parchmentDim, borderRadius: 0, clipPath: NOTCH_SM, padding: "8px 13px", fontSize: 12.5, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

/*
 * Sharing the collection read-only.
 *
 * Off unless you turn it on, and worth being blunt about in the copy: this is
 * a link anyone can open, so the switch says exactly what a guest sees and
 * exactly what they don't. The server enforces the same list — see
 * public-vault.cjs — rather than trusting this screen.
 */
export function GuestViewPanel({ profileName, publicVault, setPublicVault, publicTrade, setPublicTrade, tradeCount }) {
  const [copied, setCopied] = useState(false);
  const url = profileName ? `${publicOrigin()}/v/${profileName}` : null;

  function copyLink() {
    if (!url) return;
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => {});
    else done();
  }

  return (
    <SettingsSection label="Share your collection">
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          fontSize: 13,
          color: C.parchment,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <input
          type="checkbox"
          checked={!!publicVault}
          onChange={(e) => setPublicVault(e.target.checked)}
          style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
        />
        <span>
          Let anyone with the link browse this collection
          <span style={{ display: "block", fontSize: 11.5, color: C.parchmentDim, marginTop: 2, lineHeight: 1.55 }}>
            Read-only: your cards, what they're worth today, your sets and your decks. Never what you
            paid, your collection totals, your gain, your value history, where a card is kept, your
            tags and notes, or anything you've sold. Nothing on that page can change anything here.
          </span>
        </span>
      </label>

      {publicVault && url && (
        <div style={{ marginTop: 12, background: C.bgPanel2, border: `1px solid ${C.border}`, padding: "10px 12px" }}>
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, textTransform: "uppercase", color: C.parchmentDim }}>
            Guest link
          </div>
          <div className="mono" style={{ fontSize: 13, color: C.accent, marginTop: 5, overflowWrap: "anywhere" }}>
            {url}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
            <button
              onClick={copyLink}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 0,
                clipPath: NOTCH_SM,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy link"}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.parchmentDim,
                clipPath: NOTCH_SM,
                padding: "8px 14px",
                fontSize: 12.5,
                textDecoration: "none",
              }}
            >
              Open it <ExternalLink size={13} />
            </a>
          </div>
          <div style={{ fontSize: 11.5, color: C.parchmentDim, marginTop: 9, lineHeight: 1.5 }}>
            Guests don't need an account. Untick the box and the link stops answering immediately.
          </div>
        </div>
      )}

      {/* The trade binder is its own switch: plenty of people will share what
          they'll trade away without sharing everything they own. */}
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          fontSize: 13,
          color: C.parchment,
          cursor: "pointer",
          userSelect: "none",
          marginTop: 14,
        }}
      >
        <input
          type="checkbox"
          checked={!!publicTrade}
          onChange={(e) => setPublicTrade(e.target.checked)}
          style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
        />
        <span>
          Share my trade list
          <span style={{ display: "block", fontSize: 11.5, color: C.parchmentDim, marginTop: 2, lineHeight: 1.55 }}>
            The {tradeCount || 0} card{tradeCount === 1 ? "" : "s"} you've marked up for trade appear
            on your wishlist page and in your playgroup's matches — so someone can see at a glance
            what you'd give for what they have. Nothing else about those cards travels.
          </span>
        </span>
      </label>

    </SettingsSection>
  );
}

export function SettingsModal({
  serverMode,
  onAccountChange,
  account,
  currency,
  setCurrency,
  czkRate,
  setCzkRate,
  eurRate,
  setEurRate,
  priceSource,
  setPriceSource,
  eurPricedCount,
  publicVault,
  setPublicVault,
  publicTrade,
  setPublicTrade,
  tradeCount,
  profileName,
  ratesAuto,
  setRatesAuto,
  ratesUpdated,
  ratesBusy,
  ratesError,
  onRefreshRates,
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
        Pick which market your cards are priced on and how you'd like totals displayed —
        the conversion rates look after themselves.
      </p>

      {/* The market matters more than the currency: the same printing often
          sells for very different amounts in the EU and the US. */}
      <Field label="Card prices from" htmlFor="sm-price-source">
        <select
          id="sm-price-source"
          style={inputStyle}
          value={priceSource === "cardmarket" ? "cardmarket" : "tcgplayer"}
          onChange={(e) => setPriceSource(e.target.value)}
        >
          <option value="cardmarket">Cardmarket — European market (€)</option>
          <option value="tcgplayer">TCGplayer — US market ($)</option>
        </select>
      </Field>
      <p data-testid="price-source-hint" style={{ fontSize: 11.5, color: C.parchmentDim, marginTop: -6, marginBottom: 14 }}>
        {priceSource === "cardmarket"
          ? `Cardmarket's trend price, converted to your display currency at today's rate.${
              typeof eurPricedCount === "number" && typeof cardCount === "number" && eurPricedCount < cardCount
                ? ` ${eurPricedCount} of ${cardCount} cards have a Cardmarket price so far — the rest use TCGplayer's until the next price refresh.`
                : ""
            }`
          : "TCGplayer's market price, converted to your display currency at today's rate."}{" "}
        Each card's details show both markets side by side.
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
            style={{ ...inputStyle, opacity: ratesAuto ? 0.6 : 1 }}
            value={eurRate}
            disabled={ratesAuto}
            onChange={(e) => setEurRate(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="CZK per 1 USD" htmlFor="sm-czk-rate">
          <input
            id="sm-czk-rate"
            type="number"
            step="0.1"
            style={{ ...inputStyle, opacity: ratesAuto ? 0.6 : 1 }}
            value={czkRate}
            disabled={ratesAuto}
            onChange={(e) => setCzkRate(Number(e.target.value) || 0)}
          />
        </Field>
      </div>


      {/* Where those two numbers come from. Fetched by the browser straight from
          the rate source, so nothing about your collection goes anywhere. */}
      <div
        style={{
          background: C.bgPanel2,
          border: `1px solid ${C.border}`,
          padding: "10px 12px",
          marginBottom: 14,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 13,
            color: C.parchment,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={!!ratesAuto}
            onChange={(e) => setRatesAuto(e.target.checked)}
            style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
          />
          <span>
            Keep rates up to date automatically
            <span style={{ display: "block", fontSize: 11.5, color: C.parchmentDim, marginTop: 2 }}>
              Uses the European Central Bank's daily reference rates. Untick to type your own.
            </span>
          </span>
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button
            onClick={onRefreshRates}
            disabled={ratesBusy}
            className="mono"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.parchmentDim,
              borderRadius: 0,
              clipPath: NOTCH_SM,
              padding: "6px 11px",
              fontSize: 10,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              cursor: ratesBusy ? "default" : "pointer",
            }}
          >
            <RefreshCw size={11} style={ratesBusy ? { animation: "spin 1s linear infinite" } : {}} />
            {ratesBusy ? "Checking" : "Update now"}
          </button>
          <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
            {ratesError ? (
              <span style={{ color: C.redBright }}>{ratesError} — still using the last known rates.</span>
            ) : (
              `Updated ${ratesAgeLabel(ratesUpdated)}`
            )}
          </span>
        </div>
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

      {isNativeApp() && <ServerPanel />}

      {serverMode && <AccountPanel account={account} onAccountChange={onAccountChange} />}

      {serverMode && profileName && (
        <GuestViewPanel
          profileName={profileName}
          publicVault={publicVault}
          setPublicVault={setPublicVault}
          publicTrade={publicTrade}
          setPublicTrade={setPublicTrade}
          tradeCount={tradeCount}
        />
      )}

      <SettingsSection label="Support Binderwyrm">
        <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0, lineHeight: 1.55 }}>
          Binderwyrm is free and always will be. If it's saved you some spreadsheet
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
        <p style={{ fontSize: 12, color: C.parchmentDim, marginBottom: 0 }}>
          <a data-testid="privacy-link" href={privacyUrl()} target="_blank" rel="noreferrer" style={{ color: C.accent }}>
            Privacy policy
          </a>{" "}
          — what's stored, where, and what the app talks to.
        </p>
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

