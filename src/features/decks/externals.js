/*
 * Cards in a deck that aren't in your collection.
 *
 * A deck entry has always pointed at a card you own (`entry.cardId` → a row in
 * `cards`), which made planning a deck you haven't bought yet impossible. Rather
 * than give entries a second shape — and rewrite every `cardById[e.cardId]` in
 * the deck view — a deck now carries its own little list of card-shaped records
 * in `deck.external`, and the view merges those into the same lookup. Everything
 * downstream (value, identity, roles, export) keeps working; the only new fact
 * about them is `notOwned: true`.
 *
 * They are per deck on purpose: an unowned card is a plan, not a possession, so
 * two decks can each plan the same card without fighting over a copy.
 */
import { uid } from "../../lib/store";

export const EXTERNAL_PREFIX = "ext-";

export function isExternal(card) {
  return !!card?.notOwned;
}

// Build a card-shaped record from a Scryfall printing (or a decklist line that
// was looked up). It deliberately mirrors the fields a collection card has, so
// pricing, colour identity, role classification and export all treat it the
// same as any other card.
export function makeExternalCard(printing, extra = {}) {
  return {
    id: `${EXTERNAL_PREFIX}${uid()}`,
    notOwned: true,
    name: printing.name,
    set: printing.set || "",
    setName: printing.setName || "",
    collectorNumber: printing.collectorNumber || "",
    scryfallId: printing.scryfallId || null,
    scryfallUri: printing.scryfallUri || null,
    imageUrl: printing.imageUrl || null,
    imageUrlLarge: printing.imageUrlLarge || null,
    imageUrlBack: printing.imageUrlBack || null,
    imageUrlBackLarge: printing.imageUrlBackLarge || null,
    quantity: 1,
    finish: printing.finish || "nonfoil",
    foil: false,
    condition: "NM",
    usd: printing.usd ?? null,
    usdFoil: printing.usdFoil ?? null,
    usdEtched: printing.usdEtched ?? null,
    eur: printing.eur ?? null,
    eurFoil: printing.eurFoil ?? null,
    eurEtched: printing.eurEtched ?? null,
    colors: printing.colors || [],
    cmc: printing.cmc ?? 0,
    typeLine: printing.typeLine || "",
    rarity: printing.rarity || "",
    artist: printing.artist || null,
    ...extra,
  };
}

export function externalsOf(deck) {
  return deck?.external || [];
}

// What this deck is still short of, and what it would cost to fix.
// `unitValue` is the app's own per-copy pricing, so it follows the display
// currency and any overrides exactly like the rest of the deck's figures do.
export function missingSummary(deck, cardById, unitValue) {
  const rows = [];
  let cost = 0;
  let count = 0;
  (deck?.entries || []).forEach((e) => {
    const card = cardById[e.cardId];
    if (!card || !card.notOwned) return;
    const qty = e.qty || 1;
    const each = unitValue ? unitValue(card) || 0 : 0;
    count += qty;
    cost += each * qty;
    rows.push({ card, qty, each });
  });
  rows.sort((a, b) => b.each * b.qty - a.each * a.qty || a.card.name.localeCompare(b.card.name));
  return { count, cost, rows };
}

// Does an owned card satisfy this placeholder? Scryfall id is the only thing
// that says "this exact printing"; set + collector number is the same statement
// spelled differently. Name alone is a deliberate last resort — if you own the
// card at all, the plan is satisfied.
export function matchesExternal(external, card, mode = "any") {
  if (!card || card.sold || card.proxy || card.notOwned) return false;
  const exactId = !!(external.scryfallId && card.scryfallId && external.scryfallId === card.scryfallId);
  const exactPrint = !!(
    external.set &&
    external.collectorNumber &&
    card.set &&
    card.collectorNumber &&
    external.set.toLowerCase() === card.set.toLowerCase() &&
    String(external.collectorNumber) === String(card.collectorNumber)
  );
  if (mode === "exact") return exactId || exactPrint;
  return exactId || exactPrint || external.name.toLowerCase() === (card.name || "").toLowerCase();
}

/*
 * When a card you were only planning turns up in the collection — bought and
 * typed in, imported from a CSV, or acquired off the wishlist — the deck should
 * quietly stop calling it missing.
 *
 * Returns a patched deck, or null when there's nothing to link. A collection
 * card is claimed at most once per pass, so two placeholders for the same card
 * don't both resolve onto one copy.
 */
export function linkAcquired(deck, cards) {
  const externals = externalsOf(deck);
  if (externals.length === 0) return null;
  const claimed = new Set(
    (deck.entries || []).map((e) => e.cardId).filter((id) => !String(id).startsWith(EXTERNAL_PREFIX))
  );
  if (deck.commanderId) claimed.add(deck.commanderId);
  if (deck.partnerId) claimed.add(deck.partnerId);

  // Two passes: the printing you actually asked for first, so a placeholder
  // that names one doesn't get answered by a different printing while its own
  // copy sits there unclaimed. Then anything of that name — if you own the
  // card, the plan is satisfied.
  const linked = {}; // externalId -> owned card id
  ["exact", "any"].forEach((mode) => {
    externals.forEach((ext) => {
      if (linked[ext.id]) return;
      const owned = cards.find((c) => !claimed.has(c.id) && matchesExternal(ext, c, mode));
      if (owned) {
        linked[ext.id] = owned.id;
        claimed.add(owned.id);
      }
    });
  });
  if (Object.keys(linked).length === 0) return null;

  // Merge rather than duplicate: if the deck somehow already holds that owned
  // card, fold the placeholder's copies into the existing entry.
  const entries = [];
  (deck.entries || []).forEach((e) => {
    const target = linked[e.cardId];
    if (!target) return entries.push(e);
    const existing = entries.find((x) => x.cardId === target);
    if (existing) existing.qty = (existing.qty || 1) + (e.qty || 1);
    else entries.push({ ...e, cardId: target });
  });

  return {
    ...deck,
    entries,
    external: externals.filter((x) => !linked[x.id]),
  };
}

// A deck reads as "built" once it holds at least one real card and none of
// its entries are still placeholders — see the module doc above for why a
// placeholder means "planned" rather than "owned". A deck with no entries
// yet is not built either; there's nothing to have finished buying.
export function isDeckBuilt(deck, cardById) {
  const entries = deck?.entries || [];
  if (entries.length === 0) return false;
  return entries.every((e) => {
    const card = cardById?.[e.cardId];
    return !!card && !card.notOwned;
  });
}
