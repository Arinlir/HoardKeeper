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


// ── Sorting the roster grid ─────────────────────────────────────────────
// The ways the "every card in the set" grid can be ordered. `dir` is the
// direction a key starts in when picked — collector number reads top-down
// like a binder, but for price or how many you hold, the interesting end
// is the big one.
export const ROSTER_SORTS = [
  { key: "number", label: "Collector #", dir: "asc" },
  { key: "name", label: "Name", dir: "asc" },
  { key: "color", label: "Colour / archetype", dir: "asc" },
  { key: "type", label: "Card type", dir: "asc" },
  { key: "rarity", label: "Rarity", dir: "desc" },
  { key: "cmc", label: "Mana value", dir: "asc" },
  { key: "price", label: "Price", dir: "desc" },
  { key: "owned", label: "Copies owned", dir: "desc" },
];

// Natural order for collector numbers: "2" < "10" < "10a" < "199", and the
// odd ones ("★12", "A-5") still land somewhere stable rather than throwing.
const cnCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// A group's place in the set is its LOWEST collector number — the main
// printing — not whichever printing is displayed (that's the one you own,
// and a showcase #245 shouldn't drag the card to the back of the binder).
export function groupCollectorNumber(g) {
  let best = null;
  for (const p of g.printings || [g.display]) {
    const cn = p?.collectorNumber ?? "";
    if (best === null || cnCollator.compare(cn, best) < 0) best = cn;
  }
  return best ?? "";
}

const WUBRG = "WUBRG";
// Draft archetypes in a set are colour pairs, so pairs are listed in the
// order players name them: the five allied guilds round the wheel, then
// the five enemy ones.
const PAIR_ORDER = ["WU", "UB", "BR", "RG", "WG", "WB", "UR", "BG", "WR", "UG"];

function frontType(card) {
  return (card?.typeLine || "").split(" // ")[0];
}

// Buckets, in order: mono W, U, B, R, G (0–4) → the ten pairs (10–19) →
// three colours (20) → four or five (21) → colourless non-land (30) →
// lands (40). Lands go last whatever their identity, the way a set list
// or a binder usually ends with them. Within a bucket, collector number.
export function colorBucket(card) {
  if (/\bLand\b/.test(frontType(card))) return 40;
  const cols = [...new Set(card?.colors || [])]
    .filter((c) => WUBRG.includes(c))
    .sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
  if (cols.length === 0) return 30;
  if (cols.length === 1) return WUBRG.indexOf(cols[0]);
  if (cols.length === 2) return 10 + PAIR_ORDER.indexOf(cols.join(""));
  if (cols.length === 3) return 20;
  return 21;
}

// Rough "what is this card" order: creatures first (that's how most set
// lists and decklists read), then the other spells, lands last.
const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Enchantment", "Artifact", "Land"];
export function typeBucket(card) {
  const t = frontType(card);
  // A land with another type word (Artifact Land, Dryad Arbor's Land
  // Creature) is still filed by what it does first: creature, then land.
  if (/\bCreature\b/.test(t)) return 0;
  if (/\bLand\b/.test(t)) return TYPE_ORDER.indexOf("Land");
  const i = TYPE_ORDER.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
  return i === -1 ? TYPE_ORDER.length : i;
}

const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };

// Sorts groups from groupRosterByName. `priceOf` turns one printing into a
// number or null; the group's price is its CHEAPEST printing — what it
// would cost you to fill that slot. Groups with no price, like printings
// with no price in the printing pickers, go last in either direction.
// Ties always fall back to collector number ascending so the order never
// shuffles between renders.
export function sortRosterGroups(groups, key = "number", dir = "asc", priceOf = () => null) {
  const sign = dir === "desc" ? -1 : 1;
  const byNumber = (a, b) => cnCollator.compare(groupCollectorNumber(a), groupCollectorNumber(b));
  const groupPrice = (g) => {
    let best = null;
    for (const p of g.printings || [g.display]) {
      const v = priceOf(p);
      if (v != null && (best == null || v < best)) best = v;
    }
    return best;
  };
  const primary = {
    number: (a, b) => byNumber(a, b),
    name: (a, b) => a.name.localeCompare(b.name),
    color: (a, b) => colorBucket(a.display) - colorBucket(b.display),
    type: (a, b) => typeBucket(a.display) - typeBucket(b.display),
    rarity: (a, b) => (RARITY_RANK[a.display?.rarity] ?? 9) - (RARITY_RANK[b.display?.rarity] ?? 9),
    cmc: (a, b) => (a.display?.cmc ?? 0) - (b.display?.cmc ?? 0),
    owned: (a, b) => (a.totalOwned || 0) - (b.totalOwned || 0),
  }[key];

  if (key === "price") {
    const priced = groups.map((g) => [g, groupPrice(g)]);
    return priced
      .sort(([a, av], [b, bv]) => {
        if (av == null && bv == null) return byNumber(a, b);
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * sign || byNumber(a, b);
      })
      .map(([g]) => g);
  }
  const cmp = primary || byNumber; // unknown key → binder order
  return [...groups].sort((a, b) => cmp(a, b) * sign || byNumber(a, b));
}
