/*
 * Collections can sit inside one other collection — one level deep, no more.
 * "Universes Beyond" holds "Marvel", "Assassin's Creed" and "TMNT"; picking
 * the parent shows everything in all of them, and its totals are theirs added
 * up. Deeper nesting was left out on purpose: two levels already clear the
 * clutter, and every picker stays a short, flat-looking list.
 *
 * Stored as `parentId` on the child. Nothing else changes: a card still
 * belongs to exactly one collection, and each collection still splits its own
 * Invested total across its own cards.
 *
 * Every read goes through validParentId(), so a parent that was deleted, a
 * parent that itself got a parent, or a collection pointing at itself all
 * just read as top-level — bad data never hides a collection.
 */
import { UNCATEGORIZED } from "./scryfall";

function byId(collections) {
  const m = {};
  (collections || []).forEach((c) => (m[c.id] = c));
  return m;
}

export function validParentId(col, map) {
  const pid = col?.parentId;
  if (!pid || pid === col.id) return null;
  const parent = map[pid];
  if (!parent) return null;
  // One level only: a parent must itself be top-level.
  if (parent.parentId && map[parent.parentId] && parent.parentId !== parent.id) return null;
  return pid;
}

export function topLevel(collections) {
  const map = byId(collections);
  return (collections || []).filter((c) => !validParentId(c, map));
}

export function childrenOf(collections, id) {
  const map = byId(collections);
  return (collections || []).filter((c) => validParentId(c, map) === id);
}

export function parentIdOf(collections, id) {
  const map = byId(collections);
  return map[id] ? validParentId(map[id], map) : null;
}

export function hasChildren(collections, id) {
  return childrenOf(collections, id).length > 0;
}

// The collection itself plus anything inside it.
export function scopeIds(collections, id) {
  return new Set([id, ...childrenOf(collections, id).map((c) => c.id)]);
}

// "Universes Beyond › Marvel" for a sub-collection, the plain name otherwise.
export function collectionPath(collections, id) {
  if (!id || id === UNCATEGORIZED) return "Uncategorized";
  const map = byId(collections);
  const col = map[id];
  if (!col) return "Uncategorized";
  const pid = validParentId(col, map);
  return pid ? `${map[pid].name} › ${col.name}` : col.name;
}

// Every collection in picker order — each parent followed by its children —
// with a label that names the parent, for <select>s.
export function collectionOptions(collections) {
  const out = [];
  topLevel(collections).forEach((p) => {
    out.push({ id: p.id, label: p.name, depth: 0, col: p });
    childrenOf(collections, p.id).forEach((c) => out.push({ id: c.id, label: `${p.name} › ${c.name}`, depth: 1, col: c }));
  });
  return out;
}

// Which collections `id` could be put inside: top-level ones other than
// itself — and none at all if it already holds sub-collections of its own.
export function possibleParents(collections, id) {
  if (id && hasChildren(collections, id)) return [];
  return topLevel(collections).filter((c) => c.id !== id);
}
