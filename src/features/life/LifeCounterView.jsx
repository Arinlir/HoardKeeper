import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, RotateCcw, RotateCw, Swords, Users, X } from "lucide-react";
import { C, STOCK_BG, STOCK_SHADOW, ROOT_BG } from "../../lib/tokens";

export const LIFE_STARTING = { commander: 40, normal: 20 };
export const LIFE_STORAGE_KEY = "hk-life-tracker";

export function makeLifePlayer(id, name, life) {
  return { id, name, life, cmdDmg: {} };
}

export function loadSavedLife() {
  try {
    const s = JSON.parse(localStorage.getItem(LIFE_STORAGE_KEY));
    if (s && Array.isArray(s.players) && s.players.length >= 2) return s;
  } catch (e) {}
  return null;
}

export const lifeIconBtn = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 3,
  display: "flex",
  alignItems: "center",
};
export const lifeStepBtn = {
  background: "rgba(185,191,199,0.1)",
  border: `1px solid rgba(185,191,199,0.25)`,
  borderRadius: 5,
  color: C.parchment,
  fontSize: 12.5,
  fontWeight: 600,
  padding: "5px 11px",
  cursor: "pointer",
};
export const lifeTinyBtn = {
  background: "rgba(185,191,199,0.1)",
  border: `1px solid rgba(185,191,199,0.25)`,
  borderRadius: 3,
  color: C.parchment,
  fontSize: 11,
  width: 20,
  height: 20,
  cursor: "pointer",
  lineHeight: 1,
};
export function lifeCountBtn(disabled) {
  return {
    background: "none",
    border: `1px solid rgba(185,191,199,0.25)`,
    borderRadius: 3,
    color: disabled ? "rgba(139,144,151,0.4)" : C.parchmentDim,
    width: 20,
    height: 20,
    cursor: disabled ? "default" : "pointer",
    fontSize: 13,
    lineHeight: 1,
  };
}

export function LifeCounterView({ onExit }) {
  const idRef = useRef(1);

  const [format, setFormat] = useState(() => loadSavedLife()?.format || "commander");
  const [players, setPlayers] = useState(() => {
    const saved = loadSavedLife();
    if (saved) {
      idRef.current = Math.max(...saved.players.map((p) => p.id)) + 1;
      return saved.players;
    }
    idRef.current = 5;
    return [1, 2, 3, 4].map((i) => makeLifePlayer(i, `Player ${i}`, LIFE_STARTING.commander));
  });
  const [expanded, setExpanded] = useState(null);
  const [rotated, setRotated] = useState({});

  // Floating "-N" / "+N" delta badges: taps accumulate into a running total
  // per player. The badge lingers while taps keep coming, then — once idle —
  // holds a moment before fading and scaling away, so a burst of quick taps
  // reads as one clear number instead of a blur of individual flashes.
  const [badges, setBadges] = useState({});
  const badgeTimers = useRef({});
  const badgePoofTimers = useRef({});
  const LINGER_MS = 900;
  const POOF_MS = 550;

  useEffect(() => {
    return () => {
      Object.values(badgeTimers.current).forEach(clearTimeout);
      Object.values(badgePoofTimers.current).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onExit?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onExit]);

  function bumpBadge(id, delta) {
    setBadges((b) => {
      const cur = b[id];
      const amount = (cur && !cur.fading ? cur.amount : 0) + delta;
      return { ...b, [id]: { amount, fading: false } };
    });
    clearTimeout(badgeTimers.current[id]);
    clearTimeout(badgePoofTimers.current[id]);
    badgeTimers.current[id] = setTimeout(() => {
      setBadges((b) => (b[id] ? { ...b, [id]: { ...b[id], fading: true } } : b));
      badgePoofTimers.current[id] = setTimeout(() => {
        setBadges((b) => {
          if (!b[id]) return b;
          const next = { ...b };
          delete next[id];
          return next;
        });
      }, POOF_MS);
    }, LINGER_MS);
  }

  useEffect(() => {
    try {
      localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify({ format, players }));
    } catch (e) {}
  }, [format, players]);

  const maxPlayers = format === "commander" ? 6 : 4;
  const minPlayers = 2;

  function setFormatAndReset(f) {
    if (f === format) return;
    const start = LIFE_STARTING[f];
    setFormat(f);
    setPlayers((ps) => (f === "commander" ? ps : ps.slice(0, 4)).map((p) => ({ ...p, life: start, cmdDmg: {} })));
    setBadges({});
  }

  function addPlayer() {
    setPlayers((ps) => {
      if (ps.length >= maxPlayers) return ps;
      const id = idRef.current++;
      return [...ps, makeLifePlayer(id, `Player ${ps.length + 1}`, LIFE_STARTING[format])];
    });
  }

  function removePlayer() {
    setPlayers((ps) => (ps.length <= minPlayers ? ps : ps.slice(0, -1)));
  }

  function newGame() {
    const start = LIFE_STARTING[format];
    setPlayers((ps) => ps.map((p) => ({ ...p, life: start, cmdDmg: {} })));
    setExpanded(null);
    setBadges({});
  }

  function adjustLife(id, delta) {
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, life: p.life + delta } : p)));
    bumpBadge(id, delta);
  }

  function resetPlayer(id) {
    const start = LIFE_STARTING[format];
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, life: start, cmdDmg: {} } : p)));
  }

  function renamePlayer(id, name) {
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  function adjustCmdDmg(id, fromId, delta) {
    setPlayers((ps) =>
      ps.map((p) => {
        if (p.id !== id) return p;
        const next = Math.max(0, (p.cmdDmg[fromId] || 0) + delta);
        return { ...p, cmdDmg: { ...p.cmdDmg, [fromId]: next } };
      })
    );
  }

  const cols = players.length <= 2 ? 1 : players.length <= 4 ? 2 : 3;
  const rows = Math.ceil(players.length / cols);

  // The life number used a flat vw-based clamp regardless of column count,
  // so at 3 columns (5-6 players) it stayed close to full size while its
  // cell shrank to a third of the screen width — the number then collided
  // with the buttons and hint text beneath it. Scale both the vw factor and
  // the px ceiling down as columns increase, and cap by vh too so a wide,
  // short window (the common case that triggered this) can't blow past the
  // cell's actual height either.
  const NUMBER_VW = { 1: 9, 2: 6.5, 3: 5 };
  const NUMBER_MAX_PX = { 1: 96, 2: 78, 3: 62 };
  const numberFontSize = `clamp(28px, min(${NUMBER_VW[cols]}vw, 32vh), ${NUMBER_MAX_PX[cols]}px)`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 95,
        background: ROOT_BG,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes life-badge-in {
          from { opacity: 0; transform: translateY(4px) scale(0.75); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes life-badge-poof {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          40% { opacity: 1; transform: translateY(-6px) scale(1.12); }
          100% { opacity: 0; transform: translateY(-22px) scale(0.7); }
        }
        .life-badge { animation: life-badge-in 0.16s ease-out; }
        .life-badge.poofing { animation: life-badge-poof ${POOF_MS}ms ease-in forwards; }
        @media (prefers-reduced-motion: reduce) {
          .life-badge, .life-badge.poofing { animation: none; }
        }
      `}</style>

      {/* top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          padding: "14px clamp(14px, 4vw, 28px)",
          borderBottom: `1px solid rgba(185,191,199,0.15)`,
          flexShrink: 0,
        }}
      >
        <div className="serif" style={{ fontSize: 16, fontWeight: 600, color: C.goldBright }}>
          Life Counter
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {["commander", "normal"].map((f) => (
            <button
              key={f}
              onClick={() => setFormatAndReset(f)}
              aria-pressed={format === f}
              style={{
                background: format === f ? STOCK_BG : "transparent",
                color: format === f ? C.stockInk : C.parchmentDim,
                border: `1px solid ${format === f ? C.stock : "rgba(185,191,199,0.26)"}`,
                borderRadius: 4,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {f} · {LIFE_STARTING[f]}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.parchmentDim, fontSize: 12.5 }}>
          <Users size={14} />
          <button onClick={removePlayer} disabled={players.length <= minPlayers} aria-label="Remove player" style={lifeCountBtn(players.length <= minPlayers)}>
            −
          </button>
          <span className="mono" style={{ color: C.parchment, minWidth: 14, textAlign: "center" }}>
            {players.length}
          </span>
          <button onClick={addPlayer} disabled={players.length >= maxPlayers} aria-label="Add player" style={lifeCountBtn(players.length >= maxPlayers)}>
            +
          </button>
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={newGame}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 5,
            padding: "8px 14px",
            fontWeight: 700,
            fontSize: 12.5,
            cursor: "pointer",
            boxShadow: STOCK_SHADOW,
          }}
        >
          <RotateCcw size={14} /> New Game
        </button>

        <button
          onClick={onExit}
          title="Exit life counter"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            color: C.parchmentDim,
            border: `1px solid rgba(185,191,199,0.26)`,
            borderRadius: 5,
            padding: "8px 12px",
            fontWeight: 600,
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          <X size={14} /> Exit
        </button>
      </div>

      {/* player grid — fills the remaining screen */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gap: 1,
          background: "rgba(185,191,199,0.15)",
          overflow: "auto",
        }}
      >
        {players.map((p) => {
          const start = LIFE_STARTING[format];
          const lethal = Object.values(p.cmdDmg).some((v) => v >= 21);
          const badge = badges[p.id];
          return (
            <div
              key={p.id}
              style={{
                background: C.bg,
                padding: "14px clamp(12px, 2.5vw, 20px) 16px",
                transform: rotated[p.id] ? "rotate(180deg)" : "none",
                transition: "transform 0.25s ease",
                display: "flex",
                flexDirection: "column",
                // A grid cell won't shrink its content below intrinsic size on
                // its own — min-width/min-height:0 lets flex children actually
                // shrink to fit, and overflow:hidden is the backstop so an
                // expanded commander-damage list (or anything else) can never
                // visually spill into a neighboring cell, whatever the cause.
                minHeight: 0,
                minWidth: 0,
                // Horizontal clipping is a hard rule — a cell must never bleed
                // into a neighboring column. Vertical scroll is a fallback for
                // real edge cases (many players, expanded commander damage on
                // a short window) so damage tracking degrades into a scrollbar
                // rather than silently losing information.
                overflowX: "hidden",
                overflowY: "auto",
                boxShadow: lethal ? "inset 0 0 0 2px rgba(222,115,134,0.5)" : "none",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexShrink: 0 }}>
                <input
                  value={p.name}
                  onChange={(e) => renamePlayer(p.id, e.target.value)}
                  aria-label="Player name"
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: `1px solid rgba(185,191,199,0.25)`,
                    color: C.parchment,
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "2px 0",
                    width: "60%",
                  }}
                />
                <div style={{ display: "flex", gap: 2 }}>
                  <button onClick={() => setRotated((r) => ({ ...r, [p.id]: !r[p.id] }))} style={lifeIconBtn} title="Flip for the seat across the table" aria-label="Flip for the seat across the table">
                    <RotateCw size={13} color={C.parchmentDim} />
                  </button>
                  <button onClick={() => resetPlayer(p.id)} style={lifeIconBtn} title="Reset this player" aria-label={`Reset ${p.name}`}>
                    <RotateCcw size={13} color={C.parchmentDim} />
                  </button>
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                {badge && (
                  <div
                    className={`life-badge${badge.fading ? " poofing" : ""}`}
                    style={{
                      position: "absolute",
                      top: "8%",
                      left: "50%",
                      transform: "translateX(-50%)",
                      pointerEvents: "none",
                      zIndex: 2,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        display: "inline-block",
                        fontSize: "clamp(18px, 3vw, 26px)",
                        fontWeight: 700,
                        padding: "2px 12px",
                        borderRadius: 20,
                        background: badge.amount < 0 ? "rgba(222,115,134,0.16)" : "rgba(132,199,160,0.16)",
                        color: badge.amount < 0 ? C.redBright : C.greenBright,
                        border: `1px solid ${badge.amount < 0 ? "rgba(222,115,134,0.4)" : "rgba(132,199,160,0.4)"}`,
                      }}
                    >
                      {badge.amount > 0 ? "+" : ""}
                      {badge.amount}
                    </span>
                  </div>
                )}

                <div
                  onClick={() => adjustLife(p.id, 1)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.name}: increase life by 1 (currently ${p.life})`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      adjustLife(p.id, 1);
                    }
                  }}
                  style={{ cursor: "pointer", textAlign: "center", userSelect: "none" }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: numberFontSize,
                      fontWeight: 700,
                      color: p.life <= 0 ? C.redBright : p.life < start / 2 ? "#E8B34C" : C.goldBright,
                      lineHeight: 1,
                    }}
                  >
                    {p.life}
                  </span>
                </div>
                <div
                  onClick={() => adjustLife(p.id, -1)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.name}: decrease life by 1`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      adjustLife(p.id, -1);
                    }
                  }}
                  style={{ cursor: "pointer", textAlign: "center", padding: "4px 0 0", fontSize: 10, color: C.parchmentDim, userSelect: "none" }}
                >
                  tap number for +1 · tap here for −1
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: format === "commander" ? 8 : 0, flexShrink: 0 }}>
                <button onClick={() => adjustLife(p.id, -5)} aria-label={`${p.name}: decrease life by 5`} style={lifeStepBtn}>−5</button>
                <button onClick={() => adjustLife(p.id, -1)} aria-label={`${p.name}: decrease life by 1`} style={lifeStepBtn}>−1</button>
                <button onClick={() => adjustLife(p.id, 1)} aria-label={`${p.name}: increase life by 1`} style={lifeStepBtn}>+1</button>
                <button onClick={() => adjustLife(p.id, 5)} aria-label={`${p.name}: increase life by 5`} style={lifeStepBtn}>+5</button>
              </div>

              {format === "commander" && (
                <div style={{ borderTop: `1px solid rgba(185,191,199,0.15)`, paddingTop: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => setExpanded((e) => (e === p.id ? null : p.id))}
                    aria-expanded={expanded === p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "none",
                      border: "none",
                      color: lethal ? C.redBright : C.parchmentDim,
                      fontSize: 11.5,
                      cursor: "pointer",
                      padding: "2px 0",
                      width: "100%",
                    }}
                  >
                    <Swords size={12} />
                    Commander damage{lethal ? " — LETHAL" : ""}
                    <ChevronDown size={12} style={{ marginLeft: "auto", transform: expanded === p.id ? "rotate(180deg)" : "none" }} />
                  </button>
                  {expanded === p.id && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6, maxHeight: cols === 3 ? 84 : 110, overflowY: "auto" }}>
                      {players.filter((o) => o.id !== p.id).map((o) => {
                        const dmg = p.cmdDmg[o.id] || 0;
                        return (
                          <div key={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, color: C.parchmentDim }}>
                            <span style={{ maxWidth: "50%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              from {o.name}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <button onClick={() => adjustCmdDmg(p.id, o.id, -1)} aria-label={`Decrease commander damage from ${o.name} to ${p.name}`} style={lifeTinyBtn}>−</button>
                              <span className="mono" style={{ color: dmg >= 21 ? C.redBright : C.parchment, minWidth: 16, textAlign: "center" }}>
                                {dmg}
                              </span>
                              <button onClick={() => adjustCmdDmg(p.id, o.id, 1)} aria-label={`Increase commander damage from ${o.name} to ${p.name}`} style={lifeTinyBtn}>+</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// When a Glossary search comes up empty, tell the person WHY rather than
// leaving them to guess whether it's a bug or they just don't own such a
// card. Checks the raw scanned text directly, bypassing the keyword list
// entirely, so it answers the question honestly either way. Pulled out as
// its own pure function (not inline in the component) so the logic can be
// tested directly against known inputs, independent of simulating a search
// box interaction.
