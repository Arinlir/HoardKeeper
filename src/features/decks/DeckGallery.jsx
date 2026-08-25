import React from "react";
import { finishOf } from "../../lib/scryfall";
import { C, STOCK_BG, STOCK_SHADOW } from "../../lib/tokens";
import { CardArt } from "../collection/CardTile";

export function DeckGallery({ deck, commander, cardById, oracleMap, isStandard }) {
  const members = [];
  if (!isStandard && commander) members.push({ card: commander, qty: 1, isCommander: true });
  deck.entries.forEach((e) => {
    const c = cardById[e.cardId];
    if (c) members.push({ card: c, qty: e.qty || 1 });
  });
  // Alphabetical by name, same reasoning as the Roles view — but the
  // commander (if pinned first above) stays first regardless.
  members.sort((a, b) => {
    if (a.isCommander) return -1;
    if (b.isCommander) return 1;
    return a.card.name.localeCompare(b.card.name);
  });

  const basics = Object.entries(deck.basics || {});

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 22,
      }}
    >
      {members.map(({ card, qty, isCommander }) => {
        const text = card.scryfallId ? oracleMap[card.scryfallId]?.t : null;
        return (
          <div key={card.id} className="card-tile" style={{ cursor: "default" }}>
            <div
              className="sleeve"
              style={{
                position: "relative",
                borderRadius: 10,
                overflow: "hidden",
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
              <CardArt card={card} />
              {finishOf(card) !== "nonfoil" && (
                <>
                  <div className="foil-sheen" />
                  <div className="foil-edge" />
                </>
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
      })}

      {basics.map(([name, n]) => (
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
      ))}
    </div>
  );
}

