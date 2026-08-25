import React from "react";
import { LibraryBig, Upload } from "lucide-react";
import { C, STOCK_BG } from "../../lib/tokens";
import { IconButton } from "./IconButton";

export function EmptyState({ onAddCard, onImport }) {
  return (
    <div
      style={{
        marginTop: 60,
        textAlign: "center",
        color: C.parchmentDim,
        padding: 40,
        border: `1px dashed rgba(185,191,199,0.3)`,
        borderRadius: 12,
      }}
    >
      <LibraryBig size={28} color={C.gold} style={{ marginBottom: 10 }} />
      <div className="display" style={{ fontSize: 18, color: C.goldBright, marginBottom: 6 }}>
        The vault is empty
      </div>
      <div style={{ fontSize: 13, marginBottom: 18 }}>
        Add your first card, or bring in an existing collection from a CSV.
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button
          onClick={onAddCard}
          style={{
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 6,
            padding: "9px 16px",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Add a card
        </button>
        <IconButton onClick={onImport} label="Import CSV" icon={<Upload size={15} />} />
      </div>
    </div>
  );
}

