import React, { useCallback, useEffect, useState } from "react";
import { C, ROOT_BG, NOTCH, NOTCH_SM, STOCK_BG } from "../../lib/tokens";
import { MfaPanel } from "../auth/MfaPanel";

// The admin space (server side: admin.cjs). A page of its own, reached at
// /admin — separate from the app and from user accounts. Always same-origin,
// so it uses plain fetch rather than the phone-app plumbing in lib/platform.

async function call(method, path, body) {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "x-hk-app": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

const mono = { fontFamily: "'IBM Plex Mono', monospace" };
const input = {
  width: "100%",
  boxSizing: "border-box",
  background: C.bg,
  color: C.parchment,
  border: `1px solid ${C.border}`,
  borderRadius: 2,
  padding: "9px 10px",
  fontSize: 13.5,
  fontFamily: "inherit",
};
const button = (kind = "plain") => ({
  background: kind === "primary" ? STOCK_BG : "transparent",
  color: kind === "primary" ? C.stockInk : kind === "danger" ? C.redBright : C.parchment,
  border: kind === "primary" ? "none" : `1px solid ${kind === "danger" ? C.redBright : C.borderLight}`,
  clipPath: kind === "primary" ? NOTCH_SM : undefined,
  padding: "8px 14px",
  fontWeight: 700,
  fontSize: 12.5,
  letterSpacing: 0.6,
  fontFamily: "'Archivo', sans-serif",
  cursor: "pointer",
});
const panel = {
  background: C.bgPanel,
  border: `1px solid ${C.border}`,
  borderRadius: 3,
  padding: 20,
  marginBottom: 16,
};

function Shell({ children, onSignOut }) {
  return (
    <div style={{ minHeight: "100vh", background: ROOT_BG, color: C.parchment, fontFamily: "'Archivo', sans-serif", padding: "24px clamp(14px, 4vw, 30px) 60px" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 20 }}>
          <div aria-hidden="true" style={{ width: 18, height: 18, background: C.accent, clipPath: NOTCH_SM }} />
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 21, letterSpacing: 1.5, margin: 0, color: C.goldBright }}>BINDERWYRM</h1>
          <span style={{ ...mono, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.parchmentDim }}>Admin</span>
          <span style={{ flex: 1 }} />
          <a href="/" style={{ color: C.accent, fontSize: 12.5 }}>Back to the app</a>
          {onSignOut && (
            <button style={button()} onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function Message({ kind, children }) {
  if (!children) return null;
  return (
    <div role={kind === "error" ? "alert" : "status"} style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 12px", color: kind === "error" ? C.redBright : C.greenBright }}>
      {children}
    </div>
  );
}

// ---- first password / sign in ----

function Gate({ configured, onDone }) {
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState("");
  const [otp, setOtp] = useState("");

  async function submitCode() {
    setError("");
    setBusy(true);
    const r = await call("POST", "login-mfa", { ticket, code: otp });
    setBusy(false);
    if (r.ok) return onDone();
    if (r.data.expired) {
      setTicket("");
      setPw("");
    }
    setError(r.data.error || "Something went wrong.");
  }

  async function submit() {
    setError("");
    if (!configured) {
      if (pw !== pw2) return setError("The two passwords don't match.");
    }
    setBusy(true);
    const r = configured ? await call("POST", "login", { password: pw }) : await call("POST", "setup", { code, password: pw });
    setBusy(false);
    if (r.ok && r.data.mfaRequired) {
      setTicket(r.data.ticket);
      setOtp("");
      return;
    }
    if (r.ok) return onDone();
    setError(r.data.error || "Something went wrong.");
  }

  if (ticket)
    return (
      <Shell>
        <div style={{ ...panel, maxWidth: 400, margin: "40px auto" }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.parchmentDim, marginBottom: 14 }}>Two-factor code</div>
          <Message kind="error">{error}</Message>
          <input style={{ ...input, marginBottom: 8 }} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code or recovery code" aria-label="Two-factor code" autoFocus value={otp} onChange={(e) => setOtp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitCode()} />
          <button style={{ ...button("primary"), width: "100%" }} onClick={submitCode} disabled={busy || !otp.trim()}>
            {busy ? "…" : "Verify"}
          </button>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <div style={{ ...panel, maxWidth: 400, margin: "40px auto" }}>
        <div style={{ ...mono, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.parchmentDim, marginBottom: 14 }}>
          {configured ? "Admin sign-in" : "Choose the admin password"}
        </div>
        <Message kind="error">{error}</Message>
        {!configured && (
          <>
            <p style={{ fontSize: 12.5, color: C.parchmentDim, lineHeight: 1.5, marginTop: 0 }}>
              No admin password is set yet. The server printed a one-time setup code in its log (<code>docker compose logs</code>) — enter it here, then choose a
              password of 12 or more characters.
            </p>
            <input style={{ ...input, marginBottom: 8 }} placeholder="Setup code" aria-label="Setup code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
          </>
        )}
        <input
          style={{ ...input, marginBottom: 8 }}
          type="password"
          placeholder={configured ? "Admin password" : "New admin password"}
          aria-label="Admin password"
          autoComplete={configured ? "current-password" : "new-password"}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => configured && e.key === "Enter" && submit()}
        />
        {!configured && (
          <input
            style={{ ...input, marginBottom: 8 }}
            type="password"
            placeholder="Repeat password"
            aria-label="Repeat password"
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        )}
        <button style={{ ...button("primary"), width: "100%" }} onClick={submit} disabled={busy}>
          {busy ? "…" : configured ? "Sign in" : "Set password"}
        </button>
      </div>
    </Shell>
  );
}

// ---- settings ----

function Field({ d, draft, setDraft }) {
  const value = draft[d.key] !== undefined ? draft[d.key] : d.value ?? "";
  const set = (v) => setDraft((x) => ({ ...x, [d.key]: v }));
  const id = `f-${d.key}`;
  let control;
  if (d.type === "bool" || d.type === "choice") {
    const opts = d.type === "bool" ? [["", "Default"], ["true", "On"], ["false", "Off"]] : [["", "Default"], ...d.choices.map((c) => [c, c[0].toUpperCase() + c.slice(1)])];
    control = (
      <select id={id} style={input} value={value} onChange={(e) => set(e.target.value)}>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        id={id}
        style={input}
        type={d.type === "secret" ? "password" : "text"}
        autoComplete="off"
        spellCheck={false}
        placeholder={d.type === "secret" ? (d.set ? "•••••••• (set — type to replace)" : "") : d.placeholder}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    );
  }
  const note = d.source === "file" ? "set here" : d.source === "env" ? "from the environment" : "";
  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={id} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>
        {d.label}
        {d.restart && <span style={{ ...mono, fontSize: 9.5, color: C.parchmentDim, fontWeight: 400 }}>restart to apply</span>}
        <span style={{ flex: 1 }} />
        {note && <span style={{ ...mono, fontSize: 9.5, color: C.parchmentDim, fontWeight: 400 }}>{note}</span>}
        {d.source === "file" && (
          <button type="button" style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 11.5, padding: 0 }} onClick={() => setDraft((x) => ({ ...x, [d.key]: { reset: true } }))}>
            reset
          </button>
        )}
      </label>
      {draft[d.key]?.reset ? (
        <div style={{ fontSize: 12.5, color: C.parchmentDim }}>
          Will go back to the environment / default when you save.{" "}
          <button type="button" style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", padding: 0 }} onClick={() => setDraft((x) => { const n = { ...x }; delete n[d.key]; return n; })}>
            undo
          </button>
        </div>
      ) : (
        control
      )}
      {d.help && <div style={{ fontSize: 11.5, color: C.parchmentDim, marginTop: 4, lineHeight: 1.45 }}>{d.help}</div>}
    </div>
  );
}

function SettingsTab({ onRestart }) {
  const [cfg, setCfg] = useState(null);
  const [draft, setDraft] = useState({});
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    call("GET", "config").then((r) => (r.ok ? setCfg(r.data) : setMsg({ kind: "error", text: r.data.error || "Couldn't load the settings." })));
  }, []);

  const changes = () => {
    const set = {};
    const reset = [];
    for (const [k, v] of Object.entries(draft)) {
      if (v && typeof v === "object" && v.reset) reset.push(k);
      else if (typeof v === "string") set[k] = v;
    }
    return { set, reset };
  };
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setBusy(true);
    setMsg({ kind: "", text: "" });
    const r = await call("PUT", "config", changes());
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.data.error || "Couldn't save." });
    setCfg(r.data);
    setDraft({});
    setMsg({ kind: "ok", text: "Saved. Changes that don't need a restart are already live." });
  }

  async function sendTest() {
    setBusy(true);
    setMsg({ kind: "", text: "" });
    const r = await call("POST", "smtp-test", { to: testTo, ...changes() });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: `Test email sent via ${r.data.via}. Check the inbox (and spam).` } : { kind: "error", text: r.data.error || "Sending failed." });
  }

  if (!cfg) return <Message kind={msg.kind || "ok"}>{msg.text || "Loading…"}</Message>;

  const groups = [...new Set(cfg.settings.map((s) => s.group))];
  return (
    <>
      {cfg.pendingRestart.length > 0 && (
        <div style={{ ...panel, borderColor: C.accent }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            Saved, but <b>{cfg.pendingRestart.length === 1 ? "one setting needs" : `${cfg.pendingRestart.length} settings need`}</b> a restart to take effect:{" "}
            <span style={mono}>{cfg.pendingRestart.join(", ")}</span>
          </div>
          <button style={button("primary")} onClick={onRestart}>
            Restart the server…
          </button>
        </div>
      )}
      {groups.map((g) => (
        <section key={g} style={panel} aria-label={g}>
          <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, letterSpacing: 1, margin: "0 0 14px", color: C.goldBright }}>{g}</h2>
          {cfg.settings
            .filter((s) => s.group === g)
            .map((s) => (
              <Field key={s.key} d={s} draft={draft} setDraft={setDraft} />
            ))}
          {g === "Email (SMTP)" && (
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Send a test email</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={input} type="email" placeholder="you@example.com" aria-label="Send the test to" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                <button style={button()} onClick={sendTest} disabled={busy}>
                  Send test
                </button>
              </div>
              <div style={{ fontSize: 11.5, color: C.parchmentDim, marginTop: 4 }}>Uses what is in the boxes above, saved or not.</div>
            </div>
          )}
        </section>
      ))}
      <div style={{ position: "sticky", bottom: 0, background: ROOT_BG, padding: "10px 0", display: "flex", gap: 12, alignItems: "center" }}>
        <button style={button("primary")} onClick={save} disabled={!dirty || busy}>
          {busy ? "…" : "Save changes"}
        </button>
        {dirty && (
          <button style={button()} onClick={() => setDraft({})}>
            Discard
          </button>
        )}
        <Message kind={msg.kind}>{msg.text}</Message>
      </div>
      <div style={{ ...mono, fontSize: 10.5, color: C.parchmentDim, lineHeight: 1.6 }}>
        Saved to <code>{cfg.configFile}</code>. Values here win over environment variables. PORT and DATA_DIR can only be set in the environment.
      </div>
    </>
  );
}

// ---- accounts ----

function AccountsTab() {
  const [users, setUsers] = useState(null);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [temp, setTemp] = useState(null);

  const load = useCallback(() => {
    call("GET", "users").then((r) => (r.ok ? setUsers(r.data.users) : setMsg({ kind: "error", text: r.data.error || "Couldn't load accounts." })));
  }, []);
  useEffect(load, [load]);

  async function act(u, action) {
    setMsg({ kind: "", text: "" });
    setTemp(null);
    if (action === "temp-password" && !window.confirm(`Reset the password for ${u.email}? They're signed out everywhere.`)) return;
    const r = await call("POST", `users/${u.id}/${action}`, {});
    if (!r.ok) return setMsg({ kind: "error", text: r.data.error || "Failed." });
    if (action === "temp-password") setTemp({ email: r.data.email, password: r.data.password });
    else if (action === "reset-link")
      r.data.emailed
        ? setMsg({ kind: "ok", text: `Reset link emailed to ${u.email}. It works for 24 hours, once.` })
        : setTemp({ email: r.data.email, link: r.data.link });
    else
      setMsg({
        kind: "ok",
        text: action === "confirm" ? `Confirmed ${u.email}.` : action === "unlock" ? `Unlocked ${u.email}.` : action === "mfa-off" ? `Two-factor is off for ${u.email}.` : `Signed ${u.email} out everywhere.`,
      });
    load();
  }

  if (!users) return <Message kind={msg.kind || "ok"}>{msg.text || "Loading…"}</Message>;
  return (
    <section style={panel} aria-label="Accounts">
      <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, letterSpacing: 1, margin: "0 0 12px", color: C.goldBright }}>
        Accounts <span style={{ ...mono, fontSize: 11, color: C.parchmentDim }}>{users.length}</span>
      </h2>
      <Message kind={msg.kind}>{msg.text}</Message>
      {temp && (
        <div role="status" style={{ border: `1px solid ${C.accent}`, padding: 12, marginBottom: 12, fontSize: 13 }}>
          {temp.link ? (
            <>
              Reset link for <b>{temp.email}</b> (not emailed — pass it on yourself; it works for 24 hours, once):
              <div style={{ ...mono, fontSize: 12, margin: "8px 0 0", userSelect: "all", overflowWrap: "anywhere" }}>{temp.link}</div>
            </>
          ) : (
            <>
              Temporary password for <b>{temp.email}</b> — shown once, give it to them and ask them to change it in Settings → Account:
              <div style={{ ...mono, fontSize: 16, margin: "8px 0 0", userSelect: "all" }}>{temp.password}</div>
            </>
          )}
        </div>
      )}
      {users.length === 0 && <div style={{ fontSize: 13, color: C.parchmentDim }}>No accounts yet.</div>}
      {users.map((u) => (
        <div key={u.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "9px 0", borderTop: `1px solid ${C.border}` }}>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{u.email}</div>
            <div style={{ ...mono, fontSize: 10.5, color: C.parchmentDim }}>
              {u.handle ? `@${u.handle} · ` : ""}
              {u.locked ? <b style={{ color: C.redBright }}>LOCKED (too many wrong passwords or codes) · </b> : null}
              {u.mfa ? "two-factor on · " : ""}
              {u.verified ? "confirmed" : "NOT confirmed"} · joined {new Date(u.created).toLocaleDateString()}
              {u.updated ? ` · last save ${new Date(u.updated).toLocaleDateString()}` : ""}
            </div>
          </div>
          {u.locked && (
            <button style={button("primary")} onClick={() => act(u, "unlock")}>
              Unlock
            </button>
          )}
          {u.mfa && (
            <button style={button()} onClick={() => window.confirm(`Turn off two-factor for ${u.email}? They're signed out everywhere.`) && act(u, "mfa-off")}>
              Turn off two-factor
            </button>
          )}
          <button style={button()} onClick={() => act(u, "reset-link")}>
            Send reset link
          </button>
          {!u.verified && (
            <button style={button()} onClick={() => act(u, "confirm")}>
              Confirm email
            </button>
          )}
          <button style={button()} onClick={() => act(u, "sign-out")}>
            Sign out everywhere
          </button>
          <button style={button("danger")} onClick={() => act(u, "temp-password")}>
            Reset password
          </button>
        </div>
      ))}
    </section>
  );
}

// ---- server ----

function fmtUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

function ServerTab({ passwordFromEnv, mfaOn, onMfa, restartOpen, setRestartOpen }) {
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(() => {
    call("GET", "status").then((r) => r.ok && setSt(r.data));
  }, []);
  useEffect(load, [load]);

  async function signOutEveryone() {
    if (!window.confirm("Sign every user out? They'll have to sign in again.")) return;
    const r = await call("POST", "sign-out-everyone", {});
    setMsg(r.ok ? { kind: "ok", text: `Signed out ${r.data.sessions} session${r.data.sessions === 1 ? "" : "s"}.` } : { kind: "error", text: r.data.error || "Failed." });
    load();
  }

  async function changePassword() {
    const r = await call("POST", "password", { current: cur, next });
    if (r.ok) {
      setCur("");
      setNext("");
    }
    setMsg(r.ok ? { kind: "ok", text: "Admin password changed." } : { kind: "error", text: r.data.error || "Failed." });
  }

  async function restart() {
    const r = await call("POST", "restart", { confirm: true });
    if (!r.ok) return setMsg({ kind: "error", text: r.data.error || "Failed." });
    setRestartOpen(false);
    setRestarting(true);
    // Wait for the server to go away and come back.
    let down = false;
    for (let i = 0; i < 90; i++) {
      await new Promise((ok) => setTimeout(ok, 1000));
      try {
        const h = await fetch("/api/health", { cache: "no-store" });
        if (h.ok && down) {
          window.location.reload();
          return;
        }
      } catch (e) {
        down = true;
      }
    }
    setRestarting(false);
    setMsg({ kind: "error", text: "The server hasn't come back. If it isn't run by something that restarts it (Docker's restart policy), start it again by hand." });
  }

  const row = (k, v) => (
    <div key={k} style={{ display: "flex", gap: 12, padding: "5px 0", fontSize: 13 }}>
      <div style={{ width: 150, color: C.parchmentDim }}>{k}</div>
      <div style={{ ...mono, fontSize: 12, overflowWrap: "anywhere" }}>{v}</div>
    </div>
  );

  return (
    <>
      <Message kind={msg.kind}>{msg.text}</Message>
      {restarting && <Message kind="ok">Restarting… this page reloads when the server is back.</Message>}
      <section style={panel} aria-label="Status">
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, letterSpacing: 1, margin: "0 0 10px", color: C.goldBright }}>Status</h2>
        {!st ? (
          "Loading…"
        ) : (
          <>
            {row("Up for", fmtUptime(st.uptime))}
            {row("Node", `${st.node} on ${st.platform}`)}
            {row("Memory", `${st.memoryMb} MB`)}
            {row("Data folder", st.dataDir)}
            {row("Accounts", `${st.accounts.accounts} (${st.accounts.unconfirmed} unconfirmed) · ${st.accounts.sessions} signed-in sessions`)}
            {row(
              "Unclaimed profiles",
              st.unclaimed?.length
                ? st.unclaimed.map((u) => (u.hasPin ? u.name : `${u.name} (NO PIN — anyone can claim it)`)).join(", ")
                : "none"
            )}
            {row("Email", st.email || "not set up")}
            {row("Card database", st.cards ? (st.cards.ready ? `ready${st.cards.count ? ` · ${st.cards.count.toLocaleString()} cards` : ""}` : "not ready") : "off")}
          </>
        )}
      </section>

      <section style={panel} aria-label="Restart">
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, letterSpacing: 1, margin: "0 0 8px", color: C.goldBright }}>Restart</h2>
        <p style={{ fontSize: 12.5, color: C.parchmentDim, lineHeight: 1.5, marginTop: 0 }}>
          Restarting takes a few seconds; everyone's next request waits for it. Nothing is lost — it only works if something brings the server back up (Docker's <code>restart: unless-stopped</code>, as in the supplied compose file).
        </p>
        {restartOpen ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button style={button("danger")} onClick={restart}>
              Yes, restart now
            </button>
            <button style={button()} onClick={() => setRestartOpen(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={button("danger")} onClick={() => setRestartOpen(true)}>
              Restart the server…
            </button>
            <button style={button()} onClick={signOutEveryone}>
              Sign every user out
            </button>
          </div>
        )}
      </section>

      <section style={panel} aria-label="Admin two-factor">
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, letterSpacing: 1, margin: "0 0 8px", color: C.goldBright }}>Admin two-factor</h2>
        <MfaPanel enabled={mfaOn} who="the admin space" post={(name, body) => call("POST", `mfa/${name}`, body)} onChanged={onMfa} />
      </section>

      <section style={panel} aria-label="Admin password">
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, letterSpacing: 1, margin: "0 0 8px", color: C.goldBright }}>Admin password</h2>
        {passwordFromEnv ? (
          <div style={{ fontSize: 12.5, color: C.parchmentDim }}>Set by ADMIN_PASSWORD in the server's environment — change it there.</div>
        ) : (
          <div style={{ display: "grid", gap: 8, maxWidth: 360 }}>
            <input style={input} type="password" placeholder="Current password" aria-label="Current admin password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
            <input style={input} type="password" placeholder="New password (12+ characters)" aria-label="New admin password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <div>
              <button style={button()} onClick={changePassword}>
                Change password
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

// ---- the page ----

// One-click switch for new sign-ups, on every tab. Same setting as
// Settings → New sign-ups.
function SignupBar({ onChange }) {
  const [closed, setClosed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    call("GET", "config").then((r) => {
      if (!r.ok) return;
      const v = r.data.settings.find((s) => s.key === "REGISTRATION")?.value || "";
      setClosed(/^(closed|0|false|no|off)$/i.test(v));
    });
  }, []);

  async function toggle() {
    setBusy(true);
    setError("");
    const r = await call("PUT", "config", { set: { REGISTRATION: closed ? "open" : "closed" } });
    setBusy(false);
    if (!r.ok) return setError(r.data.error || "Couldn't change it.");
    setClosed(!closed);
    onChange();
  }

  if (closed === null) return null;
  return (
    <div
      role="status"
      style={{
        ...panel,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        borderColor: closed ? C.redBright : C.border,
      }}
    >
      <div style={{ flex: "1 1 240px", fontSize: 13 }}>
        New sign-ups are{" "}
        <b style={{ color: closed ? C.redBright : C.greenBright }}>{closed ? "BLOCKED" : "open"}</b>
        <span style={{ color: C.parchmentDim }}>{closed ? " — nobody new can create an account." : " — anyone who reaches the server can create an account."}</span>
        {error && <div style={{ color: C.redBright }}>{error}</div>}
      </div>
      <button style={button(closed ? "plain" : "danger")} onClick={toggle} disabled={busy}>
        {closed ? "Allow sign-ups" : "Block sign-ups"}
      </button>
    </div>
  );
}

export function AdminPage() {
  const [state, setState] = useState(null);
  const [settingsKey, setSettingsKey] = useState(0);
  const [tab, setTab] = useState("settings");
  const [restartOpen, setRestartOpen] = useState(false);

  const refresh = useCallback(() => {
    call("GET", "state").then((r) => setState(r.ok ? r.data : { error: r.data.error || "The admin space is switched off." }));
  }, []);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    document.title = "Admin · Binderwyrm";
  }, []);

  if (!state) return <Shell>Loading…</Shell>;
  if (state.error) return <Shell><Message kind="error">{state.error}</Message></Shell>;
  if (!state.signedIn) return <Gate configured={state.configured} onDone={refresh} />;

  async function signOut() {
    await call("POST", "logout", {});
    refresh();
  }

  const tabs = [["settings", "Settings"], ["accounts", "Accounts"], ["server", "Server"]];
  return (
    <Shell onSignOut={signOut}>
      <SignupBar onChange={() => setSettingsKey((k) => k + 1)} />
      <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            style={{
              ...button(),
              clipPath: NOTCH_SM,
              background: tab === id ? C.accentFill : "transparent",
              color: tab === id ? C.stockInk : C.parchment,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "settings" && <SettingsTab key={settingsKey} onRestart={() => { setTab("server"); setRestartOpen(true); }} />}
      {tab === "accounts" && <AccountsTab />}
      {tab === "server" && <ServerTab passwordFromEnv={state.passwordFromEnv} mfaOn={!!state.mfa} onMfa={refresh} restartOpen={restartOpen} setRestartOpen={setRestartOpen} />}
    </Shell>
  );
}
