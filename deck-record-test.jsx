// Verifies: the join between the Life Counter and the decks -- a finished game
// becomes a record, and the record reads back as wins, losses and matchups.
import { gameResult, makeLifePlayer } from "./src/features/life/lifeState";
import { MAX_GAMES, addGame, deckRecord, formatRecord, gamesForDeck, recordsByDeck } from "./src/features/decks/record";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

function seat(id, name, deck, { out = false, outAt = null, life = 40 } = {}) {
  return { ...makeLifePlayer(id, name, life), out, outAt, deckId: deck?.id || null, deckName: deck?.name || null };
}
const TREE = { id: "d1", name: "Treebeard EDH" };
const ATRAXA = { id: "d2", name: "Atraxa" };
const KRENKO = { id: "d3", name: "Krenko" };

// ---- a game becomes a result ----
const players = [
  seat(1, "Arin", TREE, { life: 12 }),
  seat(2, "Kevin", ATRAXA, { out: true, outAt: 200 }),
  seat(3, "Sam", KRENKO, { out: true, outAt: 100 }),
];
const g = gameResult(players, { format: "commander", startedAt: 50, at: 1000 });
check("the last one standing is the winner", g.winnerName === "Arin" && g.winnerDeckId === "d1");
check("the winner's seat is marked won", g.seats.find((s) => s.name === "Arin").won === true);
check("places come from elimination order", g.seats.map((s) => s.name).join() === "Arin,Kevin,Sam");
check("...so the last one knocked out came second", g.seats[1].name === "Kevin" && g.seats[1].place === 2);
check("the deck in each seat is carried", g.seats.every((s) => !!s.deckName));
check("life totals are kept", g.seats.find((s) => s.name === "Arin").life === 12);
check("the format is kept", g.format === "commander");
check("a game with no winner yet says so", (() => {
  const unfinished = gameResult([seat(1, "A", TREE), seat(2, "B", ATRAXA)], {});
  return unfinished.winnerName === null && unfinished.seats.every((s) => !s.won);
})());
check("a seat with no deck is still a seat", (() => {
  const mixed = gameResult([seat(1, "A", TREE), seat(2, "Guest", null, { out: true, outAt: 5 })], {});
  return mixed.seats.length === 2 && mixed.seats.some((s) => s.deckId === null);
})());

// ---- the record ----
const games = [
  g,
  // Atraxa wins one against Treebeard
  gameResult([seat(1, "Arin", TREE, { out: true, outAt: 300 }), seat(2, "Kevin", ATRAXA)], { at: 2000 }),
  // a game Treebeard wasn't in
  gameResult([seat(2, "Kevin", ATRAXA), seat(3, "Sam", KRENKO, { out: true, outAt: 10 })], { at: 3000 }),
];
const tree = deckRecord(games, "d1");
check("only games the deck was in count", gamesForDeck(games, "d1").length === 2 && tree.played === 2);
check("wins and losses are counted", tree.won === 1 && tree.lost === 1);
check("win rate is a fraction, not a percent", Math.abs(tree.winRate - 0.5) < 1e-9);
check("last played is the newest game", tree.lastPlayed === 2000);
check("opponents are listed", tree.opponents.map((o) => o.name).sort().join() === "Atraxa,Krenko");
check("head to head is right", (() => {
  const atr = tree.opponents.find((o) => o.name === "Atraxa");
  return atr.met === 2 && atr.beat === 1 && atr.lostTo === 1;
})());
check("a deck that never played has no rate, rather than 0%", (() => {
  const never = deckRecord(games, "d9");
  return never.played === 0 && never.winRate === null;
})());
check("an unnamed seat isn't a matchup", (() => {
  const withGuest = [gameResult([seat(1, "Arin", TREE), seat(2, "Guest", null, { out: true, outAt: 1 })], { at: 4000 })];
  return deckRecord(withGuest, "d1").opponents.length === 0;
})());

// ---- the list view's one-pass version ----
const all = recordsByDeck(games);
check("every deck gets a tally in one pass", all.d1.played === 2 && all.d1.won === 1 && all.d2.played === 3 && all.d2.won === 2);
check("the tally matches the full record", all.d1.won === tree.won && all.d1.played === tree.played);
check("a record reads as W–L and a percentage", formatRecord(all.d1) === "1–1 · 50%");
check("nothing played reads as nothing", formatRecord({ played: 0, won: 0 }) === null && formatRecord(undefined) === null);

// ---- storage ----
check("a new game goes on the front", addGame(games, gameResult([seat(1, "A", TREE)], { at: 9999 }))[0].at === 9999);
check("the log is capped", (() => {
  let list = [];
  for (let i = 0; i < MAX_GAMES + 25; i++) list = addGame(list, gameResult([seat(1, "A", TREE)], { at: i }));
  return list.length === MAX_GAMES;
})());
check("adding doesn't mutate what was there", (() => {
  const before = games.length;
  addGame(games, g);
  return games.length === before;
})());

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
