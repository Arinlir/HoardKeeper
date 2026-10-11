/*
 * Deck-page derived data: mana curve, cards per colour, how cards split across categories, and which card represents the
 * deck in its thumbnail. Pure — cards in, chart-ready rows out — same shape
 * as manabase.js and categories.js, so DecksView and DeckGallery just render
 * what comes back.
 */
import { deckCategories } from "./categories";

// Nonland cards by mana value, 0-6 then "7+" — the same bucketing the
// collection's own curve chart uses (see features/collection/Analytics.jsx),
// so the same shape of chart means the same thing everywhere in the app.
// `commander` may be one card or the whole command zone (an array).
export function deckManaCurve(deck, cardById, commander) {
  const buckets = {};
  const bump = (card, qty) => {
    if (!card) return;
    if (/\bland\b/i.test(card.typeLine || "")) return;
    const cmc = Math.min(Math.round(card.cmc ?? 0), 7);
    const key = cmc === 7 ? "7+" : String(cmc);
    buckets[key] = (buckets[key] || 0) + qty;
  };
  [].concat(commander || []).forEach((c) => bump(c, 1));
  (deck?.entries || []).forEach((e) => bump(cardById?.[e.cardId], e.qty || 1));
  return ["0", "1", "2", "3", "4", "5", "6", "7+"].map((k) => ({ name: k, Cards: buckets[k] || 0 }));
}

// How many cards sit in each category this deck actually shows (built-in
// roles first, then its own — see categories.js). A category with nothing in
// it is left off rather than drawn as an empty bar.
export function deckCategoryCounts(deck, cardById) {
  const counts = {};
  (deck?.entries || []).forEach((e) => {
    if (!cardById?.[e.cardId]) return;
    const key = e.role || "other";
    counts[key] = (counts[key] || 0) + (e.qty || 1);
  });
  return deckCategories(deck)
    .map((c) => ({ name: c.label, Cards: counts[c.key] || 0 }))
    .filter((c) => c.Cards > 0);
}

// How many nonland cards of each colour the deck holds (commander included).
// A multicolour card counts once for every colour it has, so the bars can add
// up to more than the deck size; colourless cards get their own bar.
const COLOUR_ROWS = [
  { key: "W", name: "White" },
  { key: "U", name: "Blue" },
  { key: "B", name: "Black" },
  { key: "R", name: "Red" },
  { key: "G", name: "Green" },
  { key: "C", name: "Colorless" },
];
export function deckColorCounts(deck, cardById, commander) {
  const counts = {};
  const bump = (card, qty) => {
    if (!card || /\bland\b/i.test(card.typeLine || "")) return;
    const cols = card.colors || [];
    (cols.length ? cols : ["C"]).forEach((c) => (counts[c] = (counts[c] || 0) + qty));
  };
  [].concat(commander || []).forEach((c) => bump(c, 1));
  (deck?.entries || []).forEach((e) => bump(cardById?.[e.cardId], e.qty || 1));
  return COLOUR_ROWS.map((r) => ({ ...r, Cards: counts[r.key] || 0 })).filter((r) => r.Cards > 0);
}

// Which card represents this deck in a thumbnail: whatever was explicitly
// chosen via "Set as deck image", falling back to the commander (and to
// nothing at all for a 60-card deck that never picked one — no art is
// honest there, not a placeholder).
export function coverImageFor(deck, cardById, commander) {
  const chosen = deck?.coverCardId ? cardById?.[deck.coverCardId] : null;
  return chosen || commander || null;
}
