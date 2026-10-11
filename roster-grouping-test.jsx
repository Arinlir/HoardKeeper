// Tests groupRosterByName directly -- the fix for the exact bug reported:
// a card with multiple printings in a set (e.g. Capitoline Triad with 3
// versions) should count as "owned" if ANY printing is owned, not just the
// one specific roster row that happens to match exactly.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { innerHeight: 900, location: { search: "", pathname: "/" }, history: { replaceState(){} } };
globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
import { __test_groupRosterByName as groupRosterByName } from "./src/App.jsx";

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

// three printings of the same card, exactly the reported scenario
const triadNormal = { name: "Capitoline Triad", set: "acr", collectorNumber: "12", scryfallId: "triad-normal", rarity: "rare" };
const triadShowcase = { name: "Capitoline Triad", set: "acr", collectorNumber: "245", scryfallId: "triad-showcase", rarity: "rare" };
const triadBorderless = { name: "Capitoline Triad", set: "acr", collectorNumber: "301", scryfallId: "triad-borderless", rarity: "rare" };
const murder = { name: "Murder", set: "acr", collectorNumber: "92", scryfallId: "murder-1", rarity: "uncommon" };

const roster = [triadNormal, triadShowcase, triadBorderless, murder];

// own only the showcase version, and nothing of Murder
const ownedMap = { "triad-showcase": 1 };
function ownedCount(entry) {
  return ownedMap[entry.scryfallId] || 0;
}

const groups = groupRosterByName(roster, ownedCount);

check("groups by name, not by printing (4 rows -> 2 groups)", groups.length === 2);

const triadGroup = groups.find((g) => g.name === "Capitoline Triad");
check("Capitoline Triad group found", !!triadGroup);
check("owning ONE of three printings marks the group as owned", triadGroup.isOwned === true);
check("all three printings are kept, not lost", triadGroup.printings.length === 3);
check("displays the printing you ACTUALLY own (showcase), not the first one", triadGroup.display.scryfallId === "triad-showcase");
check("total owned quantity is correct even with only one printing held", triadGroup.totalOwned === 1);

const murderGroup = groups.find((g) => g.name === "Murder");
check("Murder (single printing, unowned) correctly shows as not owned", murderGroup.isOwned === false);
check("unowned group still displays its only known printing for art/info", murderGroup.display.scryfallId === "murder-1");

// owning MULTIPLE printings of the same name sums correctly
const ownedMap2 = { "triad-normal": 2, "triad-borderless": 1 };
function ownedCount2(entry) {
  return ownedMap2[entry.scryfallId] || 0;
}
const groups2 = groupRosterByName(roster, ownedCount2);
const triadGroup2 = groups2.find((g) => g.name === "Capitoline Triad");
check("owning multiple printings sums total quantity correctly (2 + 1 = 3)", triadGroup2.totalOwned === 3);
check("picks one of the owned printings to display (first match: normal)", triadGroup2.display.scryfallId === "triad-normal");

// completion count: only 2 unique names in this roster, 1 owned -> should reflect that, not "1 of 4 printing rows"
const ownedCountOnly = groups.filter((g) => g.isOwned).length;
check("unique-name-based completion count is 1 of 2 (not 1 of 4 printing rows)", ownedCountOnly === 1 && groups.length === 2);

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
