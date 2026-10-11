import React from "react";
import { CUR, PRICE_SOURCES, fmt, fmtNative } from "../../lib/format";
import { marketPrice, marketPriceUsd, priceSourceOf } from "../../lib/scryfall";
import { C } from "../../lib/tokens";

// Both markets side by side, each in its own currency — the way you'd see it
// on the site — with the one your totals use marked. EU and US prices for the
// same printing routinely differ by more than any exchange rate explains, so
// the other number is worth seeing even when you don't price on it.
export function MarketPrices({ card, compact = false, style }) {
  const used = priceSourceOf(card);
  const chosen = CUR.source === "cardmarket" ? "cardmarket" : "tcgplayer";
  const rows = ["cardmarket", "tcgplayer"].map((src) => {
    const meta = PRICE_SOURCES[src];
    const native = marketPrice(card, src);
    // Also in the display currency, when that isn't the market's own.
    const shown = !compact && native !== null && CUR.code !== meta.native ? fmt(marketPriceUsd(card, src)) : null;
    return { src, meta, native, shown };
  });
  return (
    <div data-testid="market-prices" style={{ marginBottom: compact ? 0 : 10, ...style }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: compact ? "2px 10px" : "4px 14px" }}>
        {rows.map(({ src, meta, native, shown }) => {
          const on = used === src;
          return (
            <div
              key={src}
              data-market={src}
              data-active={on ? "true" : "false"}
              className="mono"
              title={on ? "The price totals here are based on" : undefined}
              style={{ fontSize: compact ? 10.5 : 11.5, color: on ? C.parchment : C.parchmentDim, whiteSpace: "nowrap" }}
            >
              <span style={{ fontSize: compact ? 8.5 : 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: on ? C.accent : C.parchmentDim }}>
                {meta.label}
              </span>{" "}
              {fmtNative(native, src)}
              {shown ? <span style={{ color: C.parchmentDim }}> ≈ {shown}</span> : null}
            </div>
          );
        })}
      </div>
      {!compact && used && used !== chosen ? (
        <div style={{ fontSize: 11.5, color: C.parchmentDim, marginTop: 3 }}>
          No {PRICE_SOURCES[chosen].label} price for this printing — using {PRICE_SOURCES[used].label}'s.
        </div>
      ) : null}
    </div>
  );
}
