import React from "react";
import { C, NOTCH_SM } from "../../lib/tokens";

export function Chip({ label, active, onClick }) {
  return (
    <button
      className="chip"
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? C.accentFill : "transparent",
        color: active ? C.goldBright : C.parchmentDim,
        border: `1px solid ${active ? C.accent : C.border}`,
        borderRadius: 0,
        clipPath: NOTCH_SM,
        padding: "6px 13px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

