import { C } from "../../lib/tokens";

export function classifyRole(card, text) {
  const t = (text || "").toLowerCase();
  const ty = (card.typeLine || "").toLowerCase();
  if (ty.includes("land")) return "land";
  if (/destroy all|exile all|each creature deals|deals damage to each/.test(t)) return "wipe";
  if (/destroy target|exile target|deals \d+ damage to (any target|target creature)|fights? target/.test(t))
    return "removal";
  if (/add \{|add [a-z]+ mana|search your library for (a|up to two)[^.]*land/.test(t)) return "ramp";
  if (/draw (a|two|three|x) cards?|draws? that many cards/.test(t)) return "draw";
  if (ty.includes("creature")) return "creature";
  return "other";
}

// words that indicate mechanical synergy when shared with the commander
export const SYNERGY_WORDS = [
  "token", "sacrifice", "graveyard", "counter", "+1/+1", "lifelink", "life", "landfall",
  "wolf", "wolves", "elf", "goblin", "zombie", "dragon", "angel", "vampire", "spirit",
  "artifact", "enchantment", "equipment", "aura", "instant", "sorcery", "flying",
  "deathtouch", "proliferate", "mill", "discard", "treasure", "food", "clue",
];

export function synergyScore(commanderText, commanderTypes, card, text) {
  const ct = (commanderText || "").toLowerCase();
  const t = ((text || "") + " " + (card.typeLine || "")).toLowerCase();
  let score = 0;
  // shared creature subtypes (after the em dash in the commander's type line)
  const sub = (commanderTypes.split("—")[1] || "").toLowerCase().trim().split(/\s+/);
  sub.forEach((st) => {
    if (st.length > 2 && t.includes(st)) score += 3;
  });
  SYNERGY_WORDS.forEach((w) => {
    if (ct.includes(w) && t.includes(w)) score += 1.5;
  });
  return score;
}

export function identityFits(card, identity) {
  return (card.colors || []).every((c) => identity.includes(c));
}

export const ROLE_TARGETS = { land: 37, ramp: 10, draw: 10, removal: 8, wipe: 3 };
export const ROLE_LABELS = {
  land: "Lands",
  ramp: "Ramp",
  draw: "Card draw",
  removal: "Removal",
  wipe: "Board wipes",
  creature: "Creatures",
  other: "Other spells",
};
export const ROLE_ORDER = ["land", "ramp", "draw", "removal", "wipe", "creature", "other"];

// The drafter: fills role quotas from the pool, then the rest by synergy and curve.
// Commander is singleton with two exceptions: basic lands, and cards whose text
// explicitly allows any number ("A deck can have any number of cards named…",
// e.g. Rat Colony, Persistent Petitioners, Dragon's Approach).
export function isBasicLand(card) {
  return /\bbasic\b/i.test(card?.typeLine || "") && /\bland\b/i.test(card?.typeLine || "");
}

export function allowsAnyNumber(card, oracleText) {
  if (isBasicLand(card)) return true;
  return /a deck can have any number of cards named/i.test(oracleText || "");
}

// `freeCopies(card)` reports how many copies aren't already committed to another
// deck. Defaults to "everything is available" so the function stays testable.
export function draftDeck(commander, pool, oracle, freeCopies = () => Infinity) {
  const identity = commander.colors || [];
  const cText = oracle[commander.scryfallId]?.t || "";
  const cTypes = commander.typeLine || "";

  const candidates = pool
    .filter(
      (c) =>
        !c.sold &&
        c.id !== commander.id &&
        c.scryfallId &&
        identityFits(c, identity) &&
        // don't draft a card that's already sleeved in another deck
        freeCopies(c) > 0
    )
    .map((c) => {
      const text = oracle[c.scryfallId]?.t || "";
      return {
        card: c,
        role: classifyRole(c, text),
        syn: synergyScore(cText, cTypes, c, text),
      };
    });

  // singleton by name, except basics and "any number" cards
  const seen = new Set([commander.name]);
  const unique = [];
  candidates
    .sort((a, b) => b.syn - a.syn)
    .forEach((x) => {
      const free = allowsAnyNumber(x.card, oracle[x.card.scryfallId]?.t);
      if (free || !seen.has(x.card.name)) {
        if (!free) seen.add(x.card.name);
        unique.push(x);
      }
    });

  const picks = [];
  const used = new Set();

  function take(role, n, sorter) {
    const found = unique
      .filter((x) => x.role === role && !used.has(x.card.id))
      .sort(sorter)
      .slice(0, n);
    found.forEach((x) => {
      used.add(x.card.id);
      picks.push(x);
    });
    return found.length;
  }

  const bySyn = (a, b) => b.syn - a.syn || Math.abs((a.card.cmc || 3) - 3) - Math.abs((b.card.cmc || 3) - 3);
  const cheapFirst = (a, b) => (a.card.cmc || 0) - (b.card.cmc || 0) || b.syn - a.syn;

  const landsFound = take("land", 14, bySyn); // nonbasics from the pool
  take("ramp", ROLE_TARGETS.ramp, cheapFirst);
  take("draw", ROLE_TARGETS.draw, bySyn);
  take("removal", ROLE_TARGETS.removal, cheapFirst);
  take("wipe", ROLE_TARGETS.wipe, bySyn);

  // basics fill the rest of the mana base
  const basicsNeeded = Math.max(0, ROLE_TARGETS.land - landsFound);
  const spellSlots = 99 - landsFound - basicsNeeded - picks.filter((p) => p.role !== "land").length;

  // remaining slots: best synergy, curve-weighted
  const rest = unique
    .filter((x) => !used.has(x.card.id) && x.role !== "land")
    .sort(bySyn)
    .slice(0, Math.max(0, spellSlots));
  rest.forEach((x) => {
    used.add(x.card.id);
    picks.push(x);
  });

  // split basics across the identity by pip presence in picked cards
  const pipCount = {};
  identity.forEach((c) => (pipCount[c] = 1));
  picks.forEach((x) => (x.card.colors || []).forEach((c) => {
    if (identity.includes(c)) pipCount[c] = (pipCount[c] || 0) + 1;
  }));
  const totalPips = Object.values(pipCount).reduce((a, b) => a + b, 0) || 1;
  const basics = {};
  const BASIC_NAME = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
  let assigned = 0;
  const identityList = identity.length ? identity : ["C"];
  identityList.forEach((c, i) => {
    const n =
      i === identityList.length - 1
        ? basicsNeeded - assigned
        : Math.round((basicsNeeded * (pipCount[c] || 1)) / totalPips);
    assigned += n;
    if (n > 0) basics[BASIC_NAME[c] || "Wastes"] = n;
  });

  return {
    entries: picks.map((x) => ({ cardId: x.card.id, role: x.role })),
    basics,
    shortfall: Math.max(0, spellSlots - rest.length),
  };
}

// 60-card constructed drafter. No commander: you pick the colors, it builds
// 24 lands / ~24 creatures / spells, allowing up to 4 copies but never more
// than you own. Theme is inferred from your most common creature type.
export function draftDeck60(colors, pool, oracle, freeCopies = () => Infinity) {
  const identity = colors;
  const candidates = pool
    .filter(
      (c) =>
        !c.sold &&
        identityFits(c, identity) &&
        !(c.typeLine || "").toLowerCase().includes("basic land") &&
        freeCopies(c) > 0
    )
    .map((c) => {
      const text = oracle[c.scryfallId]?.t || "";
      return {
        card: c,
        role: classifyRole(c, text),
        text,
        // four of a card, but never more than you have free
        maxQty: Math.min(4, c.quantity || 1, freeCopies(c)),
      };
    });

  // theme: the most common creature subtype in the candidate pool
  const subtypeCount = {};
  candidates.forEach((x) => {
    if (!(x.card.typeLine || "").includes("Creature")) return;
    const sub = ((x.card.typeLine || "").split("—")[1] || "").trim().split(/\s+/);
    sub.forEach((st) => {
      if (st.length > 2) subtypeCount[st] = (subtypeCount[st] || 0) + (x.maxQty || 1);
    });
  });
  const theme = Object.entries(subtypeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  candidates.forEach((x) => {
    const t = ((x.text || "") + " " + (x.card.typeLine || "")).toLowerCase();
    x.syn = (theme && t.includes(theme.toLowerCase()) ? 3 : 0) - Math.abs((x.card.cmc || 2) - 2.5);
  });

  const picks = [];
  const used = new Set();
  let count = 0;

  function take(filter, slots, sorter) {
    const found = candidates.filter((x) => !used.has(x.card.id) && filter(x)).sort(sorter);
    for (const x of found) {
      if (count >= 60 - 24 + landsPicked || slots <= 0) break;
      const qty = Math.min(x.maxQty, slots);
      used.add(x.card.id);
      picks.push({ ...x, qty });
      slots -= qty;
      count += qty;
    }
  }

  // nonbasic lands first (up to 6), basics fill to 24
  let landsPicked = 0;
  candidates
    .filter((x) => x.role === "land" && !used.has(x.card.id))
    .sort((a, b) => b.syn - a.syn)
    .slice(0, 3)
    .forEach((x) => {
      const qty = Math.min(x.maxQty, 6 - landsPicked);
      if (qty <= 0) return;
      used.add(x.card.id);
      picks.push({ ...x, qty });
      landsPicked += qty;
    });

  const bySyn = (a, b) => b.syn - a.syn;
  const cheap = (a, b) => (a.card.cmc || 0) - (b.card.cmc || 0) || b.syn - a.syn;

  take((x) => x.role === "removal", 8, cheap);
  take((x) => x.role === "draw", 6, bySyn);
  take((x) => x.role === "creature", 24, bySyn);
  take((x) => x.role !== "land", 60, bySyn); // fill whatever's left

  const spellCount = picks.filter((p) => p.role !== "land").reduce((s, p) => s + p.qty, 0);
  const basicsNeeded = Math.max(0, 60 - spellCount - landsPicked);

  const pipCount = {};
  identity.forEach((c) => (pipCount[c] = 1));
  picks.forEach((x) => (x.card.colors || []).forEach((c) => {
    if (identity.includes(c)) pipCount[c] = (pipCount[c] || 0) + x.qty;
  }));
  const totalPips = Object.values(pipCount).reduce((a, b) => a + b, 0) || 1;
  const BASIC_NAME = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
  const basics = {};
  let assigned = 0;
  const identityList = identity.length ? identity : ["C"];
  identityList.forEach((c, i) => {
    const n =
      i === identityList.length - 1
        ? basicsNeeded - assigned
        : Math.round((basicsNeeded * (pipCount[c] || 1)) / totalPips);
    assigned += n;
    if (n > 0) basics[BASIC_NAME[c] || "Wastes"] = n;
  });

  return {
    entries: picks.map((x) => ({ cardId: x.card.id, role: x.role, qty: x.qty })),
    basics,
    shortfall: Math.max(0, 60 - spellCount - landsPicked - basicsNeeded),
    theme,
  };
}

/* ============================================================
   ACCOUNT GATE — email + password, used when the server runs
   in accounts mode. PIN installs never see this.
   ============================================================ */

