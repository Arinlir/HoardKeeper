import React from "react";
import { C, NOTCH } from "../../lib/tokens";

export function IconButton({ onClick, label, icon, disabled, active, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={typeof label === "string" && label ? undefined : title}
      aria-pressed={active}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: active ? C.accentFill : "transparent",
        color: active ? C.goldBright : C.parchmentDim,
        border: `1px solid ${active ? C.accent : C.border}`,
        borderRadius: 0,
        clipPath: NOTCH,
        padding: "8px 12px",
        fontSize: 12.5,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

