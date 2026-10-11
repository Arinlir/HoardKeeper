/*
 * The Life Counter's look and the few hooks its pieces share.
 *
 * The screen is deliberately its own thing — flat saturated colour on black,
 * heavy rounded numerals, dark rounded panels with big round icon buttons —
 * rather than the app's ink-and-slate chrome, because it is read from across a
 * table at arm's length, often upside down. Nothing here knows about the rest
 * of the app.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Binderwyrm's own ink-and-slate palette (same family as the rest of the app):
// slate panels on an ink canvas, one slate-blue accent. `yellow` is the name the
// "switched on" colour had before the restyle; it is the accent now.
export const L = {
  black: "#101317",
  panel: "#1B1F26",
  well: "#262B33",
  yellow: "#6FA6D1",
  red: "#D4566B",
  white: "#F2F4F6",
  dim: "rgba(242,244,246,0.6)",
  line: "rgba(255,255,255,0.14)",
};

// The app's signature: chrome is cut at an angle, not rounded. Tiles lose two
// opposite corners, small things lose one.
export const CUT = 22;
export const TILE_CLIP = `polygon(0 0, calc(100% - ${CUT}px) 0, 100% ${CUT}px, 100% 100%, ${CUT}px 100%, 0 calc(100% - ${CUT}px))`;
export const NOTCH_CLIP = "polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%)";
export const NOTCH_CLIP_SM = "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)";

export const LABEL_FONT = '"Cinzel", "Spectral", Georgia, serif';
export const FONT = '"Archivo", system-ui, -apple-system, "Segoe UI", sans-serif';
// Heavy, rounded numerals. ui-rounded is SF Rounded on Apple devices; the rest
// fall through to the bundled mono, which is at least tabular and bold.
export const NUMBER_FONT = 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", "IBM Plex Mono", monospace';

export const labelStyle = {
  fontFamily: LABEL_FONT,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: 11,
  color: L.white,
};

export const GAP = 8;
export const TILE_RADIUS = 0;

export const OVERLAY = {
  position: "fixed",
  inset: 0,
  zIndex: 96,
  background: "rgba(0,0,0,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "clamp(14px, 4vw, 30px)",
};

export const PANEL = {
  background: L.panel,
  color: L.white,
  borderRadius: 0,
  clipPath: TILE_CLIP,
  padding: "24px clamp(18px, 4vw, 26px)",
  width: "100%",
  maxWidth: 400,
  maxHeight: "88vh",
  overflowY: "auto",
  fontFamily: FONT,
};

// A pill button. `tone` picks the fill: the default is the dark well, "on" is
// the yellow of a switched-on thing, "go" the primary action.
export function pill(tone = "plain", extra = {}) {
  const tones = {
    plain: { background: L.well, color: L.white },
    on: { background: L.yellow, color: L.black },
    go: { background: L.yellow, color: L.black },
    danger: { background: L.red, color: L.white },
    ghost: { background: "transparent", color: L.white, boxShadow: `inset 0 0 0 2px ${L.line}` },
  };
  return {
    ...tones[tone],
    border: "none",
    borderRadius: 0,
    clipPath: NOTCH_CLIP,
    padding: "11px 18px",
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 12.5,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    touchAction: "manipulation",
    ...extra,
  };
}

export function roundBtn(size = 52, on = false, extra = {}) {
  return {
    width: size,
    height: size,
    borderRadius: 0,
    clipPath: NOTCH_CLIP,
    border: "none",
    background: on ? L.yellow : L.well,
    color: on ? L.black : L.white,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    touchAction: "manipulation",
    ...extra,
  };
}

/*
 * Measure an element and keep measuring. jsdom has no layout and reports zero,
 * which is treated as "no measurement yet" and keeps the fallback, so the same
 * code renders sensibly under test.
 */
export function useSize(ref, fallback = { w: 200, h: 400 }) {
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
      }
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return size;
}

/*
 * A box that reads the way a seat's player sees it. A seat facing sideways is
 * tall and narrow on the screen but wide and short to the person sitting there,
 * so its contents are laid out in the player's frame — width and height
 * swapped — and the whole frame is turned. `children` gets that frame's size.
 */
export function Rotated({ rot = 0, children, interactive = false, style }) {
  const ref = useRef(null);
  const { w, h } = useSize(ref);
  const sideways = rot === 90 || rot === -90;
  const fw = sideways ? h : w;
  const fh = sideways ? w : h;
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: fw,
          height: fh,
          transform: `translate(-50%, -50%) rotate(${rot}deg)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: interactive ? "auto" : "none",
          ...style,
        }}
      >
        {typeof children === "function" ? children({ w: fw, h: fh }) : children}
      </div>
    </div>
  );
}

/*
 * Tap for one step; hold and it keeps going, and keeps going faster, so
 * dropping someone from 40 to 3 isn't thirty-seven taps.
 *
 * Pointer events cover mouse and touch alike, so there's no second event to
 * double-count. A click with `detail === 0` is keyboard activation (and how the
 * tests press things), which never sends a pointer down — that one is handled
 * on click.
 */
export function useHold() {
  const ref = useRef({ timer: null, interval: null, ticks: 0 });
  const clear = useCallback(() => {
    clearTimeout(ref.current.timer);
    clearInterval(ref.current.interval);
    ref.current = { timer: null, interval: null, ticks: 0 };
  }, []);
  useEffect(() => clear, [clear]);
  const start = (run) => {
    run(1);
    clear();
    ref.current.timer = setTimeout(() => {
      ref.current.interval = setInterval(() => {
        ref.current.ticks += 1;
        run(ref.current.ticks > 14 ? 5 : 1);
      }, 110);
    }, 420);
  };
  const press = (run) => ({
    onClick: (e) => {
      if (!e.detail) run(1);
    },
    onPointerDown: () => start(run),
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e) => e.preventDefault(),
  });
  return { press, clear };
}

// Plus and minus drawn as bars rather than glyphs: they stay the same weight
// at any size and don't depend on a font having a proper minus.
export function Sign({ kind, color, size = 26, opacity = 0.3 }) {
  const t = Math.max(3, Math.round(size / 5));
  const bar = { position: "absolute", background: color, borderRadius: 0, left: "50%", top: "50%" };
  return (
    <span aria-hidden="true" style={{ position: "relative", width: size, height: size, display: "inline-block", opacity }}>
      <span style={{ ...bar, width: size, height: t, transform: "translate(-50%,-50%)" }} />
      {kind === "plus" && <span style={{ ...bar, width: t, height: size, transform: "translate(-50%,-50%)" }} />}
    </span>
  );
}

// Two seats' worth of figure, for the Partners switch.
export function PartnersIcon({ size = 26, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <path d="M12 5a8 8 0 1 0 0 18V5z" fill={color} />
      <circle cx="20.500" cy="12.500" r="4" fill={color} />
    </svg>
  );
}

/*
 * The numerals. Heavy single-stroke figures with round ends, drawn as paths so
 * they look the same on every device — a "rounded" system font only exists on
 * Apple's. Each digit lives in a 13 × 16 box; the text a screen reader (or a
 * test) sees is carried alongside as visually-hidden text.
 */
const GLYPHS = {
  0: "M4.200 2 H6.800 A3.200 3.200 0 0 1 10 5.200 V10.800 A3.200 3.200 0 0 1 6.800 14 H4.200 A3.200 3.200 0 0 1 1 10.800 V5.200 A3.200 3.200 0 0 1 4.200 2 Z",
  1: "M2.500 5.500 L6 2 V14",
  2: "M1.500 5 A4 3.300 0 0 1 9.500 5 C9.500 8.500 1.500 10.500 1.500 14 H9.800",
  3: "M1.500 3.500 C2.500 1.500 8.500 1.200 9 4.500 C9.200 6.500 6.500 7.600 4.800 7.800 C7.500 7.800 9.800 9 9.600 11.200 C9.300 14.500 3 15 1.200 12",
  4: "M7.500 14 V2 L1.200 10.200 H10",
  5: "M9 2 H2.500 L2 7.200 C5 5.700 9.500 6.300 9.600 10 C9.700 13.500 5 15 1.500 12.800",
  6: "M8.500 2.500 C5 1.800 1.500 4.500 1.500 9.500 C1.500 12.500 3 14 5.500 14 C8 14 9.500 12.300 9.500 10.200 C9.500 8 8 6.800 5.800 6.800 C3.800 6.800 2.200 7.900 1.600 9.200",
  7: "M1.500 2.500 H9.800 L4.800 14",
  8: "M5.500 7.800 C3 7.800 1.800 6.300 1.800 4.800 C1.800 3.200 3.200 2 5.500 2 C7.800 2 9.200 3.200 9.200 4.800 C9.200 6.300 8 7.800 5.500 7.800 C2.800 7.800 1.200 9.300 1.200 11 C1.200 12.800 2.800 14 5.500 14 C8.200 14 9.800 12.800 9.800 11 C9.800 9.300 8.200 7.800 5.500 7.800 Z",
  9: "M2.500 13.500 C6 14.200 9.500 11.500 9.500 6.500 C9.500 3.500 8 2 5.500 2 C3 2 1.500 3.700 1.500 5.800 C1.500 8 3 9.200 5.200 9.200 C7.200 9.200 8.800 8.100 9.400 6.800",
  "-": "M2 8 H9",
};

export function StrokeNumber({ text, em, color }) {
  const chars = [...String(text)].filter((c) => GLYPHS[c] !== undefined);
  const n = Math.max(1, chars.length);
  return (
    <span className="mono life-num" style={{ display: "block", fontSize: em, lineHeight: 1, color, position: "relative" }}>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>{text}</span>
      <svg aria-hidden="true" viewBox={`0 0 ${13 * n} 16`} style={{ display: "block", width: `${(n * 13 * 0.97) / 16}em`, height: "0.97em", overflow: "visible" }}>
        {chars.map((c, i) => (
          <path key={i} d={GLYPHS[c]} transform={`translate(${i * 13 + 1.2} 0)`} fill="none" stroke="currentColor" strokeWidth="2.100" strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit="3" />
        ))}
      </svg>
    </span>
  );
}
