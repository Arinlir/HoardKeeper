import { finishOf } from "./scryfall";

// Imports pile up: a row that names a copy you already own (or that repeats
// earlier in the same file) raises that row's quantity instead of creating a
// second card. "Same copy" follows the Add Card rule — same printing and
// finish, same signed/proxy flags — plus the same collection and condition,
// since a file can deliberately spread copies over binders or grades.
function keyOf(c) {
  const printing = c.scryfallId
    ? `id:${c.scryfallId}`
    : `n:${(c.name || "").toLowerCase()}|${c.set || ""}|${c.collectorNumber || ""}`;
  return [
    printing,
    finishOf(c),
    c.signed ? 1 : 0,
    c.proxy ? 1 : 0,
    c.collectionId || "",
    c.condition || "NM",
  ].join("~");
}

export function mergeImported(existing, incoming) {
  const out = existing.slice();
  const slot = new Map();
  out.forEach((c, i) => {
    if (!c.sold && !slot.has(keyOf(c))) slot.set(keyOf(c), i);
  });
  let merged = 0;
  incoming.forEach((c) => {
    const k = keyOf(c);
    if (slot.has(k)) {
      const i = slot.get(k);
      const t = out[i];
      out[i] = {
        ...t,
        quantity: (t.quantity || 1) + (c.quantity || 1),
        costOverride:
          t.costOverride != null || c.costOverride != null
            ? (t.costOverride || 0) + (c.costOverride || 0)
            : null,
      };
      merged++;
    } else {
      slot.set(k, out.length);
      out.push(c);
    }
  });
  return { cards: out, merged };
}
