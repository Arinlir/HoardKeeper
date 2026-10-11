/*
 * Can this card be your commander?
 *
 * Rule 903.3: a legendary creature — or any card whose own rules text says
 * "<name> can be your commander". The second half is how planeswalker
 * commanders work (Jace, Multiverse Architect; the old Commander 2014
 * walkers), and a few legendary vehicles and spacecraft use it too. Only
 * checking the type line was why those never showed up in the picker.
 *
 * Kept free of imports so the Scryfall layer, the search query engine and
 * the deck view can all share it without a cycle.
 */

const CAN_BE_COMMANDER = /can be your commander/i;

// From Scryfall's raw card: the text lives on the card, or on each face of a
// two-faced card. Only the FRONT face counts for the type — a modal DFC
// whose back is a legendary creature can't lead a deck from the back.
export function rawCanBeCommander(raw) {
  if (!raw) return false;
  const faces = raw.card_faces || [];
  const frontType = (faces[0]?.type_line || raw.type_line || "").split(" // ")[0];
  if (/\bLegendary\b/.test(frontType) && /\bCreature\b/.test(frontType)) return true;
  const text = [raw.oracle_text || "", ...faces.map((f) => f.oracle_text || "")].join("\n");
  return CAN_BE_COMMANDER.test(text);
}

// From a card in the collection. `canBeCommander` is set whenever a card is
// fetched or refreshed; older saved cards may not have it yet, so the type
// line is still honoured, and cached rules text (if the caller has it) can
// confirm the "can be your commander" ones before the flag is backfilled.
export function isCommanderCard(card, oracleText) {
  if (!card) return false;
  if (card.canBeCommander === true) return true;
  const t = card.typeLine || "";
  if (t.includes("Legendary") && t.includes("Creature")) return true;
  return !!oracleText && CAN_BE_COMMANDER.test(oracleText);
}

// Legendary cards whose rules text hasn't been read yet: a non-creature
// might say "can be your commander", and any legend might carry a partner
// ability. Both answers are recorded (false / null when there's nothing),
// so each card is looked up once, ever.
export function needsCommanderCheck(card) {
  const t = card?.typeLine || "";
  if (!card?.scryfallId || !t.includes("Legendary")) return false;
  const walkerUnknown = card.canBeCommander === undefined && !t.includes("Creature");
  return walkerUnknown || card.partner === undefined;
}

// What a rules-text lookup (the oracle cache: { t: text, ty: type line })
// says about a saved card.
export function commanderPatchFromOracle(card, entry) {
  const typeLine = entry?.ty || card.typeLine || "";
  const text = entry?.t || "";
  const front = typeLine.split(" // ")[0];
  return {
    canBeCommander:
      (/\bLegendary\b/.test(front) && /\bCreature\b/.test(front)) || CAN_BE_COMMANDER.test(text),
    partner: parsePartner(text),
  };
}

export function textSaysCommander(text) {
  return CAN_BE_COMMANDER.test(text || "");
}

// ── Two commanders ──────────────────────────────────────────────────────
//
// Rule 702.124 and its offshoots. Since 2025 WotC prints the newer ones as
// "Partner—<variant>" (Partner—Character select on the TMNT turtles, which
// is how Leonardo leads with Raphael or Splinter), and a card with a variant
// can only pair with the SAME variant. The older spellings still exist on
// paper, so both are read:
//
//   Partner                     ↔ any other plain Partner
//   Partner with <Name>         ↔ that exact card
//   Partner—<Variant>           ↔ same <Variant> (Character select, Survivors…)
//   Friends forever             ↔ Friends forever (= Partner—Friends forever)
//   Choose a Background         ↔ a legendary Background enchantment
//   Doctor's companion          ↔ a creature that is only "Time Lord Doctor"
//
// What's stored on a card (`partner`) comes from rules text only; the two
// roles that come from a type line (Background, the Doctor) are read from
// the type line when pairing, so they need no lookup at all.

// One ability line → descriptor, or null. Reminder text in parentheses is
// dropped first so "Partner (You can have two commanders…)" reads as Partner.
function parseLine(line) {
  const l = line.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  let m;
  if ((m = /^partner with (.+)$/i.exec(l))) return { k: "with", name: m[1].trim() };
  if ((m = /^partner\s*[—–-]\s*(.+)$/i.exec(l))) return { k: "variant", v: m[1].trim().toLowerCase() };
  if (/^partner$/i.test(l)) return { k: "partner" };
  if (/^friends forever$/i.test(l)) return { k: "variant", v: "friends forever" };
  if (/^choose a background$/i.test(l)) return { k: "choose-bg" };
  if (/^doctor['’]s companion$/i.test(l)) return { k: "companion" };
  return null;
}

// Rules text (all faces joined) → the card's partner ability, or null.
export function parsePartner(text) {
  for (const line of String(text || "").split(/\n/)) {
    const d = parseLine(line);
    if (d) return d;
  }
  return null;
}

export function rawPartner(raw) {
  if (!raw) return null;
  const faces = raw.card_faces || [];
  return parsePartner([raw.oracle_text || "", ...faces.map((f) => f.oracle_text || "")].join("\n"));
}

function frontTypeOf(card) {
  return String(card?.typeLine || "").split(" // ")[0];
}
export function isBackground(card) {
  const t = frontTypeOf(card);
  return /\bLegendary\b/.test(t) && /\bEnchantment\b/.test(t) && /\bBackground\b/.test(t);
}
export function isTheDoctor(card) {
  const t = frontTypeOf(card);
  const sub = (t.split(/\s[—–-]\s/)[1] || "").trim();
  return /\bCreature\b/.test(t) && /^Time Lord Doctor$/i.test(sub);
}

// Can a and b share the command zone? Order doesn't matter.
export function canPair(a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (a.name && a.name === b.name) return false; // two copies of one legend
  const pa = a.partner || null;
  const pb = b.partner || null;
  if (pa?.k === "partner" && pb?.k === "partner") return true;
  if (pa?.k === "with" || pb?.k === "with") {
    const eq = (x, y) => String(x || "").toLowerCase() === String(y || "").toLowerCase();
    return (pa?.k === "with" && eq(pa.name, b.name)) || (pb?.k === "with" && eq(pb.name, a.name));
  }
  if (pa?.k === "variant" && pb?.k === "variant") return pa.v === pb.v;
  if (pa?.k === "choose-bg" && isBackground(b)) return true;
  if (pb?.k === "choose-bg" && isBackground(a)) return true;
  if (pa?.k === "companion" && isTheDoctor(b)) return true;
  if (pb?.k === "companion" && isTheDoctor(a)) return true;
  return false;
}

// Does this card leave room for a second commander at all? Drives whether
// the "second commander" picker is shown.
export function canHavePartner(card) {
  if (!card) return false;
  if (card.partner) return true;
  return isBackground(card) || isTheDoctor(card);
}

// Short human label for the ability, for the picker's hint line.
export function partnerLabel(card) {
  const p = card?.partner;
  if (p?.k === "partner") return "Partner";
  if (p?.k === "with") return `Partner with ${p.name}`;
  if (p?.k === "variant") return `Partner — ${p.v.replace(/\b\w/g, (c) => c.toUpperCase())}`;
  if (p?.k === "choose-bg") return "Choose a Background";
  if (p?.k === "companion") return "Doctor's companion";
  if (isBackground(card)) return "Background";
  if (isTheDoctor(card)) return "the Doctor";
  return "";
}

// The deck's commanders, in order — primary first. A deck made before
// second commanders existed just has the one.
export function deckCommanderIds(deck) {
  if (!deck) return [];
  return [deck.commanderId, deck.partnerId].filter(Boolean);
}

// Colour identity of the whole command zone, in WUBRG order.
export function combinedIdentity(cards) {
  const set = new Set();
  (cards || []).forEach((c) => (c?.colors || []).forEach((x) => set.add(x)));
  return ["W", "U", "B", "R", "G"].filter((x) => set.has(x));
}
