/*
 * Who at this table has what the others are after.
 *
 * The thing a self-hosted tracker can do that no hosted site can: your
 * playgroup's collections are all on your server, behind their own PINs, and
 * each of them already publishes a wishlist. Matching is then just set
 * arithmetic over the pages they've each chosen to share — no accounts to
 * link, no trade "system" to join, nobody's private data leaving their vault.
 *
 * Cards are matched by name, deliberately. A trade is "do you have a Rhystic
 * Study" — nobody says "do you have the 2019 Mystery Booster printing" — so
 * the printing shows up as detail on the match rather than as a condition of
 * it.
 *
 * Pure: lists in, matches out.
 */

export function nameKey(name) {
  return String(name || "")
    .split("//")[0]
    .trim()
    .toLowerCase();
}

function index(list) {
  const m = {};
  (list || []).forEach((c) => {
    const k = nameKey(c.name);
    if (!k) return;
    (m[k] = m[k] || []).push(c);
  });
  return m;
}

/*
 * One person's side of the table.
 *
 * `theyWant` is their wishlist against what you hold — with the copies you've
 * actually flagged for trade first, because those are the ones you've already
 * decided you can live without. `youWant` is your wishlist against their
 * published trade list, which only exists if they've shared it.
 *
 * Proxies never count as a match: a proxy is a card you're still looking for,
 * not one you can hand over.
 */
export function matchWithProfile({ profile, myCards, myWishlist, theirWishlist, theirTrade }) {
  const mine = index((myCards || []).filter((c) => !c.sold && !c.proxy && !c.notOwned));
  const theirTradeIndex = index(theirTrade);

  const theyWant = [];
  (theirWishlist || []).forEach((w) => {
    const copies = mine[nameKey(w.name)];
    if (!copies || copies.length === 0) return;
    const tradeable = copies.filter((c) => c.forTrade);
    theyWant.push({
      name: w.name,
      want: w.quantity || 1,
      priority: w.priority || "normal",
      note: w.note || "",
      copies,
      // Something you've already said you'd part with, versus something you
      // merely own — a real distinction when someone's asking.
      onTradeList: tradeable.length > 0,
      have: copies.reduce((n, c) => n + (c.quantity || 1), 0),
      card: tradeable[0] || copies[0],
    });
  });

  const youWant = [];
  (myWishlist || []).forEach((w) => {
    const theirs = theirTradeIndex[nameKey(w.name)];
    if (!theirs || theirs.length === 0) return;
    youWant.push({
      name: w.name,
      want: w.quantity || 1,
      priority: w.priority || "normal",
      have: theirs.reduce((n, c) => n + (c.quantity || 1), 0),
      card: theirs[0],
      // What they wrote on their trade list about it, if anything.
      tradeNote: (theirs.find((c) => c.note) || {}).note || "",
    });
  });

  const byPriority = (a, b) => {
    const rank = { high: 0, normal: 1, low: 2 };
    return (
      (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) ||
      Number(b.onTradeList || false) - Number(a.onTradeList || false) ||
      a.name.localeCompare(b.name)
    );
  };
  theyWant.sort(byPriority);
  youWant.sort(byPriority);

  return {
    profile,
    theyWant,
    youWant,
    // A swap in both directions is the one worth opening a conversation about.
    twoWay: theyWant.length > 0 && youWant.length > 0,
    total: theyWant.length + youWant.length,
    sharesTrade: (theirTrade || []).length > 0,
  };
}

// Everyone, most matches first — a table's worth of answers in one list.
export function matchPlaygroup({ myCards, myWishlist, others }) {
  return (others || [])
    .map((o) =>
      matchWithProfile({
        profile: o.profile,
        myCards,
        myWishlist,
        theirWishlist: o.wishlist,
        theirTrade: o.trade,
      })
    )
    .sort((a, b) => Number(b.twoWay) - Number(a.twoWay) || b.total - a.total || a.profile.localeCompare(b.profile));
}
