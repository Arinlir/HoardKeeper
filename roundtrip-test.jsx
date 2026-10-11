// Export a deck, re-import it, and check nothing is lost.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { innerHeight: 900, location: { search: "", pathname: "/" }, history: { replaceState(){} } };
globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
import {
  __test_parseDecklist as parseDecklist,
  __test_matchDecklist as matchDecklist,
  __test_deckToText as deckToText,
  __test_deckToJson as deckToJson,
  __test_jsonToParsed as jsonToParsed,
} from "./src/App.jsx";

const cards = [
  { id: "g1", name: "Galadriel, Elven-Queen", set: "ltc", collectorNumber: "3", quantity: 1 },
  { id: "s1", name: "Sol Ring", set: "ltc", collectorNumber: "59", quantity: 2 },
  { id: "b1", name: "Lightning Bolt", set: "2x2", collectorNumber: "117", quantity: 4 },
];
const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));
const commander = cards[0];
const deck = {
  name: "Galadriel deck",
  format: "commander",
  entries: [
    { cardId: "s1", qty: 1, role: "ramp" },
    { cardId: "b1", qty: 1, role: "removal" },
  ],
  basics: { Forest: 12, Island: 8 },
  tokenCounts: { tok1: 5 },
  extraTokens: [{ id: "tok1", name: "Treasure", ty: "Token Artifact — Treasure" }],
};
const tokens = [{ id: "tok1", name: "Treasure", ty: "Token Artifact — Treasure" }];
const tokenQty = (id) => deck.tokenCounts[id] ?? 1;

console.log("--- text export ---");
const txt = deckToText(deck, cardById, commander, tokens, tokenQty);
console.log(txt);

console.log("\n--- text re-import ---");
let r = matchDecklist(parseDecklist(txt), cards, {});
console.log("commander:", r.commanderId, "| entries:", r.entries.map((e) => e.cardId + "×" + e.qty).join(", "));
console.log("basics:", JSON.stringify(r.basics), "| missing:", r.missing.length);

console.log("\n--- json round trip ---");
const json = deckToJson(deck, cardById, commander);
const parsedJson = jsonToParsed(json);
r = matchDecklist(parsedJson, cards, {});
console.log("name:", parsedJson.meta.name, "| format:", parsedJson.meta.format);
console.log("commander:", r.commanderId, "| entries:", r.entries.map((e) => e.cardId + "×" + e.qty).join(", "));
console.log("basics:", JSON.stringify(r.basics));
console.log("tokenCounts preserved:", JSON.stringify(parsedJson.meta.tokenCounts));
console.log("extraTokens preserved:", parsedJson.meta.extraTokens.length === 1);

console.log("\n--- respects cards committed elsewhere ---");
r = matchDecklist(parseDecklist("2 Sol Ring"), cards, { s1: 2 });
console.log("both copies in use ->", r.missing.length ? "reported missing" : "WRONGLY CLAIMED");

const ok =
  r.missing.length === 1 &&
  parsedJson.meta.name === "Galadriel deck";
console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
