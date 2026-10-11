import React from "react";
import { C, NOTCH } from "../../lib/tokens";

export function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1,
        background: active ? C.accentFill : "transparent",
        color: active ? C.goldBright : C.parchmentDim,
        border: `1px solid ${active ? C.accent : C.border}`,
        borderRadius: 0,
        clipPath: NOTCH,
        padding: "8px 0",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}


