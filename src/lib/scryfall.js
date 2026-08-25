import { Search } from "lucide-react";
import { MANA } from "./mana";
import { C } from "./tokens";

export const UNCATEGORIZED = "uncategorized";
export const SOLD = "__sold__";
export const RARITY_GROUP_ORDER = ["mythic", "rare", "uncommon", "common"];
export const RARITY_GROUP_LABELS = ["Mythic", "Rare", "Uncommon", "Common"];

export const TYPE_FILTERS = [
  "Creature",
  "Land",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Planeswalker",
  "Battle",
];

export function cardTypes(card) {
  const t = (card.typeLine || "").split("//")[0].toLowerCase();
  return TYPE_FILTERS.filter((f) => t.includes(f.toLowerCase()));
}



export const COLOR_BUCKETS = [
  { key: "W", label: "White", fill: MANA.W },
  { key: "U", label: "Blue", fill: MANA.U },
  { key: "B", label: "Black", fill: MANA.B },
  { key: "R", label: "Red", fill: MANA.R },
  { key: "G", label: "Green", fill: MANA.G },
  { key: "M", label: "Multicolor", fill: "#C9A227" },
  { key: "C", label: "Colorless", fill: "#7A7263" },
];

export function bucketOf(card) {
  const cols = card.colors || [];
  if (cols.length === 0) return "C";
  if (cols.length > 1) return "M";
  return cols[0];
}

export const SCRYFALL = "https://api.scryfall.com";

// Scryfall asks for a small delay between requests. Be a good citizen.
export const RATE_MS = 100;

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// A fetch that cannot hang: 20s and it throws instead of wedging the caller.
export async function scryfallFetch(url, opts = {}, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "Scryfall request timed out" : e.message);
  } finally {
    clearTimeout(t);
  }
}

export async function scryfallLookup(name, set) {
  let url = `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`;
  if (set) url += `&set=${encodeURIComponent(set)}`;
  const res = await scryfallFetch(url);
  if (!res.ok) throw new Error(`Card not found: ${name}`);
  return normalizeCard(await res.json());
}

export async function scryfallById(id) {
  const res = await scryfallFetch(`${SCRYFALL}/cards/${id}`);
  if (!res.ok) throw new Error("Lookup failed");
  return normalizeCard(await res.json());
}

// Multi-result search: unique='cards' collapses printings for picking a card,
// unique='prints' lists every printing of one card for picking the exact copy.
export async function scryfallSearch(query, unique = "cards", limit = 12) {
  const order = unique === "prints" ? "released&dir=desc" : "name";
  const res = await scryfallFetch(
    `${SCRYFALL}/cards/search?q=${encodeURIComponent(query)}&unique=${unique}&order=${order}`
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Search failed");
  const d = await res.json();
  return (d.data || []).slice(0, limit).map(normalizeCard);
}

// The collector line on a physical card: set code + number, e.g. HOB 0191.
// Scryfall stores numbers without padding, so retry with zeros stripped.
export async function scryfallByCode(set, number) {
  const clean = String(number).trim();
  const tryOne = async (n) => {
    const res = await scryfallFetch(`${SCRYFALL}/cards/${encodeURIComponent(set.trim().toLowerCase())}/${encodeURIComponent(n)}`);
    if (!res.ok) return null;
    return normalizeCard(await res.json());
  };
  let card = await tryOne(clean);
  if (!card && /^0+\d/.test(clean)) card = await tryOne(clean.replace(/^0+/, ""));
  if (!card) throw new Error(`No card ${clean} in set ${set.toUpperCase()}`);
  return card;
}

// Resolves up to 75 cards in a single request. Retries once on rate limiting.
export async function scryfallCollection(identifiers, attempt = 0) {
  const res = await scryfallFetch(`${SCRYFALL}/cards/collection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers }),
  });
  if (res.status === 429 && attempt === 0) {
    await sleep(2500);
    return scryfallCollection(identifiers, 1);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.details || `Scryfall returned ${res.status}`);
  }
  return res.json();
}

export function normalizeCard(data) {
  const face = data.card_faces?.[0];
  return {
    name: data.name,
    set: data.set,
    setName: data.set_name,
    collectorNumber: data.collector_number,
    imageUrl:
      data.image_uris?.normal ||
      face?.image_uris?.normal ||
      data.image_uris?.large ||
      null,
    imageUrlLarge:
      data.image_uris?.large ||
      face?.image_uris?.large ||
      data.image_uris?.png ||
      face?.image_uris?.png ||
      data.image_uris?.normal ||
      face?.image_uris?.normal ||
      null,
    scryfallUri: data.scryfall_uri || null,
    usd: data.prices?.usd ? parseFloat(data.prices.usd) : null,
    usdFoil: data.prices?.usd_foil ? parseFloat(data.prices.usd_foil) : null,
    usdEtched: data.prices?.usd_etched ? parseFloat(data.prices.usd_etched) : null,
    // which finishes this printing was actually made in
    finishes: data.finishes || (data.foil ? ["nonfoil", "foil"] : ["nonfoil"]),
    // treatments belong to the printing, not to your copy — shown, not chosen
    frameEffects: data.frame_effects || [],
    promoTypes: data.promo_types || [],
    borderColor: data.border_color || null,
    fullArt: !!data.full_art,
    eur: data.prices?.eur ? parseFloat(data.prices.eur) : null,
    eurFoil: data.prices?.eur_foil ? parseFloat(data.prices.eur_foil) : null,
    cmc: data.cmc ?? face?.cmc ?? 0,
    typeLine: data.type_line || face?.type_line || "",
    colors: data.color_identity || [],
    rarity: data.rarity || "",
    scryfallId: data.id,
    artist: data.artist || face?.artist || null,
  };
}

export const FINISHES = [
  { key: "nonfoil", label: "Normal" },
  { key: "foil", label: "Foil" },
  { key: "etched", label: "Etched" },
];

// Older cards only stored a boolean. Read through it so nothing needs migrating.
export function finishOf(card) {
  if (card?.finish) return card.finish;
  return card?.foil ? "foil" : "nonfoil";
}

export function priceForFinish(card) {
  const f = finishOf(card);
  if (f === "foil") return card.usdFoil ?? card.usd ?? null;
  if (f === "etched") return card.usdEtched ?? card.usdFoil ?? card.usd ?? null;
  return card.usd ?? null;
}

// Which finishes this printing exists in. Unknown means we only have the older
// data, so offer normal and foil rather than guessing.
export function availableFinishes(card) {
  const f = card?.finishes;
  if (Array.isArray(f) && f.length) return f;
  return card?.usdEtched ? ["nonfoil", "foil", "etched"] : ["nonfoil", "foil"];
}

export const FRAME_LABELS = {
  showcase: "Showcase",
  extendedart: "Extended art",
  inverted: "Inverted",
  legendary: "Legendary frame",
  etched: "Etched frame",
  fullart: "Full art",
  colorshifted: "Colorshifted",
  companion: "Companion",
  miracle: "Miracle",
  nyxtouched: "Nyx-touched",
  devoid: "Devoid",
  snow: "Snow",
  shatteredglass: "Shattered glass",
};

export const PROMO_LABELS = {
  serialized: "Serialized",
  surgefoil: "Surge foil",
  galaxyfoil: "Galaxy foil",
  halofoil: "Halo foil",
  textured: "Textured foil",
  oilslick: "Oil slick",
  confettifoil: "Confetti foil",
  gilded: "Gilded",
  stepandcompleat: "Step-and-compleat",
  neonink: "Neon ink",
  raisedfoil: "Raised foil",
  ripplefoil: "Ripple foil",
  doublerainbow: "Double rainbow",
  prerelease: "Prerelease",
  promopack: "Promo pack",
};

// Human-readable tags describing the printing you own. Derived from Scryfall,
// so they're shown rather than chosen — a borderless card is a different
// printing with its own collector number, not a checkbox on this one.
export function treatmentTags(card) {
  const out = [];
  (card.frameEffects || []).forEach((f) => out.push(FRAME_LABELS[f] || f));
  if (card.borderColor === "borderless") out.push("Borderless");
  if (card.fullArt) out.push("Full art");
  (card.promoTypes || []).forEach((p) => {
    if (PROMO_LABELS[p]) out.push(PROMO_LABELS[p]);
  });
  return [...new Set(out)];
}

export async function fetchOracleTexts(scryfallIds) {
  let cache = {};
  try {
    // v2 also records the tokens each card makes, so the key is bumped to
    // force one refetch rather than silently serving incomplete entries.
    cache = JSON.parse(localStorage.getItem("lf-oracle-v2")) || {};
  } catch (e) {}
  const missing = scryfallIds.filter((id) => id && !cache[id]);
  for (let i = 0; i < missing.length; i += 75) {
    const chunk = missing.slice(i, i + 75);
    try {
      const data = await scryfallCollection(chunk.map((id) => ({ id })));
      (data.data || []).forEach((raw) => {
        const text =
          raw.oracle_text ||
          (raw.card_faces || []).map((f) => f.oracle_text || "").join("\n");
        cache[raw.id] = {
          t: text || "",
          ty: raw.type_line || "",
          // Scryfall lists related cards; the token ones are what a deck needs
          // to have on hand.
          parts: (raw.all_parts || [])
            .filter((p) => p.component === "token")
            .map((p) => ({ id: p.id, name: p.name, ty: p.type_line || "" })),
        };
      });
    } catch (e) {
      // leave missing; drafter degrades gracefully
    }
    await sleep(RATE_MS);
  }
  try {
    localStorage.setItem("lf-oracle-v2", JSON.stringify(cache));
  } catch (e) {}
  return cache;
}

// Token cards themselves, for artwork. Cached separately and indefinitely —
// token printings don't change.
export async function fetchTokenCards(ids) {
  let cache = {};
  try {
    cache = JSON.parse(localStorage.getItem("lf-tokens")) || {};
  } catch (e) {}
  const missing = ids.filter((id) => id && !cache[id]);
  for (let i = 0; i < missing.length; i += 75) {
    const chunk = missing.slice(i, i + 75);
    try {
      const data = await scryfallCollection(chunk.map((id) => ({ id })));
      (data.data || []).forEach((raw) => {
        const c = normalizeCard(raw);
        cache[raw.id] = {
          name: c.name,
          typeLine: c.typeLine,
          imageUrl: c.imageUrl,
          set: c.set,
          collectorNumber: c.collectorNumber,
          scryfallUri: c.scryfallUri,
          power: raw.power ?? null,
          toughness: raw.toughness ?? null,
          colors: c.colors,
        };
      });
    } catch (e) {}
    await sleep(RATE_MS);
  }
  try {
    localStorage.setItem("lf-tokens", JSON.stringify(cache));
  } catch (e) {}
  return cache;
}

// ---- role classification from oracle text ----
