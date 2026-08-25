import { RATE_MS, SCRYFALL, normalizeCard, sleep } from "../../lib/scryfall";
import { C } from "../../lib/tokens";

export function cleanArtCardName(name) {
  // Art series cards are technically double-faced (front + back, both the
  // same card), so Scryfall's `name` field is literally "X // X" — collapse
  // that back to plain "X" for display.
  const parts = (name || "").split(" // ");
  if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
  return name;
}

export async function fetchSetInfo(code) {
  const cacheKey = `lf-setinfo-${code}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey));
    if (cached && Date.now() - cached.t < 7 * 864e5) return cached.d;
  } catch (e) {}
  const res = await fetch(`${SCRYFALL}/sets/${code}`);
  if (!res.ok) throw new Error("set not found");
  const raw = await res.json();
  const d = { name: raw.name, code: raw.code, count: raw.card_count, released: raw.released_at };
  try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d })); } catch (e) {}
  return d;
}

// Full roster for a set, paginated, cached for a week. Non-foil paper printings.
export async function fetchSetRoster(code) {
  const cacheKey = `lf-roster-${code}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey));
    if (cached && Date.now() - cached.t < 7 * 864e5) return cached.d;
  } catch (e) {}
  let url = `${SCRYFALL}/cards/search?q=${encodeURIComponent(`e:${code} game:paper`)}&unique=prints&order=set`;
  const all = [];
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("roster fetch failed");
    const page = await res.json();
    (page.data || []).forEach((raw) => all.push(normalizeCard(raw)));
    url = page.has_more ? page.next_page : null;
    if (url) await sleep(RATE_MS);
  }
  try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d: all })); } catch (e) {
    // roster may exceed quota; fine, it just refetches next time
  }
  return all;
}

// Art Series sets ("Tales of Middle-earth Art Series", etc.) are real,
// independent Scryfall sets — full art, no rules text, layout "art_series" —
// linked back to their parent expansion via parent_set_code. Fetched once
// and cached for a month since this list barely changes.
// The full Scryfall set list, fetched once and cached — both the "which of
// my sets have an art series" lookup and the "every art series that exists"
// lookup (for searching by name across all of them) are derived from this
// same list, so it's fetched only once regardless of which is needed first.
export async function fetchAllSets() {
  const cacheKey = "lf-all-sets";
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey));
    if (cached && Date.now() - cached.t < 30 * 864e5) return cached.d;
  } catch (e) {}
  const res = await fetch(`${SCRYFALL}/sets`);
  if (!res.ok) throw new Error("couldn't load the set list");
  const data = await res.json();
  const list = data.data || [];
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d: list }));
  } catch (e) {}
  return list;
}

export function isArtSeriesSet(set) {
  return set.set_type === "memorabilia" && /art series/i.test(set.name);
}

export async function fetchArtSeriesCompanions() {
  const sets = await fetchAllSets();
  const map = {};
  sets.forEach((set) => {
    if (isArtSeriesSet(set) && set.parent_set_code) {
      map[set.parent_set_code] = { code: set.code, name: set.name, count: set.card_count };
    }
  });
  return map;
}

// Every art series set Scryfall knows about, regardless of whether you own
// anything from its parent — used by the Add Card "Art card" search, since
// you might be adding a card from a series you don't otherwise collect.
export async function fetchAllArtSeriesSets() {
  const sets = await fetchAllSets();
  return sets
    .filter(isArtSeriesSet)
    .map((set) => ({ code: set.code, name: set.name, count: set.card_count, parentCode: set.parent_set_code || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const RARITY_ORDER = ["common", "uncommon", "rare", "mythic"];
export const RARITY_FILL = {
  common: C.rarityCommon,
  uncommon: C.rarityUncommon,
  rare: C.rarityRare,
  mythic: C.rarityMythic,
};

// A set's roster is fetched at the PRINTING level (one row per unique
// art/collector-number Scryfall knows about) — but a person doesn't think
// of "Capitoline Triad, showcase version" and "Capitoline Triad, normal
// version" as two different cards to collect; they think "do I have a
// Capitoline Triad." Grouping by name and checking ownership across every
// printing of that name is what makes completion tracking match how a
// collector actually thinks about it, instead of penalizing them for owning
// a different (but real) version of a card they already have.
export function groupRosterByName(roster, ownedCount) {
  const order = [];
  const byName = new Map();
  roster.forEach((entry) => {
    if (!byName.has(entry.name)) {
      byName.set(entry.name, []);
      order.push(entry.name);
    }
    byName.get(entry.name).push(entry);
  });
  return order.map((name) => {
    const printings = byName.get(name);
    const ownedPrinting = printings.find((p) => ownedCount(p) > 0) || null;
    const totalOwned = printings.reduce((sum, p) => sum + ownedCount(p), 0);
    return {
      name,
      printings,
      // Show whichever printing is actually owned (so the tile displays
      // YOUR copy's art), falling back to the first known printing when
      // nothing in the group is owned yet.
      display: ownedPrinting || printings[0],
      isOwned: !!ownedPrinting,
      totalOwned,
    };
  });
}

