import React, { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH } from "../../lib/tokens";

// sideNav (optional): { onPrev, onNext } — big previous/next arrows flanking the
// dialog, outside it (DetailModal's card stepper). A null handler shows that
// arrow disabled. Hidden on narrow screens via .modal-side-nav in index.css,
// where the small arrows in the title bar (headerExtra) take over.
function SideArrow({ dir, onClick }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight;
  const label = dir < 0 ? "Previous card" : "Next card";
  return (
    <button
      className="modal-side-nav"
      data-role={dir < 0 ? "side-prev" : "side-next"}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      disabled={!onClick}
      aria-label={label}
      title={`${label} (${dir < 0 ? "←" : "→"})`}
      style={{ clipPath: NOTCH, borderRadius: 0 }}
    >
      <Icon size={52} strokeWidth={2.5} />
    </button>
  );
}

// Backdrop click-to-close that ignores a click that began inside the dialog:
// a press inside it followed by a release on the backdrop is not a backdrop click. A plain onClick also fires
// when you press inside the dialog (selecting text, dragging a slider, a
// button that re-renders under the cursor) and let go outside it — the browser
// reports that click on the common ancestor, i.e. the backdrop — which closed
// the dialog and lost what you were doing.
export function useBackdropClose(onClose) {
  const pressedInside = useRef(false);
  return {
    onMouseDown: (e) => {
      pressedInside.current = e.target !== e.currentTarget;
    },
    onClick: (e) => {
      const ok = e.target === e.currentTarget && !pressedInside.current;
      pressedInside.current = false;
      if (ok) onClose?.();
    },
  };
}

export function ModalShell({ title, onClose, children, width = 480, headerExtra = null, sideNav = null }) {
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`);
  const backdropProps = useBackdropClose(onClose);

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
      {...backdropProps}
    >
      {sideNav && <SideArrow dir={-1} onClick={sideNav.onPrev} />}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
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
            margin: "14px clamp(10px, 3vw, 14px) 0",
            padding: "8px clamp(10px, 3vw, 14px)",
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
          {/* headerExtra: optional controls that sit next to the close button
              (DetailModal's previous/next card stepper). */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {headerExtra}
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
        </div>
        <div style={{ padding: "18px clamp(12px, 4vw, 24px) 24px", position: "relative" }}>{children}</div>
      </div>
      {sideNav && <SideArrow dir={1} onClick={sideNav.onNext} />}
    </div>
  );
}

