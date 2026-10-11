/*
 * The shape of the one payload Binderwyrm hands out without a PIN.
 *
 * Kept in its own module, and built from an explicit allow-list, because this
 * is the only place collection data could ever leak: everything else in the
 * vault (what you paid, what it's worth, where it's stored, what's in which
 * deck) is behind the PIN, and a field added to a card later must stay private
 * until someone deliberately lists it here.
 */

const { cleanCardUrls } = require("./safe-url.cjs");

const FIELDS = [
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
  "finish",
  "rarity",
  "colors",
  "typeLine",
  "usd",
  "usdFoil",
  "usdEtched",
  // Cardmarket's own euro prices, for an owner who prices on Cardmarket.
  "eur",
  "eurFoil",
  "eurEtched",
];

// Which market the owner prices on. Older vaults only had "use Cardmarket
// while showing euros" (eurNative), so read that the way it was meant.
function priceSourceOf(v) {
  if (v.priceSource === "cardmarket" || v.priceSource === "tcgplayer") return v.priceSource;
  return v.currency === "EUR" && v.eurNative !== false ? "cardmarket" : "tcgplayer";
}

function publicCard(c, extra) {
  const out = { id: c.id };
  FIELDS.forEach((f) => {
    out[f] = c[f] === undefined ? null : c[f];
  });
  return { ...cleanCardUrls(out), ...extra };
}

// vault is the parsed contents of a profile's stored blob; profile is its name.
function publicWishlistPayload(vault, profile) {
  const v = vault || {};
  return {
    profile,
    // Whether this profile also shares a read-only view of the collection, so
    // the wishlist page can offer the door. It says nothing the /v/ address
    // wouldn't say on its own.
    vaultOpen: v.publicVault === true,
    currency: v.currency || "USD",
    czkRate: v.czkRate ?? null,
    eurRate: v.eurRate ?? null,
    priceSource: priceSourceOf(v),
    // Cards wanted but not owned.
    wishlist: (v.wishlist || []).map((e) =>
      publicCard(e, {
        quantity: e.quantity || 1,
        priority: e.priority || "normal",
        note: e.note || "",
        added: e.added || null,
      })
    ),
    // Cards you're happy to trade away. Its own opt-in, separate from the
    // read-only collection view: a trade binder is something you publish on
    // purpose, and someone may want to publish it without publishing anything
    // else about what they own.
    trade:
      v.publicTrade === true
        ? (v.cards || [])
            .filter((c) => c.forTrade && !c.sold)
            // The trade note is written for exactly this list, so it travels
            // with it (unlike the card's private notes).
            .map((c) => publicCard(c, { quantity: c.quantity || 1, proxy: !!c.proxy, note: c.tradeNote || "" }))
        : [],
    // Cards already owned that you'd rather replace — proxies, mostly. Sold
    // cards never appear: they're not yours any more.
    replacing: (v.cards || [])
      .filter((c) => c.wanted && !c.sold)
      .map((c) =>
        publicCard(c, {
          quantity: c.quantity || 1,
          priority: c.wantPriority || "normal",
          note: c.wantNote || "",
          proxy: !!c.proxy,
        })
      ),
  };
}

module.exports = { publicWishlistPayload, PUBLIC_CARD_FIELDS: FIELDS };
