// Verifies: the advanced search syntax. Pure parser + matcher, no DOM --
// t:, o:, c:, r:, set:, cmc/price/qty comparisons, is:, tag:, col:, deck:,
// format legality, negation, quoted phrases, exact names and `or`.
import { QUERY_HELP, matchQuery, parseQuery } from "./src/features/collection/query";
import { packLegalities } from "./src/lib/formats";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const bolt = {
  id: "b", name: "Lightning Bolt", set: "2xm", setName: "Double Masters",
  collectorNumber: "129", colors: ["R"], cmc: 1, rarity: "uncommon",
  typeLine: "Instant", artist: "Christopher Rush", quantity: 4, usd: 5,
  tags: ["Trade"], collectionId: "c1", finish: "nonfoil",
  legalities: packLegalities({ modern: "legal", commander: "legal", standard: "not_legal", vintage: "restricted" }),
};
const sol = {
  id: "s", name: "Sol Ring", set: "ltc", setName: "Tales of Middle-earth Commander",
  collectorNumber: "59", colors: [], cmc: 1, rarity: "uncommon",
  typeLine: "Artifact", quantity: 1, usd: 30, proxy: true, finish: "foil",
  legalities: packLegalities({ modern: "banned", commander: "legal" }),
};
const tree = {
  id: "t", name: "Treebeard, Gracious Host", set: "ltr", colors: ["G"], cmc: 5,
  rarity: "rare", typeLine: "Legendary Creature — Treefolk", quantity: 1, usd: 2,
  finish: "nonfoil",
};

const ORACLE = {
  b: { t: "Lightning Bolt deals 3 damage to any target.", ty: "Instant" },
};
const ctx = {
  textScope: true,
  oracleFor: (c) => ORACLE[c.id] || null,
  collectionOf: (c) => (c.collectionId === "c1" ? "The Vault" : "Uncategorized"),
  deckNames: (c) => (c.id === "s" ? ["Atraxa"] : []),
  isWanted: (c) => c.id === "t",
  unitValue: (c) => c.usd,
  legalityOf: (c, f) => {
    const map = { modern: "mod", commander: "cmd", standard: "std", vintage: "vin" };
    const packed = c.legalities || {};
    return { l: "legal", n: "not_legal", b: "banned", r: "restricted" }[packed[map[f]]] || "";
  },
};

const all = [bolt, sol, tree];
const run = (q) => all.filter((c) => matchQuery(c, parseQuery(q), ctx)).map((c) => c.id).join(",");

check("a plain word still searches names", run("bolt") === "b");
check("a plain word still searches rules text", run("3 damage") === "b");
check("t: matches the type line", run("t:creature") === "t");
check("o: matches rules text only", run("o:damage") === "b");
check("o: does not match the name", run("o:treebeard") === "");
check("c: matches a colour", run("c:r") === "b");
check("c:colorless finds colourless cards", run("c:colorless") === "s");
check("r: takes a prefix", run("r:rare") === "t");
check("set: matches the code", run("set:ltc") === "s");
check("set: matches part of the set name", run('set:"middle-earth"') === "s");
check("cmc<=1 compares mana value", run("cmc<=1") === "b,s");
check("cmc>=5 compares the other way", run("cmc>=5") === "t");
check("price> uses the app's own value", run("price>10") === "s");
check("qty>=4 counts copies", run("qty>=4") === "b");
check("is:foil reads the finish", run("is:foil") === "s");
check("is:proxy finds proxies", run("is:proxy") === "s");
check("is:wanted asks the wishlist", run("is:wanted") === "t");
check("is:commander finds legendary creatures", run("is:commander") === "t");
check("tag: matches your own tags, case-insensitively", run("tag:trade") === "b");
check("col: matches the collection name", run("col:vault") === "b");
check("deck: matches a deck the card is in", run("deck:atraxa") === "s");
check("f: means legal in that format", run("f:modern") === "b");
check("banned: finds the banlist", run("banned:modern") === "s");
check("restricted: is its own question", run("restricted:vintage") === "b");
check("unknown legality is not treated as legal", run("f:standard") === "");
check("terms combine with and", run("c:r cmc<=1") === "b");
check("a leading minus negates", run("cmc<=1 -is:proxy") === "b");
check("or takes either side", run("t:instant or t:artifact") === "b,s");
check("a quoted phrase stays whole", run('o:"3 damage to any"') === "b");
check("!name is an exact name match", run('!"sol ring"') === "s");
check("an unknown key falls back to a plain word", run("zzz:nothing") === "");
check("an empty query matches everything", run("") === "b,s,t");
check("name-only scope ignores rules text", (() => {
  const nameOnly = { ...ctx, textScope: false };
  return all.filter((c) => matchQuery(c, parseQuery("damage"), nameOnly)).length === 0;
})());
check("the parser knows when a query is advanced", parseQuery("t:goblin").advanced && !parseQuery("goblin").advanced);
check("every documented example parses to something", QUERY_HELP.every((h) => !parseQuery(h.q).empty));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
