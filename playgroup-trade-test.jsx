// Verifies: the trade binder end to end as data -- the matching itself, and
// the two payloads' opt-in behaviour (a trade list is shared on purpose, or
// not at all).
import { matchPlaygroup, matchWithProfile, nameKey } from "./src/features/playgroup/matching";
import { publicWishlistPayload } from "./public-wishlist.cjs";
import { publicVaultPayload } from "./public-vault.cjs";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const myCards = [
  { id: "c1", name: "Rhystic Study", set: "prp", quantity: 2, usd: 30, forTrade: true },
  { id: "c2", name: "Sol Ring", set: "ltc", quantity: 1, usd: 2 },
  { id: "c3", name: "Mana Crypt", set: "2xm", quantity: 1, usd: 200, proxy: true },
  { id: "c4", name: "Sold Bolt", set: "2xm", quantity: 1, usd: 5, sold: true, forTrade: true },
  { id: "c5", name: "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki", set: "neo", quantity: 1, usd: 20, forTrade: true },
];
const myWishlist = [
  { id: "w1", name: "Cyclonic Rift", quantity: 1, priority: "high" },
  { id: "w2", name: "Smothering Tithe", quantity: 1, priority: "low" },
];

const kevin = {
  profile: "kevin",
  wishlist: [
    { id: "k1", name: "Rhystic Study", quantity: 1, priority: "high", note: "any printing" },
    { id: "k2", name: "Sol Ring", quantity: 2, priority: "normal" },
    { id: "k3", name: "Mana Crypt", quantity: 1, priority: "normal" },
    { id: "k4", name: "Sold Bolt", quantity: 1, priority: "normal" },
    { id: "k5", name: "Fable of the Mirror-Breaker", quantity: 1, priority: "normal" },
    { id: "k6", name: "Timetwister", quantity: 1, priority: "high" },
  ],
  trade: [{ id: "t1", name: "Cyclonic Rift", set: "mm3", quantity: 1, usd: 25 }],
};
const sam = { profile: "sam", wishlist: [{ id: "s1", name: "Timetwister", quantity: 1 }], trade: [] };

const m = matchWithProfile({ profile: "kevin", myCards, myWishlist, theirWishlist: kevin.wishlist, theirTrade: kevin.trade });
const wanted = m.theyWant.map((r) => r.name);

check("something they want that you own is a match", wanted.includes("Rhystic Study"));
check("owning it is enough — it needn't be on your trade list", wanted.includes("Sol Ring"));
check("a copy you've marked for trade says so", m.theyWant.find((r) => r.name === "Rhystic Study").onTradeList === true);
check("...and one you merely own doesn't", m.theyWant.find((r) => r.name === "Sol Ring").onTradeList === false);
check("a proxy is never a match — it's a card you're still after", !wanted.includes("Mana Crypt"));
check("a sold card is not yours to trade", !wanted.includes("Sold Bolt"));
check("a card they don't have and you don't own isn't invented", !wanted.includes("Timetwister"));
check("a double-faced card matches on its front name", wanted.some((n) => n.startsWith("Fable")));
check("quantities come through", m.theyWant.find((r) => r.name === "Sol Ring").want === 2);
check("their top-of-list card sorts first", m.theyWant[0].name === "Rhystic Study");
check("how many you hold is counted", m.theyWant.find((r) => r.name === "Rhystic Study").have === 2);

check("their trade list against your wishlist is the other direction", m.youWant.map((r) => r.name).join() === "Cyclonic Rift");
check("a swap in both directions is flagged", m.twoWay === true);
check("and it knows they share a trade list", m.sharesTrade === true);

const noTrade = matchWithProfile({ profile: "sam", myCards, myWishlist, theirWishlist: sam.wishlist, theirTrade: sam.trade });
check("someone who shares no trade list still matches one way", noTrade.theyWant.length === 0 && noTrade.youWant.length === 0);
check("...and isn't called a swap", noTrade.twoWay === false && noTrade.sharesTrade === false);

const all = matchPlaygroup({ myCards, myWishlist, others: [sam, kevin] });
check("everyone is matched", all.length === 2);
check("the two-way swap sorts to the front", all[0].profile === "kevin");
check("names are matched case- and punctuation-insensitively", nameKey(" Sol Ring ") === nameKey("sol ring"));
check("nothing crashes on empty input", matchPlaygroup({}).length === 0 && matchWithProfile({ profile: "x" }).total === 0);

// ---- the payloads only share a trade list when told to ----
const vault = {
  publicVault: true,
  publicTrade: true,
  cards: myCards,
  wishlist: myWishlist,
  decks: [],
};
const shared = publicWishlistPayload(vault, "arin");
check("the trade list rides on the wishlist page when shared", shared.trade.length === 2);
check("sold cards never reach it", !JSON.stringify(shared.trade).includes("Sold Bolt"));
check("without the switch, nothing is shared", publicWishlistPayload({ ...vault, publicTrade: false }, "arin").trade.length === 0);
check("a vault with no flag at all shares nothing", publicWishlistPayload({ cards: myCards }, "arin").trade.length === 0);
check("the wishlist itself is unaffected either way", publicWishlistPayload({ ...vault, publicTrade: false }, "arin").wishlist.length === 2);

const vaultPayload = publicVaultPayload(vault, "arin");
check("the guest view marks which cards are up for trade", vaultPayload.cards.find((c) => c.name === "Rhystic Study").forTrade === true);
check("and says the list is shared", vaultPayload.tradeShared === true);
check("with the switch off, the flag doesn't travel at all", (() => {
  const closed = publicVaultPayload({ ...vault, publicTrade: false }, "arin");
  return closed.tradeShared === false && closed.cards.every((c) => c.forTrade === undefined);
})());

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
