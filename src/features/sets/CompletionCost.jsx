import React, { useMemo } from "react";
import { fmt } from "../../lib/format";
import { C, CONSOLE } from "../../lib/tokens";

export function CompletionCost({ roster, ownedCount }) {
  const { missing, cost, unpriced } = useMemo(() => {
    let missing = 0, cost = 0, unpriced = 0;
    roster.forEach((e) => {
      if (ownedCount(e) > 0) return;
      missing++;
      if (e.usd !== null && e.usd !== undefined) cost += e.usd;
      else unpriced++;
    });
    return { missing, cost, unpriced };
  }, [roster, ownedCount]);

  if (missing === 0) {
    return (
      <div className="mono" style={{ fontSize: 11.5, color: CONSOLE.green, padding: "0 4px 14px", letterSpacing: 0.3 }}>
        SET COMPLETE — every card accounted for.
      </div>
    );
  }
  return (
    <div className="mono" style={{ fontSize: 11.5, color: CONSOLE.dim, padding: "0 4px 14px", letterSpacing: 0.3 }}>
      {missing} missing · completing at market would cost about{" "}
      <span style={{ color: CONSOLE.accent, fontWeight: 600 }}>{fmt(cost)}</span>
      {unpriced > 0 ? ` (${unpriced} unpriced)` : ""}
    </div>
  );
}

