import React from "react";
import { FINISHES, availableFinishes, treatmentTags } from "../../../lib/scryfall";
import { C, STOCK_BG, STOCK_SHADOW } from "../../../lib/tokens";

export function FinishPicker({ card, value, onChange }) {
  const avail = availableFinishes(card);
  const opts = FINISHES.filter((f) => avail.includes(f.key));
  const list = opts.length ? opts : [FINISHES[0]];
  return (
    <div role="group" aria-label="Finish" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {list.map((f) => {
        const on = value === f.key;
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            aria-pressed={on}
            style={{
              background: on ? STOCK_BG : "transparent",
              color: on ? C.stockInk : C.parchmentDim,
              border: `1px solid ${on ? C.stock : C.border}`,
              borderRadius: 5,
              padding: "7px 13px",
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              cursor: "pointer",
              boxShadow: on ? STOCK_SHADOW : "none",
            }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

// Read-only description of the printing's treatment.
export function TreatmentTags({ card }) {
  const tags = treatmentTags(card);
  if (!tags.length) return null;
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
      {tags.map((t) => (
        <span
          key={t}
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            border: `1px solid ${C.border}`,
            color: C.parchmentDim,
            borderRadius: 3,
            padding: "2px 7px",
          }}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

