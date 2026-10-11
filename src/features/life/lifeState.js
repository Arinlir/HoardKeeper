/*
 * Everything the Life Counter knows that isn't rendering.
 *
 * Kept as plain functions with no React in sight, partly so the rules (what
 * counts as lethal, who won, how a high roll settles a tie, where a seat sits
 * on the board and which way it faces) can be tested directly, and partly to
 * keep the Life Counter's deliberate isolation: it imports React and lucide,
 * and nothing from the collection, decks or storage layers.
 */

export const LIFE_STARTING = { commander: 40, normal: 20 };
export const LIFE_STORAGE_KEY = "hk-life-tracker";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

// The optional counters. Which ones are on is a table-wide choice, not a
// per-player one — everyone at a table is playing the same game, and a row of
// counters nobody is using is just noise on every seat.
export const COUNTERS = [
  { key: "poison", label: "Poison", short: "POISON", lethalAt: 10, note: "ten and you're out" },
  { key: "energy", label: "Energy", short: "ENERGY" },
  { key: "experience", label: "Experience", short: "EXP" },
  { key: "tax", label: "Commander tax", short: "TAX", step: 2, note: "goes up two at a time" },
  { key: "storm", label: "Storm", short: "STORM" },
];

export const COUNTER_BY_KEY = Object.fromEntries(COUNTERS.map((c) => [c.key, c]));

// ---------------------------------------------------------------------------
// Colours. A seat is a block of flat colour with black (or white) numerals on
// it — the colour is how you find your own seat from across a table.
// ---------------------------------------------------------------------------

export const SEAT_COLORS = [
  "#E6D9A8", // plains
  "#2F6DB0", // island
  "#C4503A", // mountain
  "#4E9A62", // forest
  "#6B5F7A", // swamp
  "#C9A227", // gold
  "#6FB3AE", // teal
  "#9A6FB0", // violet
  "#B5B8BD", // silver
  "#D98A4E", // copper
];

// A seat background that isn't one flat colour. `css` is a complete CSS
// `background` value, so the view has nothing to special-case.
const STARS_SVG =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'>" +
  "<g fill='white'>" +
  "<circle cx='18' cy='22' r='1.600' fill-opacity='0.8'/><circle cx='96' cy='14' r='1' fill-opacity='0.55'/>" +
  "<circle cx='58' cy='64' r='1.300' fill-opacity='0.7'/><circle cx='124' cy='72' r='1.800' fill-opacity='0.85'/>" +
  "<circle cx='30' cy='108' r='1' fill-opacity='0.5'/><circle cx='88' cy='120' r='1.500' fill-opacity='0.75'/>" +
  "<path d='M70 30l1.200 3.200 3.200 1.200-3.200 1.200L70 39l-1.200-3.400-3.200-1.200 3.200-1.200z' fill-opacity='0.9'/>" +
  "</g></svg>\")";
// A night sky: deep indigo with a faint glow and a scatter of stars.
export const STARS_THEME = {
  id: "stars",
  label: "Night sky",
  css: `${STARS_SVG}, radial-gradient(120% 90% at 30% 10%, #3A3F8F 0%, #1E2250 45%, #0E1030 100%)`,
};

export function defaultColorFor(index) {
  return SEAT_COLORS[((index % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Black numerals on anything bright, white on anything dark. The night-sky
// theme is dark all over, so it takes white.
export function inkFor(color) {
  if (color === STARS_THEME.id) return "#FFFFFF";
  const rgb = hexToRgb(color);
  if (!rgb) return "#FFFFFF";
  const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.3 ? "#000000" : "#FFFFFF";
}

// The same colour, turned down — what the other seats look like while you're
// reading one player's commander damage.
export function dimColor(color, amount = 0.7) {
  const rgb = hexToRgb(color);
  if (!rgb) return "#2B2A33";
  return "#" + rgb.map((v) => Math.round(v * amount).toString(16).padStart(2, "0")).join("");
}

export function seatBackground(color) {
  if (color === STARS_THEME.id) return STARS_THEME.css;
  return hexToRgb(color) ? color : defaultColorFor(0);
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export function makeLifePlayer(id, name, life, color) {
  return {
    id,
    name,
    life,
    cmdDmg: {},
    counters: {},
    out: false,
    color: color || defaultColorFor(id - 1),
    partner: false,
    scale: 1,
    flip: false,
  };
}

// Commander damage is kept per commander. A partner pair is two commanders, and
// the 21-damage rule applies to each of them on its own, so the second one gets
// its own key.
export function cmdKey(fromId, second = false) {
  return second ? `${fromId}b` : String(fromId);
}

export function cmdDamage(player, fromId, second = false) {
  return player?.cmdDmg?.[cmdKey(fromId, second)] || 0;
}

// The biggest single hit this player has taken — what the little sword chip
// on a seat shows.
export function maxCmdDamage(player) {
  return Math.max(0, ...Object.values(player?.cmdDmg || {}));
}

export const SCALE_MIN = 0.6;
export const SCALE_MAX = 1.2;
export function clampScale(v) {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(v * 100) / 100));
}

/*
 * The result of a finished game, in the shape the collection stores.
 *
 * This is the one place the Life Counter touches the rest of the app, and it
 * does it by handing over a plain object rather than by importing anything: a
 * seat carries the deck it was piloting only if someone said so, and a game
 * where nobody named a deck is still a game worth having in the log.
 *
 * Places are read off elimination order — the last one knocked out came
 * second — which is why setOut stamps a time.
 */
export function gameResult(players, { format = "commander", startedAt = null, at = Date.now() } = {}) {
  const alive = players.filter((p) => !p.out);
  const winner = players.length > 1 && alive.length === 1 ? alive[0] : null;
  const ordered = [...players].sort((a, b) => {
    if (!!a.out !== !!b.out) return a.out ? 1 : -1;
    return (b.outAt || 0) - (a.outAt || 0);
  });
  return {
    id: `g-${at}-${Math.random().toString(36).slice(2, 6)}`,
    at,
    startedAt,
    format,
    winnerName: winner?.name || null,
    winnerDeckId: winner?.deckId || null,
    seats: ordered.map((p, i) => ({
      name: p.name,
      deckId: p.deckId || null,
      deckName: p.deckName || null,
      life: p.life,
      out: !!p.out,
      place: winner ? i + 1 : null,
      won: !!winner && p.id === winner.id,
    })),
  };
}

// Saves from before counters, colours and partners existed are missing those
// fields; fill them in rather than letting `undefined` reach the render.
function normalizePlayer(p, index) {
  return {
    cmdDmg: {},
    counters: {},
    out: false,
    color: defaultColorFor(index),
    partner: false,
    scale: 1,
    flip: false,
    ...p,
  };
}

export function loadSavedLife() {
  try {
    const s = JSON.parse(localStorage.getItem(LIFE_STORAGE_KEY));
    if (s && Array.isArray(s.players) && s.players.length >= MIN_PLAYERS) {
      const players = s.players.slice(0, MAX_PLAYERS).map(normalizePlayer);
      return {
        ...s,
        players,
        layout: layoutById(s.layout) ? s.layout : defaultLayoutFor(players.length),
      };
    }
  } catch (e) {}
  return null;
}

export const EMPTY_TABLE = { monarch: null, initiative: null, dayNight: null };

export function counterValue(player, key) {
  return player?.counters?.[key] || 0;
}

// What's killing this player, if anything — used for the warning on a seat and
// for the "knock them out" prompt. Poison only counts when the table is
// actually tracking it.
export function lethalReason(player, visibleCounters = []) {
  if (Object.values(player.cmdDmg || {}).some((v) => v >= 21)) return "21 commander damage";
  if (visibleCounters.includes("poison") && counterValue(player, "poison") >= 10) return "10 poison";
  if (player.life <= 0) return "0 life";
  return null;
}

export function livePlayers(players) {
  return players.filter((p) => !p.out);
}

// A game is won when everyone but one seat has been knocked out. Two seats and
// one of them out counts; a single-player "table" never does.
export function winnerOf(players) {
  const alive = livePlayers(players);
  return players.length > 1 && alive.length === 1 ? alive[0] : null;
}

// ---------------------------------------------------------------------------
// Layouts — where the seats sit on the board.
//
// The board is two columns wide and as many rows tall as the layout asks for.
// A layout is written as one string per row:
//   "s"  a seat in a half-width cell
//   "."  an empty half-width cell (a gap in the board)
//   "S"  one seat spanning the whole row
// so "S/ss/ss" is a wide seat across the top over a two-by-two block. Seats are
// numbered in reading order, which is also the order of the players array.
// ---------------------------------------------------------------------------

const LAYOUT_ROWS = [
  // two players
  "S/S",
  "ss",
  // three
  "S/ss",
  "ss/S",
  ".s/ss",
  "s./ss",
  // four
  "ss/ss",
  "S/ss/S",
  // five
  "S/ss/ss",
  "ss/ss/S",
  "ss/ss/.s",
  "ss/ss/s.",
  // six
  "ss/ss/ss",
  "S/ss/ss/S",
  // seven
  "ss/ss/ss/s.",
  "ss/ss/ss/.s",
  // eight
  "ss/ss/ss/ss",
  "S/ss/ss/ss/S",
  // nine
  "ss/ss/ss/ss/s.",
  // ten
  "ss/ss/ss/ss/ss",
];

export function parseLayout(id) {
  const rows = String(id || "").split("/");
  if (!rows.length || rows.some((r) => !/^(S|[s.]{2})$/.test(r))) return null;
  const seats = [];
  const cells = []; // every cell, seat or gap, for drawing the picker thumbnails
  rows.forEach((row, r) => {
    if (row === "S") {
      seats.push({ index: seats.length, row: r, col: 0, span: 2 });
      cells.push({ row: r, col: 0, span: 2, seat: seats.length - 1 });
      return;
    }
    [...row].forEach((ch, c) => {
      if (ch === "s") {
        seats.push({ index: seats.length, row: r, col: c, span: 1 });
        cells.push({ row: r, col: c, span: 1, seat: seats.length - 1 });
      } else {
        cells.push({ row: r, col: c, span: 1, seat: null });
      }
    });
  });
  if (!seats.length) return null;
  return { id, rows: rows.length, seats, cells };
}

export const LAYOUTS = LAYOUT_ROWS.map(parseLayout);

export function layoutById(id) {
  return LAYOUTS.find((l) => l.id === id) || null;
}

// The layout a table of this size gets when nobody has picked one: the first
// of its size, which is always the tidy block.
export function defaultLayoutFor(count) {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, count));
  const tidy = { 2: "S/S", 3: "S/ss", 4: "ss/ss", 5: "S/ss/ss", 6: "ss/ss/ss" };
  return tidy[n] || LAYOUTS.find((l) => l.seats.length === n)?.id;
}

export function layoutsFor(maxSeats = MAX_PLAYERS) {
  return LAYOUTS.filter((l) => l.seats.length <= maxSeats);
}

// Which way a seat faces. Seats along the sides sit at the table's left and
// right edges and read sideways; a seat across the top reads upside down to
// the person holding the device. On a landscape screen — a tablet or a browser
// window — everyone is across the table from someone, so the top row flips and
// the rest stay upright.
export function facingOf(seat, layout, landscape = false) {
  const top = seat.row === 0 && layout.rows > 1;
  if (landscape) return top ? 180 : 0;
  if (seat.span === 2) return top ? 180 : 0;
  return seat.col === 0 ? 90 : -90;
}

// Which side of a seat takes the minus and which the plus, for a given facing.
// Always the player's own left/right: a seat facing 90° has its "right" along
// the screen's downward edge, and so on.
export function tapSides(rot) {
  switch (rot) {
    case 90:
      return { dec: "top", inc: "bottom", axis: "y" };
    case -90:
      return { dec: "bottom", inc: "top", axis: "y" };
    case 180:
      return { dec: "right", inc: "left", axis: "x" };
    default:
      return { dec: "left", inc: "right", axis: "x" };
  }
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

export const DICE = [4, 6, 8, 10, 12, 20];

export function rollDie(sides, rnd = Math.random) {
  return 1 + Math.floor(rnd() * sides);
}

export function flipCoin(rnd = Math.random) {
  return rnd() < 0.5 ? "Heads" : "Tails";
}

// Everyone rolls a d20 and the highest starts. Ties reroll among the tied
// players only, the way a table actually does it — with a hard stop so a run
// of identical rolls can't spin forever.
export function highRoll(players, rnd = Math.random, maxRounds = 6) {
  let contenders = livePlayers(players);
  if (contenders.length === 0) contenders = players;
  const rounds = [];
  for (let i = 0; i < maxRounds; i++) {
    const rolls = contenders.map((p) => ({ id: p.id, name: p.name, roll: rollDie(20, rnd) }));
    const best = Math.max(...rolls.map((r) => r.roll));
    const tied = rolls.filter((r) => r.roll === best);
    rounds.push({ rolls, best });
    if (tied.length === 1) return { rounds, winner: tied[0], tied: false };
    contenders = contenders.filter((p) => tied.some((t) => t.id === p.id));
  }
  return { rounds, winner: null, tied: true };
}

// What each seat last rolled — the number its tile shows while the roll is up.
export function rollsById(result) {
  const out = {};
  for (const round of result.rounds) for (const r of round.rolls) out[r.id] = r.roll;
  return out;
}
