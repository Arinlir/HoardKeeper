/*
 * Does this deck's mana base actually cast its spells?
 *
 * The curve chart everyone draws answers "how expensive is this deck", which
 * is the easy half. The hard half is colour: a deck with fourteen green
 * sources and a {G}{G} two-drop is a deck that keeps a hand it can't play.
 *
 * The method is Frank Karsten's — count the sources that produce each colour,
 * compare against what the deck actually demands and when — with his 60-card
 * numbers scaled to whatever size this deck is. Scaled, because a commander
 * deck draws from 99 cards rather than 59, and the same 90% odds need
 * proportionally more sources.
 *
 * Pure: cards in, numbers out. Rules text arrives as a lookup so the caller
 * decides where it comes from (the same oracle cache the drafter uses).
 */

export const COLORS = ["W", "U", "B", "R", "G"];
export const COLOR_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

const BASIC_TYPES = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" };

// "{2}{G}{G}" → { G: 2, generic: 2, total: 4 }. Hybrid ({R/G}) counts for both
// halves, since either colour casts it; phyrexian ({G/P}) counts as its colour
// because paying life is the emergency exit, not the plan.
export function parsePips(manaCost) {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };
  const symbols = String(manaCost || "").match(/\{[^}]+\}/g) || [];
  symbols.forEach((sym) => {
    const body = sym.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(body)) {
      out.generic += Number(body);
      return;
    }
    if (body === "X" || body === "Y" || body === "Z") return;
    if (body === "C") {
      out.C += 1;
      return;
    }
    const parts = body.split("/").filter((p) => p !== "P" && !/^\d+$/.test(p));
    const colored = parts.filter((p) => COLORS.includes(p));
    if (colored.length === 0) {
      if (parts.length === 0) out.generic += 1;
      return;
    }
    colored.forEach((c) => (out[c] += 1));
  });
  return out;
}

export function isLand(card, ruleTypeLine) {
  return /\bland\b/i.test(ruleTypeLine || card?.typeLine || "");
}

/*
 * Which colours a card can produce mana in.
 *
 * Basic land types are the reliable half — a Sacred Foundry is a Mountain and
 * a Plains whatever else it says. The rest is read out of the rules text:
 * "Add {G}", "Add {C}{C}", "add one mana of any colour". Anything we can't
 * read produces nothing, which is the safe direction to be wrong in: it
 * under-counts your mana rather than telling you a broken base is fine.
 */
export function producedColors(card, oracle) {
  const typeLine = oracle?.ty || card?.typeLine || "";
  const found = new Set();
  Object.entries(BASIC_TYPES).forEach(([word, color]) => {
    if (new RegExp(`\\b${word}\\b`, "i").test(typeLine)) found.add(color);
  });
  const text = oracle?.t || card?.oracleText || "";
  if (/add\b[^.]*\bone mana of any (color|colour)/i.test(text)) COLORS.forEach((c) => found.add(c));
  // Every "Add ..." clause, up to the end of that sentence.
  const clauses = text.match(/add\b[^.;\n]*/gi) || [];
  clauses.forEach((clause) => {
    (clause.match(/\{[^}]+\}/g) || []).forEach((sym) => {
      sym
        .slice(1, -1)
        .toUpperCase()
        .split("/")
        .forEach((p) => {
          if (COLORS.includes(p)) found.add(p);
        });
    });
  });
  return [...found];
}

/*
 * Karsten's 90%-confidence source counts for a 60-card deck: how many sources
 * of a colour you need to reliably cast a card with that many coloured pips on
 * that turn. Beyond turn six the numbers flatten out, so the table stops.
 */
const KARSTEN_60 = {
  1: { 1: 14, 2: 13, 3: 12, 4: 11, 5: 10, 6: 9 },
  2: { 2: 21, 3: 18, 4: 16, 5: 15, 6: 14 },
  3: { 3: 23, 4: 20, 5: 19, 6: 18 },
};

// Deck size is what actually moves the number: 99 cards behind a commander
// need proportionally more sources than 59 behind a 60-card deck.
export function sourcesNeeded(pips, turn, deckSize = 60) {
  const row = KARSTEN_60[Math.min(3, Math.max(1, pips))];
  if (!row) return 0;
  const turns = Object.keys(row).map(Number);
  const t = Math.min(Math.max(turn, Math.min(...turns)), Math.max(...turns));
  const base = row[t];
  return Math.round((base * (deckSize - 1)) / 59);
}

/*
 * How many lands a deck of this shape wants. Karsten's regressions: the more
 * expensive the average spell, the more lands; every cheap mana rock or dork
 * stands in for a fraction of a land. The 99-card formula is for Commander,
 * the 60-card one is scaled to other deck sizes. A rule of thumb, not a law -
 * it is meant to say "you're a few lands light", not to settle the argument.
 */
export function recommendLands({ avgMv, cheapRamp, deckSize }) {
  const raw =
    deckSize >= 90
      ? 31.42 + 3.13 * avgMv - 0.28 * cheapRamp
      : ((19.59 + 1.9 * avgMv - 0.28 * cheapRamp) * deckSize) / 60;
  const lo = Math.round(deckSize * 0.3);
  const hi = Math.round(deckSize * 0.45);
  return Math.min(hi, Math.max(lo, Math.round(raw)));
}

/*
 * The whole analysis for one deck.
 *
 * `rows` is one entry per colour the deck actually asks for: how many sources
 * it has, how many it wants, and which card set that bar — because "you want
 * 20 green sources" is only useful next to "because of Chord of Calling".
 */
export function analyseManabase({ cards, basics = {}, commander, oracleOf = () => null, deckSize }) {
  const all = [...cards];
  // one commander, or both halves of a partner pair
  [].concat(commander || []).forEach((c) => c && all.push({ ...c, isCommander: true }));

  // Basic lands, expanded from the deck's own count.
  const basicRows = Object.entries(basics)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => ({ name, n, color: BASIC_TYPES[name.toLowerCase()] || null }));

  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const nonLandSources = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let lands = 0;

  basicRows.forEach((b) => {
    lands += b.n;
    if (b.color) sources[b.color] += b.n;
  });

  all.forEach((entry) => {
    const card = entry.card || entry;
    const qty = entry.qty || 1;
    const oracle = oracleOf(card);
    const produces = producedColors(card, oracle);
    if (isLand(card, oracle?.ty)) {
      lands += qty;
      produces.forEach((c) => (sources[c] += qty));
    } else if (produces.length) {
      // Rocks and dorks: real sources, but they cost mana themselves and can
      // be killed, so they're counted apart rather than folded in.
      produces.forEach((c) => (nonLandSources[c] += qty));
    }
  });

  // What the deck demands, and the earliest turn it demands it.
  const demand = {};
  all.forEach((entry) => {
    const card = entry.card || entry;
    const qty = entry.qty || 1;
    if (isLand(card, oracleOf(card)?.ty)) return;
    const pips = parsePips(card.manaCost);
    COLORS.forEach((c) => {
      if (!pips[c]) return;
      const turn = Math.max(1, Math.round(card.cmc ?? pips.generic + pips[c]));
      const d = (demand[c] = demand[c] || { pipCards: 0, copies: 0, worst: null });
      d.pipCards += 1;
      d.copies += qty;
      const need = sourcesNeeded(pips[c], turn, deckSize);
      if (!d.worst || need > d.worst.need)
        d.worst = { need, card, pips: pips[c], turn, name: card.name };
    });
  });

  const rows = COLORS.filter((c) => demand[c]).map((c) => {
    const d = demand[c];
    const have = sources[c];
    const want = d.worst?.need || 0;
    return {
      color: c,
      label: COLOR_NAMES[c],
      have,
      extra: nonLandSources[c],
      want,
      short: Math.max(0, want - have),
      ok: have >= want,
      cards: d.copies,
      driver: d.worst,
    };
  });

  // Land-count check. `lands` already holds every land in the deck - basics
  // plus nonbasic land cards - so the recommendation is compared against the
  // real total, not just the basics.
  let spells = 0;
  let mvSum = 0;
  let cheapRamp = 0;
  cards.forEach((entry) => {
    const card = entry.card || entry;
    const qty = entry.qty || 1;
    const oracle = oracleOf(card);
    if (isLand(card, oracle?.ty)) return;
    const p = parsePips(card.manaCost);
    const mv = card.cmc ?? (card.manaCost ? p.generic + p.C + COLORS.reduce((t, c) => t + p[c], 0) : null);
    if (mv == null) return;
    spells += qty;
    mvSum += mv * qty;
    if (mv <= 2 && producedColors(card, oracle).length) cheapRamp += qty;
  });
  const basicCount = basicRows.reduce((t, b) => t + b.n, 0);
  const avgMv = spells ? mvSum / spells : 0;
  const landPlan = spells
    ? {
        have: lands,
        basics: basicCount,
        nonbasic: Math.max(0, lands - basicCount),
        recommended: recommendLands({ avgMv, cheapRamp, deckSize }),
        avgMv,
        cheapRamp,
      }
    : null;

  return {
    lands,
    landPlan,
    deckSize,
    rows,
    // A colourless deck, or one with no costs on file yet, has nothing to say.
    known: all.some((e) => (e.card || e).manaCost),
  };
}
