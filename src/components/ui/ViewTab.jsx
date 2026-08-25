import React from "react";
import { C, NOTCH } from "../../lib/tokens";

export function ViewTab({ label, active, onClick }) {
  return (
    <button
      className="display"
      onClick={onClick}
      aria-pressed={active}
      style={{
        fontWeight: 600,
        fontSize: 13.5,
        letterSpacing: 1.2,
        background: active ? C.accentFill : "transparent",
        color: active ? C.goldBright : C.parchmentDim,
        border: `1px solid ${active ? C.accent : "rgba(185,191,199,0.22)"}`,
        borderRadius: 0,
        clipPath: NOTCH,
        padding: "8px 18px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

