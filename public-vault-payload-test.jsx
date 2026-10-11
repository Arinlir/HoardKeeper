// The guest view is the second thing Binderwyrm serves without a PIN, and by
// far the larger one, so this pins down exactly what leaves the vault: cards,
// today's prices, decks — and nothing about the owner's books.
import { PUBLIC_VAULT_CARD_FIELDS, publicVaultPayload } from "./public-vault.cjs";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const vault = {
  publicVault: true,
  currency: "CZK",
  czkRate: 23,
  eurRate: 0.92,
  eurNative: true,
  // none of these may appear anywhere in the payload
  history: [{ t: 1, value: 999, cost: 888 }],
  collections: [{ id: "col1", name: "Winter box", purchasePrice: 4000 }],
  cards: [
    {
      id: "c1", name: "Sol Ring", set: "ltc", setName: "LOTR Commander", collectorNumber: "59",
      scryfallId: "sid-sol", imageUrl: "http://x/sol.jpg", finish: "nonfoil", usd: 2, usdFoil: 6,
      eur: 1.5, quantity: 3, rarity: "uncommon", typeLine: "Artifact", colors: [], cmc: 1,
      legalities: { cmd: "l" },
      // private:
      collectionId: "col1", location: "Binder 2, page 4", costOverride: 111, valueOverride: 222,
      condition: "NM", note: "gift from dad", tags: ["binder-b", "sentimental"], wantNote: "foil please",
      prevUsd: 1.2, lastChecked: 123, added: 456,
    },
    { id: "c2", name: "Black Lotus", set: "lea", quantity: 1, usd: 30000, typeLine: "Artifact", collectionId: "col1" },
    { id: "c3", name: "Sold Away", set: "afr", quantity: 1, usd: 50, sold: true, soldPrice: 80, soldDate: "2026-01-01" },
    { id: "c4", name: "Fake Bolt", set: "2xm", quantity: 1, usd: 5, proxy: true, typeLine: "Instant" },
  ],
  decks: [
    {
      id: "d1", name: "Treebeard EDH", format: "commander", commanderId: "c1",
      entries: [
        { cardId: "c2", qty: 1, role: "ramp" },
        { cardId: "c3", qty: 1, role: "other" },   // sold — must not survive
        { cardId: "ext-9", qty: 1, role: "other" }, // a card to buy — must survive
      ],
      basics: { Forest: 20 },
      categories: [{ key: "cat-combo", label: "Combo pieces" }],
      external: [{ id: "ext-9", name: "Mana Crypt", set: "2xm", usd: 200, typeLine: "Artifact", costOverride: 999, location: "nowhere" }],
    },
  ],
};

const p = publicVaultPayload(vault, "arin");
const blob = JSON.stringify(p);

check("a vault that opted in is served", !!p && p.profile === "arin");
check("the display currency comes along", p.currency === "CZK" && p.czkRate === 23);
// A vault from before the market was its own setting: Cardmarket only ever
// applied while showing euros, so a koruna vault meant TCGplayer.
check("an old vault's market is read the way it was meant", p.priceSource === "tcgplayer");
check("an old euro vault meant Cardmarket", publicVaultPayload({ ...vault, currency: "EUR" }, "arin").priceSource === "cardmarket");
check("the chosen market comes along", publicVaultPayload({ ...vault, priceSource: "cardmarket" }, "arin").priceSource === "cardmarket");
check("the wishlist is counted so the page can link to it", publicVaultPayload({ ...vault, wishlist: [{ name: "A" }, { name: "B" }] }, "arin").wishlistCount === 2);
check("cards wanted as real copies count too, sold ones don't", publicVaultPayload({ ...vault, wishlist: [], cards: [{ id: "x", name: "X", wanted: true }, { id: "y", name: "Y", wanted: true, sold: true }] }, "arin").wishlistCount === 1);

// ---- opt-in ----
check("a vault that never opted in is not served", publicVaultPayload({ ...vault, publicVault: undefined }, "arin") === null);
check("opting out again turns it off", publicVaultPayload({ ...vault, publicVault: false }, "arin") === null);
check("a truthy-but-not-true flag is not enough", publicVaultPayload({ ...vault, publicVault: "yes" }, "arin") === null);
check("an empty vault is not served", publicVaultPayload(null, "arin") === null);

// ---- what's in ----
const sol = p.cards.find((c) => c.id === "c1");
check("cards are there", p.cards.length === 3);
check("with their printing identity", sol.set === "ltc" && sol.collectorNumber === "59" && sol.scryfallId === "sid-sol");
check("with today's prices", sol.usd === 2 && sol.usdFoil === 6 && sol.eur === 1.5);
check("with quantity", sol.quantity === 3);
check("with legality, so a guest can see what's deck-legal", sol.legalities.cmd === "l");
check("proxies come through flagged", p.cards.find((c) => c.id === "c4").proxy === true);
check("decks are there", p.decks.length === 1 && p.decks[0].name === "Treebeard EDH");
check("with the commander and the basics", p.decks[0].commanderId === "c1" && p.decks[0].basics.Forest === 20);
check("and the deck's own categories", p.decks[0].categories[0].label === "Combo pieces");
check("cards the deck plans but nobody owns come too", p.decks[0].external[0].name === "Mana Crypt");

// ---- what's out ----
check("sold cards are gone", !p.cards.some((c) => c.id === "c3"));
check("a deck entry pointing at a sold card is dropped", !p.decks[0].entries.some((e) => e.cardId === "c3"));
check("a deck entry for a card to buy survives", p.decks[0].entries.some((e) => e.cardId === "ext-9"));
check("what it cost is not there", sol.costOverride === undefined && !blob.includes("111"));
check("what the owner says it's worth is not there", sol.valueOverride === undefined && !blob.includes("222"));
check("where it's kept is not there", sol.location === undefined && !blob.includes("Binder 2"));
check("private notes are not there", !blob.includes("gift from dad") && !blob.includes("foil please"));
check("tags are not there", !blob.includes("sentimental") && !blob.includes("binder-b"));
check("which collection a card is in is there, by id only", sol.collectionId === "col1");
check("collections travel as name + order, without what was invested", p.collections?.length === 1 && p.collections[0].name === "Winter box" && !blob.includes("4000") && !blob.includes("purchasePrice"));
check("value history is not there", p.history === undefined && !blob.includes("888"));
check("sale prices are not there", !blob.includes("soldPrice") && !blob.includes("Sold Away"));
check("a placeholder's private fields are stripped too", !blob.includes("999") && !blob.includes("nowhere"));

// ---- the allow-list is the mechanism ----
check("every card key is either id, quantity, or on the list", (() => {
  const allowed = new Set([...PUBLIC_VAULT_CARD_FIELDS, "id", "quantity", "notOwned"]);
  return p.cards.every((c) => Object.keys(c).every((k) => allowed.has(k)));
})());
check("a field invented tomorrow does not leak", (() => {
  const withNew = publicVaultPayload(
    { publicVault: true, cards: [{ id: "x", name: "New", secretInsuranceValue: 12345 }] },
    "arin"
  );
  return !JSON.stringify(withNew).includes("12345");
})());
check("a deck key invented tomorrow does not leak", (() => {
  const withNew = publicVaultPayload(
    { publicVault: true, cards: [], decks: [{ id: "d", name: "D", entries: [], privateNote: "shhh" }] },
    "arin"
  );
  return !JSON.stringify(withNew).includes("shhh");
})());

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
