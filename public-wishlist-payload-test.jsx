// The public wishlist is the only thing Binderwyrm serves without a PIN, so
// this pins down exactly what leaves the vault: the wishlist and the cards
// flagged for replacement, and nothing else — no collection, no cost basis, no
// locations, no decks, no sold history.
import { publicWishlistPayload } from "./public-wishlist.cjs";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const vault = {
  currency: "CZK",
  czkRate: 23,
  eurRate: 0.92,
  history: [{ t: 1, value: 999, cost: 888 }],
  decks: [{ id: "d1", name: "Secret Brew", entries: [{ cardId: "c1" }] }],
  collections: [{ id: "col1", name: "Box", purchasePrice: 4000 }],
  cards: [
    {
      id: "c1", name: "Sol Ring", set: "ltc", setName: "Commander Legends", collectorNumber: "59",
      scryfallId: "sid-sol", imageUrl: "http://x/sol.jpg", finish: "nonfoil", usd: 2, usdFoil: 6,
      quantity: 1, collectionId: "col1", location: "Binder 2, page 4", costOverride: 111,
      valueOverride: 222, condition: "NM", proxy: true, wanted: true, wantNote: "any printing",
    },
    { id: "c2", name: "Not Wanted", set: "afr", quantity: 1, collectionId: "col1", usd: 5, location: "Shoebox" },
    { id: "c3", name: "Sold And Wanted", set: "afr", quantity: 1, wanted: true, sold: true, soldPrice: 40 },
  ],
  wishlist: [
    { id: "w1", name: "Mana Crypt", set: "", usd: 80, quantity: 2, priority: "high", note: "birthday", added: 5 },
  ],
};

const out = publicWishlistPayload(vault, "michael");

check("profile name comes back", out.profile === "michael");
check("display currency carries over", out.currency === "CZK" && out.czkRate === 23);
check("wishlist entry is included", out.wishlist.length === 1 && out.wishlist[0].name === "Mana Crypt");
check("quantity, priority and note survive", out.wishlist[0].quantity === 2 && out.wishlist[0].priority === "high" && out.wishlist[0].note === "birthday");
check("owned card flagged wanted is included", out.replacing.length === 1 && out.replacing[0].name === "Sol Ring");
check("proxy status is shown on a replacement", out.replacing[0].proxy === true);
check("the replacement's note comes from wantNote", out.replacing[0].note === "any printing");
check("a card that isn't wanted stays private", JSON.stringify(out).includes("Not Wanted") === false);
check("a sold card never appears, even flagged", JSON.stringify(out).includes("Sold And Wanted") === false);

// The allow-list itself: everything private must be absent from the payload,
// however the vault grows later.
const blob = JSON.stringify(out);
[
  ["collection membership", "col1"],
  ["physical location", "Binder 2"],
  ["purchase price override", "111"],
  ["value override", "222"],
  ["deck names", "Secret Brew"],
  ["value history", "888"],
  ["collection totals", "4000"],
  ["condition", "NM"],
].forEach(([label, needle]) => check(`${label} is not in the public payload`, !blob.includes(needle)));

// A brand new field on a card must not ride along by accident.
const withSecret = publicWishlistPayload(
  { cards: [{ id: "x", name: "Future Card", wanted: true, secretNewField: "leak-me" }] },
  "michael"
);
check("an unknown card field is not copied through", !JSON.stringify(withSecret).includes("leak-me"));

// An empty or unreadable vault answers with an empty list rather than failing.
const empty = publicWishlistPayload(null, "michael");
check("a profile with no data yields an empty list", empty.wishlist.length === 0 && empty.replacing.length === 0);

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
