import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { C } from "../../lib/tokens";

// A modal that takes the whole screen — for the jobs where a 480px dialog is
// too small to do the work in (searching for cards by picture). Same contract
// as ModalShell: Escape closes it, it carries data-role="modal-backdrop" so
// stacking/backdrop logic and tests treat it as a modal, and the page behind
// it stops scrolling while it's open.
//
// `tabs` sits in the header next to the title; `children` fill the body, which
// is a flex row (main pane + side panel) — the caller decides what those are.
export function FullScreenShell({ title, onClose, tabs, status, children }) {
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      data-role="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId.current}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: C.bg,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="fss-head"
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px 16px",
          padding: "10px clamp(10px, 2vw, 22px)",
          background: C.bgPanel,
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <h2
          id={titleId.current}
          className="serif"
          style={{ margin: 0, fontSize: 18, fontWeight: 600, color: C.goldBright, whiteSpace: "nowrap" }}
        >
          {title}
        </h2>
        {tabs && <div className="fss-tabs" style={{ display: "flex", gap: 8, minWidth: 0, flex: "0 1 440px" }}>{tabs}</div>}
        <div style={{ flex: 1 }} />
        {status}
        <button
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          style={{
            background: "none",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            color: C.parchmentDim,
            cursor: "pointer",
            display: "flex",
            padding: 6,
            minWidth: 34,
            minHeight: 34,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={18} />
        </button>
      </div>
      <div className="fss-body" style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
        {children}
      </div>
    </div>
  );
}
