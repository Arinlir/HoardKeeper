import React, { useState } from "react";
import { Check, LibraryBig, MapPin, Square } from "lucide-react";
import { ManaDots } from "../../components/ui/ManaDots";
import { fmt } from "../../lib/format";
import { MANA } from "../../lib/mana";
import { SOLD, finishOf } from "../../lib/scryfall";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH, NOTCH_SM } from "../../lib/tokens";

export function CardArt({ card, large }) {
  const [failed, setFailed] = useState(false);
  const src = large ? card.imageUrlLarge || card.imageUrl : card.imageUrl;
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={card.name}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return <CardFace card={card} />;
}

export function CardFace({ card }) {
  const cols = (card.colors || []).map((c) => MANA[c]).filter(Boolean);
  const wash =
    cols.length === 0
      ? `linear-gradient(155deg, #33373D, ${C.bg})`
      : cols.length === 1
      ? `linear-gradient(155deg, ${cols[0]}44, ${C.bg} 78%)`
      : `linear-gradient(155deg, ${cols[0]}44, ${cols[1]}33 45%, ${C.bg} 82%)`;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: wash,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "12px 11px",
      }}
    >
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          color: C.parchment,
          lineHeight: 1.25,
          textShadow: "0 1px 3px rgba(0,0,0,0.6)",
          // Leave room for the foil sparkle and quantity badge.
          padding: `0 ${card.quantity > 1 ? 26 : 0}px 0 ${card.foil ? 20 : 0}px`,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {card.name}
      </div>
      <div style={{ textAlign: "center", opacity: 0.5 }}>
        <LibraryBig size={26} color={C.parchment} />
      </div>
      <div
        style={{
          fontSize: 9.5,
          color: C.parchment,
          opacity: 0.75,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          lineHeight: 1.4,
        }}
      >
        <div>{card.setName || card.set || "—"}</div>
        <div style={{ opacity: 0.8 }}>
          {card.rarity || ""}
          {card.typeLine ? ` · ${card.typeLine.split("—")[0].trim()}` : ""}
        </div>
      </div>
    </div>
  );
}

export const CardTile = React.memo(function CardTile({ card, collectionName, cost, value, onClick, selectMode, selected, hasSiblings }) {
  const delta = value - cost;
  const up = delta >= 0;
  const label = `${card.name}${card.quantity > 1 ? `, quantity ${card.quantity}` : ""}${
    selectMode ? (selected ? ", selected" : ", not selected") : ""
  }`;
  return (
    <div
      className="card-tile"
      data-card-id={card.id}
      onClick={(e) => onClick(card, e)}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selectMode ? selected : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(card, e);
        }
      }}
    >
      <div
        className="sleeve"
        style={{
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
          opacity: selectMode && !selected ? 0.55 : 1,
          background: "#0C0E10",
          aspectRatio: "5 / 7",
          boxShadow: selected
            ? `0 0 0 2px ${C.goldBright}, 0 10px 20px -8px rgba(0,0,0,0.8)`
            : `0 10px 20px -8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)`,
        }}
      >
        {selectMode && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "flex-start",
              padding: 6,
            }}
          >
            <div
              style={{
                background: selected ? C.gold : "rgba(20,17,14,0.8)",
                borderRadius: 5,
                padding: 3,
                display: "flex",
              }}
            >
              {selected ? (
                <Check size={14} color={C.bg} />
              ) : (
                <Square size={14} color={C.parchmentDim} />
              )}
            </div>
          </div>
        )}
        <CardArt card={card} />

        {finishOf(card) !== "nonfoil" && (
          <>
            <div className="foil-sheen" />
            <div className="foil-edge" />
          </>
        )}

        {card.sold && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(20,17,14,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
            }}
          >
            <span
              className="display"
              style={{
                border: `2px solid ${C.goldBright}`,
                color: C.goldBright,
                borderRadius: 4,
                padding: "3px 10px",
                fontSize: 12,
                letterSpacing: 2,
                transform: "rotate(-12deg)",
                background: "rgba(20,17,14,0.75)",
              }}
            >
              SOLD
            </span>
          </div>
        )}

        {card.quantity > 1 && (
          <div
            className="mono"
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: STOCK_BG,
              border: "none",
              borderRadius: 0,
              clipPath: NOTCH_SM,
              padding: "1px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: C.stockInk,
              boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
              zIndex: 2,
            }}
          >
            x{card.quantity}
          </div>
        )}

        {/* Only shown when another row shares this card's name — this is
            specifically "which copy is this one" disambiguation (different
            printing/art, or a different finish), not clutter on every tile. */}
        {hasSiblings && (
          <div
            className="mono"
            style={{
              position: "absolute",
              bottom: 6,
              left: 6,
              zIndex: 2,
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
              maxWidth: "calc(100% - 12px)",
            }}
          >
            {card.set && (
              <span
                style={{
                  background: "rgba(10,11,13,0.82)",
                  border: `1px solid rgba(232,236,241,0.25)`,
                  borderRadius: 3,
                  padding: "1px 6px",
                  fontSize: 9,
                  letterSpacing: 0.4,
                  color: C.parchment,
                  textTransform: "uppercase",
                }}
              >
                {(card.set || "").toUpperCase()}
                {card.collectorNumber ? ` #${card.collectorNumber}` : ""}
              </span>
            )}
            {finishOf(card) !== "nonfoil" && (
              <span
                style={{
                  background: "rgba(10,11,13,0.82)",
                  border: `1px solid rgba(201,162,39,0.5)`,
                  borderRadius: 3,
                  padding: "1px 6px",
                  fontSize: 9,
                  letterSpacing: 0.4,
                  color: C.goldBright,
                  textTransform: "uppercase",
                }}
              >
                {finishOf(card)}
              </span>
            )}
          </div>
        )}

      </div>

      <div style={{ padding: "9px 0 0" }}>
        {/* the card frame's own type-line bar, in card stock */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            padding: "5px 9px",
            background: STOCK_BG,
            borderRadius: 0,
            clipPath: NOTCH_SM,
            color: C.stockInk,
            boxShadow: STOCK_SHADOW,
          }}
        >
          <span
            className={`serif${card.foil ? " foil-text" : ""}`}
            style={{
              fontWeight: 600,
              fontSize: 13,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={card.foil ? `${card.name} (foil)` : card.name}
          >
            {card.name}
          </span>
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>
            {card.sold ? fmt((card.soldPrice || 0) * (card.quantity || 1)) : fmt(value)}
          </span>
        </div>

        {/* collector line */}
        <div
          className="mono"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 5,
            padding: "0 2px",
            fontSize: 9.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: C.parchmentDim,
          }}
        >
          <span
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {collectionName}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <ManaDots colors={card.colors} />
            <span
              style={{
                fontWeight: 600,
                color: up ? C.greenBright : C.redBright,
                whiteSpace: "nowrap",
              }}
            >
              {up ? "+" : "-"}
              {fmt(Math.abs(delta))}
            </span>
          </div>
        </div>

        {card.location && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              marginTop: 3,
              fontSize: 10,
              color: C.parchmentDim,
            }}
          >
            <MapPin size={9} />
            {card.location}
          </div>
        )}
      </div>
    </div>
  );
});

/* ============================================================
   DECKS — commander deck building with an auto-drafter
   ============================================================ */

// Oracle text cache: role detection needs rules text, which cards don't carry.
// Fetched in batches of 75 and kept in localStorage.
