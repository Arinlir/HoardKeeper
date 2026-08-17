// Export the collection to CSV, read it back, and confirm each row still names
// one exact printing.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { innerHeight: 900, location: { search: "", pathname: "/" }, history: { replaceState(){} } };
globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
import Papa from "papaparse";
import { __test_guessMapping as guessMapping } from "./src/App.jsx";

// the columns exportCsv writes
const rows = [
  { Name: "Mountain", Set: "TMT", "Collector Number": "318", "Set Name": "Tales of Middle-earth", "Scryfall ID": "aaa-111", Rarity: "common", Quantity: 3, Finish: "nonfoil", Condition: "NM", Collection: "Elven court", Location: "Binder 2" },
  { Name: "Mountain", Set: "HOB", "Collector Number": "0312", "Set Name": "The Hobbit", "Scryfall ID": "bbb-222", Rarity: "common", Quantity: 1, Finish: "foil", Condition: "LP", Collection: "Hobbit", Location: "" },
  { Name: "Galadriel, Elven-Queen", Set: "LTC", "Collector Number": "3", "Set Name": "LotR Commander", "Scryfall ID": "ccc-333", Rarity: "mythic", Quantity: 1, Finish: "etched", Condition: "NM", Collection: "Elven court", Location: "" },
];
const csv = Papa.unparse(rows);
console.log("--- exported CSV header ---");
console.log(csv.split("\n")[0]);

const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
const mapping = guessMapping(parsed.meta.fields);
console.log("\n--- auto-detected mapping ---");
["name", "set", "collectorNumber", "scryfallId", "quantity", "foil", "condition", "collection", "location"].forEach((f) =>
  console.log(`  ${f.padEnd(16)} -> ${mapping[f] || "(unmapped)"}`)
);

const val = (row, field) => (mapping[field] ? String(row[mapping[field]] ?? "").trim() : "");
console.log("\n--- identity per row ---");
let allIdentified = true;
parsed.data.forEach((row) => {
  const sid = val(row, "scryfallId");
  const set = val(row, "set").toLowerCase();
  const cn = val(row, "collectorNumber");
  const identifier = sid ? { id: sid } : set && cn ? { set, collector_number: cn } : { name: val(row, "name") };
  const exact = !!(sid || (set && cn));
  if (!exact) allIdentified = false;
  const finishRaw = val(row, "foil").toLowerCase();
  const finish = /etch/.test(finishRaw) ? "etched" : /^(foil|yes|true|1|y)$/.test(finishRaw) ? "foil" : "nonfoil";
  console.log(`  ${val(row, "name").padEnd(24)} ${JSON.stringify(identifier)}  finish=${finish}`);
});
console.log("\nevery row names an exact printing:", allIdentified);

// the two Mountains must be distinguishable
const ids = parsed.data.map((r) => val(r, "scryfallId"));
console.log("two Mountains distinguishable:", ids[0] !== ids[1]);
if (!allIdentified || ids[0] === ids[1]) process.exit(1);
console.log("ALL PASS");
process.exit(0);
