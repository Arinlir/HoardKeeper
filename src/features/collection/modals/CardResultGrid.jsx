import React, { useEffect, useState } from "react";
import { Grid3x3, LayoutGrid, Maximize2 } from "lucide-react";
import { fmt } from "../../../lib/format";
import { availableFinishes, priceForFinish } from "../../../lib/scryfall";
import { C } from "../../../lib/tokens";
import { CardArt } from "../CardTile";

// The picture-first results the full-screen "Add a card" search is built from:
// a grid of card faces with the details a collector actually reads printed
// underneath (set, number, rarity, price), so you can tell printings apart
// without opening each one.

// Minimum tile width per size. Same three names as the collection's own size
// switch; the numbers are bigger, because a search result has to be judged by
// its artwork.
export const RESULT_MIN_PX = { compact: 140, comfortable: 200, large: 270 };

const SIZE_KEY = "hk-add-tile-size";

export function useResultSize() {
  const [size, setSize] = useState(() => {
    try {
      const v = localStorage.getItem(SIZE_KEY);
      return v && RESULT_MIN_PX[v] ? v : "comfortable";
    } catch (e) {
      return "comfortable";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SIZE_KEY, size);
    } catch (e) {}
  }, [size]);
  return [size, setSize];
}

// What a printing costs in each finish it exists in — only prices Scryfall
// actually has (a foil that falls back to the normal price would just repeat
// the first figure). Goes through priceForFinish, so it reads in the display
// currency, and in Cardmarket euros for a collection that buys there.
export function tilePrices(card) {
  const have = availableFinishes(card);
  const out = [];
  if (have.includes("nonfoil")) {
    const v = priceForFinish({ ...card, finish: "nonfoil", foil: false });
    if (v !== null && v !== undefined) out.push({ tag: "", value: v });
  }
  if (have.includes("foil") && (card.usdFoil ?? card.eurFoil) != null) {
    const v = priceForFinish({ ...card, finish: "foil", foil: true });
    if (v !== null && v !== undefined) out.push({ tag: "foil", value: v });
  }
  if (have.includes("etched") && (card.usdEtched ?? card.eurEtched) != null) {
    const v = priceForFinish({ ...card, finish: "etched", foil: false });
    if (v !== null && v !== undefined) out.push({ tag: "etched", value: v });
  }
  return out;
}

export function PriceLine({ card, style }) {
  const prices = tilePrices(card);
  if (!prices.length) {
    return (
      <span className="mono" style={{ fontSize: 11.5, color: C.parchmentDim, ...style }}>
        no price
      </span>
    );
  }
  return (
    <span className="mono" style={{ display: "inline-flex", gap: 9, flexWrap: "wrap", fontSize: 11.5, ...style }}>
      {prices.map((p) => (
        <span key={p.tag || "normal"} style={{ color: p.tag ? C.accent : C.goldBright }}>
          {p.tag === "foil" ? "✦ " : p.tag === "etched" ? "etched " : ""}
          {fmt(p.value)}
        </span>
      ))}
    </span>
  );
}

export function rarityLabel(r) {
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : "";
}

export function rarityColor(r) {
  return { common: C.rarityCommon, uncommon: C.rarityUncommon, rare: C.rarityRare, mythic: C.rarityMythic }[r] || C.parchmentDim;
}

export function ResultSizeControl({ value, onChange }) {
  return (
    <div
      title="Card size"
      className="acs-size"
      style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", flexShrink: 0 }}
    >
      {[
        { key: "compact", icon: <Grid3x3 size={14} /> },
        { key: "comfortable", icon: <LayoutGrid size={14} /> },
        { key: "large", icon: <Maximize2 size={14} /> },
      ].map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          title={t.key.charAt(0).toUpperCase() + t.key.slice(1)}
          aria-label={`${t.key} result size`}
          aria-pressed={value === t.key}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "8px 10px",
            background: value === t.key ? C.gold : "transparent",
            color: value === t.key ? C.bg : C.parchmentDim,
            border: "none",
            cursor: "pointer",
          }}
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}

// minmax(min(Npx, 100%), 1fr): as many columns as fit, never wider than the
// pane. The 0 in the phone rule (see .acs-grid in App's stylesheet) is what
// stops a long name from stretching a column past the screen.
export function ResultGrid({ size, children }) {
  return (
    <div
      className="acs-grid"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${RESULT_MIN_PX[size] || 200}px, 100%), 1fr))`,
        gap: "14px 14px",
      }}
    >
      {children}
    </div>
  );
}

// One result. `primary` is the headline node (the card's name, or for a list
// of one card's printings the set it's from), `secondary`/`tertiary` are the
// mono detail lines, and the price line is always last.
export function ResultTile({ card, primary, secondary, tertiary, selected, ownedQty = 0, size, onSelect, title }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={!!selected}
      className="acs-tile"
      title={title}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        minWidth: 0,
        cursor: "pointer",
        padding: 6,
        borderRadius: 10,
        background: selected ? C.bgPanel2 : "transparent",
        boxShadow: selected ? `inset 0 0 0 2px ${C.accent}` : "none",
      }}
    >
      <div
        className="acs-art"
        style={{
          position: "relative",
          aspectRatio: "5 / 7",
          borderRadius: "4.7% / 3.4%",
          overflow: "hidden",
          background: C.bgPanel2,
          boxShadow: "0 4px 10px -4px rgba(0,0,0,0.8)",
        }}
      >
        <CardArt card={card} large={size === "large"} />
        {ownedQty > 0 && (
          <span
            className="mono"
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              background: "rgba(21,23,27,0.9)",
              color: C.greenBright,
              border: `1px solid ${C.green}`,
              borderRadius: 4,
              fontSize: 10,
              padding: "2px 6px",
            }}
          >
            Owned ×{ownedQty}
          </span>
        )}
      </div>
      <div style={{ padding: "8px 2px 0", minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13.5,
            color: C.parchment,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {primary}
        </div>
        {secondary && (
          <div
            className="mono"
            style={{ fontSize: 10.5, color: C.parchmentDim, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {secondary}
          </div>
        )}
        {tertiary && (
          <div
            className="mono"
            style={{ fontSize: 10.5, color: C.parchmentDim, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {tertiary}
          </div>
        )}
        <div style={{ marginTop: 4 }}>
          <PriceLine card={card} />
        </div>
      </div>
    </div>
  );
}
