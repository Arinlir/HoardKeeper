/*
 * Commander Bracket System.
 *
 * WotC's five-tier power scale for Commander decks (Exhibition, Core,
 * Upgraded, Optimized, cEDH). Most of what separates the brackets — combo
 * speed, mass land denial, whether extra turns chain — is a statement about
 * how a deck plays, not something a decklist can answer by itself. The one
 * rule a card list *can* settle on its own is how many "Game Changers" it
 * runs, so that's all this estimates. `deck.bracketOverride` lets a person
 * correct the estimate once they know better (a slow combo the checker can't
 * see, or a genuinely cEDH-tuned list); `effectiveBracket` always prefers the
 * override when one is set.
 *
 * Game Changers list current as of the 2026-02-09 update (53 cards, matched
 * by exact card name — double-faced cards are listed by their front face).
 */
import { formatMeta } from "./formats";

export const GAME_CHANGERS_UPDATED = "2026-02-09";

export const GAME_CHANGERS = new Set([
  // White
  "Drannith Magistrate",
  "Enlightened Tutor",
  "Farewell",
  "Humility",
  "Serra's Sanctum",
  "Smothering Tithe",
  "Teferi's Protection",
  // Blue
  "Consecrated Sphinx",
  "Cyclonic Rift",
  "Fierce Guardianship",
  "Force of Will",
  "Gifts Ungiven",
  "Intuition",
  "Mystical Tutor",
  "Narset, Parter of Veils",
  "Rhystic Study",
  "Thassa's Oracle",
  // Black
  "Ad Nauseam",
  "Bolas's Citadel",
  "Braids, Cabal Minion",
  "Demonic Tutor",
  "Imperial Seal",
  "Necropotence",
  "Opposition Agent",
  "Orcish Bowmasters",
  "Tergrid, God of Fright",
  "Vampiric Tutor",
  // Red
  "Gamble",
  "Jeska's Will",
  "Underworld Breach",
  // Green
  "Biorhythm",
  "Crop Rotation",
  "Gaea's Cradle",
  "Natural Order",
  "Seedborn Muse",
  "Survival of the Fittest",
  "Worldly Tutor",
  // Multicolor
  "Aura Shards",
  "Coalition Victory",
  "Grand Arbiter Augustin IV",
  "Notion Thief",
  // Colorless
  "Ancient Tomb",
  "Chrome Mox",
  "Field of the Dead",
  "Glacial Chasm",
  "Grim Monolith",
  "Lion's Eye Diamond",
  "Mana Vault",
  "Mishra's Workshop",
  "Mox Diamond",
  "Panoptic Mirror",
  "The One Ring",
  "The Tabernacle at Pendrell Vale",
]);

export const BRACKETS = [
  { n: 1, label: "Exhibition" },
  { n: 2, label: "Core" },
  { n: 3, label: "Upgraded" },
  { n: 4, label: "Optimized" },
  { n: 5, label: "cEDH" },
];

export function bracketLabel(n) {
  return BRACKETS.find((b) => b.n === n)?.label || "";
}

// The bracket system is specifically a Commander-deckbuilding thing — a
// Brawl deck's card pool and meta don't map onto this list at all, so it's
// deliberately left out. Duel Commander shares Commander's card pool closely
// enough to count.
export function bracketApplies(format) {
  const key = formatMeta(format)?.key;
  return key === "commander" || key === "duel";
}

// Every Game Changer this deck actually runs, commander included — a
// commander on the list is as much a Game Changer as one in the 99.
export function deckGameChangers(deck, cardById) {
  const names = new Set();
  [deck?.commanderId, deck?.partnerId].forEach((id) => {
    const commander = id ? cardById?.[id] : null;
    if (commander?.name && GAME_CHANGERS.has(commander.name)) names.add(commander.name);
  });
  (deck?.entries || []).forEach((e) => {
    const card = cardById?.[e.cardId];
    if (card?.name && GAME_CHANGERS.has(card.name)) names.add(card.name);
  });
  return [...names].sort();
}

/*
 * Game Changer count is the one lever this can pull:
 * - 0 scores as Core (2), not Exhibition (1) — a normal deck with no Game
 *   Changers is the common case, and Exhibition is a deliberate
 *   ultra-casual/theme choice this has no way to detect.
 * - 1-3 scores as Upgraded (3), matching the official cap for that bracket.
 * - 4+ scores as Optimized (4), never cEDH (5) — cEDH is a claim about how
 *   consistently a deck wins, not just what's printed in it, so 5 is only
 *   ever reached through `bracketOverride`, never guessed.
 */
export function estimateBracket(deck, cardById) {
  const n = deckGameChangers(deck, cardById).length;
  if (n >= 4) return 4;
  if (n >= 1) return 3;
  return 2;
}

// The override wins when it's a valid bracket number; the estimate otherwise.
export function effectiveBracket(deck, cardById) {
  const override = deck?.bracketOverride;
  if (Number.isInteger(override) && override >= 1 && override <= 5) return override;
  return estimateBracket(deck, cardById);
}

export function isBracketOverridden(deck) {
  const override = deck?.bracketOverride;
  return Number.isInteger(override) && override >= 1 && override <= 5;
}
