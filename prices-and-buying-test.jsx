// Verifies: real Cardmarket euro prices (kept from Scryfall, preferred over a
// converted dollar figure when Cardmarket is the chosen market) and the buy links.
import { CUR, fmt } from "./src/lib/format";
import { buyLinks } from "./src/lib/buyLinks";
import { eurForFinish, normalizeCard, priceForFinish, usdForFinish } from "./src/lib/scryfall";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const raw = {
  id: "abc", name: "Sol Ring", set: "ltc", set_name: "LOTR Commander",
  collector_number: "59", type_line: "Artifact", cmc: 1, rarity: "uncommon",
  color_identity: [], layout: "normal", finishes: ["nonfoil", "foil"],
  prices: { usd: "10.00", usd_foil: "25.00", eur: "7.00", eur_foil: "18.00" },
  legalities: { commander: "legal", modern: "banned" },
  image_uris: { normal: "n.png", large: "l.png" },
};
const card = normalizeCard(raw);

check("euro prices are kept", card.eur === 7 && card.eurFoil === 18);
check("dollar prices are kept", card.usd === 10 && card.usdFoil === 25);
check("legalities are kept, packed", !!card.legalities && card.legalities.cmd === "l" && card.legalities.mod === "b");

const copy = { ...card, finish: "nonfoil", quantity: 1 };
const foilCopy = { ...card, finish: "foil", quantity: 1 };
check("usdForFinish follows the finish", usdForFinish(copy) === 10 && usdForFinish(foilCopy) === 25);
check("eurForFinish follows the finish", eurForFinish(copy) === 7 && eurForFinish(foilCopy) === 18);

// TCGplayer, in dollars: dollars are dollars.
CUR.code = "USD";
CUR.eurRate = 0.9;
CUR.czkRate = 22.5;
CUR.source = "tcgplayer";
check("dollars are dollars", priceForFinish(copy) === 10);

// Cardmarket, in euros: the value is carried in dollars but lands on
// Cardmarket's price once fmt() applies the rate -- that's the whole trick.
CUR.code = "EUR";
CUR.source = "cardmarket";
check("the euro price survives the round trip", Math.abs(priceForFinish(copy) * CUR.eurRate - 7) < 1e-9);
check("and it's not just the converted dollar price", Math.abs(priceForFinish(copy) - 10) > 1);
check("fmt shows Cardmarket's number", fmt(priceForFinish(copy)).includes("7"));
check("the foil euro price is used for foils", Math.abs(priceForFinish(foilCopy) * CUR.eurRate - 18) < 1e-9);

CUR.source = "tcgplayer";
check("TCGplayer shown in euros is the converted dollar price", priceForFinish(copy) === 10);

CUR.source = "cardmarket";
check("a card with no euro price falls back to dollars", priceForFinish({ ...copy, eur: null, eurFoil: null }) === 10);
check("a card added before euros were stored still prices", priceForFinish({ usd: 3, quantity: 1 }) === 3);

// The market no longer depends on the display currency: koruna can be
// Cardmarket too, at the EUR/CZK cross.
CUR.code = "CZK";
check("koruna on Cardmarket is euros at the cross rate", Math.abs(priceForFinish(copy) * CUR.czkRate - 7 / 0.9 * 22.5) < 1e-9);
CUR.source = "tcgplayer";
check("koruna on TCGplayer is converted dollars", priceForFinish(copy) === 10);
CUR.code = "USD";

const links = buyLinks(card);
check("three shops, always in the same order", links.map((l) => l.key).join(",") === "cardmarket,tcgplayer,scryfall");
check("the card's name is searched, encoded", links[0].url.includes("Sol%20Ring") || links[0].url.includes("Sol+Ring"));
check("tcgplayer gets the magic product line", links[1].url.includes("productLineName=magic"));
check("scryfall uses the card's own page when we have it", buyLinks({ name: "X", scryfallUri: "https://scryfall.com/card/x" })[2].url === "https://scryfall.com/card/x");
check("only the front face is searched", buyLinks({ name: "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki" })[0].url.includes("Fable"));
check("a nameless card offers nothing", buyLinks({}).length === 0);

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
