// Verifies: the opening-hand simulator and the mana base check. Both pure --
// randomness is injected, so the same rng gives the same hand every run.
import {
  bottomCards, buildLibrary, drawCard, handStats, isLandCard, newHand, shuffle,
} from "./src/features/decks/goldfish";
import {
  analyseManabase, parsePips, producedColors, sourcesNeeded,
} from "./src/features/decks/manabase";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// A deterministic "shuffle": rng always returns 0, so Fisher-Yates reverses in
// a fixed way. What matters is that it's the same every time.
const fixedRng = () => 0;

const cardById = {
  bolt: { id: "bolt", name: "Lightning Bolt", typeLine: "Instant", cmc: 1, manaCost: "{R}" },
  chord: { id: "chord", name: "Chord of Calling", typeLine: "Instant", cmc: 6, manaCost: "{X}{G}{G}{G}" },
  sol: { id: "sol", name: "Sol Ring", typeLine: "Artifact", cmc: 1, manaCost: "{1}", oracleText: "{T}: Add {C}{C}." },
  temple: { id: "temple", name: "Stomping Ground", typeLine: "Land — Mountain Forest", cmc: 0, manaCost: "" },
  bog: { id: "bog", name: "Bojuka Bog", typeLine: "Land", cmc: 0, manaCost: "", oracleText: "Bojuka Bog enters tapped.\n{T}: Add {B}." },
  birds: { id: "birds", name: "Birds of Paradise", typeLine: "Creature — Bird", cmc: 1, manaCost: "{G}", oracleText: "{T}: Add one mana of any color." },
};
const deck = {
  id: "d", name: "Test", format: "commander",
  entries: [
    { cardId: "bolt", qty: 2, role: "removal" },
    { cardId: "chord", qty: 1, role: "other" },
    { cardId: "sol", qty: 1, role: "ramp" },
    { cardId: "temple", qty: 3, role: "land" },
    { cardId: "bog", qty: 1, role: "land" },
    { cardId: "birds", qty: 1, role: "ramp" },
  ],
  basics: { Forest: 4, Mountain: 2 },
};
const commander = { id: "cmd", name: "Ruric Thar", typeLine: "Legendary Creature — Ogre", cmc: 6, manaCost: "{4}{R}{G}" };

// ---- library ----
const lib = buildLibrary(deck, cardById);
check("every copy is its own card in the library", lib.length === 2 + 1 + 1 + 3 + 1 + 1 + 6);
check("basics become real cards you can draw", lib.filter((c) => c.name === "Forest").length === 4);
check("the commander is not in the library", !lib.some((c) => c.id === "cmd"));
check("a missing card is skipped, not crashed on", buildLibrary({ entries: [{ cardId: "ghost", qty: 2 }] }, cardById).length === 0);
check("basic lands read as lands", isLandCard(lib.find((c) => c.name === "Forest")));

// ---- shuffling ----
check("shuffling keeps every card", shuffle(lib, fixedRng).length === lib.length);
check("shuffling doesn't mutate the original", (() => {
  const before = lib.map((c) => c.id).join();
  shuffle(lib, fixedRng);
  return lib.map((c) => c.id).join() === before;
})());
check("the same rng gives the same shuffle", (() => {
  const a = shuffle(lib, fixedRng).map((c) => c.id).join();
  const b = shuffle(lib, fixedRng).map((c) => c.id).join();
  return a === b;
})());

// ---- hands ----
const hand = newHand(lib, 0, fixedRng);
check("an opening hand is seven cards", hand.hand.length === 7);
check("the rest is the library", hand.library.length === lib.length - 7);
check("no card is in both hand and library", (() => {
  const inHand = hand.hand.length;
  return inHand + hand.library.length === lib.length;
})());
check("a fresh hand owes nothing to the bottom", hand.toBottom === 0);

const mulled = newHand(lib, 2, fixedRng);
check("a double mulligan still draws seven", mulled.hand.length === 7);
check("...but owes two cards to the bottom", mulled.toBottom === 2);
const settled = bottomCards(mulled, [`${mulled.hand[0].id}:0`, `${mulled.hand[1].id}:1`]);
check("bottoming leaves five in hand", settled.hand.length === 5);
check("the bottomed cards go back to the library", settled.library.length === mulled.library.length + 2);
check("and the debt is paid", settled.toBottom === 0);
check("you can't bottom more than you owe", (() => {
  const one = newHand(lib, 1, fixedRng);
  const keys = one.hand.slice(0, 3).map((c, i) => `${c.id}:${i}`);
  return bottomCards(one, keys).hand.length === 6;
})());

const drew = drawCard(settled, 3);
check("drawing takes off the top", drew.hand.length === 8 && drew.library.length === settled.library.length - 3);
check("the draw count is the turn count", drew.drawn === 3);

// ---- reading a hand ----
const stats = handStats([cardById.temple, cardById.temple, cardById.bolt, cardById.chord]);
check("lands and spells are counted", stats.lands === 2 && stats.spells === 2);
check("the cheapest spell is named", stats.cheapest === 1);
check("average cost is over spells, not lands", Math.abs(stats.avgCmc - 3.5) < 0.01);
check("a one-land hand is called a mulligan", handStats([cardById.temple, cardById.bolt, cardById.bolt]).screwed);
check("an all-land hand is called out", handStats([cardById.temple, cardById.temple, cardById.bog]).flooded);
check("a normal hand is neither", (() => {
  const s = handStats([cardById.temple, cardById.temple, cardById.bog, cardById.bolt, cardById.chord]);
  return !s.screwed && !s.flooded;
})());

// ---- pips ----
check("a plain cost is read", JSON.stringify(parsePips("{2}{G}{G}")) === JSON.stringify({ W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 2 }));
check("X costs nothing toward pips", parsePips("{X}{G}{G}{G}").G === 3 && parsePips("{X}{G}").generic === 0);
check("hybrid counts for both halves", (() => {
  const p = parsePips("{R/G}");
  return p.R === 1 && p.G === 1;
})());
check("phyrexian counts as its colour", parsePips("{G/P}").G === 1);
check("colourless pips aren't a colour", parsePips("{C}{C}").C === 2 && parsePips("{C}").G === 0);
check("an empty cost is empty", parsePips("").generic === 0);
check("a land with no cost doesn't throw", parsePips(undefined).G === 0);

// ---- sources ----
check("basic land types are sources", producedColors(cardById.temple).sort().join() === "G,R");
check("rules text is read for the rest", producedColors(cardById.bog, { t: cardById.bog.oracleText, ty: "Land" }).join() === "B");
check("any colour means every colour", producedColors(cardById.birds, { t: cardById.birds.oracleText, ty: "Creature" }).length === 5);
check("colourless mana is not a colour source", producedColors(cardById.sol, { t: cardById.sol.oracleText, ty: "Artifact" }).length === 0);
check("an unreadable land counts as nothing", producedColors({ typeLine: "Land", name: "Mystery" }).length === 0);

// ---- Karsten numbers ----
check("one pip on turn one wants 14 in 60", sourcesNeeded(1, 1, 60) === 14);
check("two pips on turn two want more", sourcesNeeded(2, 2, 60) > sourcesNeeded(1, 2, 60));
check("later turns want fewer", sourcesNeeded(1, 5, 60) < sourcesNeeded(1, 2, 60));
check("a bigger deck wants proportionally more", sourcesNeeded(1, 3, 100) > sourcesNeeded(1, 3, 60));
check("beyond the table it flattens rather than breaking", sourcesNeeded(1, 12, 60) === sourcesNeeded(1, 6, 60));

// ---- the whole analysis ----
const oracleOf = (c) => (c?.oracleText ? { t: c.oracleText, ty: c.typeLine } : { t: "", ty: c?.typeLine || "" });
const a = analyseManabase({
  cards: deck.entries.map((e) => ({ card: cardById[e.cardId], qty: e.qty })),
  basics: deck.basics,
  commander,
  oracleOf,
  deckSize: 100,
});
check("lands are counted, basics included", a.lands === 3 + 1 + 6);
check("only colours the deck asks for are reported", a.rows.map((r) => r.color).sort().join() === "G,R");
check("green sources are basics plus duals", a.rows.find((r) => r.color === "G").have === 4 + 3);
check("red sources likewise", a.rows.find((r) => r.color === "R").have === 2 + 3);
check("a mana dork is counted apart from lands", a.rows.find((r) => r.color === "G").extra === 1);
check("the strictest card sets the target", a.rows.find((r) => r.color === "G").driver.name === "Chord of Calling");
check("a deck this short of green is told so", a.rows.find((r) => r.color === "G").short > 0);
check("the commander's own pips count", (() => {
  const noCmd = analyseManabase({ cards: [{ card: cardById.bolt, qty: 1 }], basics: {}, oracleOf, deckSize: 100 });
  const withCmd = analyseManabase({ cards: [{ card: cardById.bolt, qty: 1 }], basics: {}, commander, oracleOf, deckSize: 100 });
  return noCmd.rows.length === 1 && withCmd.rows.length === 2;
})());
check("a deck whose costs aren't fetched yet says so rather than lying", (() => {
  const old = analyseManabase({ cards: [{ card: { name: "Old Card", typeLine: "Instant", cmc: 2 }, qty: 1 }], basics: {}, oracleOf, deckSize: 100 });
  return old.known === false && old.rows.length === 0;
})());

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
