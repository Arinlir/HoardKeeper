import React, { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, Loader2, Palette } from "lucide-react";
import { Stepper } from "../../components/ui/Stepper";
import { UNCATEGORIZED, sleep } from "../../lib/scryfall";
import { C, CONSOLE } from "../../lib/tokens";
import { CardArt } from "../collection/CardTile";
import { ArtCardsView } from "./ArtCardsView";
import { CompletionCost } from "./CompletionCost";
import { RARITY_FILL, RARITY_ORDER, fetchSetInfo, fetchSetRoster, groupRosterByName } from "./rosterUtils";

export function SetsView({ cards, collections, onAddCopy, onRemoveCopy }) {
  const [subView, setSubView] = useState("owned"); // "owned" | "art"
  const owned = useMemo(() => cards.filter((c) => !c.sold && c.set), [cards]);

  // group owned cards by set code
  const ownedBySet = useMemo(() => {
    const m = {};
    owned.forEach((c) => {
      const k = c.set.toLowerCase();
      if (!m[k]) m[k] = { setName: c.setName || k.toUpperCase(), cards: [] };
      m[k].cards.push(c);
    });
    return m;
  }, [owned]);

  const [infos, setInfos] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");
  const [targetCollection, setTargetCollection] = useState(UNCATEGORIZED);
  const [flashKey, setFlashKey] = useState(null);

  // fetch set totals for every set we own cards from
  useEffect(() => {
    let live = true;
    (async () => {
      for (const code of Object.keys(ownedBySet)) {
        if (infos[code]) continue;
        try {
          const d = await fetchSetInfo(code);
          if (!live) return;
          setInfos((prev) => ({ ...prev, [code]: d }));
        } catch (e) {
          if (!live) return;
          setInfos((prev) => ({ ...prev, [code]: { name: ownedBySet[code].setName, count: null } }));
        }
        await sleep(60);
      }
    })();
    return () => { live = false; };
  }, [ownedBySet]);

  async function openRoster(code) {
    if (expanded === code) { setExpanded(null); setRoster(null); return; }
    setExpanded(code);
    setRoster(null);
    setRosterError("");
    setRosterSearch("");
    setPreviewGroup(null);
    setRosterLoading(true);
    try {
      const r = await fetchSetRoster(code);
      setRoster(r);
    } catch (e) {
      setRosterError("Couldn't load the set roster from Scryfall. Try again in a moment.");
    }
    setRosterLoading(false);
  }

  // one index instead of a linear scan per roster row
  const ownedIndex = useMemo(() => {
    const byId = {};
    const bySetCn = {};
    owned.forEach((c) => {
      if (c.scryfallId) byId[c.scryfallId] = c;
      if (c.set && c.collectorNumber) bySetCn[`${c.set}|${c.collectorNumber}`] = c;
    });
    return { byId, bySetCn };
  }, [owned]);

  function ownedCount(entry) {
    const match =
      (entry.scryfallId && ownedIndex.byId[entry.scryfallId]) ||
      ownedIndex.bySetCn[`${entry.set}|${entry.collectorNumber}`];
    return match ? match.quantity || 1 : 0;
  }

  // distinct-cards-owned per set for completion (unique CARD NAMES, not
  // printing rows — see groupRosterByName above)
  function distinctOwned(code, fullRoster) {
    if (fullRoster) {
      return groupRosterByName(fullRoster, ownedCount).filter((g) => g.isOwned).length;
    }
    // without roster, approximate by unique collector numbers / names owned
    const seen = new Set();
    ownedBySet[code].cards.forEach((c) => seen.add(c.collectorNumber || c.name));
    return seen.size;
  }

  const groupedRoster = useMemo(
    () => (roster ? groupRosterByName(roster, ownedCount) : null),
    [roster, ownedIndex]
  );

  // Click-through preview: a large view of one card, with prev/next paging
  // across every printing of that name — the direct way to actually look at
  // a missing card, or to browse which of several versions (a "3 versions"
  // card like Capitoline Triad) you'd want to go find.
  const [previewGroup, setPreviewGroup] = useState(null); // { name, printings } | null
  const [previewIndex, setPreviewIndex] = useState(0);

  function openPreview(g) {
    const startAt = g.printings.findIndex((p) => p === g.display);
    setPreviewGroup(g);
    setPreviewIndex(startAt >= 0 ? startAt : 0);
  }

  useEffect(() => {
    if (!previewGroup) return;
    const onKey = (e) => {
      if (e.key === "Escape") setPreviewGroup(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [previewGroup]);

  const setCodes = Object.keys(ownedBySet).sort(
    (a, b) => ownedBySet[b].cards.length - ownedBySet[a].cards.length
  );

  return (
    <main
      className="mono"
      style={{ padding: "16px clamp(14px, 4vw, 30px) 48px", background: CONSOLE.panel, minHeight: "calc(100vh - 160px)" }}
    >
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: `1px solid ${CONSOLE.line}` }}>
        <button
          onClick={() => setSubView("owned")}
          className="mono"
          aria-pressed={subView === "owned"}
          style={{
            background: "none",
            color: subView === "owned" ? CONSOLE.accent : CONSOLE.dim,
            border: "none",
            borderBottom: `2px solid ${subView === "owned" ? CONSOLE.accent : "transparent"}`,
            borderRadius: 0,
            padding: "9px 16px",
            fontSize: 11,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Owned Sets
        </button>
        <button
          onClick={() => setSubView("art")}
          className="mono"
          aria-pressed={subView === "art"}
          style={{
            background: "none",
            color: subView === "art" ? CONSOLE.accent : CONSOLE.dim,
            border: "none",
            borderBottom: `2px solid ${subView === "art" ? CONSOLE.accent : "transparent"}`,
            borderRadius: 0,
            padding: "9px 16px",
            fontSize: 11,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Palette size={12} style={{ marginRight: 5, verticalAlign: -2 }} />
          Art Cards
        </button>
      </div>

      {subView === "art" ? (
        <ArtCardsView cards={cards} onAddCopy={onAddCopy} onRemoveCopy={onRemoveCopy} />
      ) : (
      <>
      {setCodes.length === 0 && (
        <div
          style={{
            border: `1px dashed ${CONSOLE.line2}`,
            borderRadius: 2,
            padding: 36,
            textAlign: "center",
            color: CONSOLE.dim,
            fontSize: 13.5,
          }}
        >
          Add some cards first — sets you own cards from will appear here with completion tracking.
        </div>
      )}

      {setCodes.map((code) => {
        const info = infos[code];
        const isOpen = expanded === code;
        const distinct = distinctOwned(code, isOpen ? roster : null);
        const total = info?.count || null;
        const pct = total ? Math.round((distinct / total) * 100) : null;

        // rarity bars need the roster, grouped so a card with several
        // printings only counts once toward "have" rather than once per
        // variant
        let rarityBars = null;
        if (isOpen && groupedRoster) {
          rarityBars = RARITY_ORDER.map((rar) => {
            const inSet = groupedRoster.filter((g) => g.display.rarity === rar);
            const have = inSet.filter((g) => g.isOwned).length;
            return { rar, have, total: inSet.length };
          }).filter((b) => b.total > 0);
        }

        return (
          <div
            key={code}
            style={{
              borderBottom: `1px solid ${CONSOLE.line}`,
              borderLeft: `3px solid ${pct === 100 ? CONSOLE.green : pct !== null ? CONSOLE.accent : CONSOLE.line2}`,
            }}
          >
            <div
              onClick={() => openRoster(code)}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              aria-label={`${info?.name || ownedBySet[code].setName}, ${isOpen ? "close" : "expand"} roster`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openRoster(code);
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
                  {info?.name || ownedBySet[code].setName}
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
                  {code.toUpperCase()}
                  {info?.released ? ` · ${info.released.slice(0, 4)}` : ""} · {distinct}
                  {total ? `/${total}` : ""} owned
                </div>
              </div>

              {total && (
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
                  style={{
                    display: "block",
                    fontSize: 9,
                    letterSpacing: 1.5,
                    color: CONSOLE.dim,
                    fontWeight: 400,
                    marginTop: 2,
                  }}
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
                    Loading roster from Scryfall…
                  </div>
                )}
                {rosterError && (
                  <div style={{ color: C.redBright, fontSize: 13, padding: "6px 4px 14px" }}>{rosterError}</div>
                )}

                {roster && (
                  <>
                    <CompletionCost roster={groupedRoster.map((g) => g.display)} ownedCount={ownedCount} />
                    {rarityBars && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 7, maxWidth: 460, padding: "0 4px 18px 14px" }}>
                        {rarityBars.map((b) => (
                          <div
                            key={b.rar}
                            style={{ display: "grid", gridTemplateColumns: "72px 1fr 90px", gap: 10, alignItems: "center" }}
                          >
                            <span className="mono" style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: CONSOLE.dim }}>
                              {b.rar}
                            </span>
                            <div style={{ height: 5, background: CONSOLE.panel2, borderRadius: 2, overflow: "hidden", boxShadow: `inset 0 0 0 1px ${CONSOLE.line}` }}>
                              <div style={{ height: "100%", width: `${(b.have / b.total) * 100}%`, background: RARITY_FILL[b.rar], borderRadius: 2 }} />
                            </div>
                            <span className="mono" style={{ fontSize: 10, color: CONSOLE.dim }}>
                              {b.have}/{b.total}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        border: `1px solid ${CONSOLE.line}`,
                        borderRadius: 2,
                        overflow: "hidden",
                        marginLeft: 14,
                      }}
                    >
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
                        <span className="mono" style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: CONSOLE.dim }}>
                          Every card in the set — greyed out ones aren't in your collection yet
                        </span>

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
                            {collections.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div
                        style={{
                          maxHeight: 560,
                          overflowY: "auto",
                          padding: 16,
                          background: CONSOLE.panel,
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                          gap: 16,
                        }}
                      >
                        {groupedRoster
                          .filter((g) => !rosterSearch || g.name.toLowerCase().includes(rosterSearch.toLowerCase()))
                          .map((g) => {
                            const key = g.display.scryfallId || `${g.display.set}-${g.display.collectorNumber}`;
                            return (
                              <div
                                key={key}
                                className={flashKey === key ? "rowflash" : ""}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  opacity: g.isOwned ? 1 : 0.4,
                                  transition: "opacity 0.15s ease",
                                }}
                              >
                                <div
                                  onClick={() => openPreview(g)}
                                  style={{
                                    position: "relative",
                                    borderRadius: 3,
                                    overflow: "hidden",
                                    border: `1px solid ${g.isOwned ? CONSOLE.line2 : CONSOLE.line}`,
                                    filter: g.isOwned ? "none" : "grayscale(0.85)",
                                    cursor: "pointer",
                                  }}
                                >
                                  <CardArt card={g.display} />
                                  {g.totalOwned > 1 && (
                                    <div
                                      className="mono"
                                      style={{
                                        position: "absolute",
                                        top: 5,
                                        right: 5,
                                        background: CONSOLE.panel,
                                        color: CONSOLE.accent,
                                        border: `1px solid ${CONSOLE.line2}`,
                                        borderRadius: 2,
                                        padding: "1px 6px",
                                        fontSize: 10,
                                        fontWeight: 700,
                                        boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                                      }}
                                    >
                                      x{g.totalOwned}
                                    </div>
                                  )}
                                </div>
                                <div
                                  onClick={() => openPreview(g)}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`${g.name}${g.isOwned ? ", owned" : ", missing"}, open preview`}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openPreview(g);
                                    }
                                  }}
                                  className="mono"
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: g.isOwned ? CONSOLE.bright : CONSOLE.dim,
                                    marginTop: 6,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    cursor: "pointer",
                                  }}
                                  title={g.name}
                                >
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 6,
                                      height: 6,
                                      borderRadius: "50%",
                                      marginRight: 5,
                                      verticalAlign: 1,
                                      background: RARITY_FILL[g.display.rarity] || C.rarityCommon,
                                    }}
                                  />
                                  {g.name}
                                </div>
                                <div className="mono" style={{ fontSize: 9.5, color: CONSOLE.dim, marginTop: 1 }}>
                                  #{g.display.collectorNumber}
                                  {g.printings.length > 1 && ` · ${g.printings.length} versions`}
                                </div>
                                <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
                                  <Stepper
                                    n={ownedCount(g.display)}
                                    onMinus={() => {
                                      onRemoveCopy(g.display);
                                      setFlashKey(key);
                                    }}
                                    onPlus={() => {
                                      onAddCopy(g.display, targetCollection);
                                      setFlashKey(key);
                                    }}
                                  />
                                </div>
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

      {previewGroup && (
        <div
          onClick={() => setPreviewGroup(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,11,13,0.82)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 70,
            padding: "clamp(14px, 4vw, 30px)",
          }}
        >
          {(() => {
            const printing = previewGroup.printings[previewIndex];
            const isOwnedPrinting = ownedCount(printing) > 0;
            const many = previewGroup.printings.length > 1;
            return (
              <div
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`${previewGroup.name} preview`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 14,
                  maxWidth: 340,
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%" }}>
                  {many && (
                    <button
                      onClick={() => setPreviewIndex((i) => (i - 1 + previewGroup.printings.length) % previewGroup.printings.length)}
                      title="Previous version"
                      style={{ background: "none", border: "none", color: C.parchment, cursor: "pointer", flexShrink: 0 }}
                    >
                      <ChevronLeft size={26} />
                    </button>
                  )}
                  <div
                    style={{
                      flex: 1,
                      borderRadius: 12,
                      overflow: "hidden",
                      boxShadow: "0 24px 50px -12px rgba(0,0,0,0.9), 0 0 0 1px rgba(232,236,241,0.2)",
                      filter: isOwnedPrinting ? "none" : "grayscale(0.7)",
                    }}
                  >
                    <CardArt card={printing} large />
                  </div>
                  {many && (
                    <button
                      onClick={() => setPreviewIndex((i) => (i + 1) % previewGroup.printings.length)}
                      title="Next version"
                      style={{ background: "none", border: "none", color: C.parchment, cursor: "pointer", flexShrink: 0 }}
                    >
                      <ChevronRight size={26} />
                    </button>
                  )}
                </div>

                <div style={{ textAlign: "center" }}>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: CONSOLE.bright }}>
                    {previewGroup.name}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: CONSOLE.dim, marginTop: 3 }}>
                    #{printing.collectorNumber}
                    {many && ` · version ${previewIndex + 1} of ${previewGroup.printings.length}`}
                    {isOwnedPrinting && <span style={{ color: CONSOLE.green }}> · owned</span>}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Stepper
                    n={ownedCount(printing)}
                    onMinus={() => onRemoveCopy(printing)}
                    onPlus={() => onAddCopy(printing, targetCollection)}
                  />
                  <button
                    onClick={() => setPreviewGroup(null)}
                    className="mono"
                    style={{
                      background: "none",
                      border: `1px solid ${CONSOLE.line2}`,
                      color: CONSOLE.dim,
                      borderRadius: 2,
                      padding: "8px 14px",
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
      </>
      )}
    </main>
  );
}

// Art Series cards ("Tales of Middle-earth Art Series", etc.) are real,
// ownable Scryfall entries — full art, no rules text — and are discovered
// via each owned set's official parent_set_code link, not a guessed prefix,
// so this works for any set that has a companion art series regardless of
// naming convention. Reuses the same roster/stepper machinery as the normal
// Sets tab, since adding an art card to your collection works identically
// to adding any other card.
