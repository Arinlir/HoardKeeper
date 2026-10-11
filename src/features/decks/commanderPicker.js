/*
 * The commander picker's list.
 *
 * It used to be `cards.filter(...)` in collection order, which meant the
 * dropdown arrived in whatever sequence the cards were typed in or imported —
 * and when you own two copies of the same legend, two identical lines with no
 * way to tell which was which.
 *
 * So: alphabetical, and a copy only carries printing detail when it actually
 * needs it to be told apart from another line. A single Sol Ring doesn't need
 * to shout its set code at you.
 */

import { canPair, isCommanderCard } from "../../lib/commander";

// Legendary creatures, plus anything whose rules text lets it lead a deck
// (planeswalker commanders) — see lib/commander.js.
export function isCommanderCandidate(card) {
  return !card?.sold && isCommanderCard(card);
}

const FINISH_LABEL = { foil: "foil", etched: "etched", nonfoil: "" };

function printingOf(card) {
  const bits = [];
  if (card.set) bits.push(String(card.set).toUpperCase());
  if (card.collectorNumber) bits.push(`#${card.collectorNumber}`);
  const finish = FINISH_LABEL[card.finish] || (card.foil ? "foil" : "");
  if (finish) bits.push(finish);
  return bits.join(" ");
}

function colorsOf(card) {
  return card.colors?.length ? `(${card.colors.join("")})` : "";
}

/*
 * Options for the "choose a commander" select: sorted by name, then by
 * printing so two copies of the same legend land next to each other in a
 * stable order. `label` is what the option shows; it gains the set, collector
 * number and finish only when another candidate shares its name.
 */
export function commanderOptions(cards) {
  return optionsFor((cards || []).filter(isCommanderCandidate));
}

/*
 * The second-commander select: every card you own that can legally share the
 * command zone with `primary` — its partners, its Background, its Doctor.
 * Backgrounds aren't commanders on their own, which is why this doesn't
 * start from commanderOptions.
 */
export function partnerOptions(cards, primary) {
  if (!primary) return [];
  return optionsFor((cards || []).filter((c) => !c.sold && canPair(primary, c)));
}

function optionsFor(list) {
  const nameCount = {};
  list.forEach((c) => {
    const k = (c.name || "").toLowerCase();
    nameCount[k] = (nameCount[k] || 0) + 1;
  });
  return list
    .map((c) => {
      const dup = nameCount[(c.name || "").toLowerCase()] > 1;
      const printing = dup ? printingOf(c) : "";
      const label = [c.name, colorsOf(c), printing && `· ${printing}`]
        .filter(Boolean)
        .join(" ");
      return { id: c.id, card: c, label, name: c.name || "", printing: printingOf(c) };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.printing.localeCompare(b.printing) ||
        String(a.id).localeCompare(String(b.id))
    );
}
