// Verifies: the Game Changers list, the Bracket estimate it drives, and the
// override that lets a person correct it. Pure module — no DOM.
import {
  BRACKETS,
  GAME_CHANGERS,
  bracketApplies,
  bracketLabel,
  deckGameChangers,
  effectiveBracket,
  estimateBracket,
  isBracketOverridden,
} from "./src/lib/brackets";
import { isDeckBuilt } from "./src/features/decks/externals";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// ---- Game Changers list ----------------------------------------------------
check("the list has 53 cards", GAME_CHANGERS.size === 53);
check("Rhystic Study is on it", GAME_CHANGERS.has("Rhystic Study"));
check("Sol Ring is not on it", !GAME_CHANGERS.has("Sol Ring"));
check("all five bracket labels exist", BRACKETS.length === 5 && bracketLabel(5) === "cEDH");

// ---- format gating ----------------------------------------------------------
check("commander gets the bracket system", bracketApplies("commander"));
check("duel commander gets it too", bracketApplies("duel"));
check("standard does not", !bracketApplies("standard"));
check("brawl does not (different card pool)", !bracketApplies("brawl"));
check("an unrecognised format does not", !bracketApplies("cube"));

// ---- estimate from Game Changers ------------------------------------------
const gcA = { id: "a", name: "Rhystic Study" };
const gcB = { id: "b", name: "Cyclonic Rift" };
const gcC = { id: "c", name: "Demonic Tutor" };
const gcD = { id: "d", name: "Mana Vault" };
const plain = { id: "p", name: "Llanowar Elves" };
const cardById = { a: gcA, b: gcB, c: gcC, d: gcD, p: plain };

const zeroGC = { format: "commander", entries: [{ cardId: "p", qty: 1 }] };
check("no Game Changers scores as Core (2)", estimateBracket(zeroGC, cardById) === 2);

const oneGC = { format: "commander", entries: [{ cardId: "a", qty: 1 }, { cardId: "p", qty: 1 }] };
check("one Game Changer scores as Upgraded (3)", estimateBracket(oneGC, cardById) === 3);

const threeGC = {
  format: "commander",
  entries: [{ cardId: "a", qty: 1 }, { cardId: "b", qty: 1 }, { cardId: "c", qty: 1 }],
};
check("three Game Changers still scores as Upgraded (3)", estimateBracket(threeGC, cardById) === 3);

const fourGC = {
  format: "commander",
  commanderId: "d",
  entries: [{ cardId: "a", qty: 1 }, { cardId: "b", qty: 1 }, { cardId: "c", qty: 1 }],
};
check("a Game-Changer commander counts too", deckGameChangers(fourGC, cardById).includes("Mana Vault"));
check("four Game Changers scores as Optimized (4), not cEDH", estimateBracket(fourGC, cardById) === 4);

check(
  "deckGameChangers names come back sorted, no duplicates",
  JSON.stringify(deckGameChangers(fourGC, cardById)) ===
    JSON.stringify(["Cyclonic Rift", "Demonic Tutor", "Mana Vault", "Rhystic Study"])
);

// ---- override ----------------------------------------------------------------
check("with no override, effective == estimate", effectiveBracket(zeroGC, cardById) === 2);
check("an unset deck is not overridden", !isBracketOverridden(zeroGC));
const overridden = { ...zeroGC, bracketOverride: 5 };
check("an override wins over the estimate", effectiveBracket(overridden, cardById) === 5);
check("that deck reads as overridden", isBracketOverridden(overridden));
check("an out-of-range override is ignored", effectiveBracket({ ...zeroGC, bracketOverride: 9 }, cardById) === 2);
check("a null override is not an override", !isBracketOverridden({ ...zeroGC, bracketOverride: null }));

// ---- "built" gating (deck_unowned_cards.md's placeholder concept) ---------
const wishlistCard = { id: "w", name: "Some Card", notOwned: true };
const builtDeck = { entries: [{ cardId: "p", qty: 1 }] };
const planningDeck = { entries: [{ cardId: "p", qty: 1 }, { cardId: "w", qty: 1 }] };
const emptyDeck = { entries: [] };
const byIdWithExternal = { p: plain, w: wishlistCard };
check("a deck with only owned cards is built", isDeckBuilt(builtDeck, byIdWithExternal));
check("a deck with any placeholder is not built", !isDeckBuilt(planningDeck, byIdWithExternal));
check("an empty deck is not built either", !isDeckBuilt(emptyDeck, byIdWithExternal));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
