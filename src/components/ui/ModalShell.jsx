import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH } from "../../lib/tokens";

export function ModalShell({ title, onClose, children, width = 480 }) {
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-role="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,11,13,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "clamp(10px, 4vw, 20px)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bgPanel,
          border: `1px solid ${C.border}`,
          borderRadius: 3,
          width: "100%",
          maxWidth: width,
          maxHeight: "88vh",
          overflowY: "auto",
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.85)",
          position: "relative",
        }}
      >
        {/* flat notched title bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            margin: "14px 14px 0",
            padding: "8px 14px",
            background: STOCK_BG,
            borderRadius: 0,
            clipPath: NOTCH,
            boxShadow: STOCK_SHADOW,
            position: "relative",
          }}
        >
          <h2
            id={titleId.current}
            className="serif"
            style={{ margin: 0, fontSize: 16.5, fontWeight: 600, color: C.stockInk }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: C.stockDim,
              cursor: "pointer",
              display: "flex",
              padding: 4,
              minWidth: 28,
              minHeight: 28,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "18px 24px 24px", position: "relative" }}>{children}</div>
      </div>
    </div>
  );
}

