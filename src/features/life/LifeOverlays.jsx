/*
 * Everything that sits on top of the board: the hexagon hub, the menu it opens,
 * the layout picker, and the small modals (exact total, dice, log, decks, the
 * winner). They share the dark rounded panel and the big round buttons.
 */
import React from "react";
import { Coins, Dices, LayoutGrid, LibraryBig, LogOut, Menu, Moon, RotateCcw, ScrollText, Sun, Sword, Trophy, Undo2, Users, X } from "lucide-react";
import { COUNTERS, DICE, LIFE_STARTING, facingOf, layoutsFor } from "./lifeState";
import { FONT, L, NUMBER_FONT, OVERLAY, PANEL, labelStyle, pill, roundBtn } from "./lifeUi";

// ---- the hub ---------------------------------------------------------------

const HEX = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";

/*
 * Sits where the four corners of the board meet. `mode` is what tapping it
 * will do: open the menu, close whatever is open, or — while one seat's
 * commander damage is on screen — go back to the game.
 */
export function Hub({ mode, onClick, dayNight }) {
  const label = mode === "menu" ? "Menu" : mode === "cmd" ? "Return to game" : "Close";
  if (mode === "cmd") {
    return (
      <button
        onClick={onClick}
        aria-label={label}
        style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 30, width: 66, height: 74, clipPath: HEX, border: "none", background: L.yellow, color: L.black, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
      >
        <Sword size={30} strokeWidth={2.5} />
      </button>
    );
  }
  const open = mode === "close";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 30, width: 66, height: 74, border: "none", background: "none", padding: 0, cursor: "pointer", filter: "drop-shadow(0 0 10px rgba(0,0,0,0.5))" }}
    >
      <span style={{ position: "absolute", inset: 0, clipPath: HEX, background: L.yellow }} />
      <span style={{ position: "absolute", inset: open ? 0 : 5, clipPath: HEX, background: open ? "transparent" : L.black, display: "flex", alignItems: "center", justifyContent: "center", color: open ? L.black : L.white }}>
        {open ? <X size={26} strokeWidth={3.5} /> : <Menu size={26} strokeWidth={3} />}
      </span>
      {dayNight && (
        <span aria-label={`It is ${dayNight}`} style={{ position: "absolute", right: -6, top: -4, width: 24, height: 24, borderRadius: "50%", background: dayNight === "day" ? L.yellow : "#6B6BFF", color: dayNight === "day" ? L.black : L.white, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 3px #000" }}>
          {dayNight === "day" ? <Sun size={14} /> : <Moon size={14} />}
        </span>
      )}
    </button>
  );
}

// ---- the menu --------------------------------------------------------------

function Tool({ icon, label, onClick, on, disabled, ariaLabel, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={on}
      title={title}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, background: "none", border: "none", padding: 0, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1, width: 76 }}
    >
      <span style={roundBtn(54, on)}>{icon}</span>
      <span style={{ ...labelStyle, fontSize: 10, textAlign: "center", lineHeight: 1.15 }}>{label}</span>
    </button>
  );
}

export function MenuPanel({ format, onFormat, count, minPlayers, maxPlayers, onAdd, onRemove, onLayout, dayNight, onDayNight, onDice, onWhoStarts, onUndo, undoDepth, onLog, hasDecks, deckAssigned, onDecks, visibleCounters, onToggleCounter, onNewGame, onExit, onClose }) {
  const sectionLabel = { ...labelStyle, color: L.dim, marginBottom: 10 };
  return (
    <div style={{ ...OVERLAY, zIndex: 20, background: "rgba(0,0,0,0.8)" }} onClick={onClose}>
      <div style={{ ...PANEL, maxWidth: 420 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Life counter menu">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ ...labelStyle, fontSize: 17, letterSpacing: "0.04em" }}>Life Counter</span>
          <button onClick={onClose} aria-label="Close" style={roundBtn(38)}><X size={18} strokeWidth={3} /></button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {["commander", "normal"].map((f) => (
            <button key={f} onClick={() => onFormat(f)} aria-pressed={format === f} style={pill(format === f ? "on" : "plain", { flex: 1, padding: "12px 6px" })}>
              {f} · {LIFE_STARTING[f]}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <Users size={18} color={L.dim} />
          <span style={{ ...labelStyle, color: L.dim, flex: 1 }}>Players</span>
          <button aria-label="Remove player" disabled={count <= minPlayers} onClick={onRemove} style={{ ...roundBtn(38), opacity: count <= minPlayers ? 0.35 : 1, fontSize: 20, fontWeight: 800, fontFamily: FONT }}>−</button>
          <span className="mono" style={{ fontFamily: NUMBER_FONT, fontWeight: 800, fontSize: 22, minWidth: 26, textAlign: "center" }}>{count}</span>
          <button aria-label="Add player" disabled={count >= maxPlayers} onClick={onAdd} style={{ ...roundBtn(38), opacity: count >= maxPlayers ? 0.35 : 1, fontSize: 20, fontWeight: 800, fontFamily: FONT }}>+</button>
          <button onClick={onLayout} style={pill("plain", { padding: "10px 14px", marginLeft: 4 })}><LayoutGrid size={15} /> Layout</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 6px", justifyContent: "space-between", marginBottom: 20 }}>
          <Tool icon={<Dices size={26} />} label="Dice" ariaLabel="Dice" onClick={onDice} title="Dice, coin, and who goes first" />
          <Tool icon={<Trophy size={25} />} label="Who starts" ariaLabel="Who starts" onClick={onWhoStarts} />
          <Tool
            icon={dayNight === "night" ? <Moon size={25} /> : <Sun size={25} />}
            label={dayNight || "Day/Night"}
            ariaLabel={dayNight || "Day/Night"}
            on={!!dayNight}
            onClick={onDayNight}
            title="Day / night / neither"
          />
          <Tool icon={<Undo2 size={25} />} label="Undo" ariaLabel="Undo" onClick={onUndo} disabled={undoDepth === 0} />
          <Tool icon={<ScrollText size={25} />} label="Log" ariaLabel="Log" onClick={onLog} />
          {hasDecks && <Tool icon={<LibraryBig size={25} />} label="Decks" ariaLabel="Decks" on={deckAssigned} onClick={onDecks} title="Who's playing which deck" />}
        </div>

        <div style={sectionLabel}>Track</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
          {COUNTERS.map((c) => {
            const on = visibleCounters.includes(c.key);
            return (
              <button key={c.key} onClick={() => onToggleCounter(c.key)} aria-pressed={on} title={c.note ? `${c.label} — ${c.note}` : c.label} style={pill(on ? "on" : "plain", { padding: "9px 14px", fontSize: 11.5, textTransform: "none", letterSpacing: "0.02em" })}>
                {c.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onNewGame} style={pill("go", { flex: 1, padding: "14px 10px" })}><RotateCcw size={15} /> New game</button>
          <button onClick={onExit} title="Exit life counter" style={pill("ghost", { padding: "14px 18px" })}><LogOut size={15} /> Exit</button>
        </div>
      </div>
    </div>
  );
}

// ---- the layout picker -----------------------------------------------------

/*
 * Every board arrangement as a little picture of itself. Grey cells are gaps in
 * the board; the one in use is lit. Tapping one re-seats the table straight away.
 */
export function LayoutPicker({ current, format, maxPlayers, onPick, onClose }) {
  const start = LIFE_STARTING[format];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40, background: L.black, overflowY: "auto", padding: "26px 22px 110px" }} role="dialog" aria-modal="true" aria-label="Choose a layout">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "26px 22px", maxWidth: 520, margin: "0 auto" }}>
        {layoutsFor(maxPlayers).map((layout) => {
          const active = layout.id === current;
          return (
            <button
              key={layout.id}
              onClick={() => onPick(layout.id)}
              aria-label={`${layout.seats.length} players, layout ${layout.id}`}
              aria-pressed={active}
              style={{ aspectRatio: "0.46", background: "none", padding: active ? 6 : 0, border: "none", borderRadius: active ? 26 : 0, boxShadow: active ? `0 0 0 2px ${L.red}` : "none", cursor: "pointer", display: "block" }}
            >
              <span style={{ display: "grid", width: "100%", height: "100%", gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${layout.rows}, 1fr)`, gap: 4 }}>
                {layout.cells.map((cell, i) => {
                  const seat = cell.seat === null ? null : layout.seats[cell.seat];
                  return (
                    <span
                      key={i}
                      style={{
                        gridRow: cell.row + 1,
                        gridColumn: cell.span === 2 ? "1 / span 2" : cell.col + 1,
                        borderRadius: active ? 10 : 11,
                        background: !seat ? "#404040" : active ? L.red : L.white,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        minHeight: 0,
                      }}
                    >
                      {active && seat && (
                        <span className="mono" style={{ fontFamily: NUMBER_FONT, fontWeight: 800, fontSize: 15, color: "#000", transform: `rotate(${facingOf(seat, layout)}deg)` }}>
                          {start}
                        </span>
                      )}
                    </span>
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>
      <button
        onClick={onClose}
        aria-label="Close layouts"
        style={{ position: "fixed", left: "50%", bottom: 26, transform: "translateX(-50%)", width: 66, height: 66, borderRadius: "50%", border: "none", background: L.red, color: L.white, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 5px 0 rgba(255,255,255,0.28)" }}
      >
        <X size={30} strokeWidth={3.5} />
      </button>
    </div>
  );
}

// ---- keypad ----------------------------------------------------------------

const KEY = { ...roundBtn(0), width: "100%", height: 56, borderRadius: 18, fontFamily: NUMBER_FONT, fontWeight: 800, fontSize: 22 };

export function KeypadModal({ player, digits, setDigits, onAdjust, onSet, onClose }) {
  const value = digits === "" ? null : Number(digits);
  const press = (d) => setDigits((cur) => (cur + d).slice(0, 3));
  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={{ ...PANEL, maxWidth: 310 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Set life for ${player.name}`}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ ...labelStyle, color: L.dim }}>{player.name} · now {player.life}</div>
          <div className="mono" style={{ fontFamily: NUMBER_FONT, fontWeight: 800, fontSize: 46, marginTop: 4, color: value === null ? L.dim : L.white }}>{digits === "" ? "—" : digits}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} style={KEY} onClick={() => press(d)}>{d}</button>
          ))}
          <button style={KEY} onClick={() => setDigits("")} aria-label="Clear">C</button>
          <button style={KEY} onClick={() => press("0")}>0</button>
          <button style={KEY} onClick={() => setDigits((d) => d.slice(0, -1))} aria-label="Backspace">⌫</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button disabled={value === null} onClick={() => onAdjust(-value)} style={pill("plain", { flex: 1, opacity: value === null ? 0.4 : 1 })}>−{digits || "0"}</button>
          <button disabled={value === null} onClick={() => onAdjust(value)} style={pill("plain", { flex: 1, opacity: value === null ? 0.4 : 1 })}>+{digits || "0"}</button>
        </div>
        <button disabled={value === null} onClick={() => onSet(value)} style={pill("go", { width: "100%", marginTop: 8, padding: "14px 0", opacity: value === null ? 0.4 : 1 })}>
          Set total to {digits || "—"}
        </button>
        <button onClick={onClose} style={pill("ghost", { width: "100%", marginTop: 8 })}>Cancel</button>
      </div>
    </div>
  );
}

// ---- dice ------------------------------------------------------------------

function Header({ title, onClose }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <span style={{ ...labelStyle, fontSize: 16 }}>{title}</span>
      <button onClick={onClose} aria-label="Close" style={roundBtn(36)}><X size={18} strokeWidth={3} /></button>
    </div>
  );
}

export function DiceModal({ dice, onRoll, onFlip, onWhoStarts, onClose }) {
  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={PANEL} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Dice and coin">
        <Header title="Roll something" onClose={onClose} />
        <div aria-live="polite" style={{ textAlign: "center", padding: "18px 0", background: L.well, borderRadius: 20, marginBottom: 14, minHeight: 92 }}>
          {dice.last ? (
            <>
              <div className="mono" style={{ fontFamily: NUMBER_FONT, fontWeight: 800, fontSize: dice.last.kind === "die" ? 54 : 28, lineHeight: 1.1 }}>{dice.last.value}</div>
              <div style={{ fontSize: 12, color: L.dim, marginTop: 6, padding: "0 10px" }}>{dice.last.text}</div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: L.dim, paddingTop: 24 }}>Nothing rolled yet.</div>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {DICE.map((s) => (
            <button key={s} onClick={() => onRoll(s)} style={pill("plain", { flex: "1 1 56px", padding: "13px 0" })}>d{s}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onFlip} style={pill("plain", { flex: 1 })}><Coins size={15} /> Coin flip</button>
          <button onClick={onWhoStarts} style={pill("go", { flex: 1 })}><Dices size={15} /> Who starts</button>
        </div>
        {dice.history.length > 1 && (
          <div style={{ marginTop: 16, borderTop: `1px solid ${L.line}`, paddingTop: 10 }}>
            {dice.history.slice(1).map((h, i) => (
              <div key={i} className="mono" style={{ fontSize: 11, color: L.dim, padding: "2px 0" }}>{h.text}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- log -------------------------------------------------------------------

export function LogModal({ log, undoDepth, onUndo, onClose }) {
  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={PANEL} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Game log">
        <Header title="Game log" onClose={onClose} />
        {log.length === 0 ? (
          <div style={{ fontSize: 13, color: L.dim, lineHeight: 1.5 }}>Nothing worth writing down yet. Rolls, eliminations, exact totals and the crown all end up here.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {log.map((e) => (
              <div key={e.id} style={{ display: "flex", gap: 10, fontSize: 13 }}>
                <span className="mono" style={{ color: L.dim, flexShrink: 0 }}>{new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span>{e.text}</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={onUndo} disabled={undoDepth === 0} style={pill("plain", { width: "100%", marginTop: 16, padding: "14px 0", opacity: undoDepth === 0 ? 0.4 : 1 })}>
          <Undo2 size={15} /> Undo the last change
        </button>
      </div>
    </div>
  );
}

// ---- decks -----------------------------------------------------------------

export function DecksModal({ players, decks, onAssign, onClose }) {
  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={{ ...PANEL, maxWidth: 460 }} role="dialog" aria-modal="true" aria-label="Assign decks to seats" onClick={(e) => e.stopPropagation()}>
        <Header title="Who's playing what" onClose={onClose} />
        <div style={{ fontSize: 12.5, color: L.dim, marginBottom: 14, lineHeight: 1.5 }}>
          Name the deck in each seat and the result of this game lands on its record — wins, losses and who it beat. Seats you leave blank are still counted as players, just not as decks.
        </div>
        {players.map((p) => (
          <div key={p.id} style={{ marginBottom: 14 }}>
            <div style={{ ...labelStyle, marginBottom: 6 }}>{p.name}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button onClick={() => onAssign(p.id, null)} aria-pressed={!p.deckId} style={pill(!p.deckId ? "on" : "plain", { padding: "8px 13px", fontSize: 11.5 })}>None</button>
              {decks.map((d) => (
                <button key={d.id} onClick={() => onAssign(p.id, d)} aria-pressed={p.deckId === d.id} style={pill(p.deckId === d.id ? "on" : "plain", { padding: "8px 13px", fontSize: 11.5, textTransform: "none", letterSpacing: "0.02em" })}>
                  {d.name}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button onClick={onClose} style={pill("go", { width: "100%", padding: "14px 0", marginTop: 4 })}>Done</button>
      </div>
    </div>
  );
}

// ---- winner ----------------------------------------------------------------

export function WinnerModal({ winner, recording, onNewGame, onKeep }) {
  return (
    <div style={OVERLAY}>
      <div style={{ ...PANEL, textAlign: "center" }} role="dialog" aria-modal="true" aria-label="Game over">
        <Trophy size={34} color={L.yellow} style={{ marginBottom: 8 }} />
        <div style={{ ...labelStyle, fontSize: 24, letterSpacing: "0.02em" }}>{winner.name} wins</div>
        <div style={{ fontSize: 13, color: L.dim, marginTop: 8, lineHeight: 1.5 }}>
          Everyone else is out. {winner.name} finished on {winner.life} life.
          {recording && <span style={{ display: "block", marginTop: 4 }}>Going in the record{winner.deckName ? ` for ${winner.deckName}` : ""}.</span>}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onNewGame} style={pill("go", { flex: 1, padding: "14px 0" })}>New game</button>
          <button onClick={onKeep} style={pill("plain", { flex: 1, padding: "14px 0" })}>Keep the board</button>
        </div>
      </div>
    </div>
  );
}
