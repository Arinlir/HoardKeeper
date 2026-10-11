import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Flashlight, FlashlightOff, X } from "lucide-react";
import { C, NOTCH, NOTCH_SM } from "../../../lib/tokens";
import { candidatesFromFrame, createStabilizer, guideRect } from "../../../lib/liveScan";
import { createResolver, anyNameMatches } from "../../../lib/scanResolve";
import { localCardsReady } from "../../../lib/scryfall";

// The phone app's live scanner, full screen.
//
// The camera is NOT in this page: the native LiveScanner plugin puts a real
// camera preview behind the WebView and makes the WebView see-through. While
// this overlay is up, <html> carries `bw-scanning`, which (index.css) makes
// the page background transparent and hides the whole app (#root) — this
// overlay is portalled to <body>, outside #root, so it's the only thing drawn
// over the camera.
//
// Each "textRecognized" event is a frame's worth of text. liveScan.js keeps
// what's inside the card guide, finds the collector line with the same parser
// the web scanner uses, and only accepts a code once two frames agree. Then
// onDetected(set, number) fires and the overlay closes — the Add Card screen
// looks the card up exactly as if it had been typed.
//
// `plugin` is injectable so tests can drive it without a phone.
const HINT_AFTER_MS = 9000;

// The same card must be out of view (neither its code nor its name seen in any frame) this long before it counts as another copy.
export const REPEAT_GAP_MS = 1200;

// With `onScanned` the scanner is continuous: the camera stays open, every
// confirmed card goes straight to onScanned(card, set, number), and a running
// list builds up until Done. Without it, the first confirmed code closes the
// scanner (onDetected), as before.
export function LiveScanOverlay({ onDetected, onClose, plugin, resolver, onScanned }) {
  const continuous = !!onScanned;
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;
  const [scanned, setScanned] = useState([]);
  // Timing readout so "slow" can be pinned on a stage: gap between frames,
  // how long the phone's recogniser took, the card lookup, and adding it.
  const perfRef = useRef({ gap: 0, ocr: 0, lookup: 0, add: 0, last: 0 });
  const [perf, setPerf] = useState(null);
  useEffect(() => {
    const t = setInterval(() => setPerf({ ...perfRef.current }), 500);
    return () => clearInterval(t);
  }, []);
  const lastCard = useRef(null);
  const lastKey = useRef("");
  const lastSeenAt = useRef(0);
  const [phase, setPhase] = useState("starting"); // starting | scanning | error
  const [error, setError] = useState("");
  const [reading, setReading] = useState(""); // best current guess, e.g. "FDN 245"
  const [lastText, setLastText] = useState("");
  const [torch, setTorch] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [suggest, setSuggest] = useState(null); // a real card whose name didn't match what was read
  const stabilizer = useRef(createStabilizer());
  const resolverRef = useRef(resolver || createResolver());
  const busy = useRef(false);
  const done = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const detectRef = useRef(onDetected);
  detectRef.current = onDetected;

  const guide = guideRect(view.w, view.h);
  const guideRef = useRef(guide);
  guideRef.current = guide;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Android back button (see lib/nativeShell.js) closes the scanner.
  useEffect(() => {
    const onBack = () => closeRef.current?.();
    window.addEventListener("bw-scanner-back", onBack);
    return () => window.removeEventListener("bw-scanner-back", onBack);
  }, []);

  useEffect(() => {
    if (phase !== "scanning" || reading) return undefined;
    const t = setTimeout(() => setShowHint(true), HINT_AFTER_MS);
    return () => clearTimeout(t);
  }, [phase, reading]);

  useEffect(() => {
    let cancelled = false;
    let listener = null;
    const html = document.documentElement;
    html.classList.add("bw-scanning");
    localCardsReady().catch(() => {}); // settle "is the server's card database up?" before the first lookup needs it

    (async () => {
      try {
        listener = await plugin.addListener("textRecognized", (event) => {
          if (done.current) return;
          const nowMs = performance.now();
          const pf = perfRef.current;
          if (pf.last) pf.gap = Math.round(pf.gap ? pf.gap * 0.7 + (nowMs - pf.last) * 0.3 : nowMs - pf.last);
          pf.last = nowMs;
          if (typeof event?.ms === "number") pf.ocr = Math.round(pf.ocr ? pf.ocr * 0.7 + event.ms * 0.3 : event.ms);
          const { candidates, text, names } = candidatesFromFrame(event, viewRef.current, guideRef.current);
          if (nowMs - (pf.textAt || 0) > 400) {
            pf.textAt = nowMs;
            setLastText(text.replace(/\s+/g, " ").trim().slice(0, 80));
          }
          const top = candidates[0] || null;
          // The card just scanned is still in front of the camera as long as any
          // frame shows its code or its name — however blurry the rest.
          if (lastKey.current) {
            const sameCode = candidates.some((c) => `${c.set}#${c.number}` === lastKey.current);
            // Only a card that has been in view without a break stays "the same one":
            // after a real gap, its reappearance must not erase the gap.
            const present = sameCode || (lastCard.current && anyNameMatches(names, lastCard.current));
            if (present && Date.now() - lastSeenAt.current < REPEAT_GAP_MS) lastSeenAt.current = Date.now();
          }
          setReading(top ? `${top.set} ${top.number}` : "");
          const stable = stabilizer.current.push(top);
          if (!top || busy.current) return;
          // Name across the top + code along the bottom, compared: the code is
          // looked up and the card must carry the name that was read. Agreement
          // is enough on ONE frame; without it nothing is taken.
          busy.current = true;
          resolverRef.current
            .resolve({ candidates, names })
            .catch(() => ({ status: "unverifiable" }))
            .then((res) => {
              busy.current = false;
              if (typeof resolverRef.current.lastLookupMs === "number") perfRef.current.lookup = resolverRef.current.lastLookupMs;
              if (done.current || cancelled) return;
              const accept = (card, set, number) => {
                if (continuous && card) {
                  const key = `${set}#${number}`;
                  const now = Date.now();
                  const repeat = lastKey.current === key && now - lastSeenAt.current < REPEAT_GAP_MS;
                  lastSeenAt.current = now;
                  if (repeat) return; // still the same card in front of the camera
                  lastKey.current = key;
                  lastCard.current = card;
                  try {
                    navigator.vibrate?.(35);
                  } catch (e) {}
                  setSuggest(null);
                  const a0 = performance.now();
                  onScannedRef.current?.(card, set, number);
                  perfRef.current.add = Math.round(performance.now() - a0);
                  setScanned((prev) => [{ name: card.name, set, number, img: card.imageUrl, card, n: 1 }, ...prev].slice(0, 100));
                  return;
                }
                done.current = true;
                try {
                  navigator.vibrate?.(35);
                } catch (e) {}
                detectRef.current?.(set, number);
                closeRef.current?.();
              };
              if (res.status === "confirmed") return accept(res.card, res.set, res.number);
              if (res.status === "mismatch") {
                setSuggest({ set: res.set, number: res.number, name: res.card?.name, card: res.card });
                return;
              }
              setSuggest(null);
              // No name to compare (or no way to look it up): fall back to the
              // same code twice in a row.
              if ((res.status === "code-only" || res.status === "unverifiable") && stable) {
                accept(res.card, stable.set, stable.number);
              }
            });
        });
        await plugin.start({ backgroundColor: C.bg });
        if (!cancelled) setPhase("scanning");
      } catch (e) {
        if (cancelled) return;
        // Nothing is behind the page any more — show the app's own colours
        // under the error rather than a see-through hole.
        html.classList.remove("bw-scanning");
        setPhase("error");
        setError(
          e?.code === "PERMISSION_DENIED"
            ? "Camera access is off for Binderwyrm. Turn it on in the phone's Settings → Apps → Binderwyrm → Permissions, or type the code below instead."
            : `Couldn't start the camera${e?.message ? ` — ${e.message}` : ""}.`
        );
      }
    })();

    return () => {
      cancelled = true;
      html.classList.remove("bw-scanning");
      try {
        listener?.remove?.();
      } catch (e) {}
      plugin.stop().catch(() => {});
    };
  }, [plugin]);

  async function toggleTorch() {
    try {
      await plugin.setTorch({ enabled: !torch });
      setTorch(!torch);
    } catch (e) {
      setTorch(false);
    }
  }

  function focusAt(e) {
    if (phase !== "scanning") return;
    plugin.focus({ x: e.clientX / view.w, y: e.clientY / view.h }).catch(() => {});
  }

  const iconBtn = {
    width: 44,
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: C.bgPanel,
    border: `1px solid ${C.borderLight}`,
    borderRadius: 0,
    clipPath: NOTCH_SM,
    color: C.goldBright,
    cursor: "pointer",
  };

  const overlay = (
    <div
      className="bw-scan-layer"
      data-testid="live-scan"
      role="dialog"
      aria-modal="true"
      aria-label="Scan a card"
      onClick={focusAt}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: phase === "error" ? C.bg : "transparent",
        fontFamily: "'Archivo', sans-serif",
        color: C.parchment,
        touchAction: "manipulation",
      }}
    >
      {phase !== "error" && (
        <>
          {/* Dimmed surround: four flat rectangles (a spread-shadow this big is
              re-rasterised over the live camera and is slow on mid-range phones). */}
          {[
            { left: 0, top: 0, width: "100%", height: guide.top },
            { left: 0, top: guide.top + guide.height, width: "100%", height: Math.max(view.h - guide.top - guide.height, 0) },
            { left: 0, top: guide.top, width: guide.left, height: guide.height },
            { left: guide.left + guide.width, top: guide.top, width: Math.max(view.w - guide.left - guide.width, 0), height: guide.height },
          ].map((r, i) => (
            <div key={i} aria-hidden="true" style={{ position: "absolute", ...r, background: "rgba(12,14,17,0.62)", pointerEvents: "none" }} />
          ))}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: guide.left,
              top: guide.top,
              width: guide.width,
              height: guide.height,
              borderRadius: guide.width * 0.045,
              border: `2px solid ${reading ? C.accent : "rgba(242,244,246,0.85)"}`,
              pointerEvents: "none",
            }}
          >
            {/* Where the collector line sits on a modern card. */}
            <div
              style={{
                position: "absolute",
                left: "4%",
                width: "48%",
                bottom: "2.5%",
                height: "8%",
                border: `1.5px dashed ${C.accent}`,
                borderRadius: 3,
              }}
            />
          </div>

          <div
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              right: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <button
              aria-label="Close scanner"
              style={iconBtn}
              onClick={(e) => {
                e.stopPropagation();
                onClose?.();
              }}
            >
              <X size={20} />
            </button>
            <button
              aria-label={torch ? "Turn the light off" : "Turn the light on"}
              aria-pressed={torch}
              style={{ ...iconBtn, background: torch ? C.accentFill : C.bgPanel }}
              onClick={(e) => {
                e.stopPropagation();
                toggleTorch();
              }}
            >
              {torch ? <FlashlightOff size={19} /> : <Flashlight size={19} />}
            </button>
          </div>
        </>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          bottom: 20,
          background: C.bgPanel,
          border: `1px solid ${C.border}`,
          borderRadius: 0,
          clipPath: NOTCH,
          padding: "14px 16px",
        }}
      >
        {phase === "error" ? (
          <>
            <div role="alert" style={{ display: "flex", gap: 8, color: C.redBright, fontSize: 13.5, lineHeight: 1.5 }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{error}</span>
            </div>
            <button
              onClick={() => onClose?.()}
              style={{
                marginTop: 12,
                width: "100%",
                background: C.accentFill,
                border: `1px solid ${C.accent}`,
                borderRadius: 0,
                clipPath: NOTCH,
                color: C.goldBright,
                padding: "11px",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </>
        ) : (
          <>
            <div data-testid="live-scan-status" aria-live="polite" style={{ fontSize: 14, fontWeight: 600, color: reading ? C.accent : C.goldBright }}>
              {phase === "starting"
                ? "Starting the camera…"
                : reading
                  ? `Reading ${reading}…`
                  : "Fit the card in the frame"}
              {continuous && scanned.length > 0 && (
                <span data-testid="live-scan-count" style={{ float: "right", color: C.greenBright }}>
                  {scanned.reduce((n, x) => n + (x.n || 1), 0)} scanned
                </span>
              )}
            </div>
            {continuous && scanned.length > 0 && (
              <div data-testid="live-scan-last" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                {scanned[0].img && <img src={scanned[0].img} alt="" style={{ width: 34, borderRadius: 3, flexShrink: 0 }} />}
                <div style={{ minWidth: 0, fontSize: 13 }}>
                  <div style={{ color: C.greenBright, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    ✓ {scanned[0].name}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: C.parchmentDim }}>
                    {scanned[0].set} #{scanned[0].number}
                  </div>
                </div>
                <button
                  data-testid="live-scan-plus"
                  aria-label="Add another copy"
                  onClick={(e) => {
                    e.stopPropagation();
                    const top = scanned[0];
                    if (!top?.card) return;
                    onScannedRef.current?.(top.card, top.set, top.number);
                    setScanned((prev) => [{ ...prev[0], n: (prev[0].n || 1) + 1 }, ...prev.slice(1)]);
                  }}
                  style={{
                    marginLeft: "auto",
                    background: "transparent",
                    border: `1px solid ${C.border}`,
                    borderRadius: 0,
                    clipPath: NOTCH_SM,
                    color: C.parchment,
                    padding: "9px 12px",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {scanned[0].n > 1 ? `×${scanned[0].n} ` : ""}+1
                </button>
                <button
                  data-testid="live-scan-done"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose?.();
                  }}
                  style={{
                    background: C.accentFill,
                    border: `1px solid ${C.accent}`,
                    borderRadius: 0,
                    clipPath: NOTCH,
                    color: C.goldBright,
                    padding: "9px 16px",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </div>
            )}
            <div style={{ fontSize: 12, color: C.parchmentDim, marginTop: 4, lineHeight: 1.45 }}>
              {showHint
                ? "Not catching it? Tap the card to focus, try the light, or tilt it a little to lose the glare."
                : "Keep the name and the set code + number (bottom left) sharp — tap to focus."}
            </div>
            {suggest && (
              <button
                data-testid="live-scan-use-anyway"
                onClick={() => {
                  if (done.current) return;
                  if (continuous && suggest.card) {
                    lastKey.current = `${suggest.set}#${suggest.number}`;
                    lastCard.current = suggest.card;
                    lastSeenAt.current = Date.now();
                    onScannedRef.current?.(suggest.card, suggest.set, suggest.number);
                    setScanned((prev) => [{ name: suggest.name, set: suggest.set, number: suggest.number, img: suggest.card.imageUrl }, ...prev]);
                    setSuggest(null);
                    return;
                  }
                  done.current = true;
                  detectRef.current?.(suggest.set, suggest.number);
                  closeRef.current?.();
                }}
                style={{
                  marginTop: 8,
                  width: "100%",
                  background: C.accentFill,
                  border: `1px solid ${C.accent}`,
                  borderRadius: 0,
                  clipPath: NOTCH,
                  color: C.goldBright,
                  padding: "9px",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Name didn't match — use {suggest.name} ({suggest.set} #{suggest.number}) anyway
              </button>
            )}
            {perf && perf.gap > 0 && (
              <div data-testid="live-scan-perf" className="mono" style={{ fontSize: 10, color: C.parchmentDim, marginTop: 6 }}>
                frames every {perf.gap} ms · read {perf.ocr || "?"} ms · lookup {perf.lookup || "-"} ms · add {perf.add || "-"} ms
              </div>
            )}
            {lastText && (
              <div className="mono" style={{ fontSize: 10, color: C.parchmentDim, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                sees: {lastText}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
