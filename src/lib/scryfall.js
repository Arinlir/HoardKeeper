import { Search } from "lucide-react";
import { CUR } from "./format";
import { packLegalities } from "./formats";
import { MANA } from "./mana";
import { C } from "./tokens";
import { apiUrl } from "./platform";
import { rawCanBeCommander, rawPartner } from "./commander";

export const UNCATEGORIZED = "uncategorized";
export const SOLD = "__sold__";
// Filter sentinel for "show me only the cards I'm running as proxies".
export const PROXY = "__proxy__";
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

// Collector numbers are strings but not purely numeric ("150", "150a", the
// occasional "★7" for a serialized/star-numbered card) — a plain string
// compare would put "10" before "2". Split into a leading digit run (compared
// numerically) plus whatever's left (compared as text) so "9" < "10" < "10a".
export function collectorNumberCompare(a, b) {
  const pa = String(a || "").match(/^(\d*)(.*)$/);
  const pb = String(b || "").match(/^(\d*)(.*)$/);
  const na = pa[1] ? parseInt(pa[1], 10) : NaN;
  const nb = pb[1] ? parseInt(pb[1], 10) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  if (Number.isNaN(na) !== Number.isNaN(nb)) return Number.isNaN(na) ? 1 : -1; // numeric before non-numeric
  return pa[2].localeCompare(pb[2]);
}

// "Sort by code": set code first (the same grouping "By code" lookup and
// the card's own printed corner use), then collector number within a set.
export function codeCompare(a, b) {
  const sc = (a.set || "").localeCompare(b.set || "");
  if (sc !== 0) return sc;
  return collectorNumberCompare(a.collectorNumber, b.collectorNumber);
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

// ---- local card database ----
//
// The server keeps a daily copy of Scryfall's card data (cards-db.cjs) and
// answers the same questions under /api/cards. Every lookup below asks it
// first and falls back to api.scryfall.com when it can't answer: the server
// is still downloading, it's turned off (CARD_DB=off), the app is running
// without a server, the card is newer than today's copy, or the search uses
// syntax the local copy doesn't evaluate. So a local answer is only ever a
// faster version of the same answer, never a different one.

// Read at call time: in the phone app the server can change while it runs.
const local = (p) => apiUrl(`/api/cards${p}`);
const LOCAL_RECHECK_MS = 60 * 1000;
const localState = { ready: false, checkedAt: 0, pending: null };

export async function localCardsReady() {
  if (localState.ready) return true;
  if (localState.pending) return localState.pending;
  if (localState.checkedAt && Date.now() - localState.checkedAt < LOCAL_RECHECK_MS) return false;
  localState.pending = (async () => {
    let ready = false;
    try {
      const res = await scryfallFetch(local("/status"), {}, 4000);
      const d = res && res.ok ? await res.json() : null;
      ready = d?.ready === true;
    } catch (e) {
      ready = false;
    }
    localState.ready = ready;
    localState.checkedAt = Date.now();
    localState.pending = null;
    return ready;
  })();
  return localState.pending;
}

// Forget the cached answer — tests use it to start each scenario fresh.
export function resetLocalCards() {
  localState.ready = false;
  localState.checkedAt = 0;
  localState.pending = null;
}

function localGone() {
  localState.ready = false;
  localState.checkedAt = Date.now();
}

// JSON from the local database, or null for "ask Scryfall instead".
async function localJson(path, opts) {
  if (!(await localCardsReady())) return null;
  try {
    const res = await scryfallFetch(local(path), opts, 8000);
    if (res.status === 503) {
      localGone();
      return null;
    }
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    localGone();
    return null;
  }
}

export async function scryfallLookup(name, set) {
  const localQs = `fuzzy=${encodeURIComponent(name)}` + (set ? `&set=${encodeURIComponent(set)}` : "");
  const hit = await localJson(`/named?${localQs}`);
  if (hit) return normalizeCard(hit);
  let url = `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`;
  if (set) url += `&set=${encodeURIComponent(set)}`;
  const res = await scryfallFetch(url);
  if (!res.ok) throw new Error(`Card not found: ${name}`);
  return normalizeCard(await res.json());
}

export async function scryfallById(id) {
  const hit = await localJson(`/id/${encodeURIComponent(id)}`);
  if (hit) return normalizeCard(hit);
  const res = await scryfallFetch(`${SCRYFALL}/cards/${id}`);
  if (!res.ok) throw new Error("Lookup failed");
  return normalizeCard(await res.json());
}

// Multi-result search: unique='cards' collapses printings for picking a card,
// unique='prints' lists every printing of one card for picking the exact copy.
export async function scryfallSearch(query, unique = "cards", limit = 12) {
  const hit = await localJson(`/search?q=${encodeURIComponent(query)}&unique=${unique}`);
  if (hit?.data?.length) return hit.data.slice(0, limit).map(normalizeCard);
  const order = unique === "prints" ? "released&dir=desc" : "name";
  const res = await scryfallFetch(
    `${SCRYFALL}/cards/search?q=${encodeURIComponent(query)}&unique=${unique}&order=${order}`
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Search failed");
  const d = await res.json();
  return (d.data || []).slice(0, limit).map(normalizeCard);
}

// One page of a search plus the total Scryfall says exists — what the
// full-screen card search needs to print "Total results: 412" and offer the
// rest, where scryfallSearch quietly stops at the first page. A page is up to
// 175 cards; `page` is 1-based.
export async function scryfallSearchPage(query, { unique = "cards", page = 1 } = {}) {
  // An empty local answer still goes to Scryfall: "nothing found" is worth a
  // second opinion (a card newer than today's copy), a hit isn't.
  const hit = await localJson(
    `/search?q=${encodeURIComponent(query)}&unique=${unique}` + (page > 1 ? `&page=${page}` : "")
  );
  if (hit?.data?.length) {
    const cards = hit.data.map(normalizeCard);
    return { cards, total: hit.total_cards ?? cards.length, hasMore: !!hit.has_more };
  }
  const order = unique === "prints" ? "released&dir=desc" : "name";
  const res = await scryfallFetch(
    `${SCRYFALL}/cards/search?q=${encodeURIComponent(query)}&unique=${unique}&order=${order}` +
      (page > 1 ? `&page=${page}` : "")
  );
  if (res.status === 404) return { cards: [], total: 0, hasMore: false };
  if (!res.ok) throw new Error("Search failed");
  const d = await res.json();
  const cards = (d.data || []).map(normalizeCard);
  return { cards, total: d.total_cards ?? cards.length, hasMore: !!d.has_more };
}

// The collector line on a physical card: set code + number, e.g. HOB 0191.
// Scryfall stores numbers without padding, so retry with zeros stripped.
export async function scryfallByCode(set, number) {
  const clean = String(number).trim();
  // the local route strips zero padding itself
  const hit = await localJson(
    `/code/${encodeURIComponent(set.trim().toLowerCase())}/${encodeURIComponent(clean)}`
  );
  if (hit) return normalizeCard(hit);
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

// Resolves up to 75 cards in a single request — same answer shape as
// Scryfall's /cards/collection ({ data, not_found }). The local database
// takes the whole batch first; only what it couldn't find goes to Scryfall.
export async function scryfallCollection(identifiers) {
  const local = await localJson("/collection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers }),
  });
  if (!local || !Array.isArray(local.data)) return scryfallCollectionRemote(identifiers);
  const missing = local.not_found || [];
  if (missing.length === 0) return { data: local.data, not_found: [] };
  try {
    const rest = await scryfallCollectionRemote(missing);
    return { data: [...local.data, ...(rest.data || [])], not_found: rest.not_found || [] };
  } catch (e) {
    // Scryfall unreachable: what the local copy found is still good
    if (local.data.length === 0) throw e;
    return { data: local.data, not_found: missing };
  }
}

// Straight to Scryfall. Retries once on rate limiting.
async function scryfallCollectionRemote(identifiers, attempt = 0) {
  const res = await scryfallFetch(`${SCRYFALL}/cards/collection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers }),
  });
  if (res.status === 429 && attempt === 0) {
    await sleep(2500);
    return scryfallCollectionRemote(identifiers, 1);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.details || `Scryfall returned ${res.status}`);
  }
  return res.json();
}

export function normalizeCard(data) {
  const face = data.card_faces?.[0];
  // Transform cards, modal DFCs, reversible cards and art-series cards carry a
  // second face with its own artwork. Scryfall puts one image per face rather
  // than one per card, so the back has to be kept alongside the front or it's
  // simply lost — see hasBackFace/CardArt for how it's shown.
  const back = data.card_faces?.[1];
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
    imageUrlBack:
      back?.image_uris?.normal ||
      back?.image_uris?.large ||
      null,
    imageUrlBackLarge:
      back?.image_uris?.large ||
      back?.image_uris?.png ||
      back?.image_uris?.normal ||
      null,
    layout: data.layout || null,
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
    eurEtched: data.prices?.eur_etched ? parseFloat(data.prices.eur_etched) : null,
    // Packed to one letter per format; see lib/formats.js.
    legalities: packLegalities(data.legalities),
    cmc: data.cmc ?? face?.cmc ?? 0,
    // The printed cost, e.g. "{2}{G}{G}" — what the mana base check counts
    // pips from. cmc alone can't tell {4}{G} from {2}{G}{G}{G}.
    manaCost: data.mana_cost || face?.mana_cost || "",
    typeLine: data.type_line || face?.type_line || "",
    colors: data.color_identity || [],
    rarity: data.rarity || "",
    scryfallId: data.id,
    artist: data.artist || face?.artist || null,
    // "YYYY-MM-DD" — sorts fine as plain strings, no Date parsing needed.
    releasedAt: data.released_at || null,
    // Legendary creature, or rules text saying "can be your commander"
    // (planeswalker commanders like Jace, Multiverse Architect). See
    // lib/commander.js — the type line alone misses the second kind.
    canBeCommander: rawCanBeCommander(data),
    // Partner / Partner with / Partner—Character select / Choose a
    // Background … — null when it has none. See lib/commander.js canPair.
    partner: rawPartner(data),
  };
}

// The three ways a "pick a printing" list can be ordered — same options
// wherever the app lets you choose a specific printing (adding a card,
// wishlisting one, fixing a mismatched printing on a card you already own).
export const PRINT_SORTS = [
  { key: "released", label: "Release date" },
  { key: "price", label: "Price" },
  { key: "set", label: "Set name" },
];

// Sorts a list of normalized cards (same shape as normalizeCard's return) by
// one of PRINT_SORTS' keys. A card with no price for the "price" sort always
// sorts to the end regardless of direction — an unknown price isn't "cheap"
// or "expensive", it just doesn't belong ranked either way.
export function sortPrintings(list, sortKey = "released", dir = "desc") {
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    if (sortKey === "price") {
      // Plain nonfoil price on your chosen market — the figure every printing
      // picker shows next to each row, not a foil/etched variant nothing here
      // has chosen.
      const av = printingPrice(a);
      const bv = printingPrice(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * sign;
    }
    if (sortKey === "set") {
      return (a.setName || "").localeCompare(b.setName || "") * sign;
    }
    // "released" — ISO date strings compare correctly as plain text.
    return (a.releasedAt || "").localeCompare(b.releasedAt || "") * sign;
  });
}

// Case-insensitive match against a printing's set name or code — what the
// "Search printings…" box filters on.
export function printingMatches(p, text) {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  return (p.setName || "").toLowerCase().includes(q) || (p.set || "").toLowerCase().includes(q);
}

export const FINISHES = [
  { key: "nonfoil", label: "Normal" },
  { key: "foil", label: "Foil" },
  { key: "etched", label: "Etched" },
];

// A card is two-sided to us when we actually hold a picture of its back. Cards
// added before back faces were kept don't have one until their next price/art
// refresh, which is exactly the right answer: nothing to flip to yet.
export function hasBackFace(card) {
  return !!card?.imageUrlBack;
}

// Older cards only stored a boolean. Read through it so nothing needs migrating.
export function finishOf(card) {
  if (card?.finish) return card.finish;
  return card?.foil ? "foil" : "nonfoil";
}

export function usdForFinish(card) {
  const f = finishOf(card);
  if (f === "foil") return card.usdFoil ?? card.usd ?? null;
  if (f === "etched") return card.usdEtched ?? card.usdFoil ?? card.usd ?? null;
  return card.usd ?? null;
}

// Cardmarket's own euro price for this printing, which is a real market price
// rather than a dollar figure run through today's exchange rate. Europe buys
// on Cardmarket, so for a European collection this is the truer number.
export function eurForFinish(card) {
  const f = finishOf(card);
  if (f === "foil") return card.eurFoil ?? card.eur ?? null;
  if (f === "etched") return card.eurEtched ?? card.eurFoil ?? card.eur ?? null;
  return card.eur ?? null;
}

/*
 * One market's price for this copy, in that market's own currency (euros for
 * Cardmarket, dollars for TCGplayer), or null if that market has none.
 */
export function marketPrice(card, source) {
  if (!card) return null;
  const v = source === "cardmarket" ? eurForFinish(card) : usdForFinish(card);
  return v === undefined ? null : v;
}

/*
 * The same, in the dollars everything else in the app is denominated in.
 * Cardmarket's euros are divided back through today's rate, so that fmt()
 * multiplying by that same rate lands on Cardmarket's price exactly — and
 * shown in koruna, it is Cardmarket's euro price at today's EUR/CZK cross.
 */
export function marketPriceUsd(card, source) {
  const v = marketPrice(card, source);
  if (v === null) return null;
  if (source === "cardmarket") return CUR.eurRate ? v / CUR.eurRate : null;
  return v;
}

export function activeSource() {
  return CUR.source === "cardmarket" ? "cardmarket" : "tcgplayer";
}

export function otherSource(source) {
  return source === "cardmarket" ? "tcgplayer" : "cardmarket";
}

/*
 * What one copy is worth, in dollars, priced on the market chosen in
 * Settings. When that market has no price for this printing, the other
 * market's is used rather than calling the card worthless — see
 * priceSourceOf() for telling which one a figure came from.
 *
 * Every sum, sort and chart keeps working in one currency, and what you read
 * is the price you'd actually pay on the market you buy from.
 */
// The nonfoil price of a printing, as the printing pickers list it.
export function printingPrice(p) {
  if (!p) return null;
  return priceForFinish({ ...p, finish: "nonfoil", foil: false });
}

export function priceForFinish(card) {
  const src = activeSource();
  const v = marketPriceUsd(card, src);
  if (v !== null) return v;
  return marketPriceUsd(card, otherSource(src));
}

// Which market the figure priceForFinish gave actually came from, or null.
export function priceSourceOf(card) {
  const src = activeSource();
  if (marketPriceUsd(card, src) !== null) return src;
  if (marketPriceUsd(card, otherSource(src)) !== null) return otherSource(src);
  return null;
}

/*
 * The price as it stood before the last refresh, on the same market as now —
 * both figures from one market, or neither, so a card that only just gained a
 * Cardmarket price doesn't read as having jumped by the euro/dollar gap.
 * Returns { prev, now } in dollars, or null.
 */
export function priceMove(card) {
  const prevCard = {
    finish: card.finish,
    foil: card.foil,
    usd: card.prevUsd,
    usdFoil: card.prevUsdFoil,
    usdEtched: card.prevUsdEtched ?? card.prevUsdFoil,
    eur: card.prevEur,
    eurFoil: card.prevEurFoil,
    eurEtched: card.prevEurEtched ?? card.prevEurFoil,
  };
  const src = activeSource();
  for (const s of [src, otherSource(src)]) {
    const prev = marketPriceUsd(prevCard, s);
    const now = marketPriceUsd(card, s);
    if (prev !== null && now !== null) return { prev, now };
  }
  return null;
}

// Everything a fresh Scryfall lookup carries about price, for copying onto a
// card. The old figures are kept as prev* so Movers can compare.
export function pricePatch(card, fresh) {
  return {
    prevUsd: card?.usd ?? null,
    prevUsdFoil: card?.usdFoil ?? null,
    prevUsdEtched: card?.usdEtched ?? null,
    prevEur: card?.eur ?? null,
    prevEurFoil: card?.eurFoil ?? null,
    prevEurEtched: card?.eurEtched ?? null,
    usd: fresh.usd ?? null,
    usdFoil: fresh.usdFoil ?? null,
    usdEtched: fresh.usdEtched ?? null,
    eur: fresh.eur ?? null,
    eurFoil: fresh.eurFoil ?? null,
    eurEtched: fresh.eurEtched ?? null,
  };
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
    // v4: combo_piece alone was too wide a net. Scryfall files a lot more
    // than "extra physical things to bring" under that bucket — a Partner
    // commander, or any card simply referenced by name in another's rules
    // text, comes back as combo_piece too, and those are real Magic cards
    // you already own or need to draft, not something to pull out of a
    // token box. The only combo_piece entries actually worth surfacing here
    // are the ones that AREN'T normal cards — dungeons, emblems, sticker
    // sheets — identifiable by their own type line rather than by component
    // alone. token stays unconditional since that component is already
    // exactly what it says.
    cache = JSON.parse(localStorage.getItem("lf-oracle-v4")) || {};
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
          // "Tokens to bring" needs the physical extras a deck's cards call
          // for at the table — tokens, plus the non-token objects that live
          // under Scryfall's combo_piece bucket alongside real referenced
          // cards: dungeons a venture card can enter (Tomb of Annihilation),
          // emblems, sticker sheets. Recognized by type line, not just
          // component, so a Partner commander or any other real card
          // combo_piece happens to name doesn't sneak in as something to
          // "bring". meld_part/meld_result stay excluded too: the same
          // card's other half, not something extra.
          parts: (raw.all_parts || [])
            .filter(
              (p) =>
                p.component === "token" ||
                (p.component === "combo_piece" && /^(Dungeon|Emblem|Stickers?)\b/i.test(p.type_line || ""))
            )
            .map((p) => ({ id: p.id, name: p.name, ty: p.type_line || "" })),
        };
      });
    } catch (e) {
      // leave missing; drafter degrades gracefully
    }
    await sleep(RATE_MS);
  }
  try {
    localStorage.setItem("lf-oracle-v4", JSON.stringify(cache));
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
