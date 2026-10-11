import React from "react";
import { ExternalLink } from "lucide-react";
import { buyLinks } from "../../lib/buyLinks";
import { C, NOTCH_SM } from "../../lib/tokens";

/*
 * A row of "buy this" links. Small, quiet, and always the same three shops in
 * the same order, so it becomes muscle memory rather than something to read.
 */
export function BuyLinks({ card, compact = false, style }) {
  const links = buyLinks(card);
  if (links.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", ...style }}>
      {links.map((l) => (
        <a
          key={l.key}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`${l.label} — ${l.hint}`}
          className="mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: `1px solid ${C.border}`,
            clipPath: NOTCH_SM,
            color: C.parchmentDim,
            textDecoration: "none",
            fontSize: compact ? 9 : 10,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            padding: compact ? "3px 7px" : "5px 9px",
          }}
        >
          {l.label}
          <ExternalLink size={compact ? 9 : 10} />
        </a>
      ))}
    </div>
  );
}
