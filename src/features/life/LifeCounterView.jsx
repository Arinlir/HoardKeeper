import React, { useState, useEffect, useRef } from "react";
import {
  EMPTY_TABLE,
  LIFE_STARTING,
  LIFE_STORAGE_KEY,
  MAX_PLAYERS,
  MIN_PLAYERS,
  clampScale,
  cmdDamage,
  cmdKey,
  counterValue,
  dimColor,
  defaultColorFor,
  defaultLayoutFor,
  facingOf,
  flipCoin,
  gameResult,
  saveGame,
  highRoll,
  inkFor,
  layoutById,
  lethalReason,
  loadSavedLife,
  makeLifePlayer,
  rollDie,
  rollsById,
  seatLabel,
  seatBackground,
  winnerOf,
  withCommander,
  STARS_THEME,
} from "./lifeState";
import { CommanderCard, Face, SeatChips, SeatPanel, Tile, chipsHeightFor } from "./LifeSeat";
import { pushGames } from "./lifeSync";
import { CommanderModal, DiceModal, Hub, KeypadModal, LayoutPicker, LogModal, MenuPanel, StatsModal, WinnerModal } from "./LifeOverlays";
import { FONT, GAP, L, pill, useHold } from "./lifeUi";

// Re-exported so anything that imported these from the view still can.
export { LIFE_STARTING, LIFE_STORAGE_KEY, makeLifePlayer, loadSavedLife };

const flipRot = (r) => (r === 0 ? 180 : r === 180 ? 0 : -r);

/*
 * `onRecordGame` is the only thing this screen knows about the rest of the
 * app, and it arrives as a prop on purpose: the Life Counter still imports
 * nothing from the collection, decks or storage layers.
 *
 * The board is full-bleed: coloured seats on black, a hexagon where their
 * corners meet, and nothing else. Everything that isn't a life total — the
 * format, the layout, dice, counters, undo, exit — lives behind the hub.
 */
export function LifeCounterView({ onExit, onRecordGame }) {
  const idRef = useRef(1);
  const saved0 = useRef(undefined);
  if (saved0.current === undefined) saved0.current = loadSavedLife();
  const saved = saved0.current;

  const [format, setFormat] = useState(() => saved?.format || "commander");
  const [players, setPlayers] = useState(() => {
    if (saved) {
      idRef.current = Math.max(...saved.players.map((p) => p.id)) + 1;
      return saved.players;
    }
    idRef.current = 5;
    return [1, 2, 3, 4].map((i) => makeLifePlayer(i, `Player ${i}`, LIFE_STARTING.commander));
  });
  const [layout, setLayout] = useState(() => saved?.layout || defaultLayoutFor(4));
  // Shared table state: who wears the crown, who holds the initiative, and
  // whether it's day or night. Nobody's property, so it lives beside players.
  const [table, setTable] = useState(() => ({ ...EMPTY_TABLE, ...(saved?.table || {}) }));
  // Which optional counters this table is tracking. Off by default: a normal
  // game shouldn't carry five rows of zeroes on every seat.
  const [visibleCounters, setVisibleCounters] = useState(() => saved?.visibleCounters || []);
  const [log, setLog] = useState(() => saved?.log || []);

  // What's on screen besides the board.
  const [menuOpen, setMenuOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [panelFor, setPanelFor] = useState(null); // a seat's own options
  // null, a seat id (reading the commander damage that seat has received), or
  // { deal: id, second } (one seat's commander A/B dealing damage to the others).
  const [cmd, setCmd] = useState(null);
  const [roll, setRoll] = useState(null); // the who-starts roll, while it's up
  const [showLog, setShowLog] = useState(false);
  const [dice, setDice] = useState(null); // null | { last, history }
  const [naming, setNaming] = useState(false); // the who's-playing-what sheet
  const [keypad, setKeypad] = useState(null); // null | { id, digits }
  const [winnerSeen, setWinnerSeen] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const startedAt = useRef(Date.now());
  const recorded = useRef(false);
  const { press, clear: clearHold } = useHold();

  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 0,
    h: typeof window !== "undefined" ? window.innerHeight : 0,
  }));
  useEffect(() => {
    // window.innerHeight, not 100vh: on iOS Safari 100vh is the height the page
    // would have with the toolbars hidden.
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Floating "-N" / "+N" delta badges: taps accumulate into a running total per
  // player. The badge lingers while taps keep coming, then — once idle — holds
  // a moment before fading away, so a burst of quick taps reads as one clear
  // number instead of a blur of individual flashes.
  const [badges, setBadges] = useState({});
  const badgeTimers = useRef({});
  const badgePoofTimers = useRef({});
  const LINGER_MS = 900;
  const POOF_MS = 550;

  // Undo keeps whole snapshots rather than inverse operations: a game state is
  // a handful of small objects, and "put it back how it was" can't drift out of
  // step with the actions the way a hand-written inverse can.
  const undoRef = useRef([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const stateRef = useRef();
  stateRef.current = { players, table, layout };

  useEffect(() => {
    return () => {
      Object.values(badgeTimers.current).forEach(clearTimeout);
      Object.values(badgePoofTimers.current).forEach(clearTimeout);
      clearHold();
    };
  }, [clearHold]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // Escape closes whatever's on top before it closes the counter itself.
      if (keypad) return setKeypad(null);
      if (picker) return setPicker(false);
      if (dice) return setDice(null);
      if (showLog) return setShowLog(false);
      if (naming) return setNaming(false);
      if (menuOpen) return setMenuOpen(false);
      if (panelFor !== null) return setPanelFor(null);
      if (cmd !== null) return setCmd(null);
      if (roll) return setRoll(null);
      onExit?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onExit, keypad, picker, dice, showLog, naming, menuOpen, panelFor, cmd, roll]);

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
      localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify({ format, layout, players, table, visibleCounters, log: log.slice(0, 40) }));
    } catch (e) {}
  }, [format, layout, players, table, visibleCounters, log]);

  const maxPlayers = format === "commander" ? MAX_PLAYERS : 6;
  const minPlayers = MIN_PLAYERS;
  const layoutObj = layoutById(layout) || layoutById(defaultLayoutFor(players.length));

  // ---- history ----
  function note(text) {
    setLog((l) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), text }, ...l].slice(0, 80));
  }

  // Every action that changes the game calls this first. Snapshot, then act.
  function remember() {
    undoRef.current = [...undoRef.current.slice(-49), stateRef.current];
    setUndoDepth(undoRef.current.length);
  }

  function undo() {
    const prev = undoRef.current.pop();
    setUndoDepth(undoRef.current.length);
    if (!prev) return;
    setPlayers(prev.players);
    setTable(prev.table);
    setLayout(prev.layout);
    setBadges({});
    note("Undid the last change");
  }

  // ---- game actions ----
  // Seats follow the layout: more seats than players adds players, fewer drops
  // the last ones.
  function seatCount(ps, n) {
    if (ps.length === n) return ps;
    if (ps.length > n) return ps.slice(0, n);
    const out = [...ps];
    while (out.length < n) {
      const id = idRef.current++;
      out.push(makeLifePlayer(id, `Player ${out.length + 1}`, LIFE_STARTING[format], defaultColorFor(out.length)));
    }
    return out;
  }

  function applyLayout(id) {
    const next = layoutById(id);
    if (!next || next.seats.length > maxPlayers) return;
    if (id !== layout) {
      remember();
      setLayout(id);
      setPlayers((ps) => seatCount(ps, next.seats.length));
      setPanelFor(null);
      setCmd(null);
    }
    setPicker(false);
  }

  function resizeTable(n) {
    const id = defaultLayoutFor(n);
    if (!id) return;
    remember();
    setLayout(id);
    setPlayers((ps) => seatCount(ps, n));
    setPanelFor(null);
    setCmd(null);
  }

  function setFormatAndReset(f) {
    if (f === format) return;
    remember();
    const start = LIFE_STARTING[f];
    let ps = players;
    if (f === "normal" && ps.length > 6) {
      ps = ps.slice(0, 6);
      setLayout(defaultLayoutFor(6));
    }
    setFormat(f);
    setPlayers(ps.map((p) => ({ ...p, life: start, cmdDmg: {}, counters: {}, out: false, outAt: null })));
    setTable({ ...EMPTY_TABLE });
    setBadges({});
    setCmd(null);
    setRoll(null);
    note(`New ${f} game — everyone at ${start}`);
  }

  // Filed once per game, whichever button the winner screen is dismissed with.
  function fileResult() {
    if (recorded.current) return;
    recorded.current = true;
    const result = gameResult(players, { format, startedAt: startedAt.current });
    saveGame(result);
    pushGames();
    if (onRecordGame) onRecordGame(result);
  }

  function setCommander(id, text) {
    setPlayers((ps) => ps.map((p, i) => (p.id === id ? withCommander(p, i, text) : p)));
  }

  function newGame() {
    remember();
    const start = LIFE_STARTING[format];
    // Commanders, colours and names stay put: the same table usually plays
    // another game with the same commanders, and typing five of them every time
    // would be a chore.
    setPlayers((ps) => ps.map((p) => ({ ...p, life: start, cmdDmg: {}, counters: {}, out: false, outAt: null })));
    startedAt.current = Date.now();
    recorded.current = false;
    setTable({ ...EMPTY_TABLE });
    setPanelFor(null);
    setCmd(null);
    setRoll(null);
    setBadges({});
    setWinnerSeen(false);
    setLog([]);
    note(`New game — everyone at ${start}`);
  }

  function adjustLife(id, delta) {
    remember();
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, life: p.life + delta } : p)));
    bumpBadge(id, delta);
  }

  function setLifeTotal(id, total) {
    remember();
    const player = players.find((p) => p.id === id);
    const delta = total - (player?.life ?? 0);
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, life: total } : p)));
    if (delta) bumpBadge(id, delta);
    note(`${player?.name || "A player"} set to ${total}`);
  }

  function resetPlayer(id) {
    remember();
    const start = LIFE_STARTING[format];
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, life: start, cmdDmg: {}, counters: {}, out: false } : p)));
  }

  function patchPlayer(id, patch) {
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function adjustCmdDmg(targetId, fromId, second, delta) {
    remember();
    const key = cmdKey(fromId, second);
    setPlayers((ps) =>
      ps.map((p) => {
        if (p.id !== targetId) return p;
        const next = Math.max(0, (p.cmdDmg[key] || 0) + delta);
        return { ...p, cmdDmg: { ...p.cmdDmg, [key]: next } };
      })
    );
  }

  function adjustCounter(id, key, delta) {
    remember();
    setPlayers((ps) =>
      ps.map((p) => {
        if (p.id !== id) return p;
        const next = Math.max(0, counterValue(p, key) + delta);
        return { ...p, counters: { ...p.counters, [key]: next } };
      })
    );
  }

  function toggleCounter(key) {
    setVisibleCounters((v) => (v.includes(key) ? v.filter((k) => k !== key) : [...v, key]));
  }

  function setOut(id, out) {
    remember();
    const player = players.find((p) => p.id === id);
    // The stamp is what lets a finished game say who came second.
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, out, outAt: out ? Date.now() : null } : p)));
    // The crown and the initiative don't stay with someone who's left the game.
    setTable((t) => ({
      ...t,
      monarch: out && t.monarch === id ? null : t.monarch,
      initiative: out && t.initiative === id ? null : t.initiative,
    }));
    note(`${player?.name || "A player"} is ${out ? "out" : "back in"}`);
  }

  // Partners are two commanders; turning it off forgets damage from the second.
  function togglePartner(id) {
    remember();
    const on = !players.find((p) => p.id === id)?.partner;
    const gone = cmdKey(id, true);
    setPlayers((ps) =>
      ps.map((p) => {
        const next = p.id === id ? { ...p, partner: on } : p;
        if (on || !(gone in next.cmdDmg)) return next;
        const { [gone]: _dropped, ...rest } = next.cmdDmg;
        return { ...next, cmdDmg: rest };
      })
    );
  }

  function claim(key, id) {
    remember();
    const player = players.find((p) => p.id === id);
    setTable((t) => ({ ...t, [key]: t[key] === id ? null : id }));
    const label = key === "monarch" ? "monarch" : "the initiative";
    note(table[key] === id ? `Nobody has ${label}` : `${player?.name || "A player"} takes ${label}`);
  }

  // Day → night → neither, in one button rather than a menu.
  function cycleDayNight() {
    remember();
    const next = table.dayNight === null ? "day" : table.dayNight === "day" ? "night" : null;
    setTable((t) => ({ ...t, dayNight: next }));
    note(next ? `It becomes ${next}` : "Day and night end");
  }

  // ---- dice ----
  function pushRoll(entry) {
    setDice((d) => ({ last: entry, history: [entry, ...((d && d.history) || [])].slice(0, 8) }));
    note(entry.text);
  }
  function doRoll(sides) {
    const n = rollDie(sides);
    pushRoll({ kind: "die", value: String(n), text: `d${sides} rolled ${n}` });
  }
  function doFlip() {
    const side = flipCoin();
    pushRoll({ kind: "coin", value: side, text: `Coin came up ${side}` });
  }
  // The who-starts roll is played out on the board itself: every seat turns
  // dark and shows its number, and the winner lights up.
  function startRoll() {
    const r = highRoll(players);
    const detail = r.rounds[r.rounds.length - 1].rolls.map((x) => `${x.name} ${x.roll}`).join(" · ");
    note(r.winner ? `${r.winner.name} wins the roll (${detail})` : `Still tied after ${r.rounds.length} rolls`);
    setRoll({ rolls: rollsById(r), winnerId: r.winner ? r.winner.id : null, winnerName: r.winner?.name || null });
    setDice(null);
    setMenuOpen(false);
    setPanelFor(null);
    setCmd(null);
  }

  const winner = winnerOf(players);
  const landscape = viewport.w > viewport.h * 1.15 && viewport.h > 0;
  const hubMode = roll ? "close" : cmd !== null ? "cmd" : "menu";
  const onHub = () => {
    if (roll) return setRoll(null);
    if (cmd !== null) return setCmd(null);
    setPanelFor(null);
    setMenuOpen(true);
  };
  const dealing = cmd !== null && typeof cmd === "object" ? { src: players.find((p) => p.id === cmd.deal), second: !!cmd.second } : null;
  const cmdTarget = cmd !== null && typeof cmd !== "object" ? players.find((p) => p.id === cmd) : null;

  function renderSeat(p, i) {
    const seat = layoutObj.seats[i];
    if (!seat) return null;
    const base = facingOf(seat, layoutObj, landscape);
    const rot = p.flip ? flipRot(base) : base;
    const bg = seatBackground(p.color);
    const ink = inkFor(p.color);
    const commander = format === "commander";

    // -- the who-starts roll
    if (roll) {
      const won = roll.winnerId === p.id;
      return (
        <Tile key={p.id} seat={seat} background={won ? seatBackground(STARS_THEME.id) : "#252427"} out={false}>
          <Face value={roll.rolls[p.id] ?? "–"} rot={rot} ink={won ? "#000000" : "#FFFFFF"} press={press} name={p.name} centerLabel={`${p.name} rolled ${roll.rolls[p.id] ?? "nothing"}`} />
        </Tile>
      );
    }

    // -- one commander dealing damage to everyone else
    if (dealing?.src) {
      const { src, second } = dealing;
      const which = src.partner ? ` ${second ? "B" : "A"}` : "";
      if (p.id === src.id) {
        return (
          <Tile key={p.id} seat={seat} background={L.panel}>
            <CommanderCard rot={rot} title={`Commander${which}`} subtitle="damage you've dealt" onReturn={() => setCmd(null)} />
          </Tile>
        );
      }
      return (
        <Tile key={p.id} seat={seat} background={dimColor(p.color)} out={p.out}>
          <Face
            value={cmdDamage(p, src.id, second)}
            rot={rot}
            ink="#FFFFFF"
            press={press}
            onDelta={(d) => adjustCmdDmg(p.id, src.id, second, d)}
            decLabel={`Decrease commander damage from ${src.name}${second ? " (partner)" : ""} to ${p.name}`}
            incLabel={`Increase commander damage from ${src.name}${second ? " (partner)" : ""} to ${p.name}`}
            signOpacity={0.35}
            name={p.name}
          />
        </Tile>
      );
    }

    // -- reading one seat's commander damage
    if (cmdTarget) {
      if (p.id === cmdTarget.id) {
        return (
          <Tile key={p.id} seat={seat} background={L.panel}>
            <CommanderCard rot={rot} onReturn={() => setCmd(null)} />
          </Tile>
        );
      }
      const faces = p.partner ? [false, true] : [false];
      return (
        <Tile key={p.id} seat={seat} background={dimColor(p.color)} out={p.out}>
          {faces.map((second, k) => (
            <Face
              key={second ? "b" : "a"}
              value={cmdDamage(cmdTarget, p.id, second)}
              rot={rot}
              ink="#FFFFFF"
              press={press}
              onDelta={(d) => adjustCmdDmg(cmdTarget.id, p.id, second, d)}
              decLabel={`Decrease commander damage from ${p.name}${second ? " (partner)" : ""} to ${cmdTarget.name}`}
              incLabel={`Increase commander damage from ${p.name}${second ? " (partner)" : ""} to ${cmdTarget.name}`}
              signOpacity={0.35}
              scale={faces.length > 1 ? 0.8 : 1}
              gap={k ? 4 : 0}
              name={faces.length > 1 ? `${p.name} ${second ? "B" : "A"}` : p.name}
            />
          ))}
        </Tile>
      );
    }

    // -- the ordinary seat
    const lethal = p.out ? null : lethalReason(p, visibleCounters);
    const chipArgs = { player: p, table, visibleCounters, commander, lethal };
    const chipsH = chipsHeightFor(chipArgs);
    return (
      <Tile key={p.id} seat={seat} background={panelFor === p.id ? L.panel : bg} out={p.out}>
        <Face
          value={p.life}
          rot={rot}
          ink={ink}
          press={press}
          onDelta={(d) => adjustLife(p.id, d)}
          decLabel={`${p.name}: decrease life by 1`}
          incLabel={`${p.name}: increase life by 1`}
          onCenter={() => setPanelFor(p.id)}
          centerLabel={`${p.name}: ${p.life} life — seat options`}
          name={seatLabel(p)}
          scale={p.scale || 1}
          badge={badges[p.id]}
          chipsHeight={chipsH}
          chips={
            chipsH > 0 ? (
              <SeatChips {...chipArgs} ink={ink} press={press} onCounter={(key, d) => adjustCounter(p.id, key, d)} onCommander={() => setCmd(p.id)} onDeal={(second) => setCmd({ deal: p.id, second })} compact={layoutObj.rows >= 4} />
            ) : null
          }
        />
        {panelFor === p.id && (
          <SeatPanel
            player={p}
            rot={rot}
            table={table}
            commander={commander}
            onClose={() => setPanelFor(null)}
            onColor={(c) => patchPlayer(p.id, { color: c })}
            onKill={() => setOut(p.id, !p.out)}
            onPartners={() => togglePartner(p.id)}
            onRename={(name) => patchPlayer(p.id, { name })}
            onTotal={() => {
              setPanelFor(null);
              setKeypad({ id: p.id, digits: "" });
            }}
            onCrown={() => claim("monarch", p.id)}
            onInitiative={() => claim("initiative", p.id)}
            onCommander={() => {
              setPanelFor(null);
              setCmd(p.id);
            }}
            onFlip={() => patchPlayer(p.id, { flip: !p.flip })}
            onReset={() => resetPlayer(p.id)}
            onScale={(d) => patchPlayer(p.id, { scale: clampScale((p.scale || 1) + d) })}
          />
        )}
      </Tile>
    );
  }

  const keypadPlayer = keypad ? players.find((p) => p.id === keypad.id) : null;

  return (
    <div
      data-bw-back="life"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 95,
        background: L.black,
        overflow: "hidden",
        fontFamily: FONT,
        color: L.white,
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        overscrollBehavior: "none",
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
        .life-mini { cursor: pointer; border: none; }
        @media (pointer: coarse) {
          .life-mini { width: 30px !important; height: 30px !important; }
        }
        button:focus-visible, [role="button"]:focus-visible { outline: 3px solid #fff; outline-offset: -3px; }
      `}</style>

      {/* the board: two columns, as many rows as the layout asks for */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gap: GAP,
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gridTemplateRows: `repeat(${layoutObj.rows}, minmax(0, 1fr))`,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
          boxSizing: "border-box",
        }}
      >
        {players.map(renderSeat)}
      </div>

      {roll && (
        <div
          aria-live="polite"
          style={{ ...pill("plain", { position: "absolute", left: "50%", bottom: "calc(18px + env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 25, background: "rgba(0,0,0,0.85)", pointerEvents: "none" }) }}
        >
          {roll.winnerName ? `${roll.winnerName} starts` : "Tied — roll again"}
        </div>
      )}

      {/* the menu has its own close button, and the hub would sit on top of it */}
      {!menuOpen && <Hub mode={hubMode} onClick={onHub} dayNight={table.dayNight} />}

      {menuOpen && (
        <MenuPanel
          format={format}
          onFormat={(f) => setFormatAndReset(f)}
          count={players.length}
          minPlayers={minPlayers}
          maxPlayers={maxPlayers}
          onAdd={() => resizeTable(players.length + 1)}
          onRemove={() => resizeTable(players.length - 1)}
          onLayout={() => {
            setMenuOpen(false);
            setPicker(true);
          }}
          dayNight={table.dayNight}
          onDayNight={cycleDayNight}
          onDice={() => {
            setMenuOpen(false);
            setDice({ last: null, history: [] });
          }}
          onWhoStarts={startRoll}
          onUndo={() => {
            undo();
            setMenuOpen(false);
          }}
          undoDepth={undoDepth}
          onLog={() => {
            setMenuOpen(false);
            setShowLog(true);
          }}
          commanderSet={players.some((p) => (p.commander || "").trim())}
          onCommanders={() => {
            setMenuOpen(false);
            setNaming(true);
          }}
          onStats={() => {
            setMenuOpen(false);
            setShowStats(true);
          }}
          visibleCounters={visibleCounters}
          onToggleCounter={toggleCounter}
          onNewGame={() => {
            newGame();
            setMenuOpen(false);
          }}
          onExit={onExit}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {showStats && <StatsModal onClose={() => setShowStats(false)} />}

      {picker && <LayoutPicker current={layoutObj.id} format={format} maxPlayers={maxPlayers} onPick={applyLayout} onClose={() => setPicker(false)} />}

      {keypadPlayer && (
        <KeypadModal
          player={keypadPlayer}
          digits={keypad.digits}
          setDigits={(fn) => setKeypad((k) => ({ ...k, digits: typeof fn === "function" ? fn(k.digits) : fn }))}
          onAdjust={(d) => {
            adjustLife(keypadPlayer.id, d);
            setKeypad(null);
          }}
          onSet={(v) => {
            setLifeTotal(keypadPlayer.id, v);
            setKeypad(null);
          }}
          onClose={() => setKeypad(null)}
        />
      )}

      {dice && <DiceModal dice={dice} onRoll={doRoll} onFlip={doFlip} onWhoStarts={startRoll} onClose={() => setDice(null)} />}

      {showLog && (
        <LogModal
          log={log}
          undoDepth={undoDepth}
          onUndo={() => {
            undo();
            setShowLog(false);
          }}
          onClose={() => setShowLog(false)}
        />
      )}

      {naming && <CommanderModal players={players} onCommander={setCommander} onClose={() => setNaming(false)} />}

      {winner && !winnerSeen && (
        <WinnerModal
          winner={winner}
          recording={!!onRecordGame && players.some((p) => (p.commander || "").trim())}
          onNewGame={() => {
            fileResult();
            setWinnerSeen(true);
            newGame();
          }}
          onKeep={() => {
            fileResult();
            setWinnerSeen(true);
          }}
        />
      )}
    </div>
  );
}
