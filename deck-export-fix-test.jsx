// Verifies the export fix: every tracked card and every basic land carries
// its type in the JSON export, which was entirely missing before -- lands
// especially, since basics had zero identifying data at all (just a count).
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { innerHeight: 900, location: { search: "", pathname: "/" }, history: { replaceState(){} } };
globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
import { __test_deckToJson as deckToJson, __test_deckToText as deckToText } from "./src/App.jsx";

const cardById = {
  s1: { id: "s1", name: "Sol Ring", set: "ltc", collectorNumber: "59", typeLine: "Artifact", usd: 2 },
  h1: { id: "h1", name: "Hinterland Harbor", set: "ltc", collectorNumber: "317", typeLine: "Land", usd: 3 },
};
const commander = { name: "Galadriel, Elven-Queen", set: "ltc", collectorNumber: "3", typeLine: "Legendary Creature — Elf Noble" };
const deck = {
  name: "Test deck",
  entries: [
    { cardId: "s1", qty: 1, role: "ramp" },
    { cardId: "h1", qty: 1, role: "land" },
  ],
  basics: { Forest: 12, Island: 8 },
};

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

const json = JSON.parse(deckToJson(deck, cardById, commander));

check("tracked card (Sol Ring) carries its type in the export", json.cards.find((c) => c.name === "Sol Ring")?.typeLine === "Artifact");
check("tracked LAND (Hinterland Harbor) carries its type", json.cards.find((c) => c.name === "Hinterland Harbor")?.typeLine === "Land");
check("commander carries its type", json.commander.typeLine === "Legendary Creature — Elf Noble");

check("basics still present as the legacy map (backward compat)", json.basics.Forest === 12 && json.basics.Island === 8);
check("basicsDetail exists with a real type for Forest", json.basicsDetail.find((b) => b.name === "Forest")?.typeLine === "Basic Land — Forest");
check("basicsDetail exists with a real type for Island", json.basicsDetail.find((b) => b.name === "Island")?.typeLine === "Basic Land — Island");
check("basicsDetail carries the right quantities too", json.basicsDetail.find((b) => b.name === "Forest")?.qty === 12);

// text export: printings for tracked cards (including the land) still work
const txt = deckToText(deck, cardById, commander, [], () => 0);
check("text export: tracked land keeps its set/number", txt.includes("Hinterland Harbor (LTC) 317"));
check("text export: basics still list correctly", txt.includes("12 Forest") && txt.includes("8 Island"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
