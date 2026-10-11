import React from "react";
import { fmt } from "../../lib/format";
import { C, STOCK_BG, STOCK_SHADOW } from "../../lib/tokens";

export function MoversPanel({ movers }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.045)",
        border: `1px solid rgba(185,191,199,0.18)`,
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            background: STOCK_BG,
            color: C.stockInk,
            fontWeight: 600,
            padding: "4px 9px",
            borderRadius: 3,
            boxShadow: STOCK_SHADOW,
          }}
        >
          MOVERS
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
          since last refresh
        </span>
      </div>

      {movers.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.parchmentDim, padding: "24px 0", textAlign: "center" }}>
          No movement recorded yet. Refresh prices twice to start comparing.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {movers.map((m) => {
            const up = m.delta >= 0;
            return (
              <div
                key={m.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  paddingBottom: 7,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span
                  style={{
                    fontSize: 12.5,
                    color: C.parchment,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.name}
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: up ? C.greenBright : C.redBright,
                    whiteSpace: "nowrap",
                  }}
                >
                  {up ? "+" : "-"}
                  {fmt(Math.abs(m.delta))}{" "}
                  <span style={{ opacity: 0.7 }}>
                    ({up ? "+" : ""}
                    {m.pct.toFixed(1)}%)
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

