/*
 * The read-only guest view of a collection.
 *
 * Same discipline as public-wishlist.cjs, and for the same reason: this is
 * data leaving the vault without a PIN, so it is built from an explicit
 * allow-list rather than by deleting the fields we happen to remember are
 * private. A field added to a card next year stays private until someone
 * deliberately lists it here.
 *
 * What a guest may see: the cards, what they're worth today, the decks
 * built from them, and the names and order of the owner's collections.
 *
 * What a guest may never see: what anything cost, collection purchase totals,
 * gain or loss, value history, what was invested per collection, where a card physically lives, private notes
 * and tags, sold cards and what they sold for. Those aren't "what cards they
 * have" — they're the owner's books.
 *
 * Off unless the owner turned it on: `vault.publicVault === true`.
 */

const { cleanCardUrls } = require("./safe-url.cjs");

const CARD_FIELDS = [
  "name",
  "set",
  "setName",
  "collectorNumber",
  "scryfallId",
  "scryfallUri",
  "imageUrl",
  "imageUrlLarge",
  "imageUrlBack",
  "imageUrlBackLarge",
  "layout",
  "finish",
  "foil",
  "rarity",
  "colors",
  "cmc",
  "typeLine",
  "artist",
  "isArt",
  "signed",
  "proxy",
  "legalities",
  "usd",
  "usdFoil",
  "usdEtched",
  "eur",
  "eurFoil",
  "eurEtched",
  "collectionId",
];

// Deliberately absent, and each for a reason: costOverride / valueOverride
// (what you paid and what you say it's worth), location (where it physically is), note / wantNote, tags (your
// own words, often private), sold / soldPrice / soldDate (not yours any more,
// and the realized-gain half of the books), prevUsd / lastChecked / added.

// Which market the owner prices on. Older vaults only had "use Cardmarket
// while showing euros" (eurNative), so read that the way it was meant.
function priceSourceOf(v) {
  if (v.priceSource === "cardmarket" || v.priceSource === "tcgplayer") return v.priceSource;
  return v.currency === "EUR" && v.eurNative !== false ? "cardmarket" : "tcgplayer";
}

function publicCard(c, extra) {
  const out = { id: c.id };
  CARD_FIELDS.forEach((f) => {
    out[f] = c[f] === undefined ? null : c[f];
  });
  return { ...cleanCardUrls(out), quantity: c.quantity || 1, ...extra };
}

// Collections are shown to guests as a name and an order (and which one sits
// inside which) — never what was invested. Array order is the owner's order.
function publicCollections(v) {
  const ids = new Set((v.collections || []).map((c) => c.id));
  return (v.collections || []).map((c) => ({
    id: c.id,
    name: c.name || "Untitled",
    parentId: c.parentId && c.parentId !== c.id && ids.has(c.parentId) ? c.parentId : null,
  }));
}

function publicDeck(d, visibleIds) {
  return {
    id: d.id,
    name: d.name || "Untitled deck",
    format: d.format || "commander",
    colors: d.colors || null,
    commanderId: d.commanderId || null,
    partnerId: d.partnerId || null,
    // Entries pointing at a card the guest can't see (a sold card, say) would
    // render as a blank row, so they're dropped here rather than in the page.
    entries: (d.entries || [])
      .filter((e) => visibleIds.has(e.cardId) || String(e.cardId).startsWith("ext-"))
      .map((e) => ({ cardId: e.cardId, qty: e.qty || 1, role: e.role || "other" })),
    basics: d.basics || {},
    categories: (d.categories || []).map((c) => ({ key: c.key, label: c.label })),
    // Cards the deck plans but nobody owns yet. They're card-shaped, so they
    // go through the same allow-list.
    external: (d.external || []).map((x) => publicCard(x, { notOwned: true })),
  };
}

function publicVaultPayload(vault, profile) {
  const v = vault || {};
  if (v.publicVault !== true) return null;
  const cards = (v.cards || []).filter((c) => !c.sold);
  // "I'd trade this" is its own opt-in; without it the flag doesn't travel,
  // even to a guest who can see the card itself.
  const shareTrade = v.publicTrade === true;
  const visibleIds = new Set(cards.map((c) => c.id));
  return {
    profile,
    currency: v.currency || "USD",
    czkRate: v.czkRate ?? null,
    eurRate: v.eurRate ?? null,
    priceSource: priceSourceOf(v),
    tradeShared: shareTrade,
    // How many cards the public wishlist page (/w/<profile>, always open)
    // would show, so the collection can link to it. Just a count — the list
    // itself stays on its own page.
    wishlistCount:
      (v.wishlist || []).length + (v.cards || []).filter((c) => c.wanted && !c.sold).length,
    // The trade note is written for the trade list, so it travels only when
    // that list is shared, and only on cards actually on it.
    cards: cards.map((c) =>
      publicCard(c, shareTrade ? { forTrade: !!c.forTrade, tradeNote: c.forTrade ? c.tradeNote || "" : "" } : {})
    ),
    collections: publicCollections(v),
    decks: (v.decks || []).map((d) => publicDeck(d, visibleIds)),
  };
}

module.exports = { publicVaultPayload, PUBLIC_VAULT_CARD_FIELDS: CARD_FIELDS };
