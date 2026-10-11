import React, { useState, useEffect } from "react";
import { Trash2, X } from "lucide-react";
import { C, STOCK_BG } from "../../lib/tokens";

export function SelectionBar({
  count,
  shownCount,
  totalCount,
  onSelectShown,
  onSelectEverything,
  onInvert,
  onDeselect,
  onExit,
  onEdit,
  onDelete,
}) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setConfirm(false);
  }, [count]);

  const smallBtn = {
    background: "none",
    border: `1px solid ${C.border}`,
    color: C.parchmentDim,
    borderRadius: 6,
    padding: "7px 11px",
    fontSize: 12.5,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "rgba(18,20,23,0.97)",
        borderTop: `1px solid rgba(185,191,199,0.45)`,
        boxShadow: "0 -10px 30px rgba(0,0,0,0.5)",
        padding: "12px 28px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        zIndex: 40,
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 13, color: C.goldBright, fontWeight: 600, whiteSpace: "nowrap" }}
      >
        {count} selected
      </span>

      <button onClick={onSelectShown} style={smallBtn}>
        Select all shown ({shownCount})
      </button>
      {shownCount !== totalCount && (
        <button onClick={onSelectEverything} style={smallBtn}>
          Select all {totalCount}
        </button>
      )}
      <button onClick={onInvert} style={smallBtn}>
        Invert
      </button>
      {count > 0 && (
        <button onClick={onDeselect} style={smallBtn}>
          Deselect
        </button>
      )}

      <div style={{ flex: 1 }} />

      {confirm ? (
        <button
          onClick={onDelete}
          style={{
            background: C.red,
            border: "none",
            color: C.parchment,
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 12.5,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Yes, delete {count} {count === 1 ? "card" : "cards"}
        </button>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          disabled={count === 0}
          style={{
            background: "none",
            border: `1px solid ${C.red}`,
            color: C.redBright,
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 12.5,
            cursor: count === 0 ? "default" : "pointer",
            opacity: count === 0 ? 0.5 : 1,
          }}
        >
          <Trash2 size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
          Delete selected
        </button>
      )}

      <button
        onClick={onEdit}
        disabled={count === 0}
        style={{
          background: count === 0 ? C.border : STOCK_BG,
          border: "none",
          color: count === 0 ? C.parchmentDim : C.stockInk,
          borderRadius: 6,
          padding: "8px 16px",
          fontSize: 12.5,
          fontWeight: 700,
          cursor: count === 0 ? "default" : "pointer",
        }}
      >
        Edit selected
      </button>

      <button
        onClick={onExit}
        title="Leave selection mode"
        aria-label="Leave selection mode"
        style={{ background: "none", border: "none", color: C.parchmentDim, cursor: "pointer", padding: 6 }}
      >
        <X size={18} />
      </button>
    </div>
  );
}

