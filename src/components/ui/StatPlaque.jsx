import React from "react";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH } from "../../lib/tokens";

export function StatPlaque({ label, value, tone, sub }) {
  const toneColor = tone === "up" ? C.greenBright : tone === "down" ? C.redBright : C.stockInk;
  return (
    <div
      style={{
        background: STOCK_BG,
        color: C.stockInk,
        borderRadius: 0,
        clipPath: NOTCH,
        padding: "9px 16px 10px",
        minWidth: 116,
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
        }}
      >
        {label}
      </span>
      <strong className="mono" style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.5, color: toneColor }}>
        {value}
      </strong>
      {sub && (
        <span className="mono" style={{ fontSize: 10, marginLeft: 6, color: toneColor, opacity: 0.8 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

