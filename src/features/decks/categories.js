/*
 * Deck categories.
 *
 * A deck used to be filed into six fixed roles — lands, ramp, draw, removal,
 * wipes, creatures, other. They're good defaults and they stay, because the
 * drafter uses them to hit quotas. But every deck eventually has a group the
 * app didn't think of: "combo pieces", "stax", "the Dockside package". So a
 * deck can now name its own, and an entry's `role` is simply a key — one of
 * the built-in ones, or one this deck invented.
 *
 * Nothing migrates: a deck with no `categories` array behaves exactly as it
 * always did.
 */
import { ROLE_LABELS, ROLE_ORDER, ROLE_TARGETS } from "./draftLogic";

export const CUSTOM_PREFIX = "cat-";

function slug(label) {
  const base = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `${CUSTOM_PREFIX}${base || "group"}`;
}

export function isCustomCategory(key) {
  return String(key || "").startsWith(CUSTOM_PREFIX);
}

/*
 * Every category this deck displays, in order: the built-in roles first (so
 * lands stay where the eye expects them), then the deck's own, then any key an
 * entry references that nothing declares — an import, or a category deleted
 * while an entry still pointed at it. Orphans are shown rather than silently
 * swallowing their cards.
 */
export function deckCategories(deck) {
  const out = ROLE_ORDER.map((key) => ({
    key,
    label: ROLE_LABELS[key],
    custom: false,
    target: ROLE_TARGETS[key] || null,
  }));
  const seen = new Set(out.map((c) => c.key));
  (deck?.categories || []).forEach((c) => {
    if (!c?.key || seen.has(c.key)) return;
    seen.add(c.key);
    out.push({ key: c.key, label: c.label || c.key, custom: true, target: null });
  });
  (deck?.entries || []).forEach((e) => {
    if (!e.role || seen.has(e.role)) return;
    seen.add(e.role);
    out.push({ key: e.role, label: e.role, custom: true, target: null, orphan: true });
  });
  return out;
}

export function categoryLabel(deck, key) {
  return deckCategories(deck).find((c) => c.key === key)?.label || key;
}

// Returns a patched deck plus the new key, or null when the name is empty or
// already taken (by label — two categories called "Combo" would be a trap).
export function addDeckCategory(deck, label) {
  const clean = String(label || "").trim().slice(0, 32);
  if (!clean) return null;
  const existing = deckCategories(deck).find(
    (c) => c.label.toLowerCase() === clean.toLowerCase()
  );
  if (existing) return { deck, key: existing.key, existed: true };
  let key = slug(clean);
  const taken = new Set(deckCategories(deck).map((c) => c.key));
  let n = 2;
  while (taken.has(key)) key = `${slug(clean)}-${n++}`;
  return {
    deck: { ...deck, categories: [...(deck.categories || []), { key, label: clean }] },
    key,
    existed: false,
  };
}

export function renameDeckCategory(deck, key, label) {
  const clean = String(label || "").trim().slice(0, 32);
  if (!clean || !isCustomCategory(key)) return deck;
  const list = deck.categories || [];
  const next = list.some((c) => c.key === key)
    ? list.map((c) => (c.key === key ? { ...c, label: clean } : c))
    : [...list, { key, label: clean }];
  return { ...deck, categories: next };
}

// Deleting a category never deletes cards: they fall back to "Other spells".
export function removeDeckCategory(deck, key) {
  if (!isCustomCategory(key)) return deck;
  return {
    ...deck,
    categories: (deck.categories || []).filter((c) => c.key !== key),
    entries: (deck.entries || []).map((e) => (e.role === key ? { ...e, role: "other" } : e)),
  };
}

export function setEntryCategory(deck, cardId, key) {
  return {
    ...deck,
    entries: (deck.entries || []).map((e) => (e.cardId === cardId ? { ...e, role: key } : e)),
  };
}

/*
 * Import-time categorization. classifyRole (in draftLogic) reads a card's
 * oracle text to find mechanical roles the drafter cares about — ramp,
 * removal, draw, wipes — and deliberately lumps everything else into
 * "other". That's the wrong shape for importing someone else's decklist:
 * there's no oracle text fetched yet (that's a separate, async, per-card
 * lookup), and "split into groups" for an import means the plain, visible
 * card type — creatures, artifacts, instants, sorceries — the way every
 * deckbuilder buckets a freshly pasted list. So this is a second,
 * independent classifier, pure type-line matching, checked in the order a
 * card's *primary* type is usually read: a land is a land no matter what
 * else it says, an Artifact Creature is filed with the creatures (not the
 * artifacts), and so on down the line.
 */
export const IMPORT_TYPE_CATEGORIES = [
  { test: (ty) => /\bland\b/i.test(ty), key: "land" },
  { test: (ty) => /\bcreature\b/i.test(ty), key: "creature" },
  { test: (ty) => /\bplaneswalker\b/i.test(ty), key: "cat-planeswalkers", label: "Planeswalkers" },
  { test: (ty) => /\bbattle\b/i.test(ty), key: "cat-battles", label: "Battles" },
  { test: (ty) => /\bartifact\b/i.test(ty), key: "cat-artifacts", label: "Artifacts" },
  { test: (ty) => /\benchantment\b/i.test(ty), key: "cat-enchantments", label: "Enchantments" },
  { test: (ty) => /\binstant\b/i.test(ty), key: "cat-instants", label: "Instants" },
  { test: (ty) => /\bsorcery\b/i.test(ty), key: "cat-sorceries", label: "Sorceries" },
];

export function importCategoryFor(typeLine) {
  const ty = String(typeLine || "");
  const hit = IMPORT_TYPE_CATEGORIES.find((c) => c.test(ty));
  return hit ? hit.key : "other";
}

// Category declarations for whichever of the custom keys above an import
// actually used, so the deck shows "Artifacts" rather than the raw
// "cat-artifacts" key. Only the keys passed in are declared, and only the
// ones with a label (land/creature are already built-in roles).
export function importCategoryDeclarations(usedKeys) {
  return IMPORT_TYPE_CATEGORIES.filter((c) => c.label && usedKeys.has(c.key)).map((c) => ({
    key: c.key,
    label: c.label,
  }));
}

// A deck imported before importCategoryFor existed has every non-land,
// non-creature card sitting in "other" forever -- the fix above only changes
// what happens on the *next* import, it can't reach back and reclassify a
// deck that's already built. This does that catch-up: any entry still filed
// under the "other" catch-all gets reclassified by its card's type, exactly
// as a fresh import would file it today. Nothing else is touched -- a card
// in one of the mechanical roles (ramp/draw/removal/wipe) or a category the
// deck named for itself is a choice, not a leftover, and stays put.
export function splitOtherByType(deck, cardById) {
  const declaredKeys = new Set((deck.categories || []).map((c) => c.key));
  const newlyUsed = new Set();
  let changed = false;
  const entries = (deck.entries || []).map((e) => {
    if (e.role !== "other") return e;
    const key = importCategoryFor(cardById?.[e.cardId]?.typeLine);
    if (key === "other") return e;
    if (isCustomCategory(key)) newlyUsed.add(key);
    changed = true;
    return { ...e, role: key };
  });
  if (!changed) return deck;
  const newCats = importCategoryDeclarations(newlyUsed).filter((c) => !declaredKeys.has(c.key));
  return { ...deck, entries, categories: [...(deck.categories || []), ...newCats] };
}
