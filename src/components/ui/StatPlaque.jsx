import React from "react";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH } from "../../lib/tokens";

// One shape for every figure in the header: a label, then the figure itself on
// a single unwrapped line. There used to be a percentage trailing the
// Unrealized amount as loose inline text, which broke across two lines with a
// suffixed currency like "Kč" and made that plaque taller and differently
// shaped than its neighbours. The percentages are gone now — every plaque is
// one label and one number.
export function StatPlaque({ label, value, tone, hint }) {
  const toneColor = tone === "up" ? C.greenBright : tone === "down" ? C.redBright : C.stockInk;
  return (
    <div
      title={hint}
      style={{
        background: STOCK_BG,
        color: C.stockInk,
        borderRadius: 0,
        clipPath: NOTCH,
        padding: "9px 16px 10px",
        minWidth: 96,
        // Basis `auto`, not a fixed 96px: with a fixed basis flexbox fits three
        // plaques onto a phone-width row and then lets their un-wrappable
        // figures run off the screen. Sizing from real content means the row
        // wraps at the right place instead.
        flex: "1 1 auto",
        maxWidth: "100%",
        boxShadow: STOCK_SHADOW,
      }}
    >
      <span
        className="mono"
        style={{
          display: "block",
          fontSize: 8.5,
          letterSpacing: 1.8,
          textTransform: "uppercase",
          color: C.stockDim,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <strong
        className="mono"
        style={{
          display: "block",
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: -0.5,
          color: toneColor,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </strong>
    </div>
  );
}
