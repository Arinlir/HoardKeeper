/*
 * Goldfishing: draw a real opening hand from a real deck.
 *
 * The single most-used button on every deck site, and the cheapest useful
 * thing a deck builder can do — no network, no rules engine, just this deck's
 * actual 99 cards, shuffled, seven off the top. It answers the only question
 * a decklist can't: does this thing keep?
 *
 * Everything here is pure and takes its randomness as an argument, so a test
 * can hand it a fixed sequence and get the same hand every time.
 */

// Fisher–Yates, with the randomness injected.
export function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/*
 * The deck as a stack of cards.
 *
 * Every copy is its own entry — four Lightning Bolts are four cards, not one
 * row with a 4 — because that's what shuffling means. Basic lands become
 * card-shaped stand-ins so the hand can show them like anything else, and the
 * commander is left out: it starts in the command zone, not the library.
 */
export function buildLibrary(deck, cardById) {
  const out = [];
  (deck?.entries || []).forEach((e) => {
    const card = cardById?.[e.cardId];
    if (!card) return;
    for (let i = 0; i < (e.qty || 1); i++) out.push(card);
  });
  Object.entries(deck?.basics || {}).forEach(([name, n]) => {
    for (let i = 0; i < n; i++)
      out.push({
        id: `basic-${name}-${i}`,
        name,
        typeLine: `Basic Land — ${name}`,
        cmc: 0,
        manaCost: "",
        basic: true,
      });
  });
  return out;
}

export function isLandCard(card) {
  return /\bland\b/i.test(card?.typeLine || "");
}

/*
 * A fresh hand under the London mulligan: you always draw seven, and put one
 * card on the bottom per mulligan taken. `toBottom` is how many this hand owes
 * — the player chooses which, so that choice stays in the UI.
 */
export function newHand(library, mulligans = 0, rng = Math.random) {
  const stack = shuffle(library, rng);
  return {
    hand: stack.slice(0, 7),
    library: stack.slice(7),
    mulligans,
    toBottom: mulligans,
    drawn: 0,
  };
}

// Put chosen cards on the bottom of the library, which is what settles a
// London mulligan and lets the draw steps start.
export function bottomCards(state, ids) {
  const chosen = new Set(ids);
  const kept = [];
  const bottomed = [];
  state.hand.forEach((c, i) => {
    const key = `${c.id}:${i}`;
    if (chosen.has(key) && bottomed.length < state.toBottom) bottomed.push(c);
    else kept.push(c);
  });
  return { ...state, hand: kept, library: [...state.library, ...bottomed], toBottom: 0 };
}

export function drawCard(state, n = 1) {
  const taken = state.library.slice(0, n);
  return {
    ...state,
    hand: [...state.hand, ...taken],
    library: state.library.slice(n),
    drawn: (state.drawn || 0) + taken.length,
  };
}

/*
 * What this hand looks like at a glance: lands, spells, the cheapest thing you
 * could actually cast, and the average cost. Enough to judge a keep without
 * counting on your fingers.
 */
export function handStats(hand) {
  const lands = hand.filter(isLandCard).length;
  const spells = hand.filter((c) => !isLandCard(c));
  const curve = {};
  spells.forEach((c) => {
    const k = Math.min(7, Math.round(c.cmc ?? 0));
    curve[k] = (curve[k] || 0) + 1;
  });
  const costs = spells.map((c) => c.cmc ?? 0);
  return {
    size: hand.length,
    lands,
    spells: spells.length,
    curve,
    cheapest: costs.length ? Math.min(...costs) : null,
    avgCmc: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
    // A hand with no land, or nothing but land, is the one people mulligan
    // without thinking — worth saying out loud.
    flooded: hand.length > 0 && lands >= hand.length - 1,
    screwed: hand.length > 0 && lands <= 1,
  };
}
