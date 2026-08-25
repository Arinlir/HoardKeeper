import React from "react";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH_SM } from "../../lib/tokens";

export function Stepper({ n, onMinus, onPlus }) {
  const btn = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 15,
    fontWeight: 600,
    background: "transparent",
    border: "none",
    color: C.stockInk,
    cursor: "pointer",
    width: 30,
    height: "100%",
    lineHeight: 1,
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: STOCK_BG,
        borderRadius: 0,
        clipPath: NOTCH_SM,
        boxShadow: STOCK_SHADOW,
        overflow: "hidden",
        width: 96,
        height: 29,
      }}
    >
      <button
        aria-label="Decrease quantity"
        style={{ ...btn, color: n === 0 ? "#B5B8B3" : C.stockInk, cursor: n === 0 ? "default" : "pointer" }}
        disabled={n === 0}
        onClick={onMinus}
      >
        −
      </button>
      <span
        className="mono"
        aria-live="polite"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: n === 0 ? "#9A9E99" : C.stockInk,
          width: 36,
          textAlign: "center",
          borderLeft: "1px solid rgba(255,255,255,0.16)",
          borderRight: "1px solid rgba(255,255,255,0.16)",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {n}
      </span>
      <button aria-label="Increase quantity" style={btn} onClick={onPlus}>
        +
      </button>
    </div>
  );
}

