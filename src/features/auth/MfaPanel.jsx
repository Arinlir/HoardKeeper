import React, { useState } from "react";
import qrcode from "qrcode-generator";
import { C } from "../../lib/tokens";

// Two-factor settings, shared by the account settings and the admin page.
// `post(name, body)` talks to the right server ("setup", "enable", "disable",
// "recovery") and returns { ok, data }.

export function QrCode({ text, size = 176 }) {
  let q;
  try {
    q = qrcode(0, "M");
    q.addData(text);
    q.make();
  } catch (e) {
    return null;
  }
  const n = q.getModuleCount();
  const cells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) cells.push(`M${c + 4} ${r + 4}h1v1h-1z`);
  return (
    <svg data-testid="mfa-qr" role="img" aria-label="QR code for your authenticator app" width={size} height={size} viewBox={`0 0 ${n + 8} ${n + 8}`} shapeRendering="crispEdges" style={{ background: "#fff", display: "block" }}>
      <path d={cells.join("")} fill="#000" />
    </svg>
  );
}

const box = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, padding: 12, marginTop: 10 };
const field = { width: "100%", boxSizing: "border-box", background: C.bg, color: C.parchment, border: `1px solid ${C.border}`, borderRadius: 2, padding: "8px 10px", fontSize: 13.5, fontFamily: "inherit", marginBottom: 8 };
const btn = (primary) => ({ background: primary ? C.accent : "transparent", color: primary ? "#111" : C.parchment, border: primary ? "none" : `1px solid ${C.borderLight}`, padding: "7px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", marginRight: 8, borderRadius: 2 });

function RecoveryCodes({ codes, onDone }) {
  const text = codes.join("\n");
  return (
    <div style={box} data-testid="mfa-recovery">
      <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>
        <b>Save these recovery codes.</b> Each works once if you lose your phone. They are shown only now.
      </div>
      <pre style={{ margin: "0 0 8px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, lineHeight: 1.7 }}>{text}</pre>
      <button style={btn(false)} onClick={() => navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {})}>
        Copy
      </button>
      <button style={btn(true)} onClick={onDone}>
        I've saved them
      </button>
    </div>
  );
}

export function MfaPanel({ enabled, post, onChanged, who = "your account" }) {
  const [step, setStep] = useState("idle"); // idle | password | scan | codes | off | new
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep("idle");
    setPassword("");
    setCode("");
    setSetup(null);
    setError("");
  };
  async function run(name, body, then) {
    setBusy(true);
    setError("");
    const r = await post(name, body);
    setBusy(false);
    if (!r.ok) return setError(r.data.error || "Something went wrong.");
    then(r.data);
  }

  return (
    <div data-testid="mfa-panel">
      <div style={{ fontSize: 12.5, color: C.parchmentDim, lineHeight: 1.5 }}>
        {enabled
          ? `Two-factor is on: signing in to ${who} needs a code from your authenticator app after the password.`
          : `Add a second step to signing in to ${who}: a 6-digit code from an authenticator app (Aegis, Google Authenticator, 1Password, …).`}
      </div>
      {error && (
        <div role="alert" style={{ color: C.redBright, fontSize: 13, marginTop: 8 }}>
          {error}
        </div>
      )}

      {recovery && (
        <RecoveryCodes
          codes={recovery}
          onDone={() => {
            setRecovery(null);
            reset();
          }}
        />
      )}

      {!recovery && step === "idle" && (
        <div style={{ marginTop: 10 }}>
          {!enabled ? (
            <button style={btn(true)} onClick={() => setStep("password")}>
              Turn on two-factor
            </button>
          ) : (
            <>
              <button style={btn(false)} onClick={() => setStep("new")}>
                New recovery codes
              </button>
              <button style={btn(false)} onClick={() => setStep("off")}>
                Turn off
              </button>
            </>
          )}
        </div>
      )}

      {!recovery && step === "password" && (
        <div style={box}>
          <input style={field} type="password" aria-label="Password" placeholder="Confirm with your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button style={btn(true)} disabled={busy} onClick={() => run("setup", { password }, (d) => { setSetup(d); setPassword(""); setStep("scan"); })}>
            Continue
          </button>
          <button style={btn(false)} onClick={reset}>
            Cancel
          </button>
        </div>
      )}

      {!recovery && step === "scan" && setup && (
        <div style={box}>
          <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>Scan this with your authenticator app, then enter the 6-digit code it shows.</div>
          <QrCode text={setup.uri} />
          <div style={{ fontSize: 12, color: C.parchmentDim, margin: "8px 0" }}>
            Can't scan? Enter this key by hand: <code data-testid="mfa-secret" style={{ color: C.parchment, overflowWrap: "anywhere" }}>{setup.secret}</code>
          </div>
          <input style={field} inputMode="numeric" aria-label="Code from the app" placeholder="123456" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button style={btn(true)} disabled={busy} onClick={() => run("enable", { code }, (d) => { setRecovery(d.recovery); onChanged && onChanged(true, d); })}>
            Turn on
          </button>
          <button style={btn(false)} onClick={reset}>
            Cancel
          </button>
        </div>
      )}

      {!recovery && (step === "off" || step === "new") && (
        <div style={box}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>{step === "off" ? "Turn off two-factor" : "Make new recovery codes (the old ones stop working)"}: enter your password and a current code.</div>
          <input style={field} type="password" aria-label="Password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input style={field} aria-label="Code or recovery code" placeholder="Code from the app, or a recovery code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button
            style={btn(true)}
            disabled={busy}
            onClick={() =>
              run(step === "off" ? "disable" : "recovery", { password, code }, (d) => {
                if (step === "off") {
                  reset();
                  onChanged && onChanged(false, d);
                } else {
                  setPassword("");
                  setCode("");
                  setRecovery(d.recovery);
                }
              })
            }
          >
            {step === "off" ? "Turn off" : "Make new codes"}
          </button>
          <button style={btn(false)} onClick={reset}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
