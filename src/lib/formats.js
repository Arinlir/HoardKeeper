/*
 * Format legality and banlists.
 *
 * Scryfall already tells us, per printing, whether a card is legal, banned or
 * restricted in every format it tracks — we simply weren't keeping it. We keep
 * a curated set now, packed into one-letter codes: a collection of ten
 * thousand cards would otherwise carry a megabyte of the word "not_legal"
 * around in its save file.
 *
 * Nothing here talks to the network or to React: `packLegalities` folds a
 * Scryfall payload down, `legalityOf` reads it back, and `deckLegality` says
 * what's wrong with a deck.
 */

export const FORMATS = [
  { key: "commander", code: "cmd", label: "Commander", singleton: true, size: 100 },
  { key: "standard", code: "std", label: "Standard", size: 60, min: true, maxCopies: 4 },
  { key: "pioneer", code: "pio", label: "Pioneer", size: 60, min: true, maxCopies: 4 },
  { key: "modern", code: "mod", label: "Modern", size: 60, min: true, maxCopies: 4 },
  { key: "legacy", code: "leg", label: "Legacy", size: 60, min: true, maxCopies: 4 },
  { key: "vintage", code: "vin", label: "Vintage", size: 60, min: true, maxCopies: 4 },
  { key: "pauper", code: "pau", label: "Pauper", size: 60, min: true, maxCopies: 4 },
  { key: "brawl", code: "brl", label: "Brawl", singleton: true, size: 100 },
  { key: "duel", code: "duel", label: "Duel Commander", singleton: true, size: 100 },
];

const BY_KEY = {};
FORMATS.forEach((f) => {
  BY_KEY[f.key] = f;
  BY_KEY[f.code] = f;
});
// The names people actually type.
BY_KEY.edh = BY_KEY.commander;
BY_KEY.cedh = BY_KEY.commander;
BY_KEY.duelcommander = BY_KEY.duel;

export function isSingletonFormat(format) {
  const meta = formatMeta(format);
  // Only the singleton formats are singleton; anything unrecognised is treated
  // as a 60-card constructed deck, which is the safer of the two guesses.
  return !!meta?.singleton;
}

export function formatMeta(nameOrCode) {
  return BY_KEY[String(nameOrCode || "").toLowerCase()] || null;
}

const PACK = { legal: "l", not_legal: "n", banned: "b", restricted: "r" };
const UNPACK = { l: "legal", n: "not_legal", b: "banned", r: "restricted" };

export function packLegalities(raw) {
  if (!raw) return null;
  const out = {};
  FORMATS.forEach((f) => {
    const v = PACK[raw[f.key]];
    if (v) out[f.code] = v;
  });
  return Object.keys(out).length ? out : null;
}

// "" when we simply don't know — a card added before legalities were stored,
// which is not the same statement as "not legal".
export function legalityOf(card, formatName) {
  const meta = formatMeta(formatName);
  if (!meta) return "";
  const packed = card?.legalities;
  if (!packed) return "";
  return UNPACK[packed[meta.code]] || "";
}

export const LEGALITY_LABEL = {
  legal: "Legal",
  banned: "Banned",
  restricted: "Restricted",
  not_legal: "Not legal",
  "": "Unknown",
};

/*
 * What's wrong with this deck in its own format.
 *
 * `entries` are resolved through `cardById` exactly as the deck view does, so
 * placeholders for cards you don't own are checked too — finding out a card is
 * banned before you buy it is the whole point.
 *
 * Basic lands are exempt from the singleton and 4-copy rules, as they are in
 * every rulebook. A card whose legality we've never fetched is reported
 * separately rather than counted as a problem.
 */
export function deckLegality(deck, cardById, opts = {}) {
  const meta = formatMeta(deck?.format);
  const isBasic = opts.isBasicLand || (() => false);
  const rows = [];
  (deck?.entries || []).forEach((e) => {
    const card = cardById?.[e.cardId];
    if (card) rows.push({ card, qty: e.qty || 1 });
  });
  // both commanders when there's a partner pair
  [deck?.commanderId, deck?.partnerId].forEach((id) => {
    const commander = id ? cardById?.[id] : null;
    if (commander) rows.push({ card: commander, qty: 1, isCommander: true });
  });

  const problems = [];
  let unknown = 0;
  rows.forEach(({ card, qty }) => {
    const status = meta ? legalityOf(card, meta.key) : "";
    if (!status) unknown += 1;
    else if (status === "banned" || status === "not_legal")
      problems.push({ card, qty, status });
    else if (status === "restricted" && qty > 1) problems.push({ card, qty, status });
  });

  // Copy limits. Basic lands are unlimited in every format; so is a card whose
  // own text says a deck can have any number of them, which the deck view
  // already knows about and passes in.
  const limit = meta?.singleton ? 1 : meta?.maxCopies || 0;
  const counted = {};
  rows.forEach(({ card, qty, isCommander }) => {
    if (isCommander || isBasic(card) || opts.unlimited?.(card)) return;
    const key = (card.name || "").toLowerCase();
    if (!counted[key]) counted[key] = { card, qty: 0 };
    counted[key].qty += qty;
  });
  const overLimit = limit
    ? Object.values(counted)
        .filter((x) => x.qty > limit)
        .map((x) => ({ card: x.card, qty: x.qty, limit }))
    : [];

  return {
    format: meta,
    known: !!meta,
    problems,
    overLimit,
    unknown,
    ok: !!meta && problems.length === 0 && overLimit.length === 0,
  };
}
