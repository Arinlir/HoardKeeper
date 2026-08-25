import React, { useState } from "react";
import { Search } from "lucide-react";
import { scryfallSearch } from "../../lib/scryfall";
import { C, STOCK_BG, STOCK_SHADOW } from "../../lib/tokens";
import { CardArt } from "../collection/CardTile";

export function TokensPanel({ tokens, tokenCards, qtyOf, onSetQty, onAdd, onRemove }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  async function searchTokens() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      // Scryfall indexes tokens as cards; this restricts the search to them.
      const r = await scryfallSearch(`${query.trim()} t:token`, "cards", 12);
      setResults(r);
    } catch (e) {
      setResults([]);
    }
    setSearching(false);
  }

  const total = tokens.reduce((n, t) => n + qtyOf(t.id), 0);
  const stepBtn = {
    background: "none",
    borderRadius: 4,
    cursor: "pointer",
    width: 24,
    height: 22,
    padding: 0,
    fontSize: 13,
    lineHeight: 1,
  };

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
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
          Tokens to bring
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
          {tokens.length} type{tokens.length === 1 ? "" : "s"} · {total} card
          {total === 1 ? "" : "s"} to bring
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setOpen((o) => !o)}
          className="mono"
          style={{
            background: open ? "rgba(232,236,241,0.1)" : "transparent",
            border: `1px solid ${open ? C.goldBright : C.border}`,
            color: open ? C.goldBright : C.parchmentDim,
            borderRadius: 5,
            padding: "5px 11px",
            fontSize: 10,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          + Add any token
        </button>
      </div>

      {open && (
        <div style={{ marginBottom: 14, maxWidth: 520 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchTokens()}
              placeholder="Token name — treasure, zombie, clue…"
              aria-label="Token name"
              style={{
                flex: 1,
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: "9px 11px",
                color: C.parchment,
                fontSize: 13,
              }}
            />
            <button
              onClick={searchTokens}
              style={{
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 6,
                padding: "0 14px",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              {searching ? "…" : "Search"}
            </button>
          </div>
          {results.length > 0 && (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderTop: "none",
                borderRadius: "0 0 8px 8px",
                maxHeight: 220,
                overflowY: "auto",
              }}
            >
              {results.map((r) => (
                <div
                  key={r.scryfallId}
                  onClick={() => {
                    onAdd({
                      id: r.scryfallId,
                      name: r.name,
                      typeLine: r.typeLine,
                      imageUrl: r.imageUrl,
                      scryfallUri: r.scryfallUri,
                    });
                    setQuery("");
                    setResults([]);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Add token ${r.name}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onAdd({
                        id: r.scryfallId,
                        name: r.name,
                        typeLine: r.typeLine,
                        imageUrl: r.imageUrl,
                        scryfallUri: r.scryfallUri,
                      });
                      setQuery("");
                      setResults([]);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "6px 11px",
                    cursor: "pointer",
                    borderBottom: `1px solid rgba(185,191,199,0.08)`,
                  }}
                >
                  <div style={{ width: 24, aspectRatio: "5 / 7", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
                    <CardArt card={r} />
                  </div>
                  <span className="serif" style={{ fontSize: 12.5, color: C.parchment, flex: 1 }}>
                    {r.name}
                  </span>
                  <span className="mono" style={{ fontSize: 9.5, color: C.parchmentDim }}>
                    {(r.typeLine || "").replace(/^Token\s*/i, "")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tokens.length === 0 && (
        <div className="mono" style={{ fontSize: 11, color: C.parchmentDim }}>
          None of these cards make tokens — add any you want to bring anyway.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 14,
        }}
      >
        {tokens.map((t) => {
          const art = tokenCards[t.id];
          const qty = qtyOf(t.id);
          return (
            <div key={t.id} style={{ opacity: qty === 0 ? 0.4 : 1 }}>
              <div
                className="sleeve"
                style={{
                  position: "relative",
                  aspectRatio: "5 / 7",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#0C0E10",
                  boxShadow: "0 8px 16px -6px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)",
                }}
              >
                {art?.imageUrl ? (
                  <img
                    src={art.imageUrl}
                    alt={t.name}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div
                    className="mono"
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: C.parchmentDim,
                      textAlign: "center",
                      padding: 10,
                    }}
                  >
                    {t.name}
                  </div>
                )}
                {qty > 1 && (
                  <span
                    className="mono"
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
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
                {art?.power && (
                  <span
                    className="mono"
                    style={{
                      position: "absolute",
                      bottom: 6,
                      right: 6,
                      fontSize: 10,
                      fontWeight: 600,
                      background: STOCK_BG,
                      color: C.stockInk,
                      borderRadius: 3,
                      padding: "1px 6px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                    }}
                  >
                    {art.power}/{art.toughness}
                  </span>
                )}
              </div>

              <div
                style={{
                  marginTop: 7,
                  padding: "4px 8px",
                  background: STOCK_BG,
                  borderRadius: 3,
                  color: C.stockInk,
                  boxShadow: STOCK_SHADOW,
                }}
              >
                <div
                  className="serif"
                  style={{
                    fontWeight: 600,
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={t.name}
                >
                  {t.name}
                </div>
                <div className="mono" style={{ fontSize: 8.5, color: C.stockDim }}>
                  {(t.ty || art?.typeLine || "").replace(/^Token\s*/i, "").toUpperCase()}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 7 }}>
                <button
                  onClick={() => onSetQty(t.id, qty - 1)}
                  disabled={qty === 0}
                  className="mono"
                  aria-label={`Decrease ${t.name} quantity`}
                  style={{
                    ...stepBtn,
                    border: `1px solid ${C.border}`,
                    color: qty === 0 ? C.border : C.parchmentDim,
                    cursor: qty === 0 ? "default" : "pointer",
                  }}
                >
                  −
                </button>
                <span className="mono" style={{ fontSize: 12.5, color: C.goldBright, minWidth: 26, textAlign: "center" }}>
                  {qty}
                </span>
                <button
                  onClick={() => onSetQty(t.id, qty + 1)}
                  className="mono"
                  aria-label={`Increase ${t.name} quantity`}
                  style={{ ...stepBtn, border: `1px solid ${C.border}`, color: C.parchmentDim }}
                >
                  +
                </button>
              </div>

              <div
                className="mono"
                style={{ fontSize: 9, color: C.parchmentDim, marginTop: 5, lineHeight: 1.45, textAlign: "center" }}
                title={t.sources.join(", ")}
              >
                {t.sources.length > 0 ? (
                  <>
                    made by {t.sources.length} card{t.sources.length === 1 ? "" : "s"}
                    <div style={{ opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.sources.slice(0, 2).join(", ")}
                      {t.sources.length > 2 ? ` +${t.sources.length - 2}` : ""}
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => onRemove(t.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.parchmentDim,
                      fontSize: 9,
                      cursor: "pointer",
                      textDecoration: "underline",
                      padding: 0,
                    }}
                  >
                    added by hand — remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

