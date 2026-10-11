import React, { useState } from "react";
import { Image as ImageIcon, X } from "lucide-react";
import { finishOf } from "../../lib/scryfall";
import { C, STOCK_BG, STOCK_SHADOW } from "../../lib/tokens";
import { CardArt } from "../collection/CardTile";
import { IMPORT_TYPE_CATEGORIES } from "./categories";

// Card-type groups for the "By type" layout, in display order. Lands sit at
// the end, with the basic lands the deck just counts (deck.basics) split off
// into their own group after them.
const TYPE_GROUPS = [
  { key: "creature", label: "Creatures" },
  { key: "cat-planeswalkers", label: "Planeswalkers" },
  { key: "cat-battles", label: "Battles" },
  { key: "cat-artifacts", label: "Artifacts" },
  { key: "cat-enchantments", label: "Enchantments" },
  { key: "cat-instants", label: "Instants" },
  { key: "cat-sorceries", label: "Sorceries" },
  { key: "other", label: "Other" },
  { key: "land", label: "Lands" },
  { key: "basic", label: "Basic lands" },
];

function groupKeyOf(card) {
  const ty = card.typeLine || "";
  if (/\bbasic\b/i.test(ty) && /\bland\b/i.test(ty)) return "basic";
  const hit = IMPORT_TYPE_CATEGORIES.find((c) => c.test(ty.split("//")[0]));
  return hit ? hit.key : "other";
}

const SORT_KEY = "lf-deck-gallery-sort";
function loadSort() {
  try {
    return localStorage.getItem(SORT_KEY) === "az" ? "az" : "type";
  } catch {
    return "type";
  }
}

export function DeckGallery({ deck, commander, cardById, oracleMap, isStandard, coverCardId, onSetCover, onRemove }) {
  const [sort, setSortState] = useState(loadSort);
  const setSort = (v) => {
    setSortState(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {}
  };
  // A card you don't own yet reads at a glance: dimmed art, and a badge that
  // says why — the same treatment the Sets roster gives a missing card.
  const members = [];
  // one commander, or a partner pair — both pinned first, in deck order
  if (!isStandard) [].concat(commander || []).forEach((c) => c && members.push({ card: c, qty: 1, isCommander: true }));
  deck.entries.forEach((e) => {
    const c = cardById[e.cardId];
    if (c) members.push({ card: c, qty: e.qty || 1 });
  });
  // Alphabetical by name, same reasoning as the Roles view — the commander
  // (pinned first above) stays first regardless, in both layouts.
  const byName = (a, b) => a.card.name.localeCompare(b.card.name);
  members.sort((a, b) => {
    if (a.isCommander && b.isCommander) return 0;
    if (a.isCommander) return -1;
    if (b.isCommander) return 1;
    return byName(a, b);
  });

  const basics = Object.entries(deck.basics || {});

  const renderTile = ({ card, qty, isCommander }) => {
        const text = card.scryfallId ? oracleMap[card.scryfallId]?.t : null;
        const isCover = !!coverCardId && coverCardId === card.id;
        return (
          <div key={card.id} className="card-tile" style={{ cursor: "default", minWidth: 0 }}>
            <div
              className="sleeve"
              style={{
                position: "relative",
                borderRadius: 10,
                overflow: "hidden",
                filter: card.notOwned ? "grayscale(0.55)" : "none",
                background: "#0C0E10",
                aspectRatio: "5 / 7",
                boxShadow: isCommander
                  ? `0 0 0 2px ${C.goldBright}, 0 10px 20px -8px rgba(0,0,0,0.8)`
                  : "0 10px 20px -8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)",
              }}
            >
              {qty > 1 && (
                <span
                  className="mono"
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    zIndex: 2,
                    fontSize: 11,
                    fontWeight: 600,
                    background: STOCK_BG,
                    color: C.stockInk,
                    borderRadius: 3,
                    padding: "1px 7px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                  }}
                >
                  ×{qty}
                </span>
              )}
              {finishOf(card) !== "nonfoil" && (
                <>
                  <div className="foil-sheen" />
                  <div className="foil-edge" />
                </>
              )}
              {isCommander && (
                <span
                  className="mono"
                  style={{
                    position: "absolute",
                    top: 8,
                    left: 8,
                    zIndex: 2,
                    fontSize: 8.5,
                    fontWeight: 600,
                    letterSpacing: 1.2,
                    background: STOCK_BG,
                    color: C.stockInk,
                    borderRadius: 3,
                    padding: "2px 7px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                  }}
                >
                  COMMANDER
                </span>
              )}
              {card.notOwned && (
                <span
                  className="mono"
                  title="Not in your collection yet"
                  style={{
                    position: "absolute",
                    top: 8,
                    left: 8,
                    zIndex: 2,
                    fontSize: 8.5,
                    fontWeight: 600,
                    letterSpacing: 1.2,
                    background: C.accentFill,
                    border: `1px solid ${C.accent}`,
                    color: C.goldBright,
                    borderRadius: 3,
                    padding: "2px 7px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                  }}
                >
                  TO BUY
                </span>
              )}
              <CardArt card={card} />
              {finishOf(card) !== "nonfoil" && (
                <>
                  <div className="foil-sheen" />
                  <div className="foil-edge" />
                </>
              )}
              {/* Which card's art represents this deck in the all-decks
                  gallery — defaults to the commander, but a 60-card deck has
                  no commander to fall back on, and even a commander deck
                  might want a different card's art up front. */}
              {onSetCover && (
                <button
                  onClick={() => onSetCover(card.id)}
                  aria-label={isCover ? `Stop using ${card.name} as this deck's image` : `Use ${card.name} as this deck's image`}
                  aria-pressed={isCover}
                  title={isCover ? "Deck image — click to unset" : "Set as deck image"}
                  className="mono"
                  style={{
                    position: "absolute",
                    bottom: 8,
                    right: 8,
                    zIndex: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    background: isCover ? C.accentFill : "rgba(20,22,26,0.72)",
                    border: `1px solid ${isCover ? C.accent : "rgba(232,236,241,0.25)"}`,
                    color: isCover ? C.goldBright : C.parchmentDim,
                    cursor: "pointer",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                  }}
                >
                  <ImageIcon size={12} />
                </button>
              )}
              {/* No remove button on the commander tile — that's a "change
                  commander" action, not a plain deck-list removal, and lives
                  elsewhere. */}
              {onRemove && !isCommander && (
                <button
                  onClick={() => onRemove(card.id)}
                  aria-label={`Remove ${card.name} from deck`}
                  title="Remove from deck"
                  className="mono"
                  style={{
                    position: "absolute",
                    bottom: 8,
                    left: 8,
                    zIndex: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    background: "rgba(20,22,26,0.72)",
                    border: "1px solid rgba(232,236,241,0.25)",
                    color: C.parchmentDim,
                    cursor: "pointer",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* typeline caption: name + type, no price */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginTop: 9,
                padding: "5px 9px",
                background: STOCK_BG,
                borderRadius: 3,
                color: C.stockInk,
                boxShadow: STOCK_SHADOW,
              }}
            >
              <span
                className="serif"
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={card.name}
              >
                {card.name}
              </span>
              <span
                className="mono"
                style={{ fontSize: 9.5, color: C.stockDim, whiteSpace: "nowrap", flexShrink: 0 }}
              >
                {(card.set || "").toUpperCase()}
                {card.collectorNumber ? ` #${card.collectorNumber}` : ""}
              </span>
            </div>

            {/* rules text */}
            {text !== null && (
              <div
                style={{
                  marginTop: 6,
                  padding: "0 3px",
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  color: C.parchmentDim,
                  whiteSpace: "pre-line",
                }}
              >
                {text === "" ? <em style={{ opacity: 0.7 }}>No rules text.</em> : text}
              </div>
            )}
          </div>
        );
  };

  const renderBasic = ([name, n]) => (
      <div
          key={name}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            aspectRatio: "5 / 7",
            borderRadius: 10,
            border: `1.5px dashed rgba(185,191,199,0.3)`,
            color: C.parchmentDim,
          }}
        >
          <span className="display" style={{ fontSize: 26, color: C.goldBright }}>
            {n}×
          </span>
          <span className="serif" style={{ fontSize: 15 }}>{name}</span>
          <span className="mono" style={{ fontSize: 9, letterSpacing: 1.5 }}>BASIC LAND</span>
        </div>
  );

  const grid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 22,
  };

  // "By type": commander first, then one section per card type, with the
  // deck's lands and its basic lands as two separate sections at the end.
  const commanders = members.filter((m) => m.isCommander);
  const groups = [];
  if (commanders.length) groups.push({ key: "commander", label: "Commander", items: commanders.map(renderTile), count: commanders.length });
  const buckets = {};
  members.filter((m) => !m.isCommander).forEach((m) => {
    const k = groupKeyOf(m.card);
    (buckets[k] = buckets[k] || []).push(m);
  });
  TYPE_GROUPS.forEach(({ key, label }) => {
    const list = buckets[key] || [];
    const items = list.map(renderTile);
    let count = list.reduce((t, m) => t + m.qty, 0);
    if (key === "basic") {
      basics.forEach((b) => {
        items.push(renderBasic(b));
        count += b[1];
      });
    }
    if (items.length) groups.push({ key, label, items, count });
  });

  const sortBtn = (key, label) => (
    <button
      key={key}
      onClick={() => setSort(key)}
      aria-pressed={sort === key}
      className="mono"
      style={{
        fontSize: 10.5,
        letterSpacing: 0.8,
        padding: "5px 11px",
        borderRadius: 3,
        cursor: "pointer",
        border: `1px solid ${sort === key ? C.accent : "rgba(255,255,255,0.14)"}`,
        background: sort === key ? C.accentFill : "transparent",
        color: sort === key ? C.goldBright : C.parchmentDim,
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: 1.4, color: C.parchmentDim }}>SORT</span>
        {sortBtn("type", "By type")}
        {sortBtn("az", "A–Z")}
      </div>

      {sort === "az" ? (
        <div style={grid}>
          {members.map(renderTile)}
          {basics.map(renderBasic)}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} style={{ marginBottom: 28 }}>
            <div
              className="mono"
              style={{ fontSize: 10.5, letterSpacing: 1.6, textTransform: "uppercase", color: C.parchmentDim, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.08)" }}
            >
              {g.label} · {g.count}
            </div>
            <div style={grid}>{g.items}</div>
          </section>
        ))
      )}
    </div>
  );
}
