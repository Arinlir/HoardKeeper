/*
 * Your own words for your own cards.
 *
 * Tags are free-form and per card: "trade", "sleeved", "sentimental", "for
 * dad's deck". The app never invents them and never interprets them — it just
 * keeps them, shows them, and lets `tag:` in the search box find them.
 */

// Tags are matched case-insensitively but stored as typed, so "Trade" and
// "trade" are the same tag and the first spelling wins.
export function normalizeTag(t) {
  return String(t || "").trim().replace(/\s+/g, " ").slice(0, 32);
}

export function addTag(tags, tag) {
  const t = normalizeTag(tag);
  if (!t) return tags || [];
  const list = tags || [];
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return list;
  return [...list, t];
}

export function removeTag(tags, tag) {
  const t = normalizeTag(tag).toLowerCase();
  return (tags || []).filter((x) => x.toLowerCase() !== t);
}

// Every tag in use, most-used first, for suggestions.
export function allTags(cards) {
  const counts = {};
  (cards || []).forEach((c) =>
    (c.tags || []).forEach((t) => {
      const k = normalizeTag(t);
      if (!k) return;
      const existing = Object.keys(counts).find((x) => x.toLowerCase() === k.toLowerCase());
      const key = existing || k;
      counts[key] = (counts[key] || 0) + 1;
    })
  );
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}
