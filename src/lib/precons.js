// Pre-constructed decks (Commander precons, Brawl decks, Planeswalker decks,
// intro packs…), so a box you just bought can be added in one go with the exact
// printings it contains.
//
// Source: MTGJSON's deck files. Scryfall has no notion of "a deck", but every
// MTGJSON deck lists each card with its set code, collector number and
// Scryfall id — which is what pins the right printing (and so the right art).
// The files are served with CORS open, so this works straight from the browser
// and from the mobile app, no server involved.
const MTGJSON = "https://mtgjson.com/api/v5";

// MTGJSON files digital-only and non-deck products here too.
const SKIP_TYPES = new Set([
  "MTGO Redemption", "Welcome Booster", "Bundle Land Pack", "Advanced Pack",
  "MTGO Theme Deck", "MTGO Commander Deck", "MTGO Duel Deck", "Arena Starter Deck",
  "Arena Starter Kit", "Arena Promotional Deck", "Historic Brawl Precon Deck",
  "Shandalar Enemy Deck", "Enemy Deck", "Dandan Deck", "Halfdeck",
  "San Diego Comic Con Promos", "Secret Lair Drop", "Jumpstart",
  "Booster Battle Pack Packet", "Deck Builder's Toolkit",
]);

let listCache = null;
let listPromise = null;
export function resetPreconCache() {
  listCache = null;
  listPromise = null;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MTGJSON returned ${res.status}`);
  return res.json();
}

// Newest first.
export function cleanDeckList(raw) {
  return (raw || [])
    .filter((d) => d && d.fileName && d.name && !SKIP_TYPES.has(d.type))
    .map((d) => ({
      fileName: d.fileName,
      name: d.name,
      code: d.code,
      type: d.type,
      releaseDate: d.releaseDate || "",
    }))
    .sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || "") || a.name.localeCompare(b.name));
}

export async function fetchPreconList() {
  if (listCache) return listCache;
  if (!listPromise) {
    listPromise = getJson(`${MTGJSON}/DeckList.json`)
      .then((j) => (listCache = cleanDeckList(j.data)))
      .finally(() => (listPromise = null));
  }
  return listPromise;
}

// Name, set, type, or "set code" — every word has to match somewhere.
export function filterPrecons(list, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((d) => {
    const hay = `${d.name} ${d.code} ${d.type}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// A deck file → plain {qty, name, set, num, foil, scryfallId} records, the same
// shape parseDecklist() produces, so the paste importer can take them as-is.
// Commanders come first. Identical printings are merged.
export function preconToRecs(deck) {
  const lists = [deck.commander, deck.mainBoard, deck.sideBoard, deck.planes, deck.schemes];
  const out = [];
  const seen = new Map();
  lists.forEach((list) =>
    (list || []).forEach((c) => {
      const foil = !!(c.isFoil || c.isEtched);
      const rec = {
        qty: c.count || 1,
        name: String(c.name || "").split("//")[0].trim(),
        set: c.setCode ? String(c.setCode).toLowerCase() : null,
        num: c.number != null ? String(c.number) : null,
        foil,
        finish: c.isEtched ? "etched" : foil ? "foil" : "nonfoil",
        scryfallId: c.identifiers?.scryfallId || null,
      };
      if (!rec.name) return;
      const key = `${rec.scryfallId || rec.set + rec.num}|${rec.finish}`;
      if (seen.has(key)) seen.get(key).qty += rec.qty;
      else {
        seen.set(key, rec);
        out.push(rec);
      }
    })
  );
  return out;
}

export async function fetchPrecon(fileName) {
  if (!/^[A-Za-z0-9_-]+$/.test(fileName)) throw new Error("Unknown deck.");
  const j = await getJson(`${MTGJSON}/decks/${fileName}.json`);
  const d = j.data;
  return { name: d.name, code: d.code, type: d.type, releaseDate: d.releaseDate, recs: preconToRecs(d) };
}
