import React from "react";
import { C, NOTCH_SM } from "../../lib/tokens";

// `partial`: this chip's scope contains the active one — a parent collection
// while one of its sub-collections is picked. Outlined, not filled.
export function Chip({ label, active, partial = false, onClick, testId }) {
  return (
    <button
      className="chip"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      style={{
        background: active ? C.accentFill : "transparent",
        color: active ? C.goldBright : partial ? C.accent : C.parchmentDim,
        border: `1px solid ${active || partial ? C.accent : C.border}`,
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

