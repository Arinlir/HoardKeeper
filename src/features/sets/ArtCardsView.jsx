import React, { useState, useEffect, useMemo } from "react";
import { Loader2, Palette, Search, X } from "lucide-react";
import { Stepper } from "../../components/ui/Stepper";
import { UNCATEGORIZED } from "../../lib/scryfall";
import { C, CONSOLE } from "../../lib/tokens";
import { CompletionCost } from "./CompletionCost";
import { RARITY_FILL, cleanArtCardName, fetchArtSeriesCompanions, fetchSetRoster } from "./rosterUtils";

export function ArtCardsView({ cards, onAddCopy, onRemoveCopy }) {
  const owned = useMemo(() => cards.filter((c) => !c.sold && c.set), [cards]);
  const ownedSetCodes = useMemo(
    () => [...new Set(owned.map((c) => c.set.toLowerCase()))],
    [owned]
  );

  const [companions, setCompanions] = useState(null); // null = loading
  const [companionError, setCompanionError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [rosterFilter, setRosterFilter] = useState("all");
  const [rosterSearch, setRosterSearch] = useState("");
  const [targetCollection, setTargetCollection] = useState(UNCATEGORIZED);
  const [flashKey, setFlashKey] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const map = await fetchArtSeriesCompanions();
        if (live) setCompanions(map);
      } catch (e) {
        if (live) setCompanionError("Couldn't reach Scryfall to look up art series companions.");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Which of your owned sets actually have a companion art series, and how
  // many art cards from that series you already own.
  const artSets = useMemo(() => {
    if (!companions) return [];
    return ownedSetCodes
      .filter((code) => companions[code])
      .map((code) => {
        const comp = companions[code];
        const distinct = new Set(
          cards.filter((c) => !c.sold && (c.set || "").toLowerCase() === comp.code.toLowerCase())
            .map((c) => c.collectorNumber || c.name)
        ).size;
        return { parentCode: code, ...comp, owned: distinct };
      })
      .sort((a, b) => b.owned - a.owned || a.name.localeCompare(b.name));
  }, [companions, ownedSetCodes, cards]);

  function ownedCount(entry) {
    const match = owned.find(
      (c) =>
        (c.scryfallId && c.scryfallId === entry.scryfallId) ||
        (c.set === entry.set && c.collectorNumber === entry.collectorNumber)
    );
    return match ? match.quantity || 1 : 0;
  }

  async function openRoster(code) {
    if (expanded === code) {
      setExpanded(null);
      setRoster(null);
      return;
    }
    setExpanded(code);
    setRoster(null);
    setRosterError("");
    setRosterFilter("all");
    setRosterSearch("");
    setRosterLoading(true);
    try {
      const r = await fetchSetRoster(code);
      setRoster(r);
    } catch (e) {
      setRosterError("Couldn't load this art series from Scryfall. Try again in a moment.");
    }
    setRosterLoading(false);
  }

  if (companionError) {
    return (
      <div style={{ color: C.redBright, fontSize: 13, padding: "6px 4px" }}>{companionError}</div>
    );
  }

  if (companions === null) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.parchmentDim, fontSize: 13.5 }}>
        <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
        Checking which of your sets have a companion art series…
      </div>
    );
  }

  if (artSets.length === 0) {
    return (
      <div
        style={{
          border: `1px dashed ${CONSOLE.line2}`,
          borderRadius: 2,
          padding: 36,
          textAlign: "center",
          color: CONSOLE.dim,
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        <Palette size={22} color={CONSOLE.accent} style={{ marginBottom: 10 }} />
        <div>None of your sets have a companion art series yet.</div>
        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
          Art series cards ship alongside specific sets — e.g. Tales of Middle-earth, most
          recent Secret Lairs — and only show up here once you own a card from a set that has
          one.
        </div>
      </div>
    );
  }

  const cardmarketUrl = (name) =>
    `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(name)}`;

  return (
    <>
      {artSets.map((art) => {
        const isOpen = expanded === art.code;
        const pct = art.count ? Math.round((art.owned / art.count) * 100) : null;
        return (
          <div
            key={art.code}
            style={{
              borderBottom: `1px solid ${CONSOLE.line}`,
              borderLeft: `3px solid ${pct === 100 ? CONSOLE.green : pct !== null ? CONSOLE.accent : CONSOLE.line2}`,
            }}
          >
            <div
              onClick={() => openRoster(art.code)}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              aria-label={`${art.name}, ${isOpen ? "close" : "expand"} roster`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openRoster(art.code);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                padding: "18px 4px 18px 14px",
                cursor: "pointer",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="mono" style={{ fontWeight: 600, fontSize: 15, color: CONSOLE.bright }}>
                  {art.name}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: CONSOLE.dim,
                    marginTop: 4,
                  }}
                >
                  {art.code.toUpperCase()} · from your {art.parentCode.toUpperCase()} cards ·{" "}
                  {art.owned}/{art.count} owned
                </div>
              </div>

              {art.count && (
                <div style={{ width: 220, maxWidth: "40vw" }}>
                  <div
                    style={{
                      height: 5,
                      background: CONSOLE.panel2,
                      borderRadius: 2,
                      overflow: "hidden",
                      boxShadow: `inset 0 0 0 1px ${CONSOLE.line}`,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: pct === 100 ? CONSOLE.green : CONSOLE.accent,
                        borderRadius: 2,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="mono" style={{ fontWeight: 700, fontSize: 20, color: CONSOLE.bright, minWidth: 74, textAlign: "right" }}>
                {pct !== null ? `${pct}%` : "…"}
                <span
                  className="mono"
                  style={{ display: "block", fontSize: 9, letterSpacing: 1.5, color: CONSOLE.dim, fontWeight: 400, marginTop: 2 }}
                >
                  {isOpen ? "CLOSE" : "COMPLETE"}
                </span>
              </div>
            </div>

            {isOpen && (
              <div style={{ paddingBottom: 24 }}>
                {rosterLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.parchmentDim, fontSize: 13, padding: "6px 4px 14px" }}>
                    <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                    Loading the art series from Scryfall…
                  </div>
                )}
                {rosterError && (
                  <div style={{ color: C.redBright, fontSize: 13, padding: "6px 4px 14px" }}>{rosterError}</div>
                )}

                {roster && (
                  <>
                    <CompletionCost roster={roster} ownedCount={ownedCount} />

                    <div style={{ border: `1px solid ${CONSOLE.line}`, borderRadius: 2, overflow: "hidden", marginLeft: 14 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                          padding: "11px 14px",
                          background: CONSOLE.panel2,
                          borderBottom: `1px solid ${CONSOLE.line}`,
                        }}
                      >
                        <div style={{ display: "flex", gap: 6 }}>
                          {["all", "missing", "owned"].map((f) => (
                            <button
                              key={f}
                              onClick={() => setRosterFilter(f)}
                              className="mono"
                              aria-pressed={rosterFilter === f}
                              style={{
                                fontSize: 10,
                                letterSpacing: 1,
                                textTransform: "uppercase",
                                background: rosterFilter === f ? CONSOLE.accent : "transparent",
                                color: rosterFilter === f ? CONSOLE.panel : CONSOLE.dim,
                                border: `1px solid ${rosterFilter === f ? CONSOLE.accent : CONSOLE.line2}`,
                                borderRadius: 2,
                                padding: "4px 10px",
                                cursor: "pointer",
                              }}
                            >
                              {f}
                            </button>
                          ))}
                        </div>

                        <input
                          value={rosterSearch}
                          onChange={(e) => setRosterSearch(e.target.value)}
                          placeholder="Filter names…"
                          aria-label="Filter roster by name"
                          className="mono"
                          style={{
                            background: CONSOLE.panel,
                            border: `1px solid ${CONSOLE.line2}`,
                            borderRadius: 2,
                            padding: "6px 10px",
                            color: CONSOLE.bright,
                            fontSize: 12,
                            width: 150,
                          }}
                        />

                        <label
                          className="mono"
                          style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: CONSOLE.dim }}
                        >
                          New cards go to
                          <select
                            value={targetCollection}
                            onChange={(e) => setTargetCollection(e.target.value)}
                            className="mono"
                            style={{
                              background: CONSOLE.panel,
                              border: `1px solid ${CONSOLE.line2}`,
                              borderRadius: 2,
                              padding: "5px 8px",
                              color: CONSOLE.bright,
                              fontSize: 11.5,
                              textTransform: "none",
                              letterSpacing: 0,
                            }}
                          >
                            <option value={UNCATEGORIZED}>Uncategorized</option>
                          </select>
                        </label>
                      </div>

                      <div style={{ maxHeight: 440, overflowY: "auto", background: CONSOLE.panel }}>
                        {roster
                          .filter((e) => {
                            const n = ownedCount(e);
                            if (rosterFilter === "missing" && n > 0) return false;
                            if (rosterFilter === "owned" && n === 0) return false;
                            const nm = cleanArtCardName(e.name);
                            if (rosterSearch && !nm.toLowerCase().includes(rosterSearch.toLowerCase())) return false;
                            return true;
                          })
                          .map((e, i) => {
                            const n = ownedCount(e);
                            const displayName = cleanArtCardName(e.name);
                            const key = e.scryfallId || `${e.set}-${e.collectorNumber}`;
                            return (
                              <div
                                key={key}
                                className={flashKey === key ? "rowflash" : ""}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "52px 1fr 110px 110px",
                                  gap: 12,
                                  alignItems: "center",
                                  padding: "8px 14px",
                                  background: i % 2 === 1 ? "rgba(255,255,255,0.012)" : "transparent",
                                  borderBottom: `1px solid ${CONSOLE.line}`,
                                  fontSize: 13,
                                }}
                                onMouseEnter={(ev) => setPreview({ entry: e, y: ev.clientY })}
                                onMouseMove={(ev) => setPreview({ entry: e, y: ev.clientY })}
                                onMouseLeave={() => setPreview(null)}
                              >
                                <span className="mono" style={{ fontSize: 10.5, color: CONSOLE.dim }}>
                                  #{e.collectorNumber}
                                </span>
                                <span
                                  className="mono"
                                  style={{
                                    fontWeight: 500,
                                    color: n > 0 ? CONSOLE.bright : CONSOLE.dim,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 7,
                                      height: 7,
                                      borderRadius: "50%",
                                      marginRight: 8,
                                      verticalAlign: 1,
                                      background: RARITY_FILL[e.rarity] || C.rarityCommon,
                                    }}
                                  />
                                  {displayName}
                                </span>
                                <span
                                  className="mono"
                                  style={{
                                    fontSize: 10.5,
                                    color: CONSOLE.dim,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                  title={e.artist || ""}
                                >
                                  {e.artist || ""}
                                </span>
                                <Stepper
                                  n={n}
                                  onMinus={() => {
                                    onRemoveCopy(e);
                                    setFlashKey(key);
                                  }}
                                  onPlus={() => {
                                    onAddCopy({ ...e, name: displayName, isArt: true }, targetCollection);
                                    setFlashKey(key);
                                  }}
                                />
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {preview && preview.entry.imageUrl && (
        <div
          style={{
            position: "fixed",
            left: 24,
            top: Math.min(Math.max(preview.y - 140, 16), window.innerHeight - 300),
            zIndex: 60,
            pointerEvents: "none",
            width: 200,
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 20px 40px -10px rgba(0,0,0,0.85), 0 0 0 1px rgba(232,236,241,0.2)",
          }}
        >
          <img
            src={preview.entry.imageUrl}
            alt={cleanArtCardName(preview.entry.name)}
            style={{ width: "100%", display: "block" }}
          />
        </div>
      )}
    </>
  );
}

