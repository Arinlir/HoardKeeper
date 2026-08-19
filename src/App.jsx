import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Plus, Upload, RefreshCw, Search, X, TrendingUp, TrendingDown,
  Sparkles, Trash2, Pencil, Download, Layers, ChevronDown, Check,
  AlertCircle, Loader2, LibraryBig, BarChart3, Coins, CheckSquare, Square, MapPin, Tag,
  RotateCcw, RotateCw, Swords, Users, Settings, Heart, Palette, Copy,
  Grid3x3, LayoutGrid, Maximize2
} from "lucide-react";
import Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, Cell, Tooltip, ResponsiveContainer,
  PieChart, Pie, CartesianGrid, Legend, LineChart, Line, Area, AreaChart
} from "recharts";

const C = {
  // silvered playmat: graphite felt, white card stock, silver stitching
  bg: "#191B1E",
  bgPanel: "#212428",
  bgPanel2: "#26292E",
  border: "#3A3E45",
  borderLight: "#4C515A",
  gold: "#B9BFC7",          // "gold" slot now carries the silver accent
  goldBright: "#E8ECF1",
  parchment: "#D9DCE0",
  parchmentDim: "#8B9097",
  green: "#3E7D55",
  greenBright: "#84C7A0",
  red: "#8B2635",
  redBright: "#DE7386",
  // card stock
  stock: "#F2F3F1",
  stockDark: "#DFE1DE",
  stockInk: "#1B1D20",
  stockDim: "#6F747C",
  // rarity (the one place warm metal survives, as data)
  rarityCommon: "#71767E",
  rarityUncommon: "#9FB2BF",
  rarityRare: "#C9A227",
  rarityMythic: "#D2691E",
};

// shared cardstock plaque surface
const STOCK_BG = `linear-gradient(180deg, ${C.stock}, ${C.stockDark})`;
const STOCK_SHADOW = `inset 0 0 0 1px rgba(40,44,50,0.4), 0 2px 0 rgba(0,0,0,0.35)`;

const MANA = {
  W: "#F1E6B6",
  U: "#3E9CE0",
  B: "#8B7FB0",
  R: "#E0563C",
  G: "#3FA35C",
};

const UNCATEGORIZED = "uncategorized";
const SOLD = "__sold__";
const RARITY_GROUP_ORDER = ["mythic", "rare", "uncommon", "common"];
const RARITY_GROUP_LABELS = ["Mythic", "Rare", "Uncommon", "Common"];

const TYPE_FILTERS = [
  "Creature",
  "Land",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Planeswalker",
  "Battle",
];

function cardTypes(card) {
  const t = (card.typeLine || "").split("//")[0].toLowerCase();
  return TYPE_FILTERS.filter((f) => t.includes(f.toLowerCase()));
}



const COLOR_BUCKETS = [
  { key: "W", label: "White", fill: MANA.W },
  { key: "U", label: "Blue", fill: MANA.U },
  { key: "B", label: "Black", fill: MANA.B },
  { key: "R", label: "Red", fill: MANA.R },
  { key: "G", label: "Green", fill: MANA.G },
  { key: "M", label: "Multicolor", fill: "#C9A227" },
  { key: "C", label: "Colorless", fill: "#7A7263" },
];

function bucketOf(card) {
  const cols = card.colors || [];
  if (cols.length === 0) return "C";
  if (cols.length > 1) return "M";
  return cols[0];
}

const SCRYFALL = "https://api.scryfall.com";

// Scryfall asks for a small delay between requests. Be a good citizen.
const RATE_MS = 100;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// A fetch that cannot hang: 20s and it throws instead of wedging the caller.
async function scryfallFetch(url, opts = {}, timeoutMs = 20000) {
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

async function scryfallLookup(name, set) {
  let url = `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`;
  if (set) url += `&set=${encodeURIComponent(set)}`;
  const res = await scryfallFetch(url);
  if (!res.ok) throw new Error(`Card not found: ${name}`);
  return normalizeCard(await res.json());
}

async function scryfallById(id) {
  const res = await scryfallFetch(`${SCRYFALL}/cards/${id}`);
  if (!res.ok) throw new Error("Lookup failed");
  return normalizeCard(await res.json());
}

// Multi-result search: unique='cards' collapses printings for picking a card,
// unique='prints' lists every printing of one card for picking the exact copy.
async function scryfallSearch(query, unique = "cards", limit = 12) {
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
async function scryfallByCode(set, number) {
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
async function scryfallCollection(identifiers, attempt = 0) {
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

function normalizeCard(data) {
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

const FINISHES = [
  { key: "nonfoil", label: "Normal" },
  { key: "foil", label: "Foil" },
  { key: "etched", label: "Etched" },
];

// Older cards only stored a boolean. Read through it so nothing needs migrating.
function finishOf(card) {
  if (card?.finish) return card.finish;
  return card?.foil ? "foil" : "nonfoil";
}

function priceForFinish(card) {
  const f = finishOf(card);
  if (f === "foil") return card.usdFoil ?? card.usd ?? null;
  if (f === "etched") return card.usdEtched ?? card.usdFoil ?? card.usd ?? null;
  return card.usd ?? null;
}

// Which finishes this printing exists in. Unknown means we only have the older
// data, so offer normal and foil rather than guessing.
function availableFinishes(card) {
  const f = card?.finishes;
  if (Array.isArray(f) && f.length) return f;
  return card?.usdEtched ? ["nonfoil", "foil", "etched"] : ["nonfoil", "foil"];
}

const FRAME_LABELS = {
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

const PROMO_LABELS = {
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
function treatmentTags(card) {
  const out = [];
  (card.frameEffects || []).forEach((f) => out.push(FRAME_LABELS[f] || f));
  if (card.borderColor === "borderless") out.push("Borderless");
  if (card.fullArt) out.push("Full art");
  (card.promoTypes || []).forEach((p) => {
    if (PROMO_LABELS[p]) out.push(PROMO_LABELS[p]);
  });
  return [...new Set(out)];
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Storage: localStorage by default. When the app is served by server.js the
// boot sequence detects /api/health and switches to per-profile server storage,
// so collections follow the profile rather than the browser.
const store = {
  mode: "local",
  profile: null,
  pin: "",
  configure(mode, profile, pin) {
    this.mode = mode;
    this.profile = profile || null;
    this.pin = pin || "";
  },
  async get(key) {
    if (this.mode === "accounts") {
      const res = await fetch("/api/store", {
        credentials: "same-origin",
        headers: { "x-hk-app": "1" },
      });
      if (res.status === 401) throw new Error("signed-out");
      if (!res.ok) throw new Error("store get failed");
      const d = await res.json();
      return d.value === null ? null : { key, value: d.value };
    }
    if (this.mode === "server" && this.profile) {
      const res = await fetch(`/api/store/${this.profile}`, {
        headers: { "x-pin": this.pin },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("store get failed");
      const d = await res.json();
      return d.value === null ? null : { key, value: d.value };
    }
    const value = localStorage.getItem(key);
    return value === null ? null : { key, value };
  },
  async set(key, value) {
    if (this.mode === "accounts") {
      const res = await fetch("/api/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-hk-app": "1" },
        credentials: "same-origin",
        body: JSON.stringify({ value }),
      });
      return res.ok ? { key, value } : null;
    }
    if (this.mode === "server" && this.profile) {
      const res = await fetch(`/api/store/${this.profile}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-pin": this.pin },
        body: JSON.stringify({ value, pin: this.pin }),
      });
      return res.ok ? { key, value } : null;
    }
    try {
      localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
};

// Display currency is global so every panel formats consistently.
// All figures are stored in USD; EUR and CZK are
// conversions using rates you set in Settings.
const CUR = {
  code: "USD",
  czkRate: 23,
  eurRate: 0.92,
};

const CURRENCIES = {
  USD: { symbol: "$", label: "US Dollar" },
  EUR: { symbol: "€", label: "Euro" },
  CZK: { symbol: "Kč", label: "Czech koruna" },
};

function convert(usdAmount) {
  if (usdAmount === null || usdAmount === undefined || isNaN(usdAmount)) return null;
  if (CUR.code === "USD") return usdAmount;
  if (CUR.code === "EUR") return usdAmount * CUR.eurRate;
  return usdAmount * CUR.czkRate;
}

// Turns an amount typed in the display currency back into the USD we store.
function unconvert(displayAmount) {
  if (displayAmount === null || displayAmount === undefined || isNaN(displayAmount)) return null;
  if (CUR.code === "USD") return displayAmount;
  if (CUR.code === "EUR") return CUR.eurRate ? displayAmount / CUR.eurRate : displayAmount;
  return CUR.czkRate ? displayAmount / CUR.czkRate : displayAmount;
}

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const v = convert(n);
  if (CUR.code === "CZK") {
    return `${Math.round(v).toLocaleString()} Kč`;
  }
  return v.toLocaleString(undefined, { style: "currency", currency: CUR.code });
}

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function shortDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

const RARITY_COLORS = {
  common: "#8C8778",
  uncommon: "#A8B4BE",
  rare: "#C9A227",
  mythic: "#D4622B",
  special: "#9B6BB5",
  bonus: "#5FA8A0",
};

export default function App() {
  const [collections, setCollections] = useState([]);
  const [cards, setCards] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // boot: checking -> gate (server, no profile yet) -> ready
  const [boot, setBoot] = useState("checking");
  const [serverMode, setServerMode] = useState(false);
  const [authMode, setAuthMode] = useState("pin");
  const [account, setAccount] = useState(null);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [saveError, setSaveError] = useState(false);

  const [activeFilter, setActiveFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("added");
  const [typeFilter, setTypeFilter] = useState("all");
  // Grid tile size, persisted so a preference sticks across sessions. The
  // minmax() lower bound is what actually controls how many columns fit —
  // bigger tiles mean fewer per row, but the art (and any text on it) reads
  // properly instead of shrinking into an unreadable postage stamp.
  const [tileSize, setTileSize] = useState(() => {
    try {
      return localStorage.getItem("hk-tile-size") || "comfortable";
    } catch (e) {
      return "comfortable";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("hk-tile-size", tileSize);
    } catch (e) {}
  }, [tileSize]);
  const TILE_MIN_PX = { compact: 140, comfortable: 170, large: 230 };
  const [colorFilter, setColorFilter] = useState("all"); // all | W U B R G | M | C
  const [showCharts, setShowCharts] = useState(false);
  const [view, setView] = useState("collection");

  const [showAddCard, setShowAddCard] = useState(false);
  const [scrollToCardId, setScrollToCardId] = useState(null);
  const [scrolledPastHeader, setScrolledPastHeader] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolledPastHeader(window.scrollY > 260);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const [showAddCollection, setShowAddCollection] = useState(false);
  const [showCollections, setShowCollections] = useState(false);
  const [sellCard, setSellCard] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [detailCard, setDetailCard] = useState(null);

  const [refreshing, setRefreshing] = useState(null);

  const [currency, setCurrency] = useState("USD");
  const [czkRate, setCzkRate] = useState(23);
  const [eurRate, setEurRate] = useState(0.92);
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState([]);
  const [decks, setDecks] = useState([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [lastTapped, setLastTapped] = useState(null);
  const [notice, setNotice] = useState("");

  // Applied during render so every fmt() call downstream uses the same currency.
  CUR.code = currency;
  CUR.czkRate = czkRate;
  CUR.eurRate = eurRate;

  // detect server mode, then either restore the saved profile or show the gate
  useEffect(() => {
    (async () => {
      let onServer = false;
      let mode = "pin";
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 1500);
        const res = await fetch("/api/health", { signal: ctl.signal });
        clearTimeout(t);
        // Dev servers answer unknown URLs with the app's HTML and a 200, so a
        // status check alone gets fooled — require the actual JSON handshake.
        if (res.ok) {
          const d = await res.json();
          onServer = d && d.ok === true;
          // the server tells us which sign-in it runs
          mode = d?.mode === "accounts" ? "accounts" : "pin";
          setRegistrationOpen(d?.registration !== false);
        }
      } catch (e) {}
      setServerMode(onServer);
      setAuthMode(mode);
      if (!onServer) {
        setBoot("ready");
        return;
      }
      if (mode === "accounts") {
        try {
          const me = await fetch("/api/auth/me", { credentials: "same-origin" });
          if (me.ok) {
            const d = await me.json();
            setAccount(d.user);
            store.configure("accounts");
            setBoot("ready");
          } else {
            setBoot("auth");
          }
        } catch (e) {
          setBoot("auth");
        }
        return;
      }
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem("lf-profile"));
      } catch (e) {}
      if (saved?.name) {
        store.configure("server", saved.name, saved.pin || "");
        setBoot("ready");
      } else {
        setBoot("gate");
      }
    })();
  }, []);

  // After adding a card and closing the dialog, find its tile once the grid
  // has re-rendered and bring it into view with a brief highlight.
  useEffect(() => {
    if (!scrollToCardId) return;
    const id = scrollToCardId;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-card-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("just-added");
        setTimeout(() => el.classList.remove("just-added"), 1800);
      }
      setScrollToCardId(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToCardId, cards]);

  // load
  useEffect(() => {
    if (boot !== "ready") return;
    (async () => {
      try {
        const res = await store.get("ledger-foil-data");
        if (res && res.value) {
          const d = JSON.parse(res.value);
          setCollections(d.collections || []);
          setCards(d.cards || []);
          if (d.currency) setCurrency(d.currency);
          if (d.czkRate) setCzkRate(d.czkRate);
          if (d.eurRate) setEurRate(d.eurRate);
          setHistory(d.history || []);
          setDecks(d.decks || []);
        }
      } catch (e) {
        // no data yet
      }
      setLoaded(true);
    })();
  }, [boot]);

  // save — debounced and serialized, so rapid edits (typing a rename,
  // several quick card adds) collapse into one write of the latest state
  // instead of firing an overlapping PUT per keystroke. Without this, two
  // in-flight requests over a real network (server/PIN mode, accounts mode)
  // can complete OUT OF ORDER, letting an older payload overwrite a newer
  // one on the server — which looks exactly like edits "reverting" after a
  // reload. saveSeq guards against a slow, now-stale request's completion
  // clobbering the saveError indicator for a save that already succeeded.
  const saveInFlight = useRef(false);
  const savePending = useRef(false);
  const saveSeq = useRef(0);
  const saveTimer = useRef(null);
  // Always holds the CURRENT state, updated every render. runSave reads from
  // this rather than closing over collections/cards/etc directly, so a retry
  // triggered from inside runSave's own finally block (see below) sends the
  // freshest data rather than replaying whatever was current when that
  // particular call started.
  const latestSnapshot = useRef(null);
  latestSnapshot.current = { collections, cards, currency, czkRate, eurRate, history, decks };

  const runSave = useCallback(async () => {
    if (saveInFlight.current) {
      // a save is already on the wire; ask it to run again with whatever's
      // freshest once it finishes, instead of starting an overlapping one
      savePending.current = true;
      return;
    }
    saveInFlight.current = true;
    const mySeq = ++saveSeq.current;
    try {
      const result = await store.set("ledger-foil-data", JSON.stringify(latestSnapshot.current));
      if (mySeq === saveSeq.current) setSaveError(!result);
    } catch (e) {
      if (mySeq === saveSeq.current) setSaveError(true);
    } finally {
      saveInFlight.current = false;
      if (savePending.current) {
        savePending.current = false;
        runSave();
      }
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(runSave, 500);
    return () => clearTimeout(saveTimer.current);
  }, [collections, cards, loaded, currency, czkRate, eurRate, history, decks, runSave]);

  // Import adds this file's spend to an existing collection's invested total.
  function addToCollectionTotal(id, amount) {
    if (!amount) return;
    setCollections((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, purchasePrice: Number(((c.purchasePrice || 0) + amount).toFixed(2)) }
          : c
      )
    );
  }

  // What a newly added card would be allocated from a collection's total.
  // Mirrors allocatedCost, counting the incoming card as one more sharer.
  function allocationPreview(collectionId) {
    if (!collectionId || collectionId === UNCATEGORIZED) return null;
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) return null;
    const stats = collectionStats[collectionId] || { overrideSum: 0, noOverrideCount: 0 };
    const remaining = Math.max(0, (collection.purchasePrice || 0) - stats.overrideSum);
    const sharers = stats.noOverrideCount + 1;
    return { each: remaining / sharers, sharers, total: collection.purchasePrice || 0 };
  }

  // One pass over the collection builds every collection's totals, so pricing
  // a card is a map lookup instead of a fresh scan of the whole collection.
  // allocatedCost used to be O(collection size) per card — O(n²) for the grid
  // as a whole — which is the main thing that made typing in search or
  // toggling a filter feel sluggish once the collection grew past a couple
  // hundred cards.
  const collectionStats = useMemo(() => {
    const m = {};
    cards.forEach((c) => {
      const key = c.collectionId || UNCATEGORIZED;
      const s = (m[key] = m[key] || { overrideSum: 0, noOverrideCount: 0 });
      if (c.costOverride !== null && c.costOverride !== undefined) {
        s.overrideSum += c.costOverride || 0;
      } else {
        s.noOverrideCount += 1;
      }
    });
    return m;
  }, [cards]);

  const collectionNameMap = useMemo(() => {
    const m = {};
    collections.forEach((c) => (m[c.id] = c.name));
    return m;
  }, [collections]);

  // Counts how many un-sold rows share a card name, so the grid can show a
  // "which printing/finish is this" badge specifically when it's actually
  // needed to tell two "Sol Ring" tiles apart — and stay quiet otherwise.
  const nameCounts = useMemo(() => {
    const m = {};
    cards.forEach((c) => {
      if (c.sold) return;
      const key = c.name.toLowerCase();
      m[key] = (m[key] || 0) + 1;
    });
    return m;
  }, [cards]);

  function collectionName(id) {
    if (id === UNCATEGORIZED || !id) return "Uncategorized";
    return collectionNameMap[id] || "Uncategorized";
  }

  function allocatedCost(card) {
    if (card.costOverride !== null && card.costOverride !== undefined) {
      return card.costOverride;
    }
    if (!card.collectionId || card.collectionId === UNCATEGORIZED) return 0;
    const collection = collections.find((c) => c.id === card.collectionId);
    if (!collection) return 0;
    const stats = collectionStats[card.collectionId];
    if (!stats || stats.noOverrideCount === 0) return 0;
    // Individual prices can exceed the collection total (a CSV import with
    // per-card prices, or hand-edited figures). Cost can never be negative, so
    // clamp at zero — otherwise the leftover cards absorb a negative cost and
    // report an enormous phantom gain.
    const remaining = Math.max(0, collection.purchasePrice - stats.overrideSum);
    return remaining / stats.noOverrideCount;
  }

  // How much the individual prices in a collection exceed its stated total.
  // Zero means the books balance.
  function overAllocation(collectionId) {
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) return 0;
    const stats = collectionStats[collectionId];
    return Math.max(0, (stats?.overrideSum || 0) - collection.purchasePrice);
  }

  function currentUnitValue(card) {
    if (card.valueOverride !== null && card.valueOverride !== undefined) {
      return card.valueOverride;
    }
    return priceForFinish(card) ?? 0;
  }

  function saleProceeds(card) {
    if (!card.sold) return 0;
    return (card.soldPrice || 0) * (card.quantity || 1);
  }

  const totals = useMemo(() => {
    let value = 0,
      cost = 0,
      realized = 0,
      realizedCost = 0;
    cards.forEach((c) => {
      if (c.sold) {
        realized += saleProceeds(c);
        realizedCost += allocatedCost(c);
      } else {
        value += currentUnitValue(c) * (c.quantity || 1);
        cost += allocatedCost(c);
      }
    });
    return {
      value,
      cost,
      delta: value - cost,
      realized,
      realizedCost,
      realizedDelta: realized - realizedCost,
    };
  }, [cards, collections]);

  // Art cards vs. everything else, scoped to whatever's currently filtered
  // (a specific collection, "All", a search, etc). Computed separately from
  // `filtered` itself so the "does this scope even have any art cards"
  // question doesn't depend on which sub-tab is currently selected.
  const [cardsSubView, setCardsSubView] = useState("cards"); // "cards" | "art"
  const hasArtInScope = useMemo(() => {
    let list = activeFilter === SOLD ? cards.filter((c) => c.sold) : cards.filter((c) => !c.sold);
    if (activeFilter !== "all" && activeFilter !== SOLD) {
      list = list.filter((c) => (c.collectionId || UNCATEGORIZED) === activeFilter);
    }
    if (typeFilter !== "all") list = list.filter((c) => cardTypes(c).includes(typeFilter));
    if (colorFilter !== "all") list = list.filter((c) => bucketOf(c) === colorFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list.some((c) => c.isArt);
  }, [cards, activeFilter, typeFilter, colorFilter, search]);
  // Don't get stuck on the Art Cards sub-tab showing an empty grid after
  // switching to a collection (or filter) that has none.
  useEffect(() => {
    if (!hasArtInScope && cardsSubView === "art") setCardsSubView("cards");
  }, [hasArtInScope, cardsSubView]);

  const filtered = useMemo(() => {
    let list = activeFilter === SOLD ? cards.filter((c) => c.sold) : cards.filter((c) => !c.sold);
    if (activeFilter !== "all" && activeFilter !== SOLD) {
      list = list.filter(
        (c) => (c.collectionId || UNCATEGORIZED) === activeFilter
      );
    }
    if (typeFilter !== "all") {
      list = list.filter((c) => cardTypes(c).includes(typeFilter));
    }
    if (colorFilter !== "all") {
      list = list.filter((c) => bucketOf(c) === colorFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    // Art cards get their own sub-tab instead of being mixed into the main
    // grid — only actually split when there's something to split (a
    // collection with no art cards renders exactly as before).
    if (hasArtInScope) {
      list = list.filter((c) => (cardsSubView === "art" ? c.isArt : !c.isArt));
    }
    list = [...list];
    if (sortBy === "name" || sortBy === "alpha-grouped")
      list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "value-desc")
      list.sort(
        (a, b) =>
          currentUnitValue(b) * b.quantity - currentUnitValue(a) * a.quantity
      );
    else if (sortBy === "value-asc")
      list.sort(
        (a, b) =>
          currentUnitValue(a) * a.quantity - currentUnitValue(b) * b.quantity
      );
    else if (sortBy === "gain")
      list.sort((a, b) => {
        const da = currentUnitValue(a) * a.quantity - allocatedCost(a);
        const db = currentUnitValue(b) * b.quantity - allocatedCost(b);
        return db - da;
      });
    else if (sortBy === "rarity-grouped")
      list.sort((a, b) => {
        const ra = RARITY_GROUP_ORDER.indexOf((a.rarity || "").toLowerCase());
        const rb = RARITY_GROUP_ORDER.indexOf((b.rarity || "").toLowerCase());
        const oa = ra === -1 ? RARITY_GROUP_ORDER.length : ra;
        const ob = rb === -1 ? RARITY_GROUP_ORDER.length : rb;
        return oa - ob || a.name.localeCompare(b.name);
      });
    else list.sort((a, b) => (b.added || 0) - (a.added || 0));
    return list;
  }, [cards, activeFilter, search, sortBy, typeFilter, colorFilter, collections, hasArtInScope, cardsSubView]);

  // Section headers for the two grouped views. Built from `filtered`, which
  // is already sorted correctly for grouping (alphabetical or rarity order)
  // above — this just finds where one group ends and the next begins.
  const groupedSections = useMemo(() => {
    if (sortBy === "alpha-grouped") {
      const groups = [];
      let current = null;
      filtered.forEach((c) => {
        const first = c.name.trim()[0]?.toUpperCase() || "#";
        const key = /[A-Z]/.test(first) ? first : "#";
        if (!current || current.label !== key) {
          current = { label: key, cards: [] };
          groups.push(current);
        }
        current.cards.push(c);
      });
      return groups;
    }
    if (sortBy === "rarity-grouped") {
      const groups = [];
      let current = null;
      filtered.forEach((c) => {
        const idx = RARITY_GROUP_ORDER.indexOf((c.rarity || "").toLowerCase());
        const key = idx === -1 ? "Other" : RARITY_GROUP_LABELS[idx];
        if (!current || current.label !== key) {
          current = { label: key, cards: [] };
          groups.push(current);
        }
        current.cards.push(c);
      });
      return groups;
    }
    return null;
  }, [filtered, sortBy]);

  // A card counts as "the same copy" you already own when it's the same
  // printing (matched by Scryfall ID, or by set + collector number when
  // that's missing) AND the same finish — a foil and a nonfoil of the same
  // card are genuinely different objects worth their own rows, but two
  // nonfoil adds of the same printing are just... more of the one you have.
  function findMatchingCard(cardData) {
    const finish = cardData.finish || (cardData.foil ? "foil" : "nonfoil");
    return cards.find((c) => {
      if (c.sold) return false;
      if (finishOf(c) !== finish) return false;
      // A signed art card and an unsigned one look identical to Scryfall
      // (it doesn't track the distinction at all) but they're worth
      // tracking as separate rows, same reasoning as finish above — don't
      // let a signed pull silently merge into an existing unsigned row.
      if (!!c.signed !== !!cardData.signed) return false;
      if (cardData.scryfallId && c.scryfallId) return c.scryfallId === cardData.scryfallId;
      return (
        !!cardData.set &&
        !!cardData.collectorNumber &&
        c.set === cardData.set &&
        c.collectorNumber === cardData.collectorNumber
      );
    });
  }

  // Returns { id, merged } — merged is true when this bumped an existing
  // row's quantity rather than creating a new one, so callers (the add
  // dialog's "added this session" list, the scroll-to-card highlight) can
  // point at the right card either way.
  function addCard(cardData) {
    const existing = findMatchingCard(cardData);
    if (existing) {
      const addQty = cardData.quantity || 1;
      updateCard(existing.id, { quantity: (existing.quantity || 1) + addQty });
      return { id: existing.id, merged: true };
    }
    const id = uid();
    setCards((prev) => [
      ...prev,
      {
        id,
        added: Date.now(),
        name: cardData.name,
        set: cardData.set || "",
        setName: cardData.setName || "",
        collectorNumber: cardData.collectorNumber || "",
        imageUrl: cardData.imageUrl || null,
        imageUrlLarge: cardData.imageUrlLarge || null,
        scryfallUri: cardData.scryfallUri || null,
        quantity: cardData.quantity || 1,
        finish: cardData.finish || (cardData.foil ? "foil" : "nonfoil"),
        foil: !!cardData.foil,
        condition: cardData.condition || "NM",
        collectionId: cardData.collectionId || UNCATEGORIZED,
        location: cardData.location || "",
        costOverride:
          cardData.costOverride !== undefined ? cardData.costOverride : null,
        valueOverride: null,
        usd: cardData.usd ?? null,
        usdFoil: cardData.usdFoil ?? null,
        colors: cardData.colors || [],
        cmc: cardData.cmc ?? 0,
        typeLine: cardData.typeLine || "",
        rarity: cardData.rarity || "",
        scryfallId: cardData.scryfallId || null,
        artist: cardData.artist || null,
        isArt: !!cardData.isArt,
        signed: !!cardData.signed,
      },
    ]);
    return { id, merged: false };
  }

  function updateCard(id, patch) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function deleteCard(id) {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  function updateCollection(id, patch) {
    setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function deleteCollection(id) {
    setCollections((prev) => prev.filter((c) => c.id !== id));
    setCards((prev) =>
      prev.map((c) => (c.collectionId === id ? { ...c, collectionId: UNCATEGORIZED } : c))
    );
    if (activeFilter === id) setActiveFilter("all");
  }

  // Clears the collection total and any per-card overrides inside it, so the
  // cost basis can be re-entered from scratch.
  function resetCollectionCost(id) {
    updateCollection(id, { purchasePrice: 0 });
    setCards((prev) =>
      prev.map((c) => (c.collectionId === id ? { ...c, costOverride: null } : c))
    );
  }

  function resetAllCosts() {
    setCollections((prev) => prev.map((c) => ({ ...c, purchasePrice: 0 })));
    setCards((prev) => prev.map((c) => ({ ...c, costOverride: null })));
  }

  function addCollection(data) {
    const id = uid();
    setCollections((prev) => [...prev, { id, ...data }]);
    return id;
  }

  async function refreshAllPrices() {
    setRefreshing({ done: 0, total: cards.length });
    const updated = [...cards];
    let failures = 0;

    const patches = {}; // cardId -> patch, committed once per batch

    function applyFresh(card, i, fresh) {
      const patch = {
        prevUsd: card.usd,
        prevUsdFoil: card.usdFoil,
        usd: fresh.usd,
        usdFoil: fresh.usdFoil,
        imageUrl: fresh.imageUrl || card.imageUrl,
        imageUrlLarge: fresh.imageUrlLarge || card.imageUrlLarge,
        scryfallUri: fresh.scryfallUri || card.scryfallUri,
        collectorNumber: card.collectorNumber || fresh.collectorNumber,
        cmc: card.cmc || fresh.cmc,
        typeLine: card.typeLine || fresh.typeLine,
        rarity: card.rarity || fresh.rarity,
        colors: card.colors?.length ? card.colors : fresh.colors,
        scryfallId: card.scryfallId || fresh.scryfallId,
        lastChecked: Date.now(),
      };
      updated[i] = { ...card, ...patch };
      patches[card.id] = patch;
    }

    function commitPatches() {
      const batch = { ...patches };
      if (Object.keys(batch).length === 0) return;
      setCards((prev) => prev.map((c) => (batch[c.id] ? { ...c, ...batch[c.id] } : c)));
      Object.keys(batch).forEach((k) => delete patches[k]);
    }

    const targets = cards.map((c, i) => ({ c, i }));
    const identifier = (c) =>
      c.scryfallId
        ? { id: c.scryfallId }
        : c.set && c.collectorNumber
        ? { set: c.set.toLowerCase(), collector_number: c.collectorNumber }
        : c.set
        ? { name: c.name, set: c.set.toLowerCase() }
        : { name: c.name };

    let done = 0;
    const missed = [];
    let lastError = "";

    try {
      for (let start = 0; start < targets.length; start += 75) {
        const chunk = targets.slice(start, start + 75);
        try {
          const data = await scryfallCollection(chunk.map((x) => identifier(x.c)));
          const byId = {};
          const bySetCn = {};
          const byName = {};
          (data.data || []).forEach((raw) => {
            const card = normalizeCard(raw);
            byId[raw.id] = card;
            bySetCn[`${raw.set}|${raw.collector_number}`] = card;
            const key = raw.name.toLowerCase();
            if (!byName[key]) byName[key] = card;
            const front = raw.name.split("//")[0].trim().toLowerCase();
            if (!byName[front]) byName[front] = card;
          });
          chunk.forEach((x) => {
            const c = x.c;
            const fresh =
              (c.scryfallId && byId[c.scryfallId]) ||
              (c.set && c.collectorNumber && bySetCn[`${c.set.toLowerCase()}|${c.collectorNumber}`]) ||
              byName[c.name.toLowerCase()] ||
              byName[c.name.split("//")[0].trim().toLowerCase()];
            if (fresh) applyFresh(c, x.i, fresh);
            else missed.push(x);
          });
        } catch (e) {
          lastError = e.message;
          console.error("[hoardkeeper] batch refresh failed:", e);
          chunk.forEach((x) => missed.push(x));
        }
        commitPatches();
        done += chunk.length;
        setRefreshing({ done, total: cards.length });
        await sleep(RATE_MS);
      }

      // Fuzzy retry for the stragglers, with its own visible progress.
      for (let i = 0; i < missed.length; i++) {
        const x = missed[i];
        try {
          applyFresh(x.c, x.i, await scryfallLookup(x.c.name, x.c.set || undefined));
        } catch (e) {
          failures++;
        }
        if (i % 5 === 4) commitPatches();
        setRefreshing({
          done: cards.length,
          total: cards.length,
          label: `Retrying ${i + 1}/${missed.length}`,
        });
        await sleep(RATE_MS);
      }
      commitPatches();

      recordSnapshot(updated);
      if (failures > 0) {
        setNotice(
          `Updated, but ${failures} card${failures === 1 ? "" : "s"} couldn't be matched on Scryfall${
            lastError ? ` (last error: ${lastError})` : ""
          }.`
        );
      }
    } catch (e) {
      // Whatever went wrong, say so instead of freezing the button.
      console.error("[hoardkeeper] refresh aborted:", e);
      setNotice(`Refresh stopped early: ${e.message}. Already-fetched prices were kept.`);
    } finally {
      setRefreshing(null);
    }
  }

  function recordSnapshot(list) {
    let value = 0,
      cost = 0;
    list.forEach((c) => {
      value += currentUnitValue(c) * (c.quantity || 1);
      cost += allocatedCost(c);
    });
    const today = dayKey(Date.now());
    setHistory((prev) => {
      const withoutToday = prev.filter((h) => dayKey(h.t) !== today);
      return [...withoutToday, { t: Date.now(), value, cost }].slice(-180);
    });
  }

  // Roster steppers: + creates or increments the matching card; − decrements
  // and removes at zero. Matching is by Scryfall ID, then set+collector number.
  // The roster's +/- always adds nonfoil copies, so a match must also be
  // nonfoil — otherwise a foil-only row could silently absorb what was
  // meant to be a separate nonfoil pull.
  function findOwned(entry) {
    return cards.find(
      (c) =>
        !c.sold &&
        finishOf(c) === "nonfoil" &&
        !c.signed && // roster adds are never pre-marked signed; don't merge into a signed row
        ((c.scryfallId && c.scryfallId === entry.scryfallId) ||
          (c.set === entry.set && c.collectorNumber === entry.collectorNumber))
    );
  }

  function addCopyFromRoster(entry, collectionId) {
    const owned = findOwned(entry);
    if (owned) {
      updateCard(owned.id, { quantity: (owned.quantity || 1) + 1 });
      return;
    }
    setCards((prev) => [
      ...prev,
      {
        id: uid(),
        added: Date.now(),
        name: entry.name,
        set: entry.set,
        setName: entry.setName,
        collectorNumber: entry.collectorNumber,
        imageUrl: entry.imageUrl,
        imageUrlLarge: entry.imageUrlLarge,
        scryfallUri: entry.scryfallUri,
        quantity: 1,
        finish: "nonfoil",
        foil: false,
        condition: "NM",
        collectionId: collectionId || UNCATEGORIZED,
        location: "",
        costOverride: null,
        valueOverride: null,
        usd: entry.usd,
        usdFoil: entry.usdFoil,
        prevUsd: null,
        prevUsdFoil: null,
        cmc: entry.cmc,
        typeLine: entry.typeLine,
        colors: entry.colors,
        rarity: entry.rarity,
        scryfallId: entry.scryfallId,
        artist: entry.artist || null,
        isArt: !!entry.isArt,
        signed: false,
      },
    ]);
  }

  function removeCopyFromRoster(entry) {
    const owned = findOwned(entry);
    if (!owned) return;
    if ((owned.quantity || 1) <= 1) deleteCard(owned.id);
    else updateCard(owned.id, { quantity: owned.quantity - 1 });
  }

  // Adds cards to a deck with identity, duplicate and singleton rules applied.
  // Returns { added, skipped: [{name, reason}] }.
  function addCardsToDeck(deckId, list) {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return { added: 0, skipped: list.map((c) => ({ name: c.name, reason: "deck not found" })) };
    const isStd = deck.format === "standard";
    const cmd = !isStd ? cards.find((c) => c.id === deck.commanderId) : null;
    const identity = isStd ? deck.colors || [] : cmd?.colors || [];
    const ids = new Set(deck.entries.map((e) => e.cardId));
    const names = new Set(
      deck.entries.map((e) => cards.find((c) => c.id === e.cardId)?.name).filter(Boolean)
    );
    if (cmd) names.add(cmd.name);

    const newEntries = [];
    const skipped = [];
    list.forEach((card) => {
      if (card.sold) return skipped.push({ name: card.name, reason: "marked sold" });
      if (!(card.colors || []).every((c) => identity.includes(c)))
        return skipped.push({ name: card.name, reason: `outside ${identity.join("") || "colorless"} identity` });
      const free = isBasicLand(card);
      if (ids.has(card.id)) return skipped.push({ name: card.name, reason: "already in deck" });
      if (!isStd && !free && names.has(card.name))
        return skipped.push({ name: card.name, reason: "singleton" });
      ids.add(card.id);
      names.add(card.name);
      newEntries.push({ cardId: card.id, role: classifyRole(card, ""), qty: 1 });
    });

    if (newEntries.length > 0) {
      setDecks((prev) =>
        prev.map((d) => (d.id === deckId ? { ...d, entries: [...d.entries, ...newEntries] } : d))
      );
    }
    return { added: newEntries.length, skipped };
  }

  const toggleSelectRef = useRef(null);

  function toggleSelect(id, shiftKey) {
    // Shift-click selects everything between the last tapped card and this one.
    if (shiftKey && lastTapped && lastTapped !== id) {
      const ids = filtered.map((c) => c.id);
      const a = ids.indexOf(lastTapped);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSelected((prev) => Array.from(new Set([...prev, ...range])));
        setLastTapped(id);
        return;
      }
    }
    setLastTapped(id);
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  toggleSelectRef.current = toggleSelect;

  // Stable across renders (only changes when selectMode flips), so passing
  // it as CardTile's onClick lets React.memo skip cards whose own props
  // didn't change, instead of every visible tile re-rendering on any
  // unrelated state change elsewhere in the app.
  const handleCardClick = useCallback(
    (card, e) => {
      if (selectMode) toggleSelectRef.current(card.id, e.shiftKey);
      else setDetailCard(card);
    },
    [selectMode]
  );

  function exitSelectMode() {
    setSelectMode(false);
    setSelected([]);
  }

  function applyBulk(patch, deckId) {
    if (Object.keys(patch).length > 0) {
      setCards((prev) =>
        prev.map((c) => (selected.includes(c.id) ? { ...c, ...patch } : c))
      );
    }
    if (deckId) {
      const list = cards.filter((c) => selected.includes(c.id));
      const r = addCardsToDeck(deckId, list);
      const deckName = decks.find((d) => d.id === deckId)?.name || "deck";
      const reasons = [...new Set(r.skipped.map((x) => x.reason))].slice(0, 3).join(", ");
      setNotice(
        `Added ${r.added} of ${list.length} to ${deckName}.` +
          (r.skipped.length ? ` Skipped ${r.skipped.length} (${reasons}).` : "")
      );
    }
    setShowBulkEdit(false);
    exitSelectMode();
  }

  function deleteAll() {
    setCards([]);
    setSelected([]);
    setSelectMode(false);
  }

  function deleteSelected() {
    setCards((prev) => prev.filter((c) => !selected.includes(c.id)));
    exitSelectMode();
  }

  function exportCsv() {
    const rows = cards.map((c) => ({
      Name: c.name,
      // Set code plus collector number names one exact printing; the Scryfall
      // ID pins it beyond doubt. Without these a re-import has to guess from
      // the name alone and can land on the wrong art and the wrong price.
      Set: (c.set || "").toUpperCase(),
      "Collector Number": c.collectorNumber || "",
      "Set Name": c.setName || "",
      "Scryfall ID": c.scryfallId || "",
      Rarity: c.rarity || "",
      Quantity: c.quantity,
      Finish: finishOf(c),
      Condition: c.condition,
      Collection: collectionName(c.collectionId),
      Location: c.location || "",
      [`Purchase Price allocated (${currency})`]: convert(allocatedCost(c)).toFixed(2),
      [`Current Value each (${currency})`]: convert(currentUnitValue(c)).toFixed(2),
      [`Current Value total (${currency})`]: convert(currentUnitValue(c) * c.quantity).toFixed(2),
      Sold: c.sold ? "Yes" : "No",
      [`Sale Price (${currency})`]: c.sold
        ? convert((c.soldPrice || 0) * c.quantity).toFixed(2)
        : "",
      "Date Sold": c.soldDate || "",
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hoardkeeper-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const gainPct =
    totals.cost > 0 ? (totals.delta / totals.cost) * 100 : null;

  if (boot === "checking") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: C.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: C.parchmentDim,
          fontFamily: "'Archivo', sans-serif",
          fontSize: 14,
        }}
      >
        <Loader2 size={18} style={{ animation: "spin 1s linear infinite", marginRight: 10 }} />
        Opening the vault…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (boot === "auth") {
    return (
      <AuthGate
        registrationOpen={registrationOpen}
        onSignedIn={(user) => {
          setAccount(user);
          store.configure("accounts");
          setBoot("ready");
        }}
      />
    );
  }

  if (boot === "gate") {
    return (
      <ProfileGate
        onEnter={(name, pin) => {
          localStorage.setItem("lf-profile", JSON.stringify({ name, pin }));
          store.configure("server", name, pin);
          setBoot("ready");
        }}
      />
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse 130% 90% at 50% -20%, #232629 0%, ${C.bg} 55%, #121417 100%)`,
        color: C.parchment,
        fontFamily: "'Archivo', sans-serif",
        position: "relative",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Spectral:wght@400;500;600&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 6px; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .display { font-family: 'Cinzel', serif; }
        .serif { font-family: 'Spectral', serif; }
        .felt-weave {
          position: fixed; inset: 0; pointer-events: none; opacity: 0.45; z-index: 0;
          background-image:
            repeating-linear-gradient(0deg, rgba(255,255,255,0.016) 0 1px, transparent 1px 3px),
            repeating-linear-gradient(90deg, rgba(0,0,0,0.05) 0 1px, transparent 1px 3px);
        }
        .mat {
          position: relative; z-index: 1;
          max-width: 1200px; margin: 22px auto 0; border-radius: 14px;
          border: 1px solid rgba(185,191,199,0.3);
          box-shadow: inset 0 0 0 1px rgba(0,0,0,0.6), inset 0 0 60px rgba(0,0,0,0.3);
        }
        .mat::before {
          content: ""; position: absolute; inset: 7px; border-radius: 9px; pointer-events: none;
          border: 1.5px dashed rgba(185,191,199,0.3); z-index: 2;
        }
        .card-tile { transition: transform 0.16s ease; cursor: pointer; }
        .card-tile:hover .sleeve { transform: translateY(-5px) rotate(-0.4deg); box-shadow: 0 18px 32px -10px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(232,236,241,0.35); }
        .sleeve { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .sleeve::after {
          content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
          background: linear-gradient(115deg, rgba(255,255,255,0.13) 0%, transparent 30%, transparent 72%, rgba(255,255,255,0.05) 100%);
        }
        .chip { transition: all 0.15s ease; }
        input, select, textarea { font-family: inherit; }
        input:focus, select:focus, textarea:focus { outline: 2px solid ${C.gold}; outline-offset: 1px; }
        button:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 2px; }
        /* Simulated foil finish. Scryfall serves one image per card — the foiling
           is physical — so a real holographic treatment is rendered on top:
           saturated rainbow interference, a diagonal glare sweep, and a
           prismatic edge so the card reads as foil even as a thumbnail. */
        .foil-sheen {
          position: absolute; inset: 0; pointer-events: none; z-index: 1; border-radius: inherit;
          background:
            linear-gradient(115deg,
              rgba(255, 40, 90, 0.28) 0%, rgba(255, 150, 0, 0.24) 12%, rgba(250, 240, 40, 0.21) 24%,
              rgba(40, 230, 130, 0.25) 38%, rgba(0, 200, 255, 0.28) 52%, rgba(80, 90, 255, 0.28) 66%,
              rgba(200, 50, 255, 0.28) 80%, rgba(255, 45, 150, 0.25) 92%, rgba(255, 40, 90, 0.28) 100%);
          background-size: 280% 280%;
          mix-blend-mode: color-dodge;
          opacity: 0.38;
          animation: foil-drift 6s ease-in-out infinite alternate;
        }
        /* second layer: soft-light rainbow keeps colour on bright art where
           color-dodge would blow out to white */
        .foil-sheen::before {
          content: ""; position: absolute; inset: 0; border-radius: inherit;
          background: linear-gradient(160deg,
            rgba(255,0,120,0.25), rgba(255,220,0,0.2), rgba(0,255,180,0.22),
            rgba(0,140,255,0.25), rgba(180,0,255,0.25));
          background-size: 200% 200%;
          mix-blend-mode: soft-light;
          animation: foil-drift 9s ease-in-out infinite alternate-reverse;
        }
        .foil-sheen::after {
          content: ""; position: absolute; inset: -40%;
          background: linear-gradient(115deg,
            transparent 40%, rgba(255,255,255,0.07) 46%, rgba(255,255,255,0.38) 50%,
            rgba(255,255,255,0.07) 54%, transparent 60%);
          animation: foil-glare 4s ease-in-out infinite;
        }
        /* prismatic rim, so foils stay identifiable at any size */
        .foil-edge {
          position: absolute; inset: 0; z-index: 2; pointer-events: none; border-radius: inherit;
          padding: 1.5px;
          background: linear-gradient(135deg, #ff2d6f, #ffd400, #2bff9b, #00c2ff, #b44dff, #ff2d6f);
          background-size: 300% 300%;
          opacity: 0.65;
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          animation: foil-drift 6s ease-in-out infinite alternate;
        }
        /* hover brings the shimmer up, so you can still "tilt" a card to see it */
        .card-tile:hover .foil-sheen { opacity: 0.62; }
        .card-tile:hover .foil-edge { opacity: 0.9; }
        /* foil cards get an iridescent name on the cardstock caption */
        .foil-text {
          background: linear-gradient(100deg, #8d3a63, #8a6636, #35705c, #33607f, #6a5590, #8d3a63);
          background-size: 300% 100%;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          animation: foil-drift 6s ease-in-out infinite alternate;
        }
        @keyframes foil-drift {
          0% { background-position: 0% 0%; }
          100% { background-position: 100% 100%; }
        }
        @keyframes foil-glare {
          0%, 18% { transform: translateX(-38%); }
          58%, 100% { transform: translateX(38%); }
        }
        @keyframes rowflash { 0% { background: rgba(232,236,241,0.14); } 100% { background: transparent; } }
        .rowflash { animation: rowflash 0.5s ease; }
        /* Floating add-card button: appears once you've scrolled past the header. */
        .fab-add {
          animation: fab-in 0.18s ease-out;
          transition: transform 0.12s ease;
        }
        .fab-add:hover { transform: scale(1.06); }
        .fab-add:active { transform: scale(0.96); }
        @keyframes fab-in {
          from { opacity: 0; transform: scale(0.7) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* Freshly added card: a gold pulse so the eye finds it after the scroll. */
        .card-tile.just-added .sleeve {
          animation: just-added-pulse 1.8s ease-out;
        }
        @keyframes just-added-pulse {
          0% { box-shadow: 0 0 0 3px ${C.goldBright}, 0 0 24px 4px rgba(232,236,241,0.5); }
          100% { box-shadow: 0 10px 20px -8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12); }
        }

        /* ---------- responsive scaling ---------- */
        /* Nav tabs: swipeable strip instead of wrapping or overflowing on phones */
        .nav-tabs {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .nav-tabs::-webkit-scrollbar { display: none; }

        /* Set roster row: five fixed columns is fine on desktop, unusable under
           ~560px — collapse to name + stepper and hide price/link there. */
        .roster-row {
          grid-template-columns: 52px 1fr 90px 100px 110px;
        }
        @media (max-width: 560px) {
          .roster-row { grid-template-columns: 34px 1fr 96px; column-gap: 8px; }
          .roster-row .roster-price, .roster-row .roster-link { display: none; }
        }

        /* Card grid: fewer, wider tiles below ~420px so art stays legible
           instead of shrinking into unreadable thumbnails. */
        @media (max-width: 420px) {
          .card-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }

        @media (prefers-reduced-motion: reduce) {
          .card-tile, .sleeve { transition: none; }
          .rowflash { animation: none; }
          .foil-sheen, .foil-sheen::before, .foil-sheen::after, .foil-edge, .foil-text { animation: none; }
          .fab-add, .card-tile.just-added .sleeve { animation: none; }
        }
      `}</style>
      <div className="felt-weave" />
      <div className="mat">

      <Header
        totals={totals}
        gainPct={gainPct}
        onAddCard={() => setShowAddCard(true)}
        onManageCollections={() => setShowCollections(true)}
        onImport={() => setShowImport(true)}
        onExport={exportCsv}
        onRefresh={refreshAllPrices}
        refreshing={refreshing}
        saveError={saveError}
        showCharts={showCharts}
        onToggleCharts={() => setShowCharts((s) => !s)}
        onSettings={() => setShowSettings(true)}
        profileName={serverMode && authMode !== "accounts" ? store.profile : null}
        onSwitchProfile={() => {
          localStorage.removeItem("lf-profile");
          window.location.reload();
        }}
      />

      <div className="nav-tabs" style={{ display: "flex", gap: 8, padding: "10px clamp(14px, 4vw, 30px) 0" }}>
        <ViewTab label="Collection" active={view === "collection"} onClick={() => setView("collection")} />
        <ViewTab label="Sets" active={view === "sets"} onClick={() => setView("sets")} />
        <ViewTab label="Decks" active={view === "decks"} onClick={() => setView("decks")} />
        <ViewTab label="Glossary" active={view === "glossary"} onClick={() => setView("glossary")} />
        <ViewTab label="Life" active={view === "life"} onClick={() => setView("life")} />
      </div>

      {view === "collection" && (
      <FilterBar
        collections={collections}
        cards={cards}
        active={activeFilter}
        setActive={setActiveFilter}
        search={search}
        setSearch={setSearch}
        sortBy={sortBy}
        setSortBy={setSortBy}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        colorFilter={colorFilter}
        setColorFilter={setColorFilter}
        tileSize={tileSize}
        setTileSize={setTileSize}
        selectMode={selectMode}
        onToggleSelectMode={() => {
          if (selectMode) exitSelectMode();
          else setSelectMode(true);
        }}
      />
      )}

      {view === "collection" && hasArtInScope && (
        <div
          style={{
            display: "flex",
            gap: 8,
            margin: "14px clamp(14px, 4vw, 28px) 0",
          }}
        >
          {[
            { key: "cards", label: "Cards" },
            { key: "art", label: "Art Cards" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setCardsSubView(t.key)}
              className="mono"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: cardsSubView === t.key ? STOCK_BG : "transparent",
                color: cardsSubView === t.key ? C.stockInk : C.parchmentDim,
                border: `1px solid ${cardsSubView === t.key ? C.stock : "rgba(185,191,199,0.26)"}`,
                borderRadius: 5,
                padding: "7px 15px",
                fontSize: 11.5,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: cardsSubView === t.key ? STOCK_SHADOW : "none",
              }}
            >
              {t.key === "art" && <Palette size={12} />}
              {t.label}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div
          style={{
            margin: "14px 28px 0",
            background: C.bgPanel2,
            border: `1px solid ${C.borderLight}`,
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 12.5,
            color: C.parchmentDim,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AlertCircle size={14} color={C.gold} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{notice}</span>
          <button
            onClick={() => setNotice("")}
            style={{ background: "none", border: "none", color: C.parchmentDim, cursor: "pointer" }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {view === "glossary" ? (
        <GlossaryView cards={cards} />
      ) : view === "life" ? (
        <LifeCounterView onExit={() => setView("collection")} />
      ) : view === "decks" ? (
        <DecksView
          cards={cards}
          collections={collections}
          decks={decks}
          setDecks={setDecks}
          valueOf={(c) => currentUnitValue(c) * (c.quantity || 1)}
        />
      ) : view === "sets" ? (
        <SetsView
          cards={cards}
          collections={collections}
          onAddCopy={addCopyFromRoster}
          onRemoveCopy={removeCopyFromRoster}
        />
      ) : (
      <main style={{ padding: "8px clamp(14px, 4vw, 28px) 48px" }}>
        {loaded && cards.length === 0 && (
          <EmptyState onAddCard={() => setShowAddCard(true)} onImport={() => setShowImport(true)} />
        )}

        {showCharts && cards.length > 0 && (
          <Analytics
            history={history}
            rows={filtered.map((c) => ({
              card: c,
              value: currentUnitValue(c) * (c.quantity || 1),
              cost: allocatedCost(c),
              collection: collectionName(c.collectionId),
            }))}
          />
        )}

        {groupedSections ? (
          <div style={{ marginTop: 20, paddingBottom: selectMode ? 70 : 0 }}>
            {groupedSections.map((section) => (
              <div key={section.label} style={{ marginBottom: 28 }}>
                <div
                  className="display"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 15,
                    fontWeight: 700,
                    color: C.goldBright,
                    marginBottom: 14,
                  }}
                >
                  {section.label}
                  <span
                    className="mono"
                    style={{
                      flex: "0 0 auto",
                      fontSize: 10.5,
                      fontWeight: 500,
                      color: C.parchmentDim,
                      letterSpacing: 0.5,
                    }}
                  >
                    {section.cards.length} card{section.cards.length === 1 ? "" : "s"}
                  </span>
                  <span style={{ flex: 1, height: 1, background: "rgba(185,191,199,0.15)" }} />
                </div>
                <div
                  className="card-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_MIN_PX[tileSize]}px, 1fr))`,
                    gap: 20,
                  }}
                >
                  {section.cards.map((card) => (
                    <CardTile
                      key={card.id}
                      card={card}
                      collectionName={collectionName(card.collectionId)}
                      cost={allocatedCost(card)}
                      value={currentUnitValue(card) * card.quantity}
                      selectMode={selectMode}
                      selected={selectedSet.has(card.id)}
                      onClick={handleCardClick}
                      hasSiblings={(nameCounts[card.name.toLowerCase()] || 0) > 1}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="card-grid"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_MIN_PX[tileSize]}px, 1fr))`,
              gap: 20,
              marginTop: 20,
              paddingBottom: selectMode ? 70 : 0,
            }}
          >
            {filtered.map((card) => (
              <CardTile
                key={card.id}
                card={card}
                collectionName={collectionName(card.collectionId)}
                cost={allocatedCost(card)}
                value={currentUnitValue(card) * card.quantity}
                selectMode={selectMode}
                selected={selectedSet.has(card.id)}
                onClick={handleCardClick}
                hasSiblings={(nameCounts[card.name.toLowerCase()] || 0) > 1}
              />
            ))}
          </div>
        )}
      </main>
      )}
      </div>

      {selectMode && (
        <SelectionBar
          count={selected.length}
          shownCount={filtered.length}
          totalCount={cards.length}
          onSelectShown={() => setSelected(filtered.map((c) => c.id))}
          onSelectEverything={() => setSelected(cards.map((c) => c.id))}
          onInvert={() =>
            setSelected(filtered.filter((c) => !selected.includes(c.id)).map((c) => c.id))
          }
          onDeselect={() => setSelected([])}
          onExit={exitSelectMode}
          onEdit={() => setShowBulkEdit(true)}
          onDelete={deleteSelected}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          count={selected.length}
          decks={decks}
          overrideCount={
            cards.filter(
              (c) =>
                selected.includes(c.id) &&
                c.costOverride !== null &&
                c.costOverride !== undefined
            ).length
          }
          collections={collections}
          onClose={() => setShowBulkEdit(false)}
          onApply={applyBulk}
        />
      )}

      {showSettings && (
        <SettingsModal
          serverMode={serverMode}
          authMode={authMode}
          account={account}
          currency={currency}
          setCurrency={setCurrency}
          czkRate={czkRate}
          setCzkRate={setCzkRate}
          eurRate={eurRate}
          setEurRate={setEurRate}
          cardCount={cards.length}
          onDeleteAll={deleteAll}
          onClose={() => setShowSettings(false)}
        />
      )}

      {view === "collection" && scrolledPastHeader && !selectMode && (
        <button
          onClick={() => setShowAddCard(true)}
          title="Add card"
          className="fab-add"
          style={{
            position: "fixed",
            right: "clamp(14px, 4vw, 30px)",
            bottom: "clamp(14px, 4vw, 30px)",
            zIndex: 40,
            width: 54,
            height: 54,
            borderRadius: "50%",
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 10px 24px -6px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(40,44,50,0.4)",
          }}
        >
          <Plus size={24} />
        </button>
      )}

      {showAddCard && (
        <AddCardModal
          // showAddCard is either `true` (plain add) or the card being
          // duplicated (from a card's own "Duplicate" button) — passing that
          // card straight through skips search entirely and jumps to the
          // finish/quantity/collection step, since we already know exactly
          // which printing this is.
          prefill={typeof showAddCard === "object" ? showAddCard : null}
          defaultCollectionId={
            typeof showAddCard === "object"
              ? showAddCard.collectionId || UNCATEGORIZED
              : activeFilter !== "all" && activeFilter !== SOLD
              ? activeFilter
              : UNCATEGORIZED
          }
          collections={collections}
          cards={cards}
          allocationPreview={allocationPreview}
          onClose={() => setShowAddCard(false)}
          onAdd={(data, keepOpen) => {
            const result = addCard(data);
            if (!keepOpen) {
              setShowAddCard(false);
              // Clear filters so the card that was just added can't be hidden
              // by a stale search, type, or color filter when we scroll to it.
              setActiveFilter("all");
              setTypeFilter("all");
              setColorFilter("all");
              setSearch("");
              setScrollToCardId(result.id);
            }
            return result;
          }}
          onCreateCollection={addCollection}
        />
      )}

      {showCollections && (
        <CollectionsModal
          overAllocation={overAllocation}
          collections={collections}
          cards={cards}
          valueOf={(c) => currentUnitValue(c) * (c.quantity || 1)}
          costOf={allocatedCost}
          onClose={() => setShowCollections(false)}
          onUpdate={updateCollection}
          onDelete={deleteCollection}
          onResetCost={resetCollectionCost}
          onResetAll={resetAllCosts}
          onCreate={() => {
            setShowCollections(false);
            setShowAddCollection(true);
          }}
        />
      )}

      {sellCard && (
        <SellModal
          card={sellCard}
          suggested={currentUnitValue(sellCard)}
          onClose={() => setSellCard(null)}
          onSell={(patch) => {
            updateCard(sellCard.id, patch);
            setSellCard(null);
            setDetailCard(null);
          }}
        />
      )}

      {showAddCollection && (
        <AddCollectionModal
          onClose={() => setShowAddCollection(false)}
          onAdd={(data) => {
            addCollection(data);
            setShowAddCollection(false);
          }}
        />
      )}

      {showImport && (
        <ImportModal
          collections={collections}
          onClose={() => setShowImport(false)}
          onCreateCollection={addCollection}
          onAddToCollectionTotal={addToCollectionTotal}
          onImportCards={(newCards) => {
            setCards((prev) => [...prev, ...newCards]);
          }}
        />
      )}

      {detailCard && (
        <DetailModal
          card={cards.find((c) => c.id === detailCard.id) || detailCard}
          collections={collections}
          cost={allocatedCost(detailCard)}
          onClose={() => setDetailCard(null)}
          onUpdate={(patch) => updateCard(detailCard.id, patch)}
          onDelete={() => {
            deleteCard(detailCard.id);
            setDetailCard(null);
          }}
          decks={decks}
          onAddToDeck={(deckId) => {
            const card = cards.find((c) => c.id === detailCard.id);
            return card ? addCardsToDeck(deckId, [card]) : { added: 0, skipped: [] };
          }}
          onSell={() => setSellCard(cards.find((c) => c.id === detailCard.id) || detailCard)}
          onUnsell={() =>
            updateCard(detailCard.id, { sold: false, soldPrice: null, soldDate: null })
          }
          onDuplicate={(c) => {
            setDetailCard(null);
            setShowAddCard(c);
          }}
        />
      )}
    </div>
  );
}

function Header({
  totals,
  gainPct,
  onAddCard,
  onManageCollections,
  onImport,
  onExport,
  onRefresh,
  refreshing,
  saveError,
  showCharts,
  onToggleCharts,
  onSettings,
  // Who's signed in, and how to switch -- surfaced directly in the header
  // rather than buried behind the currency/Settings button, which nothing
  // about visually suggests "this is where profiles live."
  profileName,
  onSwitchProfile,
}) {
  return (
    <header
      style={{
        padding: "26px clamp(14px, 4vw, 30px) 6px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 18,
      }}
    >
      <div>
        <h1
          className="display"
          style={{
            fontSize: "clamp(21px, 6vw, 28px)",
            margin: 0,
            fontWeight: 700,
            letterSpacing: 1.5,
            color: C.goldBright,
            textShadow: "0 1px 0 rgba(0,0,0,0.7), 0 0 26px rgba(185,191,199,0.14)",
          }}
        >
          HOARDKEEPER
        </h1>
        <div
          className="mono"
          style={{
            fontSize: 10.5,
            letterSpacing: 2.4,
            textTransform: "uppercase",
            color: C.parchmentDim,
            marginTop: 7,
          }}
        >
          {saveError ? (
            <span style={{ color: C.redBright }}>changes aren't saving</span>
          ) : (
            "a running appraisal of the collection"
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <StatPlaque label="Worth" value={fmt(totals.value)} />
        <StatPlaque label="Invested" value={fmt(totals.cost)} />
        <StatPlaque
          label="Unrealized"
          value={`${totals.delta >= 0 ? "+" : "−"}${fmt(Math.abs(totals.delta))}`}
          tone={totals.delta >= 0 ? "up" : "down"}
          sub={gainPct !== null ? `${totals.delta >= 0 ? "+" : "−"}${Math.abs(gainPct).toFixed(1)}%` : null}
        />
        {totals.realized > 0 && (
          <StatPlaque
            label="Realized"
            value={`${totals.realizedDelta >= 0 ? "+" : "−"}${fmt(Math.abs(totals.realizedDelta))}`}
            tone={totals.realizedDelta >= 0 ? "up" : "down"}
          />
        )}
      </div>

      <div style={{ width: "100%", display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
        {profileName && (
          <IconButton
            onClick={onSwitchProfile}
            label={`${profileName} · switch`}
            icon={<Users size={15} />}
            title="Switch to a different profile"
          />
        )}
        <IconButton onClick={onToggleCharts} label={showCharts ? "Hide charts" : "Charts"} icon={<BarChart3 size={15} />} active={showCharts} />
        <IconButton onClick={onSettings} label="Settings" icon={<Settings size={15} />} title={`Currency: ${CUR.code}`} />
        <IconButton onClick={onImport} label="Import CSV" icon={<Upload size={15} />} />
        <IconButton onClick={onExport} label="Export" icon={<Download size={15} />} />
        <IconButton
          onClick={onRefresh}
          label={
            refreshing
              ? refreshing.label || `Updating ${refreshing.done}/${refreshing.total}`
              : "Refresh prices & art"
          }
          icon={refreshing ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={15} />}
          disabled={!!refreshing}
        />
        <IconButton onClick={onManageCollections} label="Collections" icon={<Layers size={15} />} />
        <div style={{ flex: 1 }} />
        <button
          onClick={onAddCard}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 5,
            padding: "9px 18px",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            boxShadow: STOCK_SHADOW,
          }}
        >
          <Plus size={16} /> Add card
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </header>
  );
}

function ViewTab({ label, active, onClick }) {
  return (
    <button
      className="display"
      onClick={onClick}
      style={{
        fontWeight: 600,
        fontSize: 13.5,
        letterSpacing: 1.2,
        background: active ? STOCK_BG : "transparent",
        color: active ? C.stockInk : C.parchmentDim,
        border: `1px solid ${active ? C.stock : "rgba(185,191,199,0.26)"}`,
        borderRadius: 4,
        padding: "8px 18px",
        cursor: "pointer",
        boxShadow: active ? "0 2px 0 rgba(0,0,0,0.4)" : "none",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

function StatPlaque({ label, value, tone, sub }) {
  const toneColor = tone === "up" ? "#1F6B3A" : tone === "down" ? "#94222F" : C.stockInk;
  return (
    <div
      style={{
        background: STOCK_BG,
        color: C.stockInk,
        borderRadius: 5,
        padding: "9px 16px 10px",
        minWidth: 116,
        boxShadow: `0 3px 0 rgba(0,0,0,0.45), inset 0 0 0 1px rgba(40,44,50,0.35)`,
      }}
    >
      <span
        className="mono"
        style={{
          display: "block",
          fontSize: 8.5,
          letterSpacing: 1.8,
          textTransform: "uppercase",
          color: C.stockDim,
        }}
      >
        {label}
      </span>
      <strong className="mono" style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.5, color: toneColor }}>
        {value}
      </strong>
      {sub && (
        <span className="mono" style={{ fontSize: 10, marginLeft: 6, color: toneColor, opacity: 0.8 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function IconButton({ onClick, label, icon, disabled, active, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: active ? "rgba(232,236,241,0.1)" : "transparent",
        color: active ? C.goldBright : C.parchmentDim,
        border: `1px solid ${active ? C.gold : C.border}`,
        borderRadius: 5,
        padding: "8px 12px",
        fontSize: 12.5,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function FilterBar({ collections, cards, active, setActive, search, setSearch, sortBy, setSortBy, typeFilter, setTypeFilter, colorFilter, setColorFilter, selectMode, onToggleSelectMode, tileSize, setTileSize }) {
  const counts = useMemo(() => {
    const m = {};
    cards.filter((c) => !c.sold).forEach((c) => {
      const k = c.collectionId || UNCATEGORIZED;
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [cards]);
  const soldCount = useMemo(() => cards.filter((c) => c.sold).length, [cards]);
  const heldCount = useMemo(() => cards.filter((c) => !c.sold).length, [cards]);

  return (
    <div
      style={{
        padding: "14px clamp(14px, 4vw, 28px)",
        display: "flex",
        gap: 14,
        alignItems: "center",
        flexWrap: "wrap",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      {/* Collection chips always own their full row. Without this, once
          the chip list wraps onto a second line, flexbox can still judge
          there's "just enough" room to squeeze the color pips onto that
          same line — which is exactly what crowded the collection names
          against the color dots. Giving this group flex-basis:100% makes
          that impossible regardless of how many collections exist or how
          long their names are. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexBasis: "100%" }}>
        <Chip label={`All (${heldCount})`} active={active === "all"} onClick={() => setActive("all")} />
        {collections.map((col) => (
          <Chip
            key={col.id}
            label={`${col.name} (${counts[col.id] || 0})`}
            active={active === col.id}
            onClick={() => setActive(col.id)}
          />
        ))}
        {soldCount > 0 && (
          <Chip
            label={`Sold (${soldCount})`}
            active={active === SOLD}
            onClick={() => setActive(SOLD)}
          />
        )}
        {counts[UNCATEGORIZED] > 0 && (
          <Chip
            label={`Uncategorized (${counts[UNCATEGORIZED]})`}
            active={active === UNCATEGORIZED}
            onClick={() => setActive(UNCATEGORIZED)}
          />
        )}
      </div>

      {/* color pips — actual mana colors as the buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {[
          { k: "W", c: MANA.W, t: "White" },
          { k: "U", c: MANA.U, t: "Blue" },
          { k: "B", c: MANA.B, t: "Black" },
          { k: "R", c: MANA.R, t: "Red" },
          { k: "G", c: MANA.G, t: "Green" },
          { k: "M", c: "#C9A227", t: "Multicolor" },
          { k: "C", c: "#8C8878", t: "Colorless" },
        ].map((p) => {
          const on = colorFilter === p.k;
          return (
            <button
              key={p.k}
              title={p.t}
              onClick={() => setColorFilter(on ? "all" : p.k)}
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: p.c,
                border: "none",
                cursor: "pointer",
                boxShadow: on
                  ? `0 0 0 2px ${C.bg}, 0 0 0 3.5px ${C.goldBright}`
                  : "inset 0 0 0 1px rgba(0,0,0,0.4)",
                opacity: colorFilter === "all" || on ? 1 : 0.35,
                transition: "opacity 0.12s ease, box-shadow 0.12s ease",
                padding: 0,
              }}
            />
          );
        })}
      </div>

      <select
        value={typeFilter}
        onChange={(e) => setTypeFilter(e.target.value)}
        style={{
          background: C.bgPanel2,
          border: `1px solid ${typeFilter !== "all" ? C.goldBright : C.border}`,
          borderRadius: 6,
          padding: "8px 10px",
          color: typeFilter !== "all" ? C.goldBright : C.parchment,
          fontSize: 13,
        }}
      >
        <option value="all">All types</option>
        {TYPE_FILTERS.map((t) => (
          <option key={t} value={t}>
            {t}s
          </option>
        ))}
      </select>

      <div style={{ position: "relative" }}>
        <Search
          size={14}
          color={C.parchmentDim}
          style={{ position: "absolute", left: 10, top: 10 }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cards..."
          style={{
            background: C.bgPanel2,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "8px 10px 8px 30px",
            color: C.parchment,
            fontSize: 13,
            width: 180,
          }}
        />
      </div>

      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value)}
        style={{
          background: C.bgPanel2,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          padding: "8px 10px",
          color: C.parchment,
          fontSize: 13,
        }}
      >
        <option value="added">Recently added</option>
        <option value="name">Name (A-Z)</option>
        <option value="value-desc">Value (high to low)</option>
        <option value="value-asc">Value (low to high)</option>
        <option value="gain">Biggest gainers</option>
        <option value="alpha-grouped">A–Z, grouped</option>
        <option value="rarity-grouped">Rarity, grouped</option>
      </select>

      <button
        onClick={onToggleSelectMode}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: selectMode ? C.gold : "transparent",
          color: selectMode ? C.bg : C.parchmentDim,
          border: `1px solid ${selectMode ? C.gold : C.border}`,
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 13,
          fontWeight: selectMode ? 700 : 500,
          cursor: "pointer",
        }}
      >
        <CheckSquare size={15} />
        {selectMode ? "Done" : "Select"}
      </button>

      {/* card tile size — persisted, since low-res thumbnails at the default
          density are genuinely hard to read without opening the card */}
      <div
        title="Card size"
        style={{
          display: "flex",
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {[
          { key: "compact", icon: <Grid3x3 size={13} /> },
          { key: "comfortable", icon: <LayoutGrid size={13} /> },
          { key: "large", icon: <Maximize2 size={13} /> },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTileSize(t.key)}
            title={t.key.charAt(0).toUpperCase() + t.key.slice(1)}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 9px",
              background: tileSize === t.key ? C.gold : "transparent",
              color: tileSize === t.key ? C.bg : C.parchmentDim,
              border: "none",
              cursor: "pointer",
            }}
          >
            {t.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, valueKeys }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: C.bgPanel2,
        border: `1px solid ${C.borderLight}`,
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 12,
      }}
    >
      <div style={{ color: C.parchment, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="mono" style={{ color: p.color || C.goldBright }}>
          {p.name}: {fmt(p.value)}
        </div>
      ))}
    </div>
  );
}

function ChartPanel({ title, subtitle, children, height = 240 }) {
  return (
    <div
      style={{
        background: "rgba(0,0,0,0.28)",
        border: `1px solid rgba(185,191,199,0.18)`,
        borderRadius: 10,
        padding: "14px 16px 8px",
      }}
    >
      <div style={{ marginBottom: 12, display: "flex", alignItems: "baseline", gap: 10 }}>
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            background: STOCK_BG,
            color: C.stockInk,
            fontWeight: 600,
            padding: "4px 9px",
            borderRadius: 3,
            boxShadow: STOCK_SHADOW,
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>{subtitle}</span>
        )}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Analytics({ rows, history }) {
  const colorData = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      const b = bucketOf(r.card);
      if (!m[b]) m[b] = { value: 0, count: 0 };
      m[b].value += r.value;
      m[b].count += r.card.quantity || 1;
    });
    return COLOR_BUCKETS.filter((b) => m[b.key]).map((b) => ({
      name: b.label,
      fill: b.fill,
      value: Number(m[b.key].value.toFixed(2)),
      count: m[b.key].count,
    }));
  }, [rows]);

  const topCards = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((r) => ({
          name: r.card.name.length > 20 ? r.card.name.slice(0, 19) + "…" : r.card.name,
          value: Number(r.value.toFixed(2)),
          fill: COLOR_BUCKETS.find((b) => b.key === bucketOf(r.card))?.fill || C.gold,
        }))
        .reverse(),
    [rows]
  );

  const collectionData = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      if (!m[r.collection]) m[r.collection] = { value: 0, cost: 0 };
      m[r.collection].value += r.value;
      m[r.collection].cost += r.cost;
    });
    return Object.entries(m)
      .map(([name, v]) => ({
        name: name.length > 18 ? name.slice(0, 17) + "…" : name,
        Value: Number(v.value.toFixed(2)),
        Paid: Number(v.cost.toFixed(2)),
      }))
      .sort((a, b) => b.Value - a.Value);
  }, [rows]);

  const curveData = useMemo(() => {
    const buckets = {};
    rows.forEach((r) => {
      const t = (r.card.typeLine || "").toLowerCase();
      if (t.includes("land")) return;
      const cmc = Math.min(Math.round(r.card.cmc ?? 0), 7);
      const key = cmc === 7 ? "7+" : String(cmc);
      buckets[key] = (buckets[key] || 0) + (r.card.quantity || 1);
    });
    return ["0", "1", "2", "3", "4", "5", "6", "7+"].map((k) => ({
      name: k,
      Cards: buckets[k] || 0,
    }));
  }, [rows]);

  const rarityData = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      const rar = r.card.rarity || "unknown";
      if (!m[rar]) m[rar] = { value: 0, count: 0 };
      m[rar].value += r.value;
      m[rar].count += r.card.quantity || 1;
    });
    const order = ["common", "uncommon", "rare", "mythic", "special", "bonus", "unknown"];
    return order
      .filter((k) => m[k])
      .map((k) => ({
        name: k.charAt(0).toUpperCase() + k.slice(1),
        value: Number(m[k].value.toFixed(2)),
        count: m[k].count,
        fill: RARITY_COLORS[k] || "#7A7263",
      }));
  }, [rows]);

  const historyData = useMemo(
    () =>
      (history || []).map((h) => ({
        name: shortDate(h.t),
        Value: Number(h.value.toFixed(2)),
        Paid: Number(h.cost.toFixed(2)),
      })),
    [history]
  );

  const movers = useMemo(() => {
    return rows
      .map((r) => {
        const c = r.card;
        const shiny = finishOf(c) !== "nonfoil";
        const prev = shiny ? c.prevUsdFoil : c.prevUsd;
        const now = shiny ? c.usdFoil : c.usd;
        if (prev === null || prev === undefined || !now || prev === 0) return null;
        const qty = c.quantity || 1;
        return {
          name: c.name,
          delta: (now - prev) * qty,
          pct: ((now - prev) / prev) * 100,
        };
      })
      .filter((m) => m && Math.abs(m.pct) >= 0.5)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 8);
  }, [rows]);

  const totalColorValue = colorData.reduce((s, d) => s + d.value, 0);

  const axisStyle = { fill: C.parchmentDim, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 16,
        marginTop: 20,
      }}
    >
      <ChartPanel
        title="COLOR IDENTITY"
        subtitle={`${fmt(totalColorValue)} across ${colorData.length} color groups`}
      >
        <PieChart>
          <Pie
            data={colorData}
            dataKey="value"
            nameKey="name"
            innerRadius={52}
            outerRadius={85}
            paddingAngle={2}
            stroke={C.bg}
            strokeWidth={2}
          >
            {colorData.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, color: C.parchmentDim }}
            iconType="circle"
            iconSize={8}
          />
        </PieChart>
      </ChartPanel>

      <ChartPanel title="MOST VALUABLE CARDS" subtitle="Top 10 by total holding value">
        <BarChart data={topCards} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid horizontal={false} stroke={C.border} />
          <XAxis type="number" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            tick={{ ...axisStyle, fontSize: 10.5 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(201,162,39,0.08)" }} />
          <Bar dataKey="value" name="Value" radius={[0, 3, 3, 0]}>
            {topCards.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ChartPanel>

      <ChartPanel title="PAID vs WORTH" subtitle="By collection">
        <BarChart data={collectionData} margin={{ left: 0, right: 8 }}>
          <CartesianGrid vertical={false} stroke={C.border} />
          <XAxis
            dataKey="name"
            tick={{ ...axisStyle, fontSize: 10 }}
            axisLine={{ stroke: C.border }}
            tickLine={false}
            interval={0}
            angle={-15}
            textAnchor="end"
            height={50}
          />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={50} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(201,162,39,0.08)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="square" iconSize={8} />
          <Bar dataKey="Paid" fill={C.borderLight} radius={[3, 3, 0, 0]} />
          <Bar dataKey="Value" fill={C.gold} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartPanel>

      <ChartPanel
        title="VALUE OVER TIME"
        subtitle={
          historyData.length < 2
            ? "Refresh prices on separate days to build the line"
            : `${historyData.length} snapshots`
        }
      >
        <AreaChart data={historyData} margin={{ left: 0, right: 8 }}>
          <defs>
            <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.gold} stopOpacity={0.45} />
              <stop offset="100%" stopColor={C.gold} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={C.border} />
          <XAxis dataKey="name" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={50} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="Value"
            stroke={C.gold}
            strokeWidth={2}
            fill="url(#valueFill)"
          />
          <Line type="monotone" dataKey="Paid" stroke={C.borderLight} strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ChartPanel>

      <ChartPanel title="MANA CURVE" subtitle="Nonland cards by mana value">
        <BarChart data={curveData} margin={{ left: 0, right: 8 }}>
          <CartesianGrid vertical={false} stroke={C.border} />
          <XAxis dataKey="name" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "rgba(201,162,39,0.08)" }}
            contentStyle={{
              background: C.bgPanel2,
              border: `1px solid ${C.borderLight}`,
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: C.parchment }}
            itemStyle={{ color: C.goldBright }}
          />
          <Bar dataKey="Cards" fill={C.gold} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartPanel>

      <ChartPanel title="RARITY" subtitle="Value held by rarity tier">
        <BarChart data={rarityData} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid horizontal={false} stroke={C.border} />
          <XAxis type="number" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={82}
            tick={{ ...axisStyle, fontSize: 10.5 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(201,162,39,0.08)" }} />
          <Bar dataKey="value" name="Value" radius={[0, 3, 3, 0]}>
            {rarityData.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ChartPanel>

      <MoversPanel movers={movers} />
    </div>
  );
}

function MoversPanel({ movers }) {
  return (
    <div
      style={{
        background: "rgba(0,0,0,0.28)",
        border: `1px solid rgba(185,191,199,0.18)`,
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            background: STOCK_BG,
            color: C.stockInk,
            fontWeight: 600,
            padding: "4px 9px",
            borderRadius: 3,
            boxShadow: STOCK_SHADOW,
          }}
        >
          MOVERS
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
          since last refresh
        </span>
      </div>

      {movers.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.parchmentDim, padding: "24px 0", textAlign: "center" }}>
          No movement recorded yet. Refresh prices twice to start comparing.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {movers.map((m) => {
            const up = m.delta >= 0;
            return (
              <div
                key={m.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  paddingBottom: 7,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span
                  style={{
                    fontSize: 12.5,
                    color: C.parchment,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.name}
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: up ? C.greenBright : C.redBright,
                    whiteSpace: "nowrap",
                  }}
                >
                  {up ? "+" : "-"}
                  {fmt(Math.abs(m.delta))}{" "}
                  <span style={{ opacity: 0.7 }}>
                    ({up ? "+" : ""}
                    {m.pct.toFixed(1)}%)
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({ label, active, onClick }) {
  return (
    <button
      className="chip"
      onClick={onClick}
      style={{
        background: "transparent",
        color: active ? C.goldBright : C.parchmentDim,
        border: `1px solid ${active ? C.goldBright : "rgba(217,220,224,0.18)"}`,
        borderRadius: 3,
        padding: "6px 13px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function ManaDots({ colors }) {
  if (!colors || colors.length === 0) {
    return (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#5a5142",
          display: "inline-block",
        }}
      />
    );
  }
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {colors.map((c) => (
        <span
          key={c}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: MANA[c] || "#888",
            display: "inline-block",
          }}
        />
      ))}
    </div>
  );
}

// Falls back to a generated face tinted by color identity when a card has no
// artwork yet (manual entries, or rows imported without a Scryfall match).
function CardArt({ card, large }) {
  const [failed, setFailed] = useState(false);
  const src = large ? card.imageUrlLarge || card.imageUrl : card.imageUrl;
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={card.name}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return <CardFace card={card} />;
}

function CardFace({ card }) {
  const cols = (card.colors || []).map((c) => MANA[c]).filter(Boolean);
  const wash =
    cols.length === 0
      ? `linear-gradient(155deg, #33373D, ${C.bg})`
      : cols.length === 1
      ? `linear-gradient(155deg, ${cols[0]}44, ${C.bg} 78%)`
      : `linear-gradient(155deg, ${cols[0]}44, ${cols[1]}33 45%, ${C.bg} 82%)`;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: wash,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "12px 11px",
      }}
    >
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          color: C.parchment,
          lineHeight: 1.25,
          textShadow: "0 1px 3px rgba(0,0,0,0.6)",
          // Leave room for the foil sparkle and quantity badge.
          padding: `0 ${card.quantity > 1 ? 26 : 0}px 0 ${card.foil ? 20 : 0}px`,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {card.name}
      </div>
      <div style={{ textAlign: "center", opacity: 0.5 }}>
        <LibraryBig size={26} color={C.parchment} />
      </div>
      <div
        style={{
          fontSize: 9.5,
          color: C.parchment,
          opacity: 0.75,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          lineHeight: 1.4,
        }}
      >
        <div>{card.setName || card.set || "—"}</div>
        <div style={{ opacity: 0.8 }}>
          {card.rarity || ""}
          {card.typeLine ? ` · ${card.typeLine.split("—")[0].trim()}` : ""}
        </div>
      </div>
    </div>
  );
}

const CardTile = React.memo(function CardTile({ card, collectionName, cost, value, onClick, selectMode, selected, hasSiblings }) {
  const delta = value - cost;
  const up = delta >= 0;
  return (
    <div className="card-tile" data-card-id={card.id} onClick={(e) => onClick(card, e)}>
      <div
        className="sleeve"
        style={{
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
          opacity: selectMode && !selected ? 0.55 : 1,
          background: "#0C0E10",
          aspectRatio: "5 / 7",
          boxShadow: selected
            ? `0 0 0 2px ${C.goldBright}, 0 10px 20px -8px rgba(0,0,0,0.8)`
            : `0 10px 20px -8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)`,
        }}
      >
        {selectMode && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "flex-start",
              padding: 6,
            }}
          >
            <div
              style={{
                background: selected ? C.gold : "rgba(20,17,14,0.8)",
                borderRadius: 5,
                padding: 3,
                display: "flex",
              }}
            >
              {selected ? (
                <Check size={14} color={C.bg} />
              ) : (
                <Square size={14} color={C.parchmentDim} />
              )}
            </div>
          </div>
        )}
        <CardArt card={card} />

        {finishOf(card) !== "nonfoil" && (
          <>
            <div className="foil-sheen" />
            <div className="foil-edge" />
          </>
        )}

        {card.sold && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(20,17,14,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
            }}
          >
            <span
              className="display"
              style={{
                border: `2px solid ${C.goldBright}`,
                color: C.goldBright,
                borderRadius: 4,
                padding: "3px 10px",
                fontSize: 12,
                letterSpacing: 2,
                transform: "rotate(-12deg)",
                background: "rgba(20,17,14,0.75)",
              }}
            >
              SOLD
            </span>
          </div>
        )}

        {card.quantity > 1 && (
          <div
            className="mono"
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: STOCK_BG,
              border: "none",
              borderRadius: 3,
              padding: "1px 7px",
              fontSize: 11,
              fontWeight: 600,
              color: C.stockInk,
              boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
              zIndex: 2,
            }}
          >
            x{card.quantity}
          </div>
        )}

        {/* Only shown when another row shares this card's name — this is
            specifically "which copy is this one" disambiguation (different
            printing/art, or a different finish), not clutter on every tile. */}
        {hasSiblings && (
          <div
            className="mono"
            style={{
              position: "absolute",
              bottom: 6,
              left: 6,
              zIndex: 2,
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
              maxWidth: "calc(100% - 12px)",
            }}
          >
            {card.set && (
              <span
                style={{
                  background: "rgba(10,11,13,0.82)",
                  border: `1px solid rgba(232,236,241,0.25)`,
                  borderRadius: 3,
                  padding: "1px 6px",
                  fontSize: 9,
                  letterSpacing: 0.4,
                  color: C.parchment,
                  textTransform: "uppercase",
                }}
              >
                {(card.set || "").toUpperCase()}
                {card.collectorNumber ? ` #${card.collectorNumber}` : ""}
              </span>
            )}
            {finishOf(card) !== "nonfoil" && (
              <span
                style={{
                  background: "rgba(10,11,13,0.82)",
                  border: `1px solid rgba(201,162,39,0.5)`,
                  borderRadius: 3,
                  padding: "1px 6px",
                  fontSize: 9,
                  letterSpacing: 0.4,
                  color: C.goldBright,
                  textTransform: "uppercase",
                }}
              >
                {finishOf(card)}
              </span>
            )}
          </div>
        )}

      </div>

      <div style={{ padding: "9px 0 0" }}>
        {/* the card frame's own type-line bar, in card stock */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            padding: "5px 9px",
            background: STOCK_BG,
            borderRadius: 3,
            color: C.stockInk,
            boxShadow: STOCK_SHADOW,
          }}
        >
          <span
            className={`serif${card.foil ? " foil-text" : ""}`}
            style={{
              fontWeight: 600,
              fontSize: 13,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={card.foil ? `${card.name} (foil)` : card.name}
          >
            {card.name}
          </span>
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>
            {card.sold ? fmt((card.soldPrice || 0) * (card.quantity || 1)) : fmt(value)}
          </span>
        </div>

        {/* collector line */}
        <div
          className="mono"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 5,
            padding: "0 2px",
            fontSize: 9.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: C.parchmentDim,
          }}
        >
          <span
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {collectionName}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <ManaDots colors={card.colors} />
            <span
              style={{
                fontWeight: 600,
                color: up ? C.greenBright : C.redBright,
                whiteSpace: "nowrap",
              }}
            >
              {up ? "+" : "-"}
              {fmt(Math.abs(delta))}
            </span>
          </div>
        </div>

        {card.location && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              marginTop: 3,
              fontSize: 10,
              color: C.parchmentDim,
            }}
          >
            <MapPin size={9} />
            {card.location}
          </div>
        )}
      </div>
    </div>
  );
});

/* ============================================================
   DECKS — commander deck building with an auto-drafter
   ============================================================ */

// Oracle text cache: role detection needs rules text, which cards don't carry.
// Fetched in batches of 75 and kept in localStorage.
async function fetchOracleTexts(scryfallIds) {
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
async function fetchTokenCards(ids) {
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
function classifyRole(card, text) {
  const t = (text || "").toLowerCase();
  const ty = (card.typeLine || "").toLowerCase();
  if (ty.includes("land")) return "land";
  if (/destroy all|exile all|each creature deals|deals damage to each/.test(t)) return "wipe";
  if (/destroy target|exile target|deals \d+ damage to (any target|target creature)|fights? target/.test(t))
    return "removal";
  if (/add \{|add [a-z]+ mana|search your library for (a|up to two)[^.]*land/.test(t)) return "ramp";
  if (/draw (a|two|three|x) cards?|draws? that many cards/.test(t)) return "draw";
  if (ty.includes("creature")) return "creature";
  return "other";
}

// words that indicate mechanical synergy when shared with the commander
const SYNERGY_WORDS = [
  "token", "sacrifice", "graveyard", "counter", "+1/+1", "lifelink", "life", "landfall",
  "wolf", "wolves", "elf", "goblin", "zombie", "dragon", "angel", "vampire", "spirit",
  "artifact", "enchantment", "equipment", "aura", "instant", "sorcery", "flying",
  "deathtouch", "proliferate", "mill", "discard", "treasure", "food", "clue",
];

function synergyScore(commanderText, commanderTypes, card, text) {
  const ct = (commanderText || "").toLowerCase();
  const t = ((text || "") + " " + (card.typeLine || "")).toLowerCase();
  let score = 0;
  // shared creature subtypes (after the em dash in the commander's type line)
  const sub = (commanderTypes.split("—")[1] || "").toLowerCase().trim().split(/\s+/);
  sub.forEach((st) => {
    if (st.length > 2 && t.includes(st)) score += 3;
  });
  SYNERGY_WORDS.forEach((w) => {
    if (ct.includes(w) && t.includes(w)) score += 1.5;
  });
  return score;
}

function identityFits(card, identity) {
  return (card.colors || []).every((c) => identity.includes(c));
}

const ROLE_TARGETS = { land: 37, ramp: 10, draw: 10, removal: 8, wipe: 3 };
const ROLE_LABELS = {
  land: "Lands",
  ramp: "Ramp",
  draw: "Card draw",
  removal: "Removal",
  wipe: "Board wipes",
  creature: "Creatures",
  other: "Other spells",
};
const ROLE_ORDER = ["land", "ramp", "draw", "removal", "wipe", "creature", "other"];

// The drafter: fills role quotas from the pool, then the rest by synergy and curve.
// Commander is singleton with two exceptions: basic lands, and cards whose text
// explicitly allows any number ("A deck can have any number of cards named…",
// e.g. Rat Colony, Persistent Petitioners, Dragon's Approach).
function isBasicLand(card) {
  return /\bbasic\b/i.test(card?.typeLine || "") && /\bland\b/i.test(card?.typeLine || "");
}

function allowsAnyNumber(card, oracleText) {
  if (isBasicLand(card)) return true;
  return /a deck can have any number of cards named/i.test(oracleText || "");
}

// `freeCopies(card)` reports how many copies aren't already committed to another
// deck. Defaults to "everything is available" so the function stays testable.
function draftDeck(commander, pool, oracle, freeCopies = () => Infinity) {
  const identity = commander.colors || [];
  const cText = oracle[commander.scryfallId]?.t || "";
  const cTypes = commander.typeLine || "";

  const candidates = pool
    .filter(
      (c) =>
        !c.sold &&
        c.id !== commander.id &&
        c.scryfallId &&
        identityFits(c, identity) &&
        // don't draft a card that's already sleeved in another deck
        freeCopies(c) > 0
    )
    .map((c) => {
      const text = oracle[c.scryfallId]?.t || "";
      return {
        card: c,
        role: classifyRole(c, text),
        syn: synergyScore(cText, cTypes, c, text),
      };
    });

  // singleton by name, except basics and "any number" cards
  const seen = new Set([commander.name]);
  const unique = [];
  candidates
    .sort((a, b) => b.syn - a.syn)
    .forEach((x) => {
      const free = allowsAnyNumber(x.card, oracle[x.card.scryfallId]?.t);
      if (free || !seen.has(x.card.name)) {
        if (!free) seen.add(x.card.name);
        unique.push(x);
      }
    });

  const picks = [];
  const used = new Set();

  function take(role, n, sorter) {
    const found = unique
      .filter((x) => x.role === role && !used.has(x.card.id))
      .sort(sorter)
      .slice(0, n);
    found.forEach((x) => {
      used.add(x.card.id);
      picks.push(x);
    });
    return found.length;
  }

  const bySyn = (a, b) => b.syn - a.syn || Math.abs((a.card.cmc || 3) - 3) - Math.abs((b.card.cmc || 3) - 3);
  const cheapFirst = (a, b) => (a.card.cmc || 0) - (b.card.cmc || 0) || b.syn - a.syn;

  const landsFound = take("land", 14, bySyn); // nonbasics from the pool
  take("ramp", ROLE_TARGETS.ramp, cheapFirst);
  take("draw", ROLE_TARGETS.draw, bySyn);
  take("removal", ROLE_TARGETS.removal, cheapFirst);
  take("wipe", ROLE_TARGETS.wipe, bySyn);

  // basics fill the rest of the mana base
  const basicsNeeded = Math.max(0, ROLE_TARGETS.land - landsFound);
  const spellSlots = 99 - landsFound - basicsNeeded - picks.filter((p) => p.role !== "land").length;

  // remaining slots: best synergy, curve-weighted
  const rest = unique
    .filter((x) => !used.has(x.card.id) && x.role !== "land")
    .sort(bySyn)
    .slice(0, Math.max(0, spellSlots));
  rest.forEach((x) => {
    used.add(x.card.id);
    picks.push(x);
  });

  // split basics across the identity by pip presence in picked cards
  const pipCount = {};
  identity.forEach((c) => (pipCount[c] = 1));
  picks.forEach((x) => (x.card.colors || []).forEach((c) => {
    if (identity.includes(c)) pipCount[c] = (pipCount[c] || 0) + 1;
  }));
  const totalPips = Object.values(pipCount).reduce((a, b) => a + b, 0) || 1;
  const basics = {};
  const BASIC_NAME = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
  let assigned = 0;
  const identityList = identity.length ? identity : ["C"];
  identityList.forEach((c, i) => {
    const n =
      i === identityList.length - 1
        ? basicsNeeded - assigned
        : Math.round((basicsNeeded * (pipCount[c] || 1)) / totalPips);
    assigned += n;
    if (n > 0) basics[BASIC_NAME[c] || "Wastes"] = n;
  });

  return {
    entries: picks.map((x) => ({ cardId: x.card.id, role: x.role })),
    basics,
    shortfall: Math.max(0, spellSlots - rest.length),
  };
}

// 60-card constructed drafter. No commander: you pick the colors, it builds
// 24 lands / ~24 creatures / spells, allowing up to 4 copies but never more
// than you own. Theme is inferred from your most common creature type.
function draftDeck60(colors, pool, oracle, freeCopies = () => Infinity) {
  const identity = colors;
  const candidates = pool
    .filter(
      (c) =>
        !c.sold &&
        identityFits(c, identity) &&
        !(c.typeLine || "").toLowerCase().includes("basic land") &&
        freeCopies(c) > 0
    )
    .map((c) => {
      const text = oracle[c.scryfallId]?.t || "";
      return {
        card: c,
        role: classifyRole(c, text),
        text,
        // four of a card, but never more than you have free
        maxQty: Math.min(4, c.quantity || 1, freeCopies(c)),
      };
    });

  // theme: the most common creature subtype in the candidate pool
  const subtypeCount = {};
  candidates.forEach((x) => {
    if (!(x.card.typeLine || "").includes("Creature")) return;
    const sub = ((x.card.typeLine || "").split("—")[1] || "").trim().split(/\s+/);
    sub.forEach((st) => {
      if (st.length > 2) subtypeCount[st] = (subtypeCount[st] || 0) + (x.maxQty || 1);
    });
  });
  const theme = Object.entries(subtypeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  candidates.forEach((x) => {
    const t = ((x.text || "") + " " + (x.card.typeLine || "")).toLowerCase();
    x.syn = (theme && t.includes(theme.toLowerCase()) ? 3 : 0) - Math.abs((x.card.cmc || 2) - 2.5);
  });

  const picks = [];
  const used = new Set();
  let count = 0;

  function take(filter, slots, sorter) {
    const found = candidates.filter((x) => !used.has(x.card.id) && filter(x)).sort(sorter);
    for (const x of found) {
      if (count >= 60 - 24 + landsPicked || slots <= 0) break;
      const qty = Math.min(x.maxQty, slots);
      used.add(x.card.id);
      picks.push({ ...x, qty });
      slots -= qty;
      count += qty;
    }
  }

  // nonbasic lands first (up to 6), basics fill to 24
  let landsPicked = 0;
  candidates
    .filter((x) => x.role === "land" && !used.has(x.card.id))
    .sort((a, b) => b.syn - a.syn)
    .slice(0, 3)
    .forEach((x) => {
      const qty = Math.min(x.maxQty, 6 - landsPicked);
      if (qty <= 0) return;
      used.add(x.card.id);
      picks.push({ ...x, qty });
      landsPicked += qty;
    });

  const bySyn = (a, b) => b.syn - a.syn;
  const cheap = (a, b) => (a.card.cmc || 0) - (b.card.cmc || 0) || b.syn - a.syn;

  take((x) => x.role === "removal", 8, cheap);
  take((x) => x.role === "draw", 6, bySyn);
  take((x) => x.role === "creature", 24, bySyn);
  take((x) => x.role !== "land", 60, bySyn); // fill whatever's left

  const spellCount = picks.filter((p) => p.role !== "land").reduce((s, p) => s + p.qty, 0);
  const basicsNeeded = Math.max(0, 60 - spellCount - landsPicked);

  const pipCount = {};
  identity.forEach((c) => (pipCount[c] = 1));
  picks.forEach((x) => (x.card.colors || []).forEach((c) => {
    if (identity.includes(c)) pipCount[c] = (pipCount[c] || 0) + x.qty;
  }));
  const totalPips = Object.values(pipCount).reduce((a, b) => a + b, 0) || 1;
  const BASIC_NAME = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
  const basics = {};
  let assigned = 0;
  const identityList = identity.length ? identity : ["C"];
  identityList.forEach((c, i) => {
    const n =
      i === identityList.length - 1
        ? basicsNeeded - assigned
        : Math.round((basicsNeeded * (pipCount[c] || 1)) / totalPips);
    assigned += n;
    if (n > 0) basics[BASIC_NAME[c] || "Wastes"] = n;
  });

  return {
    entries: picks.map((x) => ({ cardId: x.card.id, role: x.role, qty: x.qty })),
    basics,
    shortfall: Math.max(0, 60 - spellCount - landsPicked - basicsNeeded),
    theme,
  };
}

/* ============================================================
   ACCOUNT GATE — email + password, used when the server runs
   in accounts mode. PIN installs never see this.
   ============================================================ */

async function authPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hk-app": "1" },
    credentials: "same-origin",
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

function AuthGate({ onSignedIn, registrationOpen }) {
  // signin | register | forgot | reset | sent | verify-needed
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get("reset");
  const verifiedFlag = params.get("verified");

  const [view, setView] = useState(resetToken ? "reset" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState(
    verifiedFlag === "1"
      ? "Email confirmed — you can sign in now."
      : verifiedFlag === "0"
      ? "That confirmation link has expired. Sign in and we'll send a new one."
      : ""
  );

  function clearQuery() {
    window.history.replaceState({}, "", window.location.pathname);
  }

  async function signIn() {
    setBusy(true);
    setError("");
    const { ok, status, data } = await authPost("/api/auth/login", { email, password });
    setBusy(false);
    if (ok) {
      clearQuery();
      return onSignedIn(data.user);
    }
    if (status === 403 && data.error === "unverified") {
      setView("verify-needed");
      return;
    }
    setError(data.error || "Couldn't sign in.");
  }

  async function register() {
    if (password !== password2) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    const { ok, data } = await authPost("/api/auth/register", { email, password });
    setBusy(false);
    if (!ok) return setError(data.error || "Couldn't create the account.");
    setNote("");
    setView("sent");
  }

  async function forgot() {
    setBusy(true);
    setError("");
    await authPost("/api/auth/forgot", { email });
    setBusy(false);
    setView("sent-reset");
  }

  async function doReset() {
    if (password !== password2) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    const { ok, data } = await authPost("/api/auth/reset", { token: resetToken, password });
    setBusy(false);
    if (!ok) return setError(data.error || "Couldn't reset the password.");
    clearQuery();
    setPassword("");
    setPassword2("");
    setNote("Password changed — sign in with it now.");
    setView("signin");
  }

  async function resend() {
    setBusy(true);
    await authPost("/api/auth/resend", { email });
    setBusy(false);
    setNote("If that address needs confirming, a new link is on its way.");
  }

  const input = {
    width: "100%",
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "11px 12px",
    color: C.parchment,
    fontSize: 14,
    marginBottom: 10,
  };
  const primary = {
    width: "100%",
    background: `linear-gradient(180deg, ${C.stock}, ${C.stockDark})`,
    color: C.stockInk,
    border: "none",
    borderRadius: 6,
    padding: "12px",
    fontWeight: 700,
    fontSize: 14.5,
    cursor: busy ? "default" : "pointer",
    boxShadow: "inset 0 0 0 1px rgba(40,44,50,0.4), 0 2px 0 rgba(0,0,0,0.35)",
    opacity: busy ? 0.7 : 1,
  };
  const link = {
    background: "none",
    border: "none",
    color: C.parchmentDim,
    fontSize: 12.5,
    cursor: "pointer",
    textDecoration: "underline",
    padding: 4,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse 130% 90% at 50% -20%, #232629 0%, ${C.bg} 55%, #121417 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Archivo', sans-serif",
        padding: 20,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Spectral:wght@500;600&family=Archivo:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
      `}</style>
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          border: "1px solid rgba(185,191,199,0.3)",
          borderRadius: 14,
          padding: 28,
          position: "relative",
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.6), inset 0 0 60px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 7,
            borderRadius: 9,
            border: "1.5px dashed rgba(185,191,199,0.3)",
            pointerEvents: "none",
          }}
        />
        <h1
          style={{
            fontFamily: "'Cinzel', serif",
            fontWeight: 700,
            fontSize: 23,
            letterSpacing: 1.5,
            color: C.goldBright,
            margin: "0 0 6px",
            textAlign: "center",
          }}
        >
          HOARDKEEPER
        </h1>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9.5,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: C.parchmentDim,
            textAlign: "center",
            marginBottom: 22,
          }}
        >
          {view === "register"
            ? "Create your vault"
            : view === "forgot"
            ? "Recover your account"
            : view === "reset"
            ? "Choose a new password"
            : "Sign in to your vault"}
        </div>

        {note && (
          <div style={{ fontSize: 12.5, color: C.greenBright, marginBottom: 12, lineHeight: 1.5 }}>
            {note}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12.5, color: C.redBright, marginBottom: 12, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {view === "signin" && (
          <>
            <input
              style={input}
              type="email"
              autoComplete="username"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              style={input}
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
            />
            <button style={primary} onClick={signIn} disabled={busy}>
              {busy ? "…" : "Sign in"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
              <button style={link} onClick={() => { setView("forgot"); setError(""); }}>
                Forgot password
              </button>
              {registrationOpen && (
                <button style={link} onClick={() => { setView("register"); setError(""); setNote(""); }}>
                  Create account
                </button>
              )}
            </div>
          </>
        )}

        {view === "register" && (
          <>
            <input
              style={input}
              type="email"
              autoComplete="username"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              style={input}
              type="password"
              autoComplete="new-password"
              placeholder="Password (10+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              style={input}
              type="password"
              autoComplete="new-password"
              placeholder="Repeat password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && register()}
            />
            <button style={primary} onClick={register} disabled={busy}>
              {busy ? "…" : "Create account"}
            </button>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: C.parchmentDim,
                marginTop: 10,
                lineHeight: 1.5,
              }}
            >
              A long phrase beats a short jumble. We'll email you a link to confirm the address.
            </div>
            <button style={{ ...link, marginTop: 8 }} onClick={() => { setView("signin"); setError(""); }}>
              ← Back to sign in
            </button>
          </>
        )}

        {view === "forgot" && (
          <>
            <input
              style={input}
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && forgot()}
            />
            <button style={primary} onClick={forgot} disabled={busy}>
              {busy ? "…" : "Send reset link"}
            </button>
            <button style={{ ...link, marginTop: 10 }} onClick={() => { setView("signin"); setError(""); }}>
              ← Back to sign in
            </button>
          </>
        )}

        {view === "reset" && (
          <>
            <input
              style={input}
              type="password"
              autoComplete="new-password"
              placeholder="New password (10+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              style={input}
              type="password"
              autoComplete="new-password"
              placeholder="Repeat new password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doReset()}
            />
            <button style={primary} onClick={doReset} disabled={busy}>
              {busy ? "…" : "Set new password"}
            </button>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: C.parchmentDim,
                marginTop: 10,
                lineHeight: 1.5,
              }}
            >
              This signs you out everywhere else.
            </div>
          </>
        )}

        {view === "sent" && (
          <div style={{ fontSize: 13.5, color: C.parchment, lineHeight: 1.6 }}>
            Check <b>{email}</b> for a confirmation link. It's valid for 24 hours.
            <div style={{ marginTop: 14 }}>
              <button style={link} onClick={() => { setView("signin"); setNote(""); }}>
                ← Back to sign in
              </button>
            </div>
          </div>
        )}

        {view === "sent-reset" && (
          <div style={{ fontSize: 13.5, color: C.parchment, lineHeight: 1.6 }}>
            If an account exists for <b>{email}</b>, a reset link is on its way. It's valid for one
            hour.
            <div style={{ marginTop: 14 }}>
              <button style={link} onClick={() => { setView("signin"); setNote(""); }}>
                ← Back to sign in
              </button>
            </div>
          </div>
        )}

        {view === "verify-needed" && (
          <div style={{ fontSize: 13.5, color: C.parchment, lineHeight: 1.6 }}>
            This account still needs its email confirmed. Check your inbox for the link.
            <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
              <button style={link} onClick={resend} disabled={busy}>
                Send another link
              </button>
              <button style={link} onClick={() => { setView("signin"); setError(""); }}>
                ← Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   PROFILE GATE — pick who's opening the vault (server mode only)
   ============================================================ */
function ProfileGate({ onEnter }) {
  const [profiles, setProfiles] = useState([]);
  const [chosen, setChosen] = useState(null); // existing profile name
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Distinct from "no profiles yet" — a fetch failure (commonly the data
  // volume being unwritable) used to be swallowed silently, which looked
  // identical to there being no way to switch profiles at all.
  const [listError, setListError] = useState("");

  function loadProfiles() {
    setListError("");
    fetch("/api/profiles")
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `Server returned ${r.status}`);
        }
        return r.json();
      })
      .then((d) => setProfiles(d.profiles || []))
      .catch((e) =>
        setListError(
          `Couldn't load existing profiles (${e.message}). Check the server's data volume is writable.`
        )
      );
  }

  useEffect(() => {
    loadProfiles();
  }, []);

  async function enterExisting() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/store/${chosen}`, { headers: { "x-pin": pin } }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Couldn't reach the server.");
    if (res.status === 403) return setError("Wrong PIN.");
    if (!res.ok && res.status !== 404) return setError("Something went wrong.");
    onEnter(chosen, pin);
  }

  async function createProfile() {
    const n = name.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,24}$/.test(n))
      return setError("Names: 1-24 characters, letters, numbers, - or _.");
    if (profiles.includes(n)) return setError("That name is taken — pick it from the list instead.");
    setBusy(true);
    setError("");
    const res = await fetch(`/api/store/${n}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-pin": pin },
      body: JSON.stringify({ value: null, pin }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).error || "";
      } catch (e) {}
      return setError(detail || "Couldn't create the profile — is the HoardKeeper server running?");
    }
    onEnter(n, pin);
  }

  const inputS = {
    width: "100%",
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "10px 12px",
    color: C.parchment,
    fontSize: 14,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse 130% 90% at 50% -20%, #232629 0%, ${C.bg} 55%, #121417 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Archivo', sans-serif",
        padding: 20,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Spectral:wght@500;600&family=Archivo:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          border: "1px solid rgba(185,191,199,0.3)",
          borderRadius: 14,
          padding: 28,
          position: "relative",
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.6), inset 0 0 60px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 7,
            borderRadius: 9,
            border: "1.5px dashed rgba(185,191,199,0.3)",
            pointerEvents: "none",
          }}
        />
        <h1
          style={{
            fontFamily: "'Cinzel', serif",
            fontWeight: 700,
            fontSize: 24,
            letterSpacing: 1.5,
            color: C.goldBright,
            margin: "0 0 4px",
            textAlign: "center",
          }}
        >
          HOARDKEEPER
        </h1>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            letterSpacing: 2.2,
            textTransform: "uppercase",
            color: C.parchmentDim,
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          Whose vault is this?
        </div>

        {!creating && !chosen && (
          <>
            {listError && (
              <div
                style={{
                  color: C.redBright,
                  fontSize: 12,
                  lineHeight: 1.5,
                  marginBottom: 12,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  {listError}{" "}
                  <button
                    onClick={loadProfiles}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.redBright,
                      textDecoration: "underline",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 12,
                    }}
                  >
                    Retry
                  </button>
                </span>
              </div>
            )}
            {profiles.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setChosen(p);
                  setError("");
                  setPin("");
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  fontFamily: "'Spectral', serif",
                  fontWeight: 600,
                  fontSize: 15,
                  background: "rgba(0,0,0,0.28)",
                  color: C.parchment,
                  border: "1px solid rgba(185,191,199,0.2)",
                  borderRadius: 8,
                  padding: "12px 15px",
                  marginBottom: 8,
                  cursor: "pointer",
                }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => {
                setCreating(true);
                setError("");
              }}
              style={{
                display: "block",
                width: "100%",
                background: `linear-gradient(180deg, ${C.stock}, ${C.stockDark})`,
                color: C.stockInk,
                border: "none",
                borderRadius: 8,
                padding: "12px 15px",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                boxShadow: "inset 0 0 0 1px rgba(40,44,50,0.4), 0 2px 0 rgba(0,0,0,0.35)",
                marginTop: profiles.length ? 10 : 0,
              }}
            >
              + New profile
            </button>
          </>
        )}

        {chosen && (
          <>
            <div
              style={{
                fontFamily: "'Spectral', serif",
                fontWeight: 600,
                fontSize: 17,
                color: C.goldBright,
                marginBottom: 12,
              }}
            >
              {chosen}
            </div>
            <input
              type="password"
              inputMode="numeric"
              placeholder="PIN (leave blank if none)"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && enterExisting()}
              style={inputS}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={enterExisting}
                disabled={busy}
                style={{
                  flex: 1,
                  background: `linear-gradient(180deg, ${C.stock}, ${C.stockDark})`,
                  color: C.stockInk,
                  border: "none",
                  borderRadius: 6,
                  padding: "11px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  boxShadow: "inset 0 0 0 1px rgba(40,44,50,0.4), 0 2px 0 rgba(0,0,0,0.35)",
                }}
              >
                {busy ? "…" : "Open vault"}
              </button>
              <button
                onClick={() => setChosen(null)}
                style={{
                  background: "none",
                  border: `1px solid ${C.border}`,
                  color: C.parchmentDim,
                  borderRadius: 6,
                  padding: "11px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Back
              </button>
            </div>
          </>
        )}

        {creating && (
          <>
            <input
              placeholder="Profile name (e.g. michael)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ ...inputS, marginBottom: 10 }}
              autoFocus
            />
            <input
              type="password"
              inputMode="numeric"
              placeholder="Optional PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProfile()}
              style={inputS}
            />
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: C.parchmentDim,
                margin: "8px 2px 0",
                lineHeight: 1.5,
              }}
            >
              The PIN keeps friends out of each other's vaults. It's casual protection, not real
              security — don't reuse a password.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={createProfile}
                disabled={busy}
                style={{
                  flex: 1,
                  background: `linear-gradient(180deg, ${C.stock}, ${C.stockDark})`,
                  color: C.stockInk,
                  border: "none",
                  borderRadius: 6,
                  padding: "11px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  boxShadow: "inset 0 0 0 1px rgba(40,44,50,0.4), 0 2px 0 rgba(0,0,0,0.35)",
                }}
              >
                {busy ? "…" : "Create & enter"}
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setError("");
                }}
                style={{
                  background: "none",
                  border: `1px solid ${C.border}`,
                  color: C.parchmentDim,
                  borderRadius: 6,
                  padding: "11px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Back
              </button>
            </div>
          </>
        )}

        {error && (
          <div style={{ color: C.redBright, fontSize: 12.5, marginTop: 12 }}>{error}</div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   GLOSSARY — plain-language keyword guide, built from your cards
   ============================================================ */

// Definitions written in plain language. `re` is tested against oracle text
// plus type line, lowercased. Order roughly: evergreen abilities, then
// keyword actions, then common mechanics and tokens.
const KEYWORD_GUIDE = [
  { k: "Flying", re: /\bflying\b/, d: "This creature can only be blocked by creatures with flying or reach. It sails over everything else." },
  { k: "First strike", re: /\bfirst strike\b/, d: "Deals its combat damage before creatures without it. If it kills the blocker first, it takes nothing back." },
  { k: "Double strike", re: /\bdouble strike\b/, d: "Deals combat damage twice — once with first strikers, then again with everyone else." },
  { k: "Deathtouch", re: /\bdeathtouch\b/, d: "Any amount of damage this deals to a creature is enough to destroy it. Even 1 damage kills." },
  { k: "Defender", re: /\bdefender\b/, d: "Can block, but can't attack. Walls and gates have this." },
  { k: "Flash", re: /\bflash\b/, d: "You can cast this at any time you could cast an instant — including in the middle of combat or on your opponent's turn." },
  { k: "Haste", re: /\bhaste\b/, d: "Can attack and use tap abilities the turn it comes down, skipping the usual one-turn wait ('summoning sickness')." },
  { k: "Hexproof", re: /\bhexproof\b/, d: "Your opponents can't target it with spells or abilities. You still can." },
  { k: "Indestructible", re: /\bindestructible\b/, d: "Ignores 'destroy' effects and lethal damage. Can still be exiled, sacrificed, or shrunk to 0 toughness." },
  { k: "Lifelink", re: /\blifelink\b/, d: "Damage this deals also gains you that much life, simultaneously." },
  { k: "Menace", re: /\bmenace\b/, d: "Can't be blocked by just one creature — your opponent must commit two or more blockers." },
  { k: "Protection", re: /\bprotection from\b/, d: "Protection from X means it can't be damaged, enchanted, equipped, blocked, or targeted by anything X. Remember it as DEBT: Damaged, Enchanted, Blocked, Targeted." },
  { k: "Reach", re: /\breach\b/, d: "Can block creatures with flying, despite being grounded. Spiders, mostly." },
  { k: "Trample", re: /\btrample\b/, d: "If it deals more combat damage than the blocker can absorb, the excess spills through to the defending player." },
  { k: "Vigilance", re: /\bvigilance\b/, d: "Doesn't tap when attacking, so it's still available to block on the way back." },
  { k: "Ward", re: /\bward\b/, d: "Ward N taxes your opponents: their spell or ability targeting this is countered unless they pay N extra." },

  { k: "Scry", re: /\bscry \d|\bscry x\b/, d: "Look at that many cards from the top of your library; put any of them on the bottom and the rest back on top in any order. Quality control for your next draws." },
  { k: "Surveil", re: /\bsurveil \d/, d: "Like scry, but rejected cards go to your graveyard instead of the bottom — which some decks actively want." },
  { k: "Sacrifice", re: /\bsacrifice\b/, d: "Put your own permanent into the graveyard as a cost or effect. Sacrificed things can't be saved by indestructible, and only you can sacrifice your own permanents." },
  { k: "Exile", re: /\bexile\b/, d: "Removed from the game entirely — a zone outside the graveyard where most things can't be retrieved. The cleanest removal." },
  { k: "Mill", re: /\bmill(s|ed)? \d|\bmill(s|ed)? x\b/, d: "Put that many cards from the top of a library straight into the graveyard. A win condition for some, fuel for graveyard decks." },
  { k: "Counterspells", re: /counter target .*(spell|abilit)/, d: "Cancel a spell while it's still being cast — it goes to the graveyard and never happens. Only works while the spell is on the stack." },
  { k: "Fight", re: /\bfights?\b/, d: "Two creatures deal damage equal to their power to each other simultaneously. Neither is 'combat' damage, so first strike doesn't apply." },
  { k: "Proliferate", re: /\bproliferate\b/, d: "Choose any number of permanents and players with counters on them; give each one more of each kind of counter they already have." },
  { k: "Goad", re: /\bgoad(s|ed)?\b/, d: "A goaded creature must attack someone other than you next turn if able. Multiplayer chaos fuel." },
  { k: "Tap / Untap", re: /\{t\}|untap(s|ped)?/, d: "Tapping (turning sideways) marks a card as used — for attacking, mana, or abilities. Untapping at the start of your turn resets it." },

  { k: "+1/+1 counters", re: /\+1\/\+1 counter/, d: "Physical markers that permanently grow a creature by one power and one toughness each. They stay through anything short of the creature leaving the battlefield." },
  { k: "Tokens", re: /create.*token/, d: "Creature (or other) cards generated by an effect rather than cast from your hand. They vanish for good if they ever leave the battlefield." },
  { k: "Treasure", re: /\btreasure\b/, d: "An artifact token you can sacrifice for one mana of any color. Banked mana with a shovel." },
  { k: "Food", re: /\bfood\b.*token|sacrifice.*food/, d: "An artifact token: pay 2 and sacrifice it to gain 3 life." },
  { k: "Clue", re: /\bclue\b|investigate/, d: "An artifact token from 'investigate': pay 2 and sacrifice it to draw a card." },
  { k: "Equipment", re: /\bequip\b/, d: "An artifact you attach to a creature for its equip cost. The gear stays on the battlefield when the wearer dies and can be re-equipped." },
  { k: "Auras", re: /\benchant creature\b|\benchant permanent\b|\benchant land\b/, d: "Enchantments attached to something. Unlike equipment, an aura goes to the graveyard if the thing it enchants leaves." },

  { k: "Landfall", re: /\blandfall\b/, d: "An ability word: something happens every time a land enters the battlefield under your control. Rewarded for simply playing lands — and doubly for fetching extras." },
  { k: "Prowess", re: /\bprowess\b/, d: "Gets +1/+1 until end of turn whenever you cast a noncreature spell. Spellslinger decks stack these triggers fast." },
  { k: "Cascade", re: /\bcascade\b/, d: "When you cast this, exile cards from the top of your library until you hit a cheaper nonland spell — then cast that one for free." },
  { k: "Flashback", re: /\bflashback\b/, d: "A spell you can cast a second time from your graveyard for its flashback cost, then it exiles itself." },
  { k: "Kicker", re: /\bkick(er|ed)\b/, d: "An optional extra cost. Pay it when casting and the spell does something bigger." },
  { k: "Monarch", re: /\bmonarch\b/, d: "A title one player holds: draw an extra card at your end step. Dealing combat damage to the monarch steals the crown." },
  { k: "Partner", re: /\bpartner\b/, d: "Commander mechanic: two legends with partner can share the command zone as co-commanders." },
  { k: "Devotion", re: /\bdevotion\b/, d: "Counts the colored mana symbols among permanents you control. More committed to a color, bigger the payoff." },
  { k: "The Ring tempts you", re: /the ring tempts you/, d: "A Lord of the Rings mechanic: each temptation upgrades your Ring's powers and picks a Ring-bearer creature that gets progressively harder to block and more dangerous." },

  // ---- expanded batch: commonly missed keywords from the last decade or so of sets ----
  { k: "Convoke", re: /\bconvoke\b/, d: "You can tap untapped creatures you control to help cast this spell — each one pays for one generic mana, or one mana of its own color." },
  { k: "Delve", re: /\bdelve\b/, d: "You can exile cards from your graveyard to help pay this spell's generic mana cost, one card per generic mana." },
  { k: "Escape", re: /\bescape\b/, d: "You can cast this from your graveyard by paying its escape cost, which includes exiling a number of other cards from your graveyard." },
  { k: "Mutate", re: /\bmutate\b/, d: "Cast this onto a non-Human creature you own instead of the battlefield. The two merge into one creature with all abilities, using whichever card's stats are on top." },
  { k: "Foretell", re: /\bforetell\b/, d: "During your turn, you can pay {2} and exile this from your hand face down. Later, cast it for its (usually cheaper) foretell cost." },
  { k: "Disturb", re: /\bdisturb\b/, d: "You can cast this from your graveyard as its (usually different) back face, typically an Aura or lesser version, for its disturb cost." },
  { k: "Blitz", re: /\bblitz\b/, d: "Cast a creature for its blitz cost and it gains haste, plus you draw a card when it dies — but it's sacrificed at the next end step." },
  { k: "Backup", re: /\bbackup\b/, d: "This creature enters and gives +1/+1 counters and some of its own abilities to itself and/or another target creature for the turn." },
  { k: "Bargain", re: /\bbargain\b/, d: "You can sacrifice an artifact, enchantment, or token as you cast this for an extra effect or discount." },
  { k: "Offspring", re: /\boffspring\b/, d: "Pay the offspring cost as you cast this creature to also create a 1/1 copy of it." },
  { k: "Impending", re: /\bimpending\b/, d: "Cast for its impending cost, it enters as a non-creature enchantment with a countdown; once the counters run out it becomes a creature." },
  { k: "Discover", re: /\bdiscover \d/, d: "Exile cards from the top of your library until you hit a nonland card costing less than the discover value, then cast it free or put it in hand." },
  { k: "Boast", re: /\bboast\b/, d: "An ability you can activate only if this creature attacked this turn." },
  { k: "Blood token", re: /blood token/, d: "An artifact token: pay 1 and discard a card to draw a card. A slower, card-filtering cousin of Clue and Treasure." },
  { k: "Role token", re: /role token/, d: "An Aura token that attaches to a creature and grants it a small, fixed bonus (like +1/+1 or flying) depending on which role it is." },
  { k: "Manifest", re: /\bmanifest(s|ed)?\b/, d: "Put the top card of your library onto the battlefield face down as a 2/2 creature. It can be turned face up later if it's a creature card." },
  { k: "Storm", re: /\bstorm\b/, d: "When you cast this, copy it once for each other spell cast earlier this turn. Can produce a huge number of copies in the right deck." },
  { k: "Affinity", re: /\baffinity for\b/, d: "This spell costs {1} less to cast for each permanent you control matching the stated type (usually artifacts)." },
  { k: "Explore", re: /\bexplores?\b/, d: "Reveal the top card of your library. Put it in hand if it's a land; otherwise put a +1/+1 counter on the exploring creature and choose whether to keep the card on top or bin it." },
  { k: "Amass", re: /\bamass\b/, d: "Put counters on an Army creature you control, creating a 0/0 Army token first if you don't have one." },
  { k: "Jump-start", re: /jump-start/, d: "Cast this from your graveyard by discarding a card in addition to its normal cost, then it's exiled instead of returning to the graveyard." },
  { k: "Unearth", re: /\bunearth\b/, d: "Pay the unearth cost to return this creature from your graveyard to the battlefield with haste — but it's exiled if it would leave the battlefield, or at the next end step." },
  { k: "Persist", re: /\bpersist\b/, d: "When this dies, if it had no -1/-1 counters on it, return it to the battlefield with a -1/-1 counter." },
  { k: "Wither", re: /\bwither\b/, d: "This deals damage to creatures in the form of -1/-1 counters instead of regular damage, which doesn't heal at end of turn." },
  { k: "Infect", re: /\binfect\b/, d: "This deals damage to creatures as -1/-1 counters and to players as poison counters instead of life loss. Ten poison counters is a loss." },
  { k: "Connive", re: /\bconnives?\b/, d: "Draw a card, then discard a card. If you discarded a nonland card this way, put a +1/+1 counter on the connived creature." },
  { k: "Ninjutsu", re: /\bninjutsu\b/, d: "Return an unblocked attacker you control to hand to put this creature from hand onto the battlefield attacking in its place." },
  { k: "Cycling", re: /\bcycling\b/, d: "Pay the cycling cost and discard this card from your hand to draw a new card — a way to turn a dead draw into a fresh one." },
  { k: "Morph", re: /\bmorph\b/, d: "You can cast this face down as a vanilla 2/2 for {3}, then later pay its morph cost to turn it face up." },
  { k: "Bestow", re: /\bbestow\b/, d: "Cast this for its bestow cost to have it enter as an Aura enchanting a creature instead of a creature itself, granting its stats and abilities." },
  { k: "Embalm / Eternalize", re: /\b(embalm|eternalize)\b/, d: "Exile this card from your graveyard to create a token copy of it (embalm makes it the printed size; eternalize makes it a 4/4)." },
  { k: "Enlist", re: /\benlist\b/, d: "As this attacks, you can tap an untapped non-attacking creature to add its power to this one's for combat." },
  { k: "Casualty", re: /\bcasualty\b/, d: "You can sacrifice a creature with the stated power or greater as you cast this to copy the spell." },
  { k: "Alliance", re: /\balliance\b/, d: "An ability word: triggers whenever another creature enters the battlefield under your control." },
];

/* ============================================================
   LIFE COUNTER — live game tracker (Commander / Normal)
   ============================================================ */

const LIFE_STARTING = { commander: 40, normal: 20 };
const LIFE_STORAGE_KEY = "hk-life-tracker";

function makeLifePlayer(id, name, life) {
  return { id, name, life, cmdDmg: {} };
}

function loadSavedLife() {
  try {
    const s = JSON.parse(localStorage.getItem(LIFE_STORAGE_KEY));
    if (s && Array.isArray(s.players) && s.players.length >= 2) return s;
  } catch (e) {}
  return null;
}

const lifeIconBtn = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 3,
  display: "flex",
  alignItems: "center",
};
const lifeStepBtn = {
  background: "rgba(185,191,199,0.1)",
  border: `1px solid rgba(185,191,199,0.25)`,
  borderRadius: 5,
  color: C.parchment,
  fontSize: 12.5,
  fontWeight: 600,
  padding: "5px 11px",
  cursor: "pointer",
};
const lifeTinyBtn = {
  background: "rgba(185,191,199,0.1)",
  border: `1px solid rgba(185,191,199,0.25)`,
  borderRadius: 3,
  color: C.parchment,
  fontSize: 11,
  width: 20,
  height: 20,
  cursor: "pointer",
  lineHeight: 1,
};
function lifeCountBtn(disabled) {
  return {
    background: "none",
    border: `1px solid rgba(185,191,199,0.25)`,
    borderRadius: 3,
    color: disabled ? "rgba(139,144,151,0.4)" : C.parchmentDim,
    width: 20,
    height: 20,
    cursor: disabled ? "default" : "pointer",
    fontSize: 13,
    lineHeight: 1,
  };
}

function LifeCounterView({ onExit }) {
  const idRef = useRef(1);

  const [format, setFormat] = useState(() => loadSavedLife()?.format || "commander");
  const [players, setPlayers] = useState(() => {
    const saved = loadSavedLife();
    if (saved) {
      idRef.current = Math.max(...saved.players.map((p) => p.id)) + 1;
      return saved.players;
    }
    idRef.current = 5;
    return [1, 2, 3, 4].map((i) => makeLifePlayer(i, `Player ${i}`, LIFE_STARTING.commander));
  });
  const [expanded, setExpanded] = useState(null);
  const [rotated, setRotated] = useState({});

  // Floating "-N" / "+N" delta badges: taps accumulate into a running total
  // per player. The badge lingers while taps keep coming, then — once idle —
  // holds a moment before fading and scaling away, so a burst of quick taps
  // reads as one clear number instead of a blur of individual flashes.
  const [badges, setBadges] = useState({});
  const badgeTimers = useRef({});
  const badgePoofTimers = useRef({});
  const LINGER_MS = 900;
  const POOF_MS = 550;

  useEffect(() => {
    return () => {
      Object.values(badgeTimers.current).forEach(clearTimeout);
      Object.values(badgePoofTimers.current).forEach(clearTimeout);
    };
  }, []);

  function bumpBadge(id, delta) {
    setBadges((b) => {
      const cur = b[id];
      const amount = (cur && !cur.fading ? cur.amount : 0) + delta;
      return { ...b, [id]: { amount, fading: false } };
    });
    clearTimeout(badgeTimers.current[id]);
    clearTimeout(badgePoofTimers.current[id]);
    badgeTimers.current[id] = setTimeout(() => {
      setBadges((b) => (b[id] ? { ...b, [id]: { ...b[id], fading: true } } : b));
      badgePoofTimers.current[id] = setTimeout(() => {
        setBadges((b) => {
          if (!b[id]) return b;
          const next = { ...b };
          delete next[id];
          return next;
        });
      }, POOF_MS);
    }, LINGER_MS);
  }

  useEffect(() => {
    try {
      localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify({ format, players }));
    } catch (e) {}
  }, [format, players]);

  const maxPlayers = format === "commander" ? 6 : 4;
  const minPlayers = 2;

  function setFormatAndReset(f) {
    if (f === format) return;
    const start = LIFE_STARTING[f];
    setFormat(f);
    setPlayers((ps) => (f === "commander" ? ps : ps.slice(0, 4)).map((p) => ({ ...p, life: start, cmdDmg: {} })));
    setBadges({});
  }

  function addPlayer() {
    setPlayers((ps) => {
      if (ps.length >= maxPlayers) return ps;
      const id = idRef.current++;
      return [...ps, makeLifePlayer(id, `Player ${ps.length + 1}`, LIFE_STARTING[format])];
    });
  }

  function removePlayer() {
    setPlayers((ps) => (ps.length <= minPlayers ? ps : ps.slice(0, -1)));
  }

  function newGame() {
    const start = LIFE_STARTING[format];
    setPlayers((ps) => ps.map((p) => ({ ...p, life: start, cmdDmg: {} })));
    setExpanded(null);
    setBadges({});
  }

  function adjustLife(id, delta) {
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, life: p.life + delta } : p)));
    bumpBadge(id, delta);
  }

  function resetPlayer(id) {
    const start = LIFE_STARTING[format];
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, life: start, cmdDmg: {} } : p)));
  }

  function renamePlayer(id, name) {
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  function adjustCmdDmg(id, fromId, delta) {
    setPlayers((ps) =>
      ps.map((p) => {
        if (p.id !== id) return p;
        const next = Math.max(0, (p.cmdDmg[fromId] || 0) + delta);
        return { ...p, cmdDmg: { ...p.cmdDmg, [fromId]: next } };
      })
    );
  }

  const cols = players.length <= 2 ? 1 : players.length <= 4 ? 2 : 3;
  const rows = Math.ceil(players.length / cols);

  // The life number used a flat vw-based clamp regardless of column count,
  // so at 3 columns (5-6 players) it stayed close to full size while its
  // cell shrank to a third of the screen width — the number then collided
  // with the buttons and hint text beneath it. Scale both the vw factor and
  // the px ceiling down as columns increase, and cap by vh too so a wide,
  // short window (the common case that triggered this) can't blow past the
  // cell's actual height either.
  const NUMBER_VW = { 1: 9, 2: 6.5, 3: 5 };
  const NUMBER_MAX_PX = { 1: 96, 2: 78, 3: 62 };
  const numberFontSize = `clamp(28px, min(${NUMBER_VW[cols]}vw, 32vh), ${NUMBER_MAX_PX[cols]}px)`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 95,
        background: `radial-gradient(ellipse 130% 90% at 50% -20%, #232629 0%, ${C.bg} 55%, #121417 100%)`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes life-badge-in {
          from { opacity: 0; transform: translateY(4px) scale(0.75); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes life-badge-poof {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          40% { opacity: 1; transform: translateY(-6px) scale(1.12); }
          100% { opacity: 0; transform: translateY(-22px) scale(0.7); }
        }
        .life-badge { animation: life-badge-in 0.16s ease-out; }
        .life-badge.poofing { animation: life-badge-poof ${POOF_MS}ms ease-in forwards; }
        @media (prefers-reduced-motion: reduce) {
          .life-badge, .life-badge.poofing { animation: none; }
        }
      `}</style>

      {/* top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          padding: "14px clamp(14px, 4vw, 28px)",
          borderBottom: `1px solid rgba(185,191,199,0.15)`,
          flexShrink: 0,
        }}
      >
        <div className="serif" style={{ fontSize: 16, fontWeight: 600, color: C.goldBright }}>
          Life Counter
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {["commander", "normal"].map((f) => (
            <button
              key={f}
              onClick={() => setFormatAndReset(f)}
              style={{
                background: format === f ? STOCK_BG : "transparent",
                color: format === f ? C.stockInk : C.parchmentDim,
                border: `1px solid ${format === f ? C.stock : "rgba(185,191,199,0.26)"}`,
                borderRadius: 4,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {f} · {LIFE_STARTING[f]}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.parchmentDim, fontSize: 12.5 }}>
          <Users size={14} />
          <button onClick={removePlayer} disabled={players.length <= minPlayers} style={lifeCountBtn(players.length <= minPlayers)}>
            −
          </button>
          <span className="mono" style={{ color: C.parchment, minWidth: 14, textAlign: "center" }}>
            {players.length}
          </span>
          <button onClick={addPlayer} disabled={players.length >= maxPlayers} style={lifeCountBtn(players.length >= maxPlayers)}>
            +
          </button>
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={newGame}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 5,
            padding: "8px 14px",
            fontWeight: 700,
            fontSize: 12.5,
            cursor: "pointer",
            boxShadow: STOCK_SHADOW,
          }}
        >
          <RotateCcw size={14} /> New Game
        </button>

        <button
          onClick={onExit}
          title="Exit life counter"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            color: C.parchmentDim,
            border: `1px solid rgba(185,191,199,0.26)`,
            borderRadius: 5,
            padding: "8px 12px",
            fontWeight: 600,
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          <X size={14} /> Exit
        </button>
      </div>

      {/* player grid — fills the remaining screen */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gap: 1,
          background: "rgba(185,191,199,0.15)",
          overflow: "auto",
        }}
      >
        {players.map((p) => {
          const start = LIFE_STARTING[format];
          const lethal = Object.values(p.cmdDmg).some((v) => v >= 21);
          const badge = badges[p.id];
          return (
            <div
              key={p.id}
              style={{
                background: C.bg,
                padding: "14px clamp(12px, 2.5vw, 20px) 16px",
                transform: rotated[p.id] ? "rotate(180deg)" : "none",
                transition: "transform 0.25s ease",
                display: "flex",
                flexDirection: "column",
                // A grid cell won't shrink its content below intrinsic size on
                // its own — min-width/min-height:0 lets flex children actually
                // shrink to fit, and overflow:hidden is the backstop so an
                // expanded commander-damage list (or anything else) can never
                // visually spill into a neighboring cell, whatever the cause.
                minHeight: 0,
                minWidth: 0,
                // Horizontal clipping is a hard rule — a cell must never bleed
                // into a neighboring column. Vertical scroll is a fallback for
                // real edge cases (many players, expanded commander damage on
                // a short window) so damage tracking degrades into a scrollbar
                // rather than silently losing information.
                overflowX: "hidden",
                overflowY: "auto",
                boxShadow: lethal ? "inset 0 0 0 2px rgba(222,115,134,0.5)" : "none",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexShrink: 0 }}>
                <input
                  value={p.name}
                  onChange={(e) => renamePlayer(p.id, e.target.value)}
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: `1px solid rgba(185,191,199,0.25)`,
                    color: C.parchment,
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "2px 0",
                    width: "60%",
                  }}
                />
                <div style={{ display: "flex", gap: 2 }}>
                  <button onClick={() => setRotated((r) => ({ ...r, [p.id]: !r[p.id] }))} style={lifeIconBtn} title="Flip for the seat across the table">
                    <RotateCw size={13} color={C.parchmentDim} />
                  </button>
                  <button onClick={() => resetPlayer(p.id)} style={lifeIconBtn} title="Reset this player">
                    <RotateCcw size={13} color={C.parchmentDim} />
                  </button>
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                {badge && (
                  <div
                    className={`life-badge${badge.fading ? " poofing" : ""}`}
                    style={{
                      position: "absolute",
                      top: "8%",
                      left: "50%",
                      transform: "translateX(-50%)",
                      pointerEvents: "none",
                      zIndex: 2,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        display: "inline-block",
                        fontSize: "clamp(18px, 3vw, 26px)",
                        fontWeight: 700,
                        padding: "2px 12px",
                        borderRadius: 20,
                        background: badge.amount < 0 ? "rgba(222,115,134,0.16)" : "rgba(132,199,160,0.16)",
                        color: badge.amount < 0 ? C.redBright : C.greenBright,
                        border: `1px solid ${badge.amount < 0 ? "rgba(222,115,134,0.4)" : "rgba(132,199,160,0.4)"}`,
                      }}
                    >
                      {badge.amount > 0 ? "+" : ""}
                      {badge.amount}
                    </span>
                  </div>
                )}

                <div onClick={() => adjustLife(p.id, 1)} style={{ cursor: "pointer", textAlign: "center", userSelect: "none" }}>
                  <span
                    className="mono"
                    style={{
                      fontSize: numberFontSize,
                      fontWeight: 700,
                      color: p.life <= 0 ? C.redBright : p.life < start / 2 ? "#E8B34C" : C.goldBright,
                      lineHeight: 1,
                    }}
                  >
                    {p.life}
                  </span>
                </div>
                <div
                  onClick={() => adjustLife(p.id, -1)}
                  style={{ cursor: "pointer", textAlign: "center", padding: "4px 0 0", fontSize: 10, color: C.parchmentDim, userSelect: "none" }}
                >
                  tap number for +1 · tap here for −1
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: format === "commander" ? 8 : 0, flexShrink: 0 }}>
                <button onClick={() => adjustLife(p.id, -5)} style={lifeStepBtn}>−5</button>
                <button onClick={() => adjustLife(p.id, -1)} style={lifeStepBtn}>−1</button>
                <button onClick={() => adjustLife(p.id, 1)} style={lifeStepBtn}>+1</button>
                <button onClick={() => adjustLife(p.id, 5)} style={lifeStepBtn}>+5</button>
              </div>

              {format === "commander" && (
                <div style={{ borderTop: `1px solid rgba(185,191,199,0.15)`, paddingTop: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => setExpanded((e) => (e === p.id ? null : p.id))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "none",
                      border: "none",
                      color: lethal ? C.redBright : C.parchmentDim,
                      fontSize: 11.5,
                      cursor: "pointer",
                      padding: "2px 0",
                      width: "100%",
                    }}
                  >
                    <Swords size={12} />
                    Commander damage{lethal ? " — LETHAL" : ""}
                    <ChevronDown size={12} style={{ marginLeft: "auto", transform: expanded === p.id ? "rotate(180deg)" : "none" }} />
                  </button>
                  {expanded === p.id && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6, maxHeight: cols === 3 ? 84 : 110, overflowY: "auto" }}>
                      {players.filter((o) => o.id !== p.id).map((o) => {
                        const dmg = p.cmdDmg[o.id] || 0;
                        return (
                          <div key={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, color: C.parchmentDim }}>
                            <span style={{ maxWidth: "50%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              from {o.name}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <button onClick={() => adjustCmdDmg(p.id, o.id, -1)} style={lifeTinyBtn}>−</button>
                              <span className="mono" style={{ color: dmg >= 21 ? C.redBright : C.parchment, minWidth: 16, textAlign: "center" }}>
                                {dmg}
                              </span>
                              <button onClick={() => adjustCmdDmg(p.id, o.id, 1)} style={lifeTinyBtn}>+</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GlossaryView({ cards }) {
  // Reads and writes through the exact same cache fetchOracleTexts uses
  // (localStorage key "lf-oracle-v2") — this used to read from a different,
  // stale key ("lf-oracle-cache") that nothing ever wrote to, so every scan
  // appeared to vanish on the next visit even though the real cache was
  // sitting there correctly the whole time.
  const [oracle, setOracle] = useState({});
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState("");

  const owned = useMemo(() => cards.filter((c) => !c.sold), [cards]);
  const withText = useMemo(
    () => owned.filter((c) => c.scryfallId && oracle[c.scryfallId]),
    [owned, oracle]
  );

  async function scan() {
    setScanning(true);
    try {
      const map = await fetchOracleTexts(owned.filter((c) => c.scryfallId).map((c) => c.scryfallId));
      setOracle({ ...map });
    } catch (e) {}
    setScanning(false);
  }

  // Load automatically on mount/whenever the collection changes — cards
  // already in the cache resolve instantly with no network call at all, so
  // this only ever costs something real for genuinely new cards. No more
  // needing to remember to press Scan just to see what you already scanned.
  useEffect(() => {
    let live = true;
    const ids = owned.filter((c) => c.scryfallId).map((c) => c.scryfallId);
    if (ids.length === 0) return;
    fetchOracleTexts(ids)
      .then((map) => {
        if (live) setOracle((prev) => ({ ...prev, ...map }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owned.map((c) => c.scryfallId).join(",")]);

  const entries = useMemo(() => {
    return KEYWORD_GUIDE.map((kw) => {
      const matches = [];
      withText.forEach((c) => {
        const text = ((oracle[c.scryfallId]?.t || "") + " " + (c.typeLine || "")).toLowerCase();
        if (kw.re.test(text)) matches.push(c.name);
      });
      const unique = [...new Set(matches)];
      return { ...kw, count: unique.length, examples: unique.slice(0, 3) };
    })
      .filter((e) => e.count > 0)
      .filter((e) => !query || e.k.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.count - a.count);
  }, [withText, oracle, query]);

  const unscanned = owned.filter((c) => c.scryfallId && !oracle[c.scryfallId]).length;

  return (
    <main style={{ padding: "16px clamp(14px, 4vw, 30px) 48px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <div className="serif" style={{ fontSize: 16, fontWeight: 600, color: C.goldBright }}>
          Keywords on your cards
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
          {entries.length} mechanics found across {withText.length} scanned cards
        </span>
        <div style={{ flex: 1 }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a keyword…"
          style={{
            background: C.bgPanel2,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "8px 11px",
            color: C.parchment,
            fontSize: 13,
            width: 170,
          }}
        />
        {unscanned > 0 && (
          <button
            onClick={scan}
            disabled={scanning}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: STOCK_BG,
              color: C.stockInk,
              border: "none",
              borderRadius: 5,
              padding: "8px 14px",
              fontWeight: 700,
              fontSize: 12.5,
              cursor: scanning ? "default" : "pointer",
              boxShadow: STOCK_SHADOW,
            }}
          >
            {scanning ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={14} />}
            Scan {unscanned} unread cards
          </button>
        )}
      </div>

      {withText.length === 0 && !scanning && (
        <div
          style={{
            border: `1px dashed rgba(185,191,199,0.3)`,
            borderRadius: 10,
            padding: 30,
            maxWidth: 560,
            color: C.parchmentDim,
            fontSize: 13.5,
            lineHeight: 1.6,
          }}
        >
          The glossary reads your cards' rules text to find which mechanics actually appear in your
          collection — it loads automatically and stays cached, so this only takes a moment the
          first time. New cards get picked up the next time you open this tab, or press{" "}
          <b style={{ color: C.parchment }}>Scan</b> to fetch them right away.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {entries.map((e) => (
          <div
            key={e.k}
            style={{
              background: "rgba(0,0,0,0.28)",
              border: `1px solid rgba(185,191,199,0.18)`,
              borderRadius: 10,
              padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 9 }}>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  background: STOCK_BG,
                  color: C.stockInk,
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: 3,
                  boxShadow: STOCK_SHADOW,
                }}
              >
                {e.k}
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, flexShrink: 0 }}>
                {e.count} card{e.count === 1 ? "" : "s"}
              </span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: C.parchment }}>{e.d}</div>
            {e.examples.length > 0 && (
              <div className="serif" style={{ fontSize: 12, color: C.parchmentDim, marginTop: 9, fontStyle: "italic" }}>
                e.g. {e.examples.join(" · ")}
                {e.count > e.examples.length ? ` +${e.count - e.examples.length} more` : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}

/* ============================================================
   DECK LISTS — import and export
   ============================================================ */

function downloadFile(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const DECK_BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"];
const DECK_SECTIONS =
  /^(deck|main(deck|board)?|commander|companion|sideboard|maybe(board)?|tokens?|considering)\b/i;

// Parses a pasted decklist. Handles the common exports — Moxfield, Archidekt,
// MTGO/Arena — and plain "4 Lightning Bolt" lists.
function parseDecklist(text) {
  const out = { commander: null, entries: [], basics: {}, ignored: [], sideboard: [] };
  let section = "deck";

  String(text || "")
    .split(/\r?\n/)
    .forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      if (/^(\/\/|#)/.test(line)) return; // comments, including our own token block
      const head = line.replace(/[:(].*$/, "").trim();
      if (DECK_SECTIONS.test(head) && !/^\d/.test(line)) {
        section = head.toLowerCase();
        return;
      }

      // 4 Lightning Bolt (2X2) 117 *F* *CMDR*
      const m = line.match(
        /^(\d+)?\s*[xX]?\s*(.+?)\s*(?:\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9-★]+)?)?\s*((?:\*[^*]+\*\s*)*)$/
      );
      if (!m) {
        out.ignored.push(line);
        return;
      }
      const qty = parseInt(m[1] || "1", 10);
      const tags = (m[5] || "").toLowerCase();
      // double-faced cards export as "Front // Back"
      const name = (m[2] || "").split("//")[0].trim();
      if (!name) {
        out.ignored.push(line);
        return;
      }

      const rec = {
        qty,
        name,
        set: m[3] ? m[3].toLowerCase() : null,
        num: m[4] || null,
        foil: /\*f\*|foil/.test(tags),
      };

      if ((tags.includes("cmdr") || section === "commander") && !out.commander) {
        out.commander = rec;
        return;
      }
      if (section.startsWith("side") || section.startsWith("maybe") || section === "considering") {
        out.sideboard.push(rec);
        return;
      }
      if (section.startsWith("token")) return;

      const basic = DECK_BASICS.find((b) => b.toLowerCase() === name.toLowerCase());
      if (basic) {
        out.basics[basic] = (out.basics[basic] || 0) + qty;
        return;
      }
      out.entries.push(rec);
    });

  return out;
}

// Pairs parsed lines with cards you own. Prefers the exact printing when the
// list names one, then any copy not committed to another deck.
function matchDecklist(parsed, cards, committed = {}) {
  const byName = {};
  cards
    .filter((c) => !c.sold)
    .forEach((c) => {
      const k = c.name.toLowerCase();
      (byName[k] = byName[k] || []).push(c);
    });

  const used = {};
  const entries = [];
  const missing = [];
  const partial = [];

  const freeCopies = (c) => (c.quantity || 1) - (committed[c.id] || 0) - (used[c.id] || 0);

  // Returns the card ids claimed, in order.
  function claim(rec, limit) {
    const pool = byName[rec.name.toLowerCase()] || [];
    const exact = pool.filter(
      (c) =>
        rec.set &&
        c.set?.toLowerCase() === rec.set &&
        (!rec.num || String(c.collectorNumber) === String(rec.num))
    );
    const order = [...exact, ...pool.filter((c) => !exact.includes(c))];
    const taken = [];
    let need = limit ?? rec.qty;
    for (const c of order) {
      if (need <= 0) break;
      const avail = Math.max(0, freeCopies(c));
      if (avail <= 0) continue;
      const take = Math.min(avail, need);
      used[c.id] = (used[c.id] || 0) + take;
      taken.push({ id: c.id, take });
      need -= take;
    }
    return taken;
  }

  // Commander first, so it gets the copy it names.
  let commanderId = null;
  if (parsed.commander) {
    const got = claim(parsed.commander, 1);
    if (got.length) commanderId = got[0].id;
    else missing.push({ ...parsed.commander, have: 0, isCommander: true });
  }

  parsed.entries.forEach((rec) => {
    const got = claim(rec);
    const total = got.reduce((n, g) => n + g.take, 0);
    got.forEach((g) => {
      const existing = entries.find((e) => e.cardId === g.id);
      if (existing) existing.qty += g.take;
      else entries.push({ cardId: g.id, qty: g.take, role: "other" });
    });
    if (total === 0) missing.push({ ...rec, have: 0 });
    else if (total < rec.qty) partial.push({ ...rec, have: total });
  });

  return { entries, commanderId, basics: { ...parsed.basics }, missing, partial };
}

// Plain-text decklist, the format every deckbuilder understands.
function deckToText(deck, cardById, commander, tokens, tokenQty) {
  const lines = [];
  if (commander) {
    lines.push("Commander");
    lines.push(
      `1 ${commander.name}${commander.set ? ` (${commander.set.toUpperCase()}) ${commander.collectorNumber || ""}`.trimEnd() : ""}`
    );
    lines.push("");
    lines.push("Deck");
  }
  deck.entries.forEach((e) => {
    const c = cardById[e.cardId];
    if (!c) return;
    const printing = c.set ? ` (${c.set.toUpperCase()}) ${c.collectorNumber || ""}`.trimEnd() : "";
    lines.push(`${e.qty || 1} ${c.name}${printing}`);
  });
  Object.entries(deck.basics || {}).forEach(([name, n]) => lines.push(`${n} ${name}`));
  const wanted = (tokens || []).filter((t) => tokenQty(t.id) > 0);
  if (wanted.length) {
    lines.push("");
    lines.push("// Tokens needed:");
    wanted.forEach((t) => lines.push(`// ${tokenQty(t.id)} ${t.name}${t.ty ? ` (${t.ty})` : ""}`));
  }
  return lines.join("\n");
}

// Basics have no owned printing attached (a quick-add "Forest" isn't tied to
// any specific card in your binder) so there's no real set to record — but
// the type line is always knowable from the name, and leaving it out is
// exactly the gap that made lands unrecognizable on their own in an export.
const BASIC_TYPE_LINES = {
  Plains: "Basic Land — Plains",
  Island: "Basic Land — Island",
  Swamp: "Basic Land — Swamp",
  Mountain: "Basic Land — Mountain",
  Forest: "Basic Land — Forest",
  Wastes: "Basic Land",
};

// Full fidelity: keeps the printing AND type of every card, so a re-import
// is exact and the file is self-documenting without cross-referencing
// Scryfall for what each line actually is.
function deckToJson(deck, cardById, commander) {
  return JSON.stringify(
    {
      hoardkeeper: 1,
      name: deck.name,
      format: deck.format || "commander",
      colors: deck.colors || null,
      exported: new Date().toISOString(),
      commander: commander
        ? {
            name: commander.name,
            set: commander.set,
            collectorNumber: commander.collectorNumber,
            typeLine: commander.typeLine || null,
          }
        : null,
      cards: deck.entries
        .map((e) => {
          const c = cardById[e.cardId];
          if (!c) return null;
          return {
            qty: e.qty || 1,
            name: c.name,
            set: c.set,
            collectorNumber: c.collectorNumber,
            typeLine: c.typeLine || null,
            finish: finishOf(c),
            role: e.role,
          };
        })
        .filter(Boolean),
      // kept as a plain {name: qty} map for backward compatibility with
      // earlier exports, PLUS a richer parallel list carrying the type each
      // basic actually is -- jsonToParsed reads either shape.
      basics: deck.basics || {},
      basicsDetail: Object.entries(deck.basics || {}).map(([name, qty]) => ({
        name,
        qty,
        typeLine: BASIC_TYPE_LINES[name] || "Basic Land",
      })),
      tokenCounts: deck.tokenCounts || {},
      extraTokens: deck.extraTokens || [],
    },
    null,
    2
  );
}

// A HoardKeeper JSON export, converted back into the parser's shape.
function jsonToParsed(json) {
  const d = JSON.parse(json);
  if (!d || !Array.isArray(d.cards)) throw new Error("Not a HoardKeeper deck file");
  return {
    meta: { name: d.name, format: d.format, colors: d.colors, tokenCounts: d.tokenCounts, extraTokens: d.extraTokens },
    commander: d.commander
      ? { qty: 1, name: d.commander.name, set: d.commander.set, num: d.commander.collectorNumber }
      : null,
    entries: d.cards.map((c) => ({
      qty: c.qty || 1,
      name: c.name,
      set: c.set || null,
      num: c.collectorNumber || null,
    })),
    basics: d.basics || {},
    ignored: [],
    sideboard: [],
  };
}

function ImportDeckModal({ cards, committed, onClose, onImport }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState("");

  function analyse(source, fileName) {
    setError("");
    const raw = source.trim();
    if (!raw) return;
    let parsed;
    let m = null;
    try {
      if (raw.startsWith("{")) {
        const j = jsonToParsed(raw);
        parsed = j;
        m = j.meta;
      } else {
        parsed = parseDecklist(raw);
      }
    } catch (e) {
      setError(e.message || "Couldn't read that list.");
      return;
    }
    const matched = matchDecklist(parsed, cards, committed);
    setMeta(m);
    setPreview({ ...matched, parsed });
    if (!name) {
      setName(
        m?.name ||
          (fileName ? fileName.replace(/\.(txt|json|dec|dek)$/i, "") : "") ||
          "Imported deck"
      );
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || "");
      setText(content);
      analyse(content, file.name);
    };
    reader.readAsText(file);
  }

  const totalWanted =
    preview?.parsed.entries.reduce((n, e) => n + e.qty, 0) +
    Object.values(preview?.parsed.basics || {}).reduce((n, v) => n + v, 0) +
    (preview?.parsed.commander ? 1 : 0);
  const totalMatched =
    (preview?.entries.reduce((n, e) => n + e.qty, 0) || 0) +
    Object.values(preview?.basics || {}).reduce((n, v) => n + v, 0) +
    (preview?.commanderId ? 1 : 0);

  const inputS = {
    width: "100%",
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "10px 12px",
    color: C.parchment,
    fontSize: 13,
  };

  return (
    <ModalShell title="Import a deck" onClose={onClose} width={620}>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0, lineHeight: 1.6 }}>
        Paste a decklist from Moxfield, Archidekt, Arena or anywhere else — or load a{" "}
        <span className="mono">.txt</span> / HoardKeeper <span className="mono">.json</span> file.
        Cards are matched against what you own; anything missing is listed rather than invented.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && analyse(text)}
        placeholder={"1 Sol Ring (LTC) 59\n4 Lightning Bolt\n10 Forest"}
        rows={8}
        style={{ ...inputS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, resize: "vertical" }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => analyse(text)}
          disabled={!text.trim()}
          style={{
            background: text.trim() ? STOCK_BG : C.border,
            color: text.trim() ? C.stockInk : C.parchmentDim,
            border: "none",
            borderRadius: 6,
            padding: "9px 16px",
            fontWeight: 700,
            fontSize: 13,
            cursor: text.trim() ? "pointer" : "default",
            boxShadow: text.trim() ? STOCK_SHADOW : "none",
          }}
        >
          Check list
        </button>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            background: "transparent",
            border: `1px solid ${C.border}`,
            color: C.parchmentDim,
            borderRadius: 6,
            padding: "9px 14px",
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          Load a file
          <input type="file" accept=".txt,.json,.dec,.dek,text/plain,application/json" onChange={handleFile} style={{ display: "none" }} />
        </label>
      </div>

      {error && <div style={{ color: C.redBright, fontSize: 12.5, marginTop: 10 }}>{error}</div>}

      {preview && (
        <div style={{ marginTop: 16 }}>
          <Field label="Deck name">
            <input style={inputS} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div
            className="mono"
            style={{
              fontSize: 11.5,
              color: totalMatched === totalWanted ? C.greenBright : C.goldBright,
              marginBottom: 10,
            }}
          >
            {totalMatched} of {totalWanted} cards matched from your collection
            {preview.commanderId ? " · commander found" : preview.parsed.commander ? " · commander missing" : ""}
          </div>

          {(preview.missing.length > 0 || preview.partial.length > 0) && (
            <div
              style={{
                border: `1px solid rgba(222,115,134,0.35)`,
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 12,
                maxHeight: 170,
                overflowY: "auto",
              }}
            >
              <div
                className="mono"
                style={{ fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.redBright, marginBottom: 6 }}
              >
                Not added — you don't own these (or they're in another deck)
              </div>
              {preview.missing.map((m, i) => (
                <div key={`m${i}`} className="mono" style={{ fontSize: 11, color: C.parchmentDim, padding: "1px 0" }}>
                  {m.qty}× {m.name}
                  {m.isCommander ? " (commander)" : ""}
                </div>
              ))}
              {preview.partial.map((p, i) => (
                <div key={`p${i}`} className="mono" style={{ fontSize: 11, color: C.parchmentDim, padding: "1px 0" }}>
                  {p.name} — only {p.have} of {p.qty} available
                </div>
              ))}
            </div>
          )}

          {preview.parsed.sideboard?.length > 0 && (
            <div className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, marginBottom: 10 }}>
              {preview.parsed.sideboard.length} sideboard line
              {preview.parsed.sideboard.length === 1 ? "" : "s"} ignored — HoardKeeper decks don't
              track sideboards.
            </div>
          )}

          <button
            onClick={() =>
              onImport({
                name: name.trim() || "Imported deck",
                format:
                  meta?.format ||
                  (preview.commanderId || preview.parsed.commander ? "commander" : "standard"),
                colors: meta?.colors || null,
                commanderId: preview.commanderId,
                entries: preview.entries,
                basics: preview.basics,
                tokenCounts: meta?.tokenCounts || {},
                extraTokens: meta?.extraTokens || [],
              })
            }
            disabled={preview.entries.length === 0 && !preview.commanderId}
            style={{
              width: "100%",
              background: STOCK_BG,
              color: C.stockInk,
              border: "none",
              borderRadius: 6,
              padding: "12px",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              boxShadow: STOCK_SHADOW,
            }}
          >
            Create deck with {totalMatched} card{totalMatched === 1 ? "" : "s"}
          </button>
        </div>
      )}
    </ModalShell>
  );
}

function TokensPanel({ tokens, tokenCards, qtyOf, onSetQty, onAdd, onRemove }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  async function searchTokens() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      // Scryfall indexes tokens as cards; this restricts the search to them.
      const r = await scryfallSearch(`${query.trim()} t:token`, "cards", 12);
      setResults(r);
    } catch (e) {
      setResults([]);
    }
    setSearching(false);
  }

  const total = tokens.reduce((n, t) => n + qtyOf(t.id), 0);
  const stepBtn = {
    background: "none",
    borderRadius: 4,
    cursor: "pointer",
    width: 24,
    height: 22,
    padding: 0,
    fontSize: 13,
    lineHeight: 1,
  };

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            background: STOCK_BG,
            color: C.stockInk,
            fontWeight: 600,
            padding: "4px 9px",
            borderRadius: 3,
            boxShadow: STOCK_SHADOW,
          }}
        >
          Tokens to bring
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
          {tokens.length} type{tokens.length === 1 ? "" : "s"} · {total} card
          {total === 1 ? "" : "s"} to bring
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setOpen((o) => !o)}
          className="mono"
          style={{
            background: open ? "rgba(232,236,241,0.1)" : "transparent",
            border: `1px solid ${open ? C.goldBright : C.border}`,
            color: open ? C.goldBright : C.parchmentDim,
            borderRadius: 5,
            padding: "5px 11px",
            fontSize: 10,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          + Add any token
        </button>
      </div>

      {open && (
        <div style={{ marginBottom: 14, maxWidth: 520 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchTokens()}
              placeholder="Token name — treasure, zombie, clue…"
              style={{
                flex: 1,
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: "9px 11px",
                color: C.parchment,
                fontSize: 13,
              }}
            />
            <button
              onClick={searchTokens}
              style={{
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 6,
                padding: "0 14px",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              {searching ? "…" : "Search"}
            </button>
          </div>
          {results.length > 0 && (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderTop: "none",
                borderRadius: "0 0 8px 8px",
                maxHeight: 220,
                overflowY: "auto",
              }}
            >
              {results.map((r) => (
                <div
                  key={r.scryfallId}
                  onClick={() => {
                    onAdd({
                      id: r.scryfallId,
                      name: r.name,
                      typeLine: r.typeLine,
                      imageUrl: r.imageUrl,
                      scryfallUri: r.scryfallUri,
                    });
                    setQuery("");
                    setResults([]);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "6px 11px",
                    cursor: "pointer",
                    borderBottom: `1px solid rgba(185,191,199,0.08)`,
                  }}
                >
                  <div style={{ width: 24, aspectRatio: "5 / 7", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
                    <CardArt card={r} />
                  </div>
                  <span className="serif" style={{ fontSize: 12.5, color: C.parchment, flex: 1 }}>
                    {r.name}
                  </span>
                  <span className="mono" style={{ fontSize: 9.5, color: C.parchmentDim }}>
                    {(r.typeLine || "").replace(/^Token\s*/i, "")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tokens.length === 0 && (
        <div className="mono" style={{ fontSize: 11, color: C.parchmentDim }}>
          None of these cards make tokens — add any you want to bring anyway.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 14,
        }}
      >
        {tokens.map((t) => {
          const art = tokenCards[t.id];
          const qty = qtyOf(t.id);
          return (
            <div key={t.id} style={{ opacity: qty === 0 ? 0.4 : 1 }}>
              <div
                className="sleeve"
                style={{
                  position: "relative",
                  aspectRatio: "5 / 7",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#0C0E10",
                  boxShadow: "0 8px 16px -6px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)",
                }}
              >
                {art?.imageUrl ? (
                  <img
                    src={art.imageUrl}
                    alt={t.name}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div
                    className="mono"
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: C.parchmentDim,
                      textAlign: "center",
                      padding: 10,
                    }}
                  >
                    {t.name}
                  </div>
                )}
                {qty > 1 && (
                  <span
                    className="mono"
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      background: STOCK_BG,
                      color: C.stockInk,
                      borderRadius: 3,
                      padding: "1px 7px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                    }}
                  >
                    ×{qty}
                  </span>
                )}
                {art?.power && (
                  <span
                    className="mono"
                    style={{
                      position: "absolute",
                      bottom: 6,
                      right: 6,
                      fontSize: 10,
                      fontWeight: 600,
                      background: STOCK_BG,
                      color: C.stockInk,
                      borderRadius: 3,
                      padding: "1px 6px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                    }}
                  >
                    {art.power}/{art.toughness}
                  </span>
                )}
              </div>

              <div
                style={{
                  marginTop: 7,
                  padding: "4px 8px",
                  background: STOCK_BG,
                  borderRadius: 3,
                  color: C.stockInk,
                  boxShadow: STOCK_SHADOW,
                }}
              >
                <div
                  className="serif"
                  style={{
                    fontWeight: 600,
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={t.name}
                >
                  {t.name}
                </div>
                <div className="mono" style={{ fontSize: 8.5, color: C.stockDim }}>
                  {(t.ty || art?.typeLine || "").replace(/^Token\s*/i, "").toUpperCase()}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 7 }}>
                <button
                  onClick={() => onSetQty(t.id, qty - 1)}
                  disabled={qty === 0}
                  className="mono"
                  style={{
                    ...stepBtn,
                    border: `1px solid ${C.border}`,
                    color: qty === 0 ? C.border : C.parchmentDim,
                    cursor: qty === 0 ? "default" : "pointer",
                  }}
                >
                  −
                </button>
                <span className="mono" style={{ fontSize: 12.5, color: C.goldBright, minWidth: 26, textAlign: "center" }}>
                  {qty}
                </span>
                <button
                  onClick={() => onSetQty(t.id, qty + 1)}
                  className="mono"
                  style={{ ...stepBtn, border: `1px solid ${C.border}`, color: C.parchmentDim }}
                >
                  +
                </button>
              </div>

              <div
                className="mono"
                style={{ fontSize: 9, color: C.parchmentDim, marginTop: 5, lineHeight: 1.45, textAlign: "center" }}
                title={t.sources.join(", ")}
              >
                {t.sources.length > 0 ? (
                  <>
                    made by {t.sources.length} card{t.sources.length === 1 ? "" : "s"}
                    <div style={{ opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.sources.slice(0, 2).join(", ")}
                      {t.sources.length > 2 ? ` +${t.sources.length - 2}` : ""}
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => onRemove(t.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.parchmentDim,
                      fontSize: 9,
                      cursor: "pointer",
                      textDecoration: "underline",
                      padding: 0,
                    }}
                  >
                    added by hand — remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeckGallery({ deck, commander, cardById, oracleMap, isStandard }) {
  const members = [];
  if (!isStandard && commander) members.push({ card: commander, qty: 1, isCommander: true });
  deck.entries.forEach((e) => {
    const c = cardById[e.cardId];
    if (c) members.push({ card: c, qty: e.qty || 1 });
  });
  // Alphabetical by name, same reasoning as the Roles view — but the
  // commander (if pinned first above) stays first regardless.
  members.sort((a, b) => {
    if (a.isCommander) return -1;
    if (b.isCommander) return 1;
    return a.card.name.localeCompare(b.card.name);
  });

  const basics = Object.entries(deck.basics || {});

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 22,
      }}
    >
      {members.map(({ card, qty, isCommander }) => {
        const text = card.scryfallId ? oracleMap[card.scryfallId]?.t : null;
        return (
          <div key={card.id} className="card-tile" style={{ cursor: "default" }}>
            <div
              className="sleeve"
              style={{
                position: "relative",
                borderRadius: 10,
                overflow: "hidden",
                background: "#0C0E10",
                aspectRatio: "5 / 7",
                boxShadow: isCommander
                  ? `0 0 0 2px ${C.goldBright}, 0 10px 20px -8px rgba(0,0,0,0.8)`
                  : "0 10px 20px -8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)",
              }}
            >
              {qty > 1 && (
                <span
                  className="mono"
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    zIndex: 2,
                    fontSize: 11,
                    fontWeight: 600,
                    background: STOCK_BG,
                    color: C.stockInk,
                    borderRadius: 3,
                    padding: "1px 7px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                  }}
                >
                  ×{qty}
                </span>
              )}
              {finishOf(card) !== "nonfoil" && (
                <>
                  <div className="foil-sheen" />
                  <div className="foil-edge" />
                </>
              )}
              {isCommander && (
                <span
                  className="mono"
                  style={{
                    position: "absolute",
                    top: 8,
                    left: 8,
                    zIndex: 2,
                    fontSize: 8.5,
                    fontWeight: 600,
                    letterSpacing: 1.2,
                    background: STOCK_BG,
                    color: C.stockInk,
                    borderRadius: 3,
                    padding: "2px 7px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                  }}
                >
                  COMMANDER
                </span>
              )}
              <CardArt card={card} />
              {finishOf(card) !== "nonfoil" && (
                <>
                  <div className="foil-sheen" />
                  <div className="foil-edge" />
                </>
              )}
            </div>

            {/* typeline caption: name + type, no price */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginTop: 9,
                padding: "5px 9px",
                background: STOCK_BG,
                borderRadius: 3,
                color: C.stockInk,
                boxShadow: STOCK_SHADOW,
              }}
            >
              <span
                className="serif"
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={card.name}
              >
                {card.name}
              </span>
              <span
                className="mono"
                style={{ fontSize: 9.5, color: C.stockDim, whiteSpace: "nowrap", flexShrink: 0 }}
              >
                {(card.set || "").toUpperCase()}
                {card.collectorNumber ? ` #${card.collectorNumber}` : ""}
              </span>
            </div>

            {/* rules text */}
            {text !== null && (
              <div
                style={{
                  marginTop: 6,
                  padding: "0 3px",
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  color: C.parchmentDim,
                  whiteSpace: "pre-line",
                }}
              >
                {text === "" ? <em style={{ opacity: 0.7 }}>No rules text.</em> : text}
              </div>
            )}
          </div>
        );
      })}

      {basics.map(([name, n]) => (
        <div
          key={name}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            aspectRatio: "5 / 7",
            borderRadius: 10,
            border: `1.5px dashed rgba(185,191,199,0.3)`,
            color: C.parchmentDim,
          }}
        >
          <span className="display" style={{ fontSize: 26, color: C.goldBright }}>
            {n}×
          </span>
          <span className="serif" style={{ fontSize: 15 }}>{name}</span>
          <span className="mono" style={{ fontSize: 9, letterSpacing: 1.5 }}>BASIC LAND</span>
        </div>
      ))}
    </div>
  );
}

function DecksView({ cards, decks, setDecks, valueOf, collections }) {
  const collectionLabel = (id) => {
    if (!id || id === UNCATEGORIZED) return "Uncategorized";
    return collections?.find((c) => c.id === id)?.name || "Uncategorized";
  };
  const [openDeck, setOpenDeck] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [justAdded, setJustAdded] = useState("");
  const addInputRef = useRef(null);
  const [deckView, setDeckView] = useState("cards"); // cards | roles
  const [oracleMap, setOracleMap] = useState({});
  const [tokenCards, setTokenCards] = useState({});

  const commanders = useMemo(
    () =>
      cards.filter(
        (c) =>
          !c.sold &&
          (c.typeLine || "").includes("Legendary") &&
          (c.typeLine || "").includes("Creature")
      ),
    [cards]
  );

  const deck = decks.find((d) => d.id === openDeck) || null;

  // A physical card can only sit in one deck at a time. Work out how many
  // copies of each card the *other* decks have already claimed.
  // NOTE: must stay above the early return below — hooks can't be conditional.
  const committedElsewhere = useMemo(() => {
    const m = {};
    decks.forEach((d) => {
      if (d.id === openDeck) return;
      d.entries.forEach((e) => {
        m[e.cardId] = (m[e.cardId] || 0) + (e.qty || 1);
      });
      // another deck's commander is a physical card too
      if (d.commanderId) m[d.commanderId] = (m[d.commanderId] || 0) + 1;
    });
    return m;
  }, [decks, openDeck]);
  const commander = deck ? cards.find((c) => c.id === deck.commanderId) : null;
  const cardById = useMemo(() => {
    const m = {};
    cards.forEach((c) => (m[c.id] = c));
    return m;
  }, [cards]);

  const [newColors, setNewColors] = useState([]);
  const [importing, setImporting] = useState(false);

  // Which tokens this deck can make, and which cards make them. Derived from
  // Scryfall's related-card data rather than guessed from rules text.
  const tokensNeeded = useMemo(() => {
    if (!deck) return [];
    const members = [
      ...(commander ? [commander] : []),
      ...deck.entries.map((e) => cardById[e.cardId]).filter(Boolean),
    ];
    const byId = {};
    members.forEach((c) => {
      (oracleMap[c.scryfallId]?.parts || []).forEach((p) => {
        if (!byId[p.id]) byId[p.id] = { ...p, sources: [] };
        if (!byId[p.id].sources.includes(c.name)) byId[p.id].sources.push(c.name);
      });
    });
    // tokens added by hand sit alongside the detected ones
    (deck.extraTokens || []).forEach((t) => {
      if (!byId[t.id]) byId[t.id] = { ...t, sources: [], manual: true };
      else byId[t.id].manual = true;
    });
    return Object.values(byId).sort(
      (a, b) => b.sources.length - a.sources.length || a.name.localeCompare(b.name)
    );
  }, [deck, commander, cardById, oracleMap]);

  // artwork for those tokens
  useEffect(() => {
    const ids = tokensNeeded.map((t) => t.id).filter((id) => id && !tokenCards[id]);
    if (ids.length === 0) return;
    let live = true;
    (async () => {
      const map = await fetchTokenCards(ids);
      if (live) setTokenCards(map);
    })();
    return () => {
      live = false;
    };
  }, [tokensNeeded]);

  // rules text for the browse view, cached in the same store the drafter uses
  useEffect(() => {
    if (!deck) return;
    let live = true;
    const ids = [
      ...(commander?.scryfallId ? [commander.scryfallId] : []),
      ...deck.entries.map((e) => cardById[e.cardId]?.scryfallId).filter(Boolean),
    ];
    if (ids.length === 0) return;
    (async () => {
      const map = await fetchOracleTexts(ids);
      if (live) setOracleMap(map);
    })();
    return () => { live = false; };
  }, [openDeck, deck?.entries?.length]);

  function createDeck(commanderId) {
    const cmd = cards.find((c) => c.id === commanderId);
    if (!cmd) return;
    const id = uid();
    setDecks((prev) => [
      ...prev,
      { id, format: "commander", name: `${cmd.name.split(",")[0]} deck`, commanderId, entries: [], basics: {} },
    ]);
    setOpenDeck(id);
  }

  function createDeck60() {
    if (newColors.length === 0) return;
    const id = uid();
    setDecks((prev) => [
      ...prev,
      { id, format: "standard", name: `${newColors.join("")} 60-card deck`, colors: [...newColors], entries: [], basics: {} },
    ]);
    setNewColors([]);
    setOpenDeck(id);
  }

  // Cards committed to every deck, so an import can't claim a copy that's
  // already sleeved somewhere else.
  const committedAll = useMemo(() => {
    const m = {};
    decks.forEach((d) => {
      d.entries.forEach((e) => {
        m[e.cardId] = (m[e.cardId] || 0) + (e.qty || 1);
      });
      if (d.commanderId) m[d.commanderId] = (m[d.commanderId] || 0) + 1;
    });
    return m;
  }, [decks]);

  function importDeck(built) {
    const id = uid();
    setDecks((prev) => [...prev, { id, ...built }]);
    setImporting(false);
    setOpenDeck(id);
  }

  function patchDeck(id, patch) {
    setDecks((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function deleteDeck(id) {
    setDecks((prev) => prev.filter((d) => d.id !== id));
    setOpenDeck(null);
  }

  async function autoBuild() {
    if (!deck) return;
    if (deck.format !== "standard" && !commander) return;
    setDrafting(true);
    setDraftNote("Fetching card texts…");
    try {
      const ids = cards.filter((c) => c.scryfallId).map((c) => c.scryfallId);
      const oracle = await fetchOracleTexts(ids);
      setDraftNote("Drafting…");
      // Cards sleeved in other decks are off the table, so a draft never
      // silently claims a copy that's physically somewhere else.
      // computed here rather than read from the outer scope, so this doesn't
      // depend on which branch of the component rendered
      const ident = deck.format === "standard" ? deck.colors || [] : commander?.colors || [];
      const locked = cards.filter(
        (c) => !c.sold && !isBasicLand(c) && identityFits(c, ident) && freeCopies(c) <= 0
      ).length;
      const lockedNote = locked
        ? ` ${locked} card${locked === 1 ? " is" : "s are"} in your other decks and were skipped.`
        : "";
      if (deck.format === "standard") {
        const result = draftDeck60(deck.colors || [], cards, oracle, freeCopies);
        patchDeck(deck.id, { entries: result.entries, basics: result.basics });
        setDraftNote(
          [
            result.theme ? `Built around your ${result.theme} count.` : "",
            result.shortfall > 0
              ? `Pool ran ${result.shortfall} cards short — more ${(deck.colors || []).join("/")} cards would fill it.`
              : "",
            lockedNote.trim(),
          ]
            .filter(Boolean)
            .join(" ")
        );
      } else {
        const result = draftDeck(commander, cards, oracle, freeCopies);
        patchDeck(deck.id, { entries: result.entries, basics: result.basics });
        setDraftNote(
          (result.shortfall > 0
            ? `Drafted, but the pool ran short by ${result.shortfall} spells — add more ${(commander.colors || []).join("/")} cards to your collection to fill it.`
            : "") + lockedNote
        );
      }
    } catch (e) {
      setDraftNote("Couldn't reach Scryfall for card texts. Try again in a moment.");
    }
    setDrafting(false);
  }

  // Basics live outside the entry list because they aren't tied to a specific
  // copy you own — you can always field more.
  // How many of each token you want to bring. Detected tokens start at one;
  // anything can be raised as high as you like or dropped to none.
  function tokenQty(id) {
    const v = deck.tokenCounts?.[id];
    return v === undefined ? 1 : v;
  }

  function setTokenQty(id, n) {
    const next = { ...(deck.tokenCounts || {}) };
    next[id] = Math.max(0, Math.min(99, n));
    patchDeck(deck.id, { tokenCounts: next });
  }

  function addExtraToken(tok) {
    const extras = deck.extraTokens || [];
    if (extras.some((t) => t.id === tok.id)) {
      setTokenQty(tok.id, tokenQty(tok.id) + 1);
      return;
    }
    patchDeck(deck.id, {
      extraTokens: [...extras, { id: tok.id, name: tok.name, ty: tok.typeLine || "" }],
      tokenCounts: { ...(deck.tokenCounts || {}), [tok.id]: 1 },
    });
    setTokenCards((prev) => ({
      ...prev,
      [tok.id]: {
        name: tok.name,
        typeLine: tok.typeLine,
        imageUrl: tok.imageUrl,
        scryfallUri: tok.scryfallUri,
        power: tok.power ?? null,
        toughness: tok.toughness ?? null,
      },
    }));
  }

  function removeExtraToken(id) {
    patchDeck(deck.id, {
      extraTokens: (deck.extraTokens || []).filter((t) => t.id !== id),
      tokenCounts: (() => {
        const n = { ...(deck.tokenCounts || {}) };
        delete n[id];
        return n;
      })(),
    });
  }

  function setBasicQty(name, n) {
    const next = { ...(deck.basics || {}) };
    if (n <= 0) delete next[name];
    else next[name] = Math.min(99, n);
    patchDeck(deck.id, { basics: next });
  }

  function removeEntry(cardId) {
    patchDeck(deck.id, { entries: deck.entries.filter((e) => e.cardId !== cardId) });
  }

  function addEntry(card) {
    if (unavailableReason(card)) return;
    const free = allowsAnyNumber(card, oracleMap[card.scryfallId]?.t);
    // Already in the deck: bump the count instead of refusing, when allowed.
    const existing = deck.entries.find((e) => e.cardId === card.id);
    if (existing) {
      if (deck.format === "standard" || free) setQty(card.id, (existing.qty || 1) + 1);
      else return;
      setAddSearch("");
      setJustAdded(card.name);
      setTimeout(() => addInputRef.current?.focus(), 0);
      return;
    }
    if (deck.format !== "standard" && !free &&
        deck.entries.some((e) => cardById[e.cardId]?.name === card.name))
      return; // commander singleton
    patchDeck(deck.id, {
      entries: [...deck.entries, { cardId: card.id, role: classifyRole(card, ""), qty: 1 }],
    });
    // Clear the box and keep the cursor there so a run of cards can be typed
    // one after another without reaching for the mouse.
    setAddSearch("");
    setJustAdded(card.name);
    setTimeout(() => addInputRef.current?.focus(), 0);
  }

  function exportList() {
    if (!deck) return;
    const lines = [];
    if (deck.format !== "standard" && commander) lines.push(`1 ${commander.name}`);
    deck.entries.forEach((e) => {
      const c = cardById[e.cardId];
      if (c) lines.push(`${e.qty || 1} ${c.name}`);
    });
    Object.entries(deck.basics || {}).forEach(([name, n]) => lines.push(`${n} ${name}`));
    // Tokens go in a commented block: deckbuilders ignore the lines, but the
    // list is there when you're standing at the shop counter.
    if (tokensNeeded.length) {
      lines.push("");
      lines.push("// Tokens needed:");
      tokensNeeded.forEach((t) => {
        const n = tokenQty(t.id);
        if (n > 0) lines.push(`// ${n} ${t.name}${t.ty ? ` (${t.ty})` : ""}`);
      });
    }
    navigator.clipboard?.writeText(lines.join("\n"));
    setDraftNote("Decklist copied to clipboard.");
  }

  // ---------- deck list ----------
  if (!deck) {
    return (
      <main style={{ padding: "16px clamp(14px, 4vw, 30px) 48px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 26 }}>
          {decks.map((d) => {
            const cmd = cardById[d.commanderId];
            const basicsN = Object.values(d.basics || {}).reduce((a, b) => a + b, 0);
            const total =
              (d.format === "standard" ? 0 : 1) +
              d.entries.reduce((s2, e) => s2 + (e.qty || 1), 0) +
              basicsN;
            const isStd = d.format === "standard";
            const target = isStd ? 60 : 100;
            return (
              <div
                key={d.id}
                onClick={() => setOpenDeck(d.id)}
                style={{
                  width: 230,
                  cursor: "pointer",
                  background: "rgba(0,0,0,0.28)",
                  border: `1px solid rgba(185,191,199,0.2)`,
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {isStd && (
                  <div
                    style={{
                      height: 46,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      background: "rgba(0,0,0,0.3)",
                    }}
                  >
                    {(d.colors || []).map((k) => (
                      <span
                        key={k}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: MANA[k],
                          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)",
                        }}
                      />
                    ))}
                  </div>
                )}
                {cmd?.imageUrl && (
                  <div style={{ height: 120, overflow: "hidden" }}>
                    <img
                      src={cmd.imageUrl}
                      alt=""
                      style={{ width: "100%", marginTop: "-14%", display: "block" }}
                    />
                  </div>
                )}
                <div style={{ padding: "10px 13px 13px" }}>
                  <div className="serif" style={{ fontWeight: 600, fontSize: 15, color: C.goldBright }}>
                    {d.name}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                      color: total === 100 ? C.greenBright : C.parchmentDim,
                      marginTop: 5,
                    }}
                  >
                    {isStd ? "60-card" : "commander"} · {total}/{target}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginBottom: 18 }}>
          <IconButton
            onClick={() => setImporting(true)}
            label="Import a deck"
            icon={<Upload size={14} />}
          />
        </div>

        {importing && (
          <ImportDeckModal
            cards={cards}
            committed={committedAll}
            onClose={() => setImporting(false)}
            onImport={importDeck}
          />
        )}

        <div
          style={{
            border: `1px dashed rgba(185,191,199,0.3)`,
            borderRadius: 10,
            padding: 22,
            maxWidth: 480,
          }}
        >
          <div className="serif" style={{ fontWeight: 600, fontSize: 16, color: C.goldBright, marginBottom: 6 }}>
            New commander deck
          </div>
          {commanders.length === 0 ? (
            <div style={{ fontSize: 13, color: C.parchmentDim, marginBottom: 16 }}>
              No legendary creatures in your collection yet — the commander picker fills in once you
              own some (run Refresh prices &amp; art if type lines are missing).
            </div>
          ) : (
            <select
              defaultValue=""
              onChange={(e) => e.target.value && createDeck(e.target.value)}
              style={{
                width: "100%",
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: "10px",
                color: C.parchment,
                fontSize: 13.5,
                marginBottom: 20,
              }}
            >
              <option value="" disabled>
                Choose a commander…
              </option>
              {commanders.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.colors?.length ? `(${c.colors.join("")})` : ""}
                </option>
              ))}
            </select>
          )}

          <div
            className="serif"
            style={{ fontWeight: 600, fontSize: 16, color: C.goldBright, marginBottom: 6, paddingTop: 14, borderTop: `1px solid rgba(185,191,199,0.15)` }}
          >
            New 60-card deck
          </div>
          <div style={{ fontSize: 12.5, color: C.parchmentDim, marginBottom: 10 }}>
            Pick one or two colors; the drafter allows up to four copies of a card, capped at what
            you own.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {["W", "U", "B", "R", "G"].map((k) => {
              const on = newColors.includes(k);
              return (
                <button
                  key={k}
                  onClick={() =>
                    setNewColors((prev) => (on ? prev.filter((x) => x !== k) : [...prev, k]))
                  }
                  title={k}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: MANA[k],
                    border: "none",
                    cursor: "pointer",
                    boxShadow: on
                      ? `0 0 0 2px ${C.bg}, 0 0 0 3.5px ${C.goldBright}`
                      : "inset 0 0 0 1px rgba(0,0,0,0.4)",
                    opacity: on || newColors.length === 0 ? 1 : 0.4,
                    padding: 0,
                  }}
                />
              );
            })}
            <button
              onClick={createDeck60}
              disabled={newColors.length === 0}
              style={{
                marginLeft: 8,
                background: newColors.length ? STOCK_BG : C.border,
                color: newColors.length ? C.stockInk : C.parchmentDim,
                border: "none",
                borderRadius: 5,
                padding: "8px 16px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: newColors.length ? "pointer" : "default",
                boxShadow: newColors.length ? STOCK_SHADOW : "none",
              }}
            >
              Create
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ---------- deck detail ----------
  const isStandard = deck.format === "standard";
  const deckSize = isStandard ? 60 : 100;
  const basicsN = Object.values(deck.basics || {}).reduce((a, b) => a + b, 0);
  const entriesN = deck.entries.reduce((s, e) => s + (e.qty || 1), 0);
  const total = (isStandard ? 0 : 1) + entriesN + basicsN;
  const deckValue =
    (!isStandard && commander ? valueOf(commander) / (commander.quantity || 1) : 0) +
    deck.entries.reduce((s, e) => {
      const c = cardById[e.cardId];
      return c ? s + (valueOf(c) / (c.quantity || 1)) * (e.qty || 1) : s;
    }, 0);

  const grouped = {};
  deck.entries.forEach((e) => {
    const c = cardById[e.cardId];
    if (!c) return;
    (grouped[e.role] = grouped[e.role] || []).push(c);
  });
  // Alphabetical within each role, not insertion order — otherwise a card
  // added last month sits above one added five minutes ago for no reason
  // visible to the person looking at the list.
  Object.values(grouped).forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));

  const identity = isStandard ? deck.colors || [] : commander?.colors || [];
  // Which decks are holding a given card, for explaining why it's unavailable.
  function heldBy(cardId) {
    return decks
      .filter(
        (d) =>
          d.id !== deck?.id &&
          (d.commanderId === cardId || d.entries.some((e) => e.cardId === cardId))
      )
      .map((d) => d.name);
  }

  // Copies still free to assign to this deck. Basic lands are exempt: they're
  // trivially replaceable, and the quick-add buttons already ignore ownership.
  function freeCopies(c) {
    if (isBasicLand(c)) return 99;
    return (c.quantity || 1) - (committedElsewhere[c.id] || 0);
  }

  // How many copies of this card the deck may hold in total.
  function copyLimit(c) {
    if (isBasicLand(c)) return 99;
    const free = freeCopies(c);
    if (allowsAnyNumber(c, oracleMap[c?.scryfallId]?.t)) return Math.max(0, free);
    return isStandard ? Math.min(4, Math.max(0, free)) : Math.min(1, Math.max(0, free));
  }

  // Shown but not addable: every copy you own is committed to another deck.
  function conflicted(c) {
    if (isBasicLand(c)) return false;
    if (deck.entries.some((e) => e.cardId === c.id)) return false;
    return freeCopies(c) <= 0;
  }

  // A card belongs in the picker if the deck can still take another copy of it —
  // so basics keep showing up until you've added as many as you want.
  function canAddMore(c) {
    const inDeck = deck.entries.find((e) => e.cardId === c.id);
    if (inDeck) return (inDeck.qty || 1) < copyLimit(c);
    const free = isBasicLand(c) || allowsAnyNumber(c, oracleMap[c?.scryfallId]?.t);
    if (!isStandard && !free && deck.entries.some((e) => cardById[e.cardId]?.name === c.name))
      return false; // commander singleton, by name
    return true;
  }

  // Why a listed card can't be taken right now — null means it's available.
  function unavailableReason(c) {
    if (isBasicLand(c)) return null;
    const here = deck.entries.find((e) => e.cardId === c.id)?.qty || 0;
    const free = freeCopies(c) - here;
    if (free > 0) return null;
    const where = [...new Set(heldBy(c.id))];
    const owned = c.quantity || 1;
    if (where.length)
      return `${owned === 1 ? "your copy is" : `all ${owned} copies are`} in ${where
        .slice(0, 2)
        .join(", ")}${where.length > 2 ? ` +${where.length - 2}` : ""}`;
    return `you own ${owned}, all assigned`;
  }

  const addable = cards.filter(
    (c) =>
      !c.sold &&
      c.id !== commander?.id &&
      identityFits(c, identity) &&
      (canAddMore(c) || conflicted(c)) &&
      (!addSearch ||
        c.name.toLowerCase().includes(addSearch.toLowerCase()) ||
        // so "hob 312" or "hob" narrows to a printing
        `${c.set || ""} ${c.collectorNumber || ""}`.toLowerCase().includes(addSearch.toLowerCase()) ||
        `${c.set || ""}${c.collectorNumber || ""}`.toLowerCase().includes(addSearch.toLowerCase().replace(/\s+/g, "")))
  );

  // The row Enter will take, and the one that gets the highlight.
  const firstFreeIndex = addable.findIndex((c) => !unavailableReason(c));

  function setQty(cardId, qty) {
    const c = cardById[cardId];
    const n = Math.max(1, Math.min(copyLimit(c), qty));
    patchDeck(deck.id, {
      entries: deck.entries.map((e) => (e.cardId === cardId ? { ...e, qty: n } : e)),
    });
  }

  return (
    <main style={{ padding: "16px clamp(14px, 4vw, 30px) 48px" }}>
      <button
        onClick={() => setOpenDeck(null)}
        className="mono"
        style={{
          background: "none",
          border: "none",
          color: C.parchmentDim,
          fontSize: 11,
          letterSpacing: 1,
          cursor: "pointer",
          padding: 0,
          marginBottom: 14,
        }}
      >
        ← ALL DECKS
      </button>

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 20 }}>
        {commander?.imageUrl && (
          <div
            className="sleeve"
            style={{
              width: 180,
              borderRadius: 10,
              overflow: "hidden",
              position: "relative",
              flexShrink: 0,
              boxShadow: "0 10px 20px -8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)",
            }}
          >
            <img src={commander.imageUrl} alt="" style={{ width: "100%", display: "block" }} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 240 }}>
          <input
            value={deck.name}
            onChange={(e) => patchDeck(deck.id, { name: e.target.value })}
            className="serif"
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: C.goldBright,
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: 4,
              padding: "2px 6px",
              marginLeft: -6,
              width: "100%",
              maxWidth: 420,
            }}
          />
          <div
            className="mono"
            style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.parchmentDim, marginTop: 6 }}
          >
            {isStandard ? "60-card constructed" : commander?.name} · {identity.join("") || "colorless"} ·{" "}
            <span style={{ color: total === deckSize ? C.greenBright : C.goldBright }}>
              {total}/{deckSize}
            </span>{" "}
            · worth {fmt(deckValue)}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button
              onClick={autoBuild}
              disabled={drafting}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 5,
                padding: "9px 16px",
                fontWeight: 700,
                fontSize: 13,
                cursor: drafting ? "default" : "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              {drafting ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={15} />}
              {deck.entries.length ? "Re-draft from collection" : "Auto-build from collection"}
            </button>
            <IconButton onClick={exportList} label="Copy decklist" icon={<Download size={14} />} />
            <IconButton
              onClick={() =>
                downloadFile(
                  `${(deck.name || "deck").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`,
                  deckToText(deck, cardById, commander, tokensNeeded, tokenQty)
                )
              }
              label="Export .txt"
              icon={<Download size={14} />}
            />
            <IconButton
              onClick={() =>
                downloadFile(
                  `${(deck.name || "deck").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
                  deckToJson(deck, cardById, commander),
                  "application/json"
                )
              }
              label="Export .json"
              icon={<Download size={14} />}
            />
            <IconButton onClick={() => deleteDeck(deck.id)} label="Delete deck" icon={<Trash2 size={14} />} />
            <div style={{ width: 8 }} />
            <IconButton onClick={() => setDeckView("cards")} label="Cards" icon={<LibraryBig size={14} />} active={deckView === "cards"} />
            <IconButton onClick={() => setDeckView("roles")} label="Roles" icon={<Layers size={14} />} active={deckView === "roles"} />
          </div>
          {draftNote && (
            <div className="mono" style={{ fontSize: 11.5, color: C.parchmentDim, marginTop: 10 }}>
              {draftNote}
            </div>
          )}
        </div>
      </div>

      {deckView === "cards" && (
        <DeckGallery
          deck={deck}
          commander={commander}
          cardById={cardById}
          oracleMap={oracleMap}
          isStandard={isStandard}
        />
      )}

      {deckView === "roles" && (
      <>
      <div
        className="mono"
        style={{ fontSize: 9.5, color: C.parchmentDim, marginBottom: 9, letterSpacing: 0.6 }}
      >
        Each row: card name · set and collector number · <span style={{
          background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
          borderRadius: 9, padding: "1px 6px" }}>mana value</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
        {ROLE_ORDER.filter((r) => grouped[r]?.length || (r === "land" && basicsN > 0)).map((role) => (
          <div
            key={role}
            style={{
              background: "rgba(0,0,0,0.28)",
              border: `1px solid rgba(185,191,199,0.18)`,
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
              <span
                className="mono"
                style={{
                  fontSize: 9,
                  letterSpacing: 1.6,
                  textTransform: "uppercase",
                  background: STOCK_BG,
                  color: C.stockInk,
                  fontWeight: 600,
                  padding: "3px 8px",
                  borderRadius: 3,
                  boxShadow: STOCK_SHADOW,
                }}
              >
                {ROLE_LABELS[role]}
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
                {(grouped[role] || []).reduce(
                  (s2, c) => s2 + (deck.entries.find((e) => e.cardId === c.id)?.qty || 1),
                  0
                ) + (role === "land" ? basicsN : 0)}
                {role === "land"
                  ? `/${isStandard ? 24 : 37}`
                  : !isStandard && ROLE_TARGETS[role]
                  ? `/${ROLE_TARGETS[role]}`
                  : ""}
              </span>
            </div>
            {(grouped[role] || []).map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                  borderBottom: `1px solid rgba(185,191,199,0.08)`,
                  fontSize: 12.5,
                }}
              >
                <span
                  className="serif"
                  style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: C.parchment }}
                >
                  {c.name}
                  <span className="mono" style={{ fontSize: 9, color: C.parchmentDim, marginLeft: 6 }}>
                    {(c.set || "").toUpperCase()}
                    {c.collectorNumber ? ` ${c.collectorNumber}` : ""}
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                  {(isStandard || allowsAnyNumber(c, oracleMap[c.scryfallId]?.t)) && (
                    <span className="mono" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11 }}>
                      <button
                        onClick={() => setQty(c.id, (deck.entries.find((e) => e.cardId === c.id)?.qty || 1) - 1)}
                        style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: C.parchmentDim, cursor: "pointer", width: 17, height: 17, lineHeight: 1, padding: 0, fontSize: 11 }}
                      >
                        −
                      </button>
                      <span style={{ color: C.goldBright, minWidth: 14, textAlign: "center" }}>
                        {deck.entries.find((e) => e.cardId === c.id)?.qty || 1}×
                      </span>
                      <button
                        onClick={() => setQty(c.id, (deck.entries.find((e) => e.cardId === c.id)?.qty || 1) + 1)}
                        style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: C.parchmentDim, cursor: "pointer", width: 17, height: 17, lineHeight: 1, padding: 0, fontSize: 11 }}
                      >
                        +
                      </button>
                    </span>
                  )}
                  <span
                    className="mono"
                    title={`Mana value ${c.cmc ?? 0}`}
                    style={{
                      fontSize: 9.5,
                      color: C.parchmentDim,
                      background: "rgba(255,255,255,0.06)",
                      border: `1px solid ${C.border}`,
                      borderRadius: 9,
                      padding: "1px 6px",
                      minWidth: 26,
                      textAlign: "center",
                    }}
                  >
                    {c.cmc ?? 0}
                  </span>
                  <button
                    onClick={() => removeEntry(c.id)}
                    style={{ background: "none", border: "none", color: C.parchmentDim, cursor: "pointer", padding: 0, display: "flex" }}
                  >
                    <X size={13} />
                  </button>
                </span>
              </div>
            ))}
            {role === "land" &&
              Object.entries(deck.basics || {}).map(([name, n]) => (
                <div
                  key={name}
                  className="mono"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 0",
                    fontSize: 11.5,
                    color: C.parchmentDim,
                  }}
                >
                  <span style={{ flex: 1 }}>{name}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <button
                      onClick={() => setBasicQty(name, n - 1)}
                      style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: C.parchmentDim, cursor: "pointer", width: 17, height: 17, lineHeight: 1, padding: 0, fontSize: 11 }}
                    >
                      −
                    </button>
                    <span style={{ color: C.goldBright, minWidth: 18, textAlign: "center" }}>{n}×</span>
                    <button
                      onClick={() => setBasicQty(name, n + 1)}
                      style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: C.parchmentDim, cursor: "pointer", width: 17, height: 17, lineHeight: 1, padding: 0, fontSize: 11 }}
                    >
                      +
                    </button>
                  </span>
                  <span style={{ fontSize: 9.5, minWidth: 30, textAlign: "right" }}>basic</span>
                </div>
              ))}
            {role === "land" && (
              <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
                {["Plains", "Island", "Swamp", "Mountain", "Forest"].map((b) => (
                  <button
                    key={b}
                    onClick={() => setBasicQty(b, (deck.basics?.[b] || 0) + 1)}
                    title={`Add a ${b}`}
                    className="mono"
                    style={{
                      background: "transparent",
                      border: `1px solid ${C.border}`,
                      color: C.parchmentDim,
                      borderRadius: 3,
                      padding: "3px 7px",
                      fontSize: 9.5,
                      cursor: "pointer",
                    }}
                  >
                    +{b.slice(0, 2)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      </>
      )}

      <TokensPanel
        tokens={tokensNeeded}
        tokenCards={tokenCards}
        qtyOf={tokenQty}
        onSetQty={setTokenQty}
        onAdd={addExtraToken}
        onRemove={removeExtraToken}
      />

      {/* add cards */}
      <div style={{ marginTop: 24, maxWidth: 560 }}>
        <div
          className="mono"
          style={{ fontSize: 9.5, letterSpacing: 1.6, textTransform: "uppercase", color: C.parchmentDim, marginBottom: 8 }}
        >
          Add from collection ({identity.join("") || "colorless"} identity)
        </div>
        <input
          ref={addInputRef}
          value={addSearch}
          onChange={(e) => {
            setAddSearch(e.target.value);
            if (justAdded) setJustAdded("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const target = addable.find((c) => !unavailableReason(c));
              if (target) addEntry(target);
            }
            if (e.key === "Escape") {
              setAddSearch("");
              setJustAdded("");
            }
          }}
          placeholder="Search your cards…"
          style={{
            width: "100%",
            background: C.bgPanel2,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "9px 11px",
            color: C.parchment,
            fontSize: 13,
          }}
        />
        {justAdded && !addSearch && (
          <div className="mono" style={{ fontSize: 11, color: C.greenBright, marginTop: 7 }}>
            ✓ {justAdded} added — keep typing for the next one
          </div>
        )}
        {addSearch && (
          <div
            style={{
              border: `1px solid rgba(185,191,199,0.2)`,
              borderTop: "none",
              borderRadius: "0 0 8px 8px",
              maxHeight: 240,
              overflowY: "auto",
            }}
          >
            {addable.slice(0, 30).map((c, i) => {
              const blocked = unavailableReason(c);
              const isFirstFree = i === firstFreeIndex;
              return (
              <div
                key={c.id}
                onClick={() => !blocked && addEntry(c)}
                title={blocked ? `Unavailable — ${blocked}` : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "6px 12px",
                  cursor: blocked ? "not-allowed" : "pointer",
                  fontSize: 12.5,
                  borderBottom: `1px solid rgba(185,191,199,0.08)`,
                  background: isFirstFree ? "rgba(232,236,241,0.06)" : "transparent",
                  borderLeft: isFirstFree ? `3px solid ${C.goldBright}` : "3px solid transparent",
                  opacity: blocked ? 0.42 : 1,
                }}
              >
                {/* the art is what actually distinguishes one basic from another */}
                <div
                  style={{
                    width: 26,
                    aspectRatio: "5 / 7",
                    borderRadius: 3,
                    overflow: "hidden",
                    flexShrink: 0,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <CardArt card={c} />
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    className="serif"
                    style={{
                      color: C.parchment,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.name}
                    {finishOf(c) !== "nonfoil" && (
                      <span className="mono" style={{ fontSize: 8.5, color: C.gold, marginLeft: 6 }}>
                        FOIL
                      </span>
                    )}
                    {isFirstFree && (
                      <span className="mono" style={{ fontSize: 9, color: C.parchmentDim, marginLeft: 8 }}>
                        ↵
                      </span>
                    )}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 9.5, color: C.parchmentDim, textTransform: "uppercase" }}
                  >
                    {(c.typeLine || "").split("—")[0].trim()}
                    {c.cmc !== undefined && c.cmc !== null ? ` · ${c.cmc} CMC` : ""}
                  </div>
                </div>

                {/* the collector line: which exact printing this is */}
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div className="mono" style={{ fontSize: 10.5, color: C.goldBright }}>
                    {(c.set || "").toUpperCase()}
                    {c.collectorNumber ? ` #${c.collectorNumber}` : ""}
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: C.parchmentDim }}>
                    {(() => {
                      if (blocked)
                        return <span style={{ color: C.redBright }}>in use — {blocked}</span>;
                      const inDeck = deck.entries.find((e) => e.cardId === c.id);
                      if (inDeck)
                        return (
                          <span style={{ color: C.greenBright }}>
                            {inDeck.qty || 1} in deck · +1 more
                          </span>
                        );
                      return `${collectionLabel(c.collectionId)}${
                        (c.quantity || 1) > 1 ? ` · ×${c.quantity}` : ""
                      }`;
                    })()}
                  </div>
                </div>
              </div>
              );
            })}
            {addable.length === 0 && (
              <div style={{ padding: "10px 12px", fontSize: 12, color: C.parchmentDim }}>
                Nothing in identity matches.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/* ============================================================
   SETS VIEW — completion tracking + roster with quantity entry
   ============================================================ */

async function fetchSetInfo(code) {
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
async function fetchSetRoster(code) {
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
async function fetchAllSets() {
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

function isArtSeriesSet(set) {
  return set.set_type === "memorabilia" && /art series/i.test(set.name);
}

async function fetchArtSeriesCompanions() {
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
async function fetchAllArtSeriesSets() {
  const sets = await fetchAllSets();
  return sets
    .filter(isArtSeriesSet)
    .map((set) => ({ code: set.code, name: set.name, count: set.card_count, parentCode: set.parent_set_code || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const RARITY_ORDER = ["common", "uncommon", "rare", "mythic"];
const RARITY_FILL = {
  common: C.rarityCommon,
  uncommon: C.rarityUncommon,
  rare: C.rarityRare,
  mythic: C.rarityMythic,
};

function SetsView({ cards, collections, onAddCopy, onRemoveCopy }) {
  const [subView, setSubView] = useState("owned"); // "owned" | "art"
  const owned = useMemo(() => cards.filter((c) => !c.sold && c.set), [cards]);

  // group owned cards by set code
  const ownedBySet = useMemo(() => {
    const m = {};
    owned.forEach((c) => {
      const k = c.set.toLowerCase();
      if (!m[k]) m[k] = { setName: c.setName || k.toUpperCase(), cards: [] };
      m[k].cards.push(c);
    });
    return m;
  }, [owned]);

  const [infos, setInfos] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [rosterFilter, setRosterFilter] = useState("all");
  const [rosterSearch, setRosterSearch] = useState("");
  const [targetCollection, setTargetCollection] = useState(UNCATEGORIZED);
  const [flashKey, setFlashKey] = useState(null);
  const [preview, setPreview] = useState(null); // { entry, y }

  // fetch set totals for every set we own cards from
  useEffect(() => {
    let live = true;
    (async () => {
      for (const code of Object.keys(ownedBySet)) {
        if (infos[code]) continue;
        try {
          const d = await fetchSetInfo(code);
          if (!live) return;
          setInfos((prev) => ({ ...prev, [code]: d }));
        } catch (e) {
          if (!live) return;
          setInfos((prev) => ({ ...prev, [code]: { name: ownedBySet[code].setName, count: null } }));
        }
        await sleep(60);
      }
    })();
    return () => { live = false; };
  }, [ownedBySet]);

  async function openRoster(code) {
    if (expanded === code) { setExpanded(null); setRoster(null); return; }
    setExpanded(code);
    setRoster(null);
    setRosterError("");
    setRosterFilter("all");
    setRosterSearch("");
    setRosterLoading(true);
    try {
      const r = await fetchSetRoster(code);
      setRoster(r);
    } catch (e) {
      setRosterError("Couldn't load the set roster from Scryfall. Try again in a moment.");
    }
    setRosterLoading(false);
  }

  // one index instead of a linear scan per roster row
  const ownedIndex = useMemo(() => {
    const byId = {};
    const bySetCn = {};
    owned.forEach((c) => {
      if (c.scryfallId) byId[c.scryfallId] = c;
      if (c.set && c.collectorNumber) bySetCn[`${c.set}|${c.collectorNumber}`] = c;
    });
    return { byId, bySetCn };
  }, [owned]);

  function ownedCount(entry) {
    const match =
      (entry.scryfallId && ownedIndex.byId[entry.scryfallId]) ||
      ownedIndex.bySetCn[`${entry.set}|${entry.collectorNumber}`];
    return match ? match.quantity || 1 : 0;
  }

  // distinct-cards-owned per set for completion (unique printings, not copies)
  function distinctOwned(code, fullRoster) {
    if (fullRoster) {
      return fullRoster.filter((e) => ownedCount(e) > 0).length;
    }
    // without roster, approximate by unique collector numbers / names owned
    const seen = new Set();
    ownedBySet[code].cards.forEach((c) => seen.add(c.collectorNumber || c.name));
    return seen.size;
  }

  const setCodes = Object.keys(ownedBySet).sort(
    (a, b) => ownedBySet[b].cards.length - ownedBySet[a].cards.length
  );

  const cardmarketUrl = (name) =>
    `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(name)}`;

  return (
    <main style={{ padding: "16px clamp(14px, 4vw, 30px) 48px" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => setSubView("owned")}
          className="mono"
          style={{
            background: subView === "owned" ? STOCK_BG : "transparent",
            color: subView === "owned" ? C.stockInk : C.parchmentDim,
            border: `1px solid ${subView === "owned" ? C.stock : "rgba(185,191,199,0.26)"}`,
            borderRadius: 5,
            padding: "7px 15px",
            fontSize: 11.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: subView === "owned" ? STOCK_SHADOW : "none",
          }}
        >
          Owned Sets
        </button>
        <button
          onClick={() => setSubView("art")}
          className="mono"
          style={{
            background: subView === "art" ? STOCK_BG : "transparent",
            color: subView === "art" ? C.stockInk : C.parchmentDim,
            border: `1px solid ${subView === "art" ? C.stock : "rgba(185,191,199,0.26)"}`,
            borderRadius: 5,
            padding: "7px 15px",
            fontSize: 11.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: subView === "art" ? STOCK_SHADOW : "none",
          }}
        >
          <Palette size={12} style={{ marginRight: 5, verticalAlign: -2 }} />
          Art Cards
        </button>
      </div>

      {subView === "art" ? (
        <ArtCardsView cards={cards} onAddCopy={onAddCopy} onRemoveCopy={onRemoveCopy} />
      ) : (
      <>
      {setCodes.length === 0 && (
        <div
          style={{
            border: `1px dashed ${C.border}`,
            borderRadius: 10,
            padding: 36,
            textAlign: "center",
            color: C.parchmentDim,
            fontSize: 13.5,
          }}
        >
          Add some cards first — sets you own cards from will appear here with completion tracking.
        </div>
      )}

      {setCodes.map((code) => {
        const info = infos[code];
        const isOpen = expanded === code;
        const distinct = distinctOwned(code, isOpen ? roster : null);
        const total = info?.count || null;
        const pct = total ? Math.round((distinct / total) * 100) : null;

        // rarity bars need the roster
        let rarityBars = null;
        if (isOpen && roster) {
          rarityBars = RARITY_ORDER.map((rar) => {
            const inSet = roster.filter((e) => e.rarity === rar);
            const have = inSet.filter((e) => ownedCount(e) > 0).length;
            return { rar, have, total: inSet.length };
          }).filter((b) => b.total > 0);
        }

        return (
          <div key={code} style={{ borderBottom: `1px solid rgba(185,191,199,0.15)` }}>
            <div
              onClick={() => openRoster(code)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                padding: "18px 4px",
                cursor: "pointer",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="serif" style={{ fontWeight: 600, fontSize: 17, color: C.goldBright }}>
                  {info?.name || ownedBySet[code].setName}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: C.parchmentDim,
                    marginTop: 4,
                  }}
                >
                  {code.toUpperCase()}
                  {info?.released ? ` · ${info.released.slice(0, 4)}` : ""} · {distinct}
                  {total ? `/${total}` : ""} owned
                </div>
              </div>

              {total && (
                <div style={{ width: 220, maxWidth: "40vw" }}>
                  <div
                    style={{
                      height: 7,
                      background: "rgba(0,0,0,0.5)",
                      borderRadius: 4,
                      overflow: "hidden",
                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: C.gold,
                        borderRadius: 4,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="display" style={{ fontWeight: 700, fontSize: 24, color: C.goldBright, minWidth: 74, textAlign: "right" }}>
                {pct !== null ? `${pct}%` : "…"}
                <span
                  className="mono"
                  style={{
                    display: "block",
                    fontSize: 9,
                    letterSpacing: 1.5,
                    color: C.parchmentDim,
                    fontWeight: 400,
                    marginTop: 2,
                  }}
                >
                  {isOpen ? "CLOSE" : "COMPLETE"}
                </span>
              </div>
            </div>

            {isOpen && (
              <div style={{ paddingBottom: 24 }}>
                {rosterLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.parchmentDim, fontSize: 13, padding: "6px 4px 14px" }}>
                    <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                    Loading roster from Scryfall…
                  </div>
                )}
                {rosterError && (
                  <div style={{ color: C.redBright, fontSize: 13, padding: "6px 4px 14px" }}>{rosterError}</div>
                )}

                {roster && (
                  <>
                    <CompletionCost roster={roster} ownedCount={ownedCount} />
                    {rarityBars && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 7, maxWidth: 460, padding: "0 4px 18px" }}>
                        {rarityBars.map((b) => (
                          <div
                            key={b.rar}
                            style={{ display: "grid", gridTemplateColumns: "72px 1fr 90px", gap: 10, alignItems: "center" }}
                          >
                            <span className="mono" style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.parchmentDim }}>
                              {b.rar}
                            </span>
                            <div style={{ height: 7, background: "rgba(0,0,0,0.5)", borderRadius: 4, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)" }}>
                              <div style={{ height: "100%", width: `${(b.have / b.total) * 100}%`, background: RARITY_FILL[b.rar], borderRadius: 4 }} />
                            </div>
                            <span className="mono" style={{ fontSize: 10, color: C.parchmentDim }}>
                              {b.have}/{b.total}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        border: `1px solid rgba(185,191,199,0.2)`,
                        borderRadius: 8,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                          padding: "11px 14px",
                          background: "rgba(0,0,0,0.3)",
                          borderBottom: `1px solid rgba(185,191,199,0.15)`,
                        }}
                      >
                        <div style={{ display: "flex", gap: 6 }}>
                          {["all", "missing", "owned"].map((f) => (
                            <button
                              key={f}
                              onClick={() => setRosterFilter(f)}
                              className="mono"
                              style={{
                                fontSize: 10,
                                letterSpacing: 1,
                                textTransform: "uppercase",
                                background: rosterFilter === f ? C.stock : "transparent",
                                color: rosterFilter === f ? C.stockInk : C.parchmentDim,
                                border: `1px solid ${rosterFilter === f ? C.stock : "rgba(185,191,199,0.25)"}`,
                                borderRadius: 3,
                                padding: "4px 10px",
                                cursor: "pointer",
                              }}
                            >
                              {f}
                            </button>
                          ))}
                        </div>

                        <input
                          value={rosterSearch}
                          onChange={(e) => setRosterSearch(e.target.value)}
                          placeholder="Filter names…"
                          style={{
                            background: C.bgPanel2,
                            border: `1px solid ${C.border}`,
                            borderRadius: 4,
                            padding: "6px 10px",
                            color: C.parchment,
                            fontSize: 12,
                            width: 150,
                          }}
                        />

                        <label
                          className="mono"
                          style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: C.parchmentDim }}
                        >
                          New cards go to
                          <select
                            value={targetCollection}
                            onChange={(e) => setTargetCollection(e.target.value)}
                            style={{
                              background: C.bgPanel2,
                              border: `1px solid ${C.border}`,
                              borderRadius: 4,
                              padding: "5px 8px",
                              color: C.parchment,
                              fontSize: 11.5,
                              textTransform: "none",
                              letterSpacing: 0,
                            }}
                          >
                            <option value={UNCATEGORIZED}>Uncategorized</option>
                            {collections.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div style={{ maxHeight: 440, overflowY: "auto" }}>
                        {roster
                          .filter((e) => {
                            const n = ownedCount(e);
                            if (rosterFilter === "missing" && n > 0) return false;
                            if (rosterFilter === "owned" && n === 0) return false;
                            if (rosterSearch && !e.name.toLowerCase().includes(rosterSearch.toLowerCase())) return false;
                            return true;
                          })
                          .map((e) => {
                            const n = ownedCount(e);
                            const key = e.scryfallId || `${e.set}-${e.collectorNumber}`;
                            return (
                              <div
                                key={key}
                                className={`roster-row${flashKey === key ? " rowflash" : ""}`}
                                style={{
                                  display: "grid",
                                  gap: 12,
                                  alignItems: "center",
                                  padding: "8px 14px",
                                  borderBottom: `1px solid rgba(185,191,199,0.09)`,
                                  fontSize: 13,
                                }}
                              >
                                <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
                                  #{e.collectorNumber}
                                </span>
                                <span
                                  className="serif"
                                  onMouseEnter={(ev) => setPreview({ entry: e, y: ev.clientY })}
                                  onMouseMove={(ev) => setPreview({ entry: e, y: ev.clientY })}
                                  onMouseLeave={() => setPreview(null)}
                                  style={{
                                    fontWeight: 500,
                                    color: n > 0 ? C.parchment : C.parchmentDim,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    cursor: "default",
                                  }}
                                >
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 7,
                                      height: 7,
                                      borderRadius: "50%",
                                      marginRight: 8,
                                      verticalAlign: 1,
                                      background: RARITY_FILL[e.rarity] || C.rarityCommon,
                                    }}
                                  />
                                  {e.name}
                                </span>
                                <span className="mono roster-price" style={{ fontSize: 11, color: C.parchmentDim, textAlign: "right" }}>
                                  {e.usd !== null ? fmt(e.usd) : "—"}
                                </span>
                                <Stepper
                                  n={n}
                                  onMinus={() => {
                                    onRemoveCopy(e);
                                    setFlashKey(key);
                                  }}
                                  onPlus={() => {
                                    onAddCopy(e, targetCollection);
                                    setFlashKey(key);
                                  }}
                                />
                                <span className="roster-link" style={{ textAlign: "right" }}>
                                  <a
                                    href={cardmarketUrl(e.name)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mono"
                                    style={{
                                      fontSize: 10,
                                      color: C.parchmentDim,
                                      textDecoration: "none",
                                      borderBottom: `1px dotted ${C.parchmentDim}`,
                                    }}
                                  >
                                    cardmarket ↗
                                  </a>
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {preview && preview.entry.imageUrl && (
        <div
          style={{
            position: "fixed",
            left: 24,
            top: Math.min(Math.max(preview.y - 140, 16), window.innerHeight - 300),
            zIndex: 60,
            pointerEvents: "none",
            width: 200,
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 20px 40px -10px rgba(0,0,0,0.85), 0 0 0 1px rgba(232,236,241,0.2)",
          }}
        >
          <img
            src={preview.entry.imageUrl}
            alt={preview.entry.name}
            style={{ width: "100%", display: "block" }}
          />
        </div>
      )}
      </>
      )}
    </main>
  );
}

// Art Series cards ("Tales of Middle-earth Art Series", etc.) are real,
// ownable Scryfall entries — full art, no rules text — and are discovered
// via each owned set's official parent_set_code link, not a guessed prefix,
// so this works for any set that has a companion art series regardless of
// naming convention. Reuses the same roster/stepper machinery as the normal
// Sets tab, since adding an art card to your collection works identically
// to adding any other card.
function cleanArtCardName(name) {
  // Art series cards are technically double-faced (front + back, both the
  // same card), so Scryfall's `name` field is literally "X // X" — collapse
  // that back to plain "X" for display.
  const parts = (name || "").split(" // ");
  if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
  return name;
}

function ArtCardsView({ cards, onAddCopy, onRemoveCopy }) {
  const owned = useMemo(() => cards.filter((c) => !c.sold && c.set), [cards]);
  const ownedSetCodes = useMemo(
    () => [...new Set(owned.map((c) => c.set.toLowerCase()))],
    [owned]
  );

  const [companions, setCompanions] = useState(null); // null = loading
  const [companionError, setCompanionError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [rosterFilter, setRosterFilter] = useState("all");
  const [rosterSearch, setRosterSearch] = useState("");
  const [targetCollection, setTargetCollection] = useState(UNCATEGORIZED);
  const [flashKey, setFlashKey] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const map = await fetchArtSeriesCompanions();
        if (live) setCompanions(map);
      } catch (e) {
        if (live) setCompanionError("Couldn't reach Scryfall to look up art series companions.");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Which of your owned sets actually have a companion art series, and how
  // many art cards from that series you already own.
  const artSets = useMemo(() => {
    if (!companions) return [];
    return ownedSetCodes
      .filter((code) => companions[code])
      .map((code) => {
        const comp = companions[code];
        const distinct = new Set(
          cards.filter((c) => !c.sold && (c.set || "").toLowerCase() === comp.code.toLowerCase())
            .map((c) => c.collectorNumber || c.name)
        ).size;
        return { parentCode: code, ...comp, owned: distinct };
      })
      .sort((a, b) => b.owned - a.owned || a.name.localeCompare(b.name));
  }, [companions, ownedSetCodes, cards]);

  function ownedCount(entry) {
    const match = owned.find(
      (c) =>
        (c.scryfallId && c.scryfallId === entry.scryfallId) ||
        (c.set === entry.set && c.collectorNumber === entry.collectorNumber)
    );
    return match ? match.quantity || 1 : 0;
  }

  async function openRoster(code) {
    if (expanded === code) {
      setExpanded(null);
      setRoster(null);
      return;
    }
    setExpanded(code);
    setRoster(null);
    setRosterError("");
    setRosterFilter("all");
    setRosterSearch("");
    setRosterLoading(true);
    try {
      const r = await fetchSetRoster(code);
      setRoster(r);
    } catch (e) {
      setRosterError("Couldn't load this art series from Scryfall. Try again in a moment.");
    }
    setRosterLoading(false);
  }

  if (companionError) {
    return (
      <div style={{ color: C.redBright, fontSize: 13, padding: "6px 4px" }}>{companionError}</div>
    );
  }

  if (companions === null) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.parchmentDim, fontSize: 13.5 }}>
        <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
        Checking which of your sets have a companion art series…
      </div>
    );
  }

  if (artSets.length === 0) {
    return (
      <div
        style={{
          border: `1px dashed ${C.border}`,
          borderRadius: 10,
          padding: 36,
          textAlign: "center",
          color: C.parchmentDim,
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        <Palette size={22} color={C.gold} style={{ marginBottom: 10 }} />
        <div>None of your sets have a companion art series yet.</div>
        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
          Art series cards ship alongside specific sets — e.g. Tales of Middle-earth, most
          recent Secret Lairs — and only show up here once you own a card from a set that has
          one.
        </div>
      </div>
    );
  }

  const cardmarketUrl = (name) =>
    `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(name)}`;

  return (
    <>
      {artSets.map((art) => {
        const isOpen = expanded === art.code;
        const pct = art.count ? Math.round((art.owned / art.count) * 100) : null;
        return (
          <div key={art.code} style={{ borderBottom: `1px solid rgba(185,191,199,0.15)` }}>
            <div
              onClick={() => openRoster(art.code)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                padding: "18px 4px",
                cursor: "pointer",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="serif" style={{ fontWeight: 600, fontSize: 17, color: C.goldBright }}>
                  {art.name}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: C.parchmentDim,
                    marginTop: 4,
                  }}
                >
                  {art.code.toUpperCase()} · from your {art.parentCode.toUpperCase()} cards ·{" "}
                  {art.owned}/{art.count} owned
                </div>
              </div>

              {art.count && (
                <div style={{ width: 220, maxWidth: "40vw" }}>
                  <div
                    style={{
                      height: 7,
                      background: "rgba(0,0,0,0.5)",
                      borderRadius: 4,
                      overflow: "hidden",
                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: C.gold,
                        borderRadius: 4,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="display" style={{ fontWeight: 700, fontSize: 24, color: C.goldBright, minWidth: 74, textAlign: "right" }}>
                {pct !== null ? `${pct}%` : "…"}
                <span
                  className="mono"
                  style={{ display: "block", fontSize: 9, letterSpacing: 1.5, color: C.parchmentDim, fontWeight: 400, marginTop: 2 }}
                >
                  {isOpen ? "CLOSE" : "COMPLETE"}
                </span>
              </div>
            </div>

            {isOpen && (
              <div style={{ paddingBottom: 24 }}>
                {rosterLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.parchmentDim, fontSize: 13, padding: "6px 4px 14px" }}>
                    <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                    Loading the art series from Scryfall…
                  </div>
                )}
                {rosterError && (
                  <div style={{ color: C.redBright, fontSize: 13, padding: "6px 4px 14px" }}>{rosterError}</div>
                )}

                {roster && (
                  <>
                    <CompletionCost roster={roster} ownedCount={ownedCount} />

                    <div style={{ border: `1px solid rgba(185,191,199,0.2)`, borderRadius: 8, overflow: "hidden" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                          padding: "11px 14px",
                          background: "rgba(0,0,0,0.3)",
                          borderBottom: `1px solid rgba(185,191,199,0.15)`,
                        }}
                      >
                        <div style={{ display: "flex", gap: 6 }}>
                          {["all", "missing", "owned"].map((f) => (
                            <button
                              key={f}
                              onClick={() => setRosterFilter(f)}
                              className="mono"
                              style={{
                                fontSize: 10,
                                letterSpacing: 1,
                                textTransform: "uppercase",
                                background: rosterFilter === f ? C.stock : "transparent",
                                color: rosterFilter === f ? C.stockInk : C.parchmentDim,
                                border: `1px solid ${rosterFilter === f ? C.stock : "rgba(185,191,199,0.25)"}`,
                                borderRadius: 3,
                                padding: "4px 10px",
                                cursor: "pointer",
                              }}
                            >
                              {f}
                            </button>
                          ))}
                        </div>

                        <input
                          value={rosterSearch}
                          onChange={(e) => setRosterSearch(e.target.value)}
                          placeholder="Filter names…"
                          style={{
                            background: C.bgPanel2,
                            border: `1px solid ${C.border}`,
                            borderRadius: 4,
                            padding: "6px 10px",
                            color: C.parchment,
                            fontSize: 12,
                            width: 150,
                          }}
                        />

                        <label
                          className="mono"
                          style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: C.parchmentDim }}
                        >
                          New cards go to
                          <select
                            value={targetCollection}
                            onChange={(e) => setTargetCollection(e.target.value)}
                            style={{
                              background: C.bgPanel2,
                              border: `1px solid ${C.border}`,
                              borderRadius: 4,
                              padding: "5px 8px",
                              color: C.parchment,
                              fontSize: 11.5,
                              textTransform: "none",
                              letterSpacing: 0,
                            }}
                          >
                            <option value={UNCATEGORIZED}>Uncategorized</option>
                          </select>
                        </label>
                      </div>

                      <div style={{ maxHeight: 440, overflowY: "auto" }}>
                        {roster
                          .filter((e) => {
                            const n = ownedCount(e);
                            if (rosterFilter === "missing" && n > 0) return false;
                            if (rosterFilter === "owned" && n === 0) return false;
                            const nm = cleanArtCardName(e.name);
                            if (rosterSearch && !nm.toLowerCase().includes(rosterSearch.toLowerCase())) return false;
                            return true;
                          })
                          .map((e) => {
                            const n = ownedCount(e);
                            const displayName = cleanArtCardName(e.name);
                            const key = e.scryfallId || `${e.set}-${e.collectorNumber}`;
                            return (
                              <div
                                key={key}
                                className={flashKey === key ? "rowflash" : ""}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "52px 1fr 110px 110px",
                                  gap: 12,
                                  alignItems: "center",
                                  padding: "8px 14px",
                                  borderBottom: `1px solid rgba(185,191,199,0.09)`,
                                  fontSize: 13,
                                }}
                                onMouseEnter={(ev) => setPreview({ entry: e, y: ev.clientY })}
                                onMouseMove={(ev) => setPreview({ entry: e, y: ev.clientY })}
                                onMouseLeave={() => setPreview(null)}
                              >
                                <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
                                  #{e.collectorNumber}
                                </span>
                                <span
                                  className="serif"
                                  style={{
                                    fontWeight: 500,
                                    color: n > 0 ? C.parchment : C.parchmentDim,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 7,
                                      height: 7,
                                      borderRadius: "50%",
                                      marginRight: 8,
                                      verticalAlign: 1,
                                      background: RARITY_FILL[e.rarity] || C.rarityCommon,
                                    }}
                                  />
                                  {displayName}
                                </span>
                                <span
                                  className="mono"
                                  style={{
                                    fontSize: 10.5,
                                    color: C.parchmentDim,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                  title={e.artist || ""}
                                >
                                  {e.artist || ""}
                                </span>
                                <Stepper
                                  n={n}
                                  onMinus={() => {
                                    onRemoveCopy(e);
                                    setFlashKey(key);
                                  }}
                                  onPlus={() => {
                                    onAddCopy({ ...e, name: displayName, isArt: true }, targetCollection);
                                    setFlashKey(key);
                                  }}
                                />
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {preview && preview.entry.imageUrl && (
        <div
          style={{
            position: "fixed",
            left: 24,
            top: Math.min(Math.max(preview.y - 140, 16), window.innerHeight - 300),
            zIndex: 60,
            pointerEvents: "none",
            width: 200,
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 20px 40px -10px rgba(0,0,0,0.85), 0 0 0 1px rgba(232,236,241,0.2)",
          }}
        >
          <img
            src={preview.entry.imageUrl}
            alt={cleanArtCardName(preview.entry.name)}
            style={{ width: "100%", display: "block" }}
          />
        </div>
      )}
    </>
  );
}

function CompletionCost({ roster, ownedCount }) {
  const { missing, cost, unpriced } = useMemo(() => {
    let missing = 0, cost = 0, unpriced = 0;
    roster.forEach((e) => {
      if (ownedCount(e) > 0) return;
      missing++;
      if (e.usd !== null && e.usd !== undefined) cost += e.usd;
      else unpriced++;
    });
    return { missing, cost, unpriced };
  }, [roster, ownedCount]);

  if (missing === 0) {
    return (
      <div className="mono" style={{ fontSize: 11.5, color: C.greenBright, padding: "0 4px 14px" }}>
        Set complete — every card accounted for.
      </div>
    );
  }
  return (
    <div className="mono" style={{ fontSize: 11.5, color: C.parchmentDim, padding: "0 4px 14px" }}>
      {missing} missing · completing at market would cost about{" "}
      <span style={{ color: C.goldBright, fontWeight: 600 }}>{fmt(cost)}</span>
      {unpriced > 0 ? ` (${unpriced} unpriced)` : ""}
    </div>
  );
}

function Stepper({ n, onMinus, onPlus }) {
  const btn = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 15,
    fontWeight: 600,
    background: "transparent",
    border: "none",
    color: C.stockInk,
    cursor: "pointer",
    width: 30,
    height: "100%",
    lineHeight: 1,
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: STOCK_BG,
        borderRadius: 4,
        boxShadow: STOCK_SHADOW,
        overflow: "hidden",
        width: 96,
        height: 29,
      }}
    >
      <button style={{ ...btn, color: n === 0 ? "#B5B8B3" : C.stockInk, cursor: n === 0 ? "default" : "pointer" }} disabled={n === 0} onClick={onMinus}>
        −
      </button>
      <span
        className="mono"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: n === 0 ? "#9A9E99" : C.stockInk,
          width: 36,
          textAlign: "center",
          borderLeft: "1px solid rgba(40,44,50,0.2)",
          borderRight: "1px solid rgba(40,44,50,0.2)",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {n}
      </span>
      <button style={btn} onClick={onPlus}>
        +
      </button>
    </div>
  );
}

function SelectionBar({
  count,
  shownCount,
  totalCount,
  onSelectShown,
  onSelectEverything,
  onInvert,
  onDeselect,
  onExit,
  onEdit,
  onDelete,
}) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setConfirm(false);
  }, [count]);

  const smallBtn = {
    background: "none",
    border: `1px solid ${C.border}`,
    color: C.parchmentDim,
    borderRadius: 6,
    padding: "7px 11px",
    fontSize: 12.5,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "rgba(18,20,23,0.97)",
        borderTop: `1px solid rgba(185,191,199,0.45)`,
        boxShadow: "0 -10px 30px rgba(0,0,0,0.5)",
        padding: "12px 28px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        zIndex: 40,
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 13, color: C.goldBright, fontWeight: 600, whiteSpace: "nowrap" }}
      >
        {count} selected
      </span>

      <button onClick={onSelectShown} style={smallBtn}>
        Select all shown ({shownCount})
      </button>
      {shownCount !== totalCount && (
        <button onClick={onSelectEverything} style={smallBtn}>
          Select all {totalCount}
        </button>
      )}
      <button onClick={onInvert} style={smallBtn}>
        Invert
      </button>
      {count > 0 && (
        <button onClick={onDeselect} style={smallBtn}>
          Deselect
        </button>
      )}

      <div style={{ flex: 1 }} />

      {confirm ? (
        <button
          onClick={onDelete}
          style={{
            background: C.red,
            border: "none",
            color: C.parchment,
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 12.5,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Yes, delete {count} {count === 1 ? "card" : "cards"}
        </button>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          disabled={count === 0}
          style={{
            background: "none",
            border: `1px solid ${C.red}`,
            color: C.redBright,
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 12.5,
            cursor: count === 0 ? "default" : "pointer",
            opacity: count === 0 ? 0.5 : 1,
          }}
        >
          <Trash2 size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
          Delete selected
        </button>
      )}

      <button
        onClick={onEdit}
        disabled={count === 0}
        style={{
          background: count === 0 ? C.border : STOCK_BG,
          border: "none",
          color: count === 0 ? C.parchmentDim : C.stockInk,
          borderRadius: 6,
          padding: "8px 16px",
          fontSize: 12.5,
          fontWeight: 700,
          cursor: count === 0 ? "default" : "pointer",
        }}
      >
        Edit selected
      </button>

      <button
        onClick={onExit}
        title="Leave selection mode"
        style={{ background: "none", border: "none", color: C.parchmentDim, cursor: "pointer", padding: 6 }}
      >
        <X size={18} />
      </button>
    </div>
  );
}

function BulkEditModal({ count, decks, overrideCount, collections, onClose, onApply }) {
  const [collectionId, setCollectionId] = useState("");
  const [location, setLocation] = useState("");
  const [condition, setCondition] = useState("");
  const [foil, setFoil] = useState("");
  const [costMode, setCostMode] = useState("");
  const [deckId, setDeckId] = useState("");

  function apply() {
    const patch = {};
    if (collectionId) patch.collectionId = collectionId;
    if (location) patch.location = location;
    if (condition) patch.condition = condition;
    if (foil) {
      patch.finish = foil;
      patch.foil = foil === "foil";
    }
    // Clearing the override puts the card back on the collection's even split —
    // the right state for anything that came out of a booster.
    if (costMode === "clear") patch.costOverride = null;
    if (Object.keys(patch).length === 0 && !deckId) return;
    onApply(patch, deckId || null);
  }

  return (
    <ModalShell title={`Edit ${count} cards`} onClose={onClose}>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Leave a field blank to keep each card's existing setting.
      </p>

      <Field label="Move to collection">
        <select style={inputStyle} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value="">Keep as is</option>
          <option value={UNCATEGORIZED}>Uncategorized</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Physical location">
        <input
          style={inputStyle}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Binder 2, page 4"
        />
      </Field>

      <Field label="Purchase price">
        <select style={inputStyle} value={costMode} onChange={(e) => setCostMode(e.target.value)}>
          <option value="">Keep as is</option>
          <option value="clear">Clear individual prices — split the collection total evenly</option>
        </select>
        {overrideCount > 0 && (
          <div className="mono" style={{ fontSize: 11, color: C.parchmentDim, marginTop: 6 }}>
            {overrideCount} of the selected cards currently {overrideCount === 1 ? "has" : "have"} an
            individual price set.
          </div>
        )}
      </Field>

      {decks?.length > 0 && (
        <Field label="Add all selected to deck">
          <select style={inputStyle} value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            <option value="">Don't add to a deck</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Condition">
          <select style={inputStyle} value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">Keep as is</option>
            {["NM", "LP", "MP", "HP", "DMG"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Finish">
          <select style={inputStyle} value={foil} onChange={(e) => setFoil(e.target.value)}>
            <option value="">Keep as is</option>
            <option value="nonfoil">Normal</option>
            <option value="foil">Foil</option>
            <option value="etched">Etched</option>
          </select>
        </Field>
      </div>

      <button
        onClick={apply}
        style={{
          width: "100%",
          background: STOCK_BG,
          color: C.stockInk,
          border: "none",
          borderRadius: 6,
          padding: "11px",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
          marginTop: 6,
        }}
      >
        Apply to {count} cards
      </button>
    </ModalShell>
  );
}

function AccountPanel({ account }) {
  const [mode, setMode] = useState(null); // null | password | delete
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const input = {
    width: "100%",
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "9px 11px",
    color: C.parchment,
    fontSize: 13,
    marginBottom: 8,
  };
  const small = {
    background: "none",
    border: `1px solid ${C.border}`,
    color: C.parchmentDim,
    borderRadius: 6,
    padding: "8px 13px",
    fontSize: 12.5,
    cursor: "pointer",
  };

  async function signOut() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-hk-app": "1" },
      credentials: "same-origin",
    });
    window.location.reload();
  }

  async function changePassword() {
    setErr("");
    setMsg("");
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hk-app": "1" },
      credentials: "same-origin",
      body: JSON.stringify({ current, next }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Couldn't change the password.");
    setMsg("Password changed. Other devices have been signed out.");
    setCurrent("");
    setNext("");
    setMode(null);
  }

  async function deleteAccount() {
    setErr("");
    const res = await fetch("/api/auth/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-hk-app": "1" },
      credentials: "same-origin",
      body: JSON.stringify({ password: pw }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Couldn't delete the account.");
    window.location.reload();
  }

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 22, paddingTop: 16 }}>
      <div
        style={{
          fontSize: 12,
          color: C.parchmentDim,
          letterSpacing: 1,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Account
      </div>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Signed in as <b style={{ color: C.parchment }}>{account?.email}</b>.
      </p>

      {msg && <div style={{ fontSize: 12, color: C.greenBright, marginBottom: 8 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.redBright, marginBottom: 8 }}>{err}</div>}

      {mode === "password" && (
        <div style={{ marginBottom: 10 }}>
          <input
            style={input}
            type="password"
            placeholder="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <input
            style={input}
            type="password"
            placeholder="New password (10+ characters)"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={changePassword}
              style={{
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 6,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              Save
            </button>
            <button style={small} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "delete" && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 12.5, color: C.redBright, lineHeight: 1.55, marginTop: 0 }}>
            This permanently erases your account and everything in your vault. Export a CSV first if
            you want a copy — this cannot be undone.
          </p>
          <input
            style={input}
            type="password"
            placeholder="Confirm with your password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={deleteAccount}
              style={{
                background: "transparent",
                border: `1px solid ${C.redBright}`,
                color: C.redBright,
                borderRadius: 6,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              Delete everything
            </button>
            <button style={small} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === null && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={small} onClick={signOut}>
            Sign out
          </button>
          <button style={small} onClick={() => { setMode("password"); setErr(""); setMsg(""); }}>
            Change password
          </button>
          <button
            style={{ ...small, borderColor: "rgba(222,115,134,0.4)", color: C.redBright }}
            onClick={() => { setMode("delete"); setErr(""); setMsg(""); }}
          >
            Delete account
          </button>
        </div>
      )}
    </div>
  );
}

function SettingsSection({ label, tone, children }) {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 22, paddingTop: 16 }}>
      <div
        style={{
          fontSize: 12,
          color: tone === "danger" ? C.redBright : C.parchmentDim,
          letterSpacing: 1,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function ProfilePinPanel() {
  const [mode, setMode] = useState(null); // null | pin | delete
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [deletePin, setDeletePin] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const input = {
    width: "100%",
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "9px 11px",
    color: C.parchment,
    fontSize: 13,
    marginBottom: 8,
  };
  const small = {
    background: "none",
    border: `1px solid ${C.border}`,
    color: C.parchmentDim,
    borderRadius: 6,
    padding: "8px 13px",
    fontSize: 12.5,
    cursor: "pointer",
  };

  function switchUser() {
    localStorage.removeItem("lf-profile");
    window.location.reload();
  }

  async function changePin() {
    if (newPin !== confirmPin) return setErr("The new PINs don't match.");
    setErr("");
    setMsg("");
    setBusy(true);
    const res = await fetch(`/api/store/${store.profile}/pin`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-pin": currentPin },
      body: JSON.stringify({ newPin }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error || "Couldn't change the PIN.");
    // the device needs to remember the new PIN going forward
    try {
      localStorage.setItem("lf-profile", JSON.stringify({ name: store.profile, pin: newPin }));
    } catch (e) {}
    store.configure("server", store.profile, newPin);
    setMsg(newPin ? "PIN changed." : "PIN removed — this vault now opens without one.");
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setMode(null);
  }

  async function deleteProfile() {
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/store/${store.profile}`, {
      method: "DELETE",
      headers: { "x-pin": deletePin },
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error || "Couldn't delete the profile.");
    localStorage.removeItem("lf-profile");
    window.location.reload();
  }

  return (
    <SettingsSection label="Profile">
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Signed in as <b style={{ color: C.parchment }}>{store.profile}</b>.
      </p>

      {msg && <div style={{ fontSize: 12, color: C.greenBright, marginBottom: 8 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.redBright, marginBottom: 8 }}>{err}</div>}

      {mode === "pin" && (
        <div style={{ marginBottom: 10 }}>
          <input
            style={input}
            type="password"
            inputMode="numeric"
            placeholder="Current PIN (leave blank if none)"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
          />
          <input
            style={input}
            type="password"
            inputMode="numeric"
            placeholder="New PIN (leave blank to remove it)"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
          />
          <input
            style={input}
            type="password"
            inputMode="numeric"
            placeholder="Confirm new PIN"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && changePin()}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={changePin}
              disabled={busy}
              style={{
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 6,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: busy ? "default" : "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              Save
            </button>
            <button
              style={small}
              onClick={() => {
                setMode(null);
                setErr("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "delete" && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 12.5, color: C.redBright, lineHeight: 1.55, marginTop: 0 }}>
            This permanently deletes the <b>{store.profile}</b> profile and everything in its
            vault from the server. Export a CSV first if you want a copy — this can't be undone.
          </p>
          <input
            style={input}
            type="password"
            inputMode="numeric"
            placeholder="Confirm with this profile's PIN (leave blank if none)"
            value={deletePin}
            onChange={(e) => setDeletePin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && deleteProfile()}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={deleteProfile}
              disabled={busy}
              style={{
                background: "transparent",
                border: `1px solid ${C.redBright}`,
                color: C.redBright,
                borderRadius: 6,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: busy ? "default" : "pointer",
              }}
            >
              Delete this profile
            </button>
            <button
              style={small}
              onClick={() => {
                setMode(null);
                setErr("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === null && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={small} onClick={switchUser}>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Users size={14} /> Switch user
            </span>
          </button>
          <button
            style={small}
            onClick={() => {
              setMode("pin");
              setErr("");
              setMsg("");
            }}
          >
            Change PIN
          </button>
          <button
            style={{ ...small, borderColor: "rgba(222,115,134,0.4)", color: C.redBright }}
            onClick={() => {
              setMode("delete");
              setErr("");
              setMsg("");
            }}
          >
            Delete this profile
          </button>
        </div>
      )}
    </SettingsSection>
  );
}

function SettingsModal({
  serverMode,
  authMode,
  account,
  currency,
  setCurrency,
  czkRate,
  setCzkRate,
  eurRate,
  setEurRate,
  cardCount,
  onDeleteAll,
  onClose,
}) {
  const [wipeConfirm, setWipeConfirm] = useState("");
  return (
    <ModalShell title="Settings" onClose={onClose} width={420}>
      <div
        style={{
          fontSize: 12,
          color: C.parchmentDim,
          letterSpacing: 1,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Currency &amp; display
      </div>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Card prices are tracked in US dollars. Pick how you'd like totals displayed and
        set the rates you want to convert at.
      </p>

      <Field label="Display totals in">
        <select style={inputStyle} value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {Object.entries(CURRENCIES).map(([code, meta]) => (
            <option key={code} value={code}>
              {code} — {meta.label}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <Field label="EUR per 1 USD">
          <input
            type="number"
            step="0.01"
            style={inputStyle}
            value={eurRate}
            onChange={(e) => setEurRate(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="CZK per 1 USD">
          <input
            type="number"
            step="0.1"
            style={inputStyle}
            value={czkRate}
            onChange={(e) => setCzkRate(Number(e.target.value) || 0)}
          />
        </Field>
      </div>

      <button
        onClick={onClose}
        style={{
          width: "100%",
          background: STOCK_BG,
          color: C.stockInk,
          border: "none",
          borderRadius: 6,
          padding: "11px",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Done
      </button>

      {serverMode && authMode === "accounts" && <AccountPanel account={account} />}

      {serverMode && authMode !== "accounts" && <ProfilePinPanel />}

      <SettingsSection label="Support HoardKeeper">
        <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0, lineHeight: 1.55 }}>
          HoardKeeper is free and always will be. If it's saved you some spreadsheet
          headaches, a coffee is appreciated but never expected.
        </p>
        <a
          href="https://ko-fi.com/Arinlir"
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 6,
            padding: "9px 16px",
            fontWeight: 700,
            fontSize: 12.5,
            textDecoration: "none",
            boxShadow: STOCK_SHADOW,
          }}
        >
          <Heart size={14} /> Buy me a coffee on Ko-fi
        </a>
      </SettingsSection>

      <SettingsSection label="Delete everything" tone="danger">
        <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
          Removes all {cardCount} cards from the vault. Collections and their purchase prices
          stay. This can't be undone — export a CSV first if you want a backup.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={wipeConfirm}
            onChange={(e) => setWipeConfirm(e.target.value)}
            placeholder="Type DELETE to confirm"
          />
          <button
            onClick={onDeleteAll}
            disabled={wipeConfirm.trim().toUpperCase() !== "DELETE"}
            style={{
              background: wipeConfirm.trim().toUpperCase() === "DELETE" ? C.red : "transparent",
              border: `1px solid ${C.red}`,
              color: wipeConfirm.trim().toUpperCase() === "DELETE" ? C.parchment : C.redBright,
              borderRadius: 6,
              padding: "0 14px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: wipeConfirm.trim().toUpperCase() === "DELETE" ? "pointer" : "default",
              opacity: wipeConfirm.trim().toUpperCase() === "DELETE" ? 1 : 0.5,
            }}
          >
            Delete all
          </button>
        </div>
      </SettingsSection>
    </ModalShell>
  );
}

function EmptyState({ onAddCard, onImport }) {
  return (
    <div
      style={{
        marginTop: 60,
        textAlign: "center",
        color: C.parchmentDim,
        padding: 40,
        border: `1px dashed rgba(185,191,199,0.3)`,
        borderRadius: 12,
      }}
    >
      <LibraryBig size={28} color={C.gold} style={{ marginBottom: 10 }} />
      <div className="display" style={{ fontSize: 18, color: C.goldBright, marginBottom: 6 }}>
        The vault is empty
      </div>
      <div style={{ fontSize: 13, marginBottom: 18 }}>
        Add your first card, or bring in an existing collection from a CSV.
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button
          onClick={onAddCard}
          style={{
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 6,
            padding: "9px 16px",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Add a card
        </button>
        <IconButton onClick={onImport} label="Import CSV" icon={<Upload size={15} />} />
      </div>
    </div>
  );
}

function ModalShell({ title, onClose, children, width = 480 }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,11,13,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "clamp(10px, 4vw, 20px)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bgPanel,
          border: `1px solid rgba(185,191,199,0.3)`,
          borderRadius: 12,
          width: "100%",
          maxWidth: width,
          maxHeight: "88vh",
          overflowY: "auto",
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.8)",
          position: "relative",
        }}
      >
        {/* stitched inner edge, like the mat */}
        <div
          style={{
            position: "absolute",
            inset: 6,
            borderRadius: 8,
            border: "1.5px dashed rgba(185,191,199,0.22)",
            pointerEvents: "none",
          }}
        />
        {/* cardstock title bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            margin: "14px 14px 0",
            padding: "8px 14px",
            background: STOCK_BG,
            borderRadius: 4,
            boxShadow: STOCK_SHADOW,
            position: "relative",
          }}
        >
          <h2
            className="serif"
            style={{ margin: 0, fontSize: 16.5, fontWeight: 600, color: C.stockInk }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: C.stockDim,
              cursor: "pointer",
              display: "flex",
              padding: 2,
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "18px 24px 24px", position: "relative" }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, color: C.parchmentDim, marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: C.bgPanel2,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "9px 10px",
  color: C.parchment,
  fontSize: 13,
};

// Money is stored in USD but always typed and shown in the display currency.
function MoneyInput({ valueUsd, onChange, placeholder, autoFocus, step = "0.01" }) {
  const toText = (v) =>
    v === null || v === undefined || v === "" || isNaN(v)
      ? ""
      : String(Math.round(convert(v) * 100) / 100);

  const [text, setText] = useState(() => toText(valueUsd));
  const [focused, setFocused] = useState(false);

  // Resync when the value or currency changes underneath us, but never while
  // the user is mid-keystroke.
  useEffect(() => {
    if (!focused) setText(toText(valueUsd));
  }, [valueUsd, focused, CUR.code, CUR.czkRate, CUR.eurRate]);

  return (
    <div style={{ position: "relative" }}>
      <input
        type="number"
        step={step}
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value === "" ? null : unconvert(Number(e.target.value)));
        }}
        style={{ ...inputStyle, paddingRight: 46 }}
      />
      <span
        className="mono"
        style={{
          position: "absolute",
          right: 26,
          top: 10,
          fontSize: 11,
          color: C.parchmentDim,
          pointerEvents: "none",
        }}
      >
        {CUR.code}
      </span>
    </div>
  );
}

function AddCardModal({ prefill, defaultCollectionId, collections, cards, allocationPreview, onClose, onAdd, onCreateCollection }) {
  const [mode, setMode] = useState("search");
  const [query, setQuery] = useState("");
  const [setCode, setSetCode] = useState("");
  const [result, setResult] = useState(prefill || null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  const [candidates, setCandidates] = useState([]);
  const [chosenName, setChosenName] = useState("");
  const [printings, setPrintings] = useState([]);
  const [fSet, setFSet] = useState("");
  const [fType, setFType] = useState("");
  const [fRarity, setFRarity] = useState("");
  const [fColors, setFColors] = useState([]);

  const [codeSet, setCodeSet] = useState("");
  const [codeNum, setCodeNum] = useState("");
  const [lastAdded, setLastAdded] = useState("");
  const [session, setSession] = useState([]); // everything added without closing
  const codeNumRef = useRef(null);
  const searchInputRef = useRef(null);

  // --- Art card search: scoped to real art-series sets only, never mixed
  // in with regular search results, so it can't return the wrong thing. ---
  const [artSets, setArtSets] = useState(null); // null = still loading
  const [artSetsError, setArtSetsError] = useState("");
  const [artQuery, setArtQuery] = useState("");
  const [artSeriesFilter, setArtSeriesFilter] = useState("");
  const [artCandidates, setArtCandidates] = useState([]);
  const [artSearching, setArtSearching] = useState(false);
  const [artError, setArtError] = useState("");
  const [signed, setSigned] = useState(prefill?.signed || false);
  const artInputRef = useRef(null);

  useEffect(() => {
    let live = true;
    fetchAllArtSeriesSets()
      .then((sets) => {
        if (live) setArtSets(sets);
      })
      .catch(() => {
        if (live) setArtSetsError("Couldn't load the list of art series from Scryfall.");
      });
    return () => {
      live = false;
    };
  }, []);

  async function doArtSearch() {
    if (!artQuery.trim() || !artSets || artSets.length === 0) return;
    setArtSearching(true);
    setArtError("");
    setArtCandidates([]);
    try {
      const scope = artSeriesFilter
        ? [artSeriesFilter]
        : artSets.map((s) => s.code);
      const scopeClause = `(${scope.map((c) => `e:${c}`).join(" or ")})`;
      const r = await scryfallSearch(`${scopeClause} ${artQuery.trim()}`, "prints", 24);
      if (r.length === 0) setArtError("No art cards match that name in this scope.");
      setArtCandidates(r);
    } catch (e) {
      setArtError(`Search failed — ${e.message}`);
    }
    setArtSearching(false);
  }

  const [quantity, setQuantity] = useState(1);
  // Duplicating an owned card defaults to matching its own finish and
  // condition — most re-pulls are the same printing again. Flipping to a
  // different finish (the foil-you-just-pulled case) is one click away in
  // the picker rather than the default.
  const [finish, setFinish] = useState(prefill ? finishOf(prefill) : "nonfoil");
  const [condition, setCondition] = useState(prefill?.condition || "NM");
  // Adding while a collection is filtered? Default to that collection.
  const [collectionId, setCollectionId] = useState(defaultCollectionId || UNCATEGORIZED);
  const [costOverride, setCostOverride] = useState(null);
  const [location, setLocation] = useState("");
  const [newCollectionName, setNewCollectionName] = useState("");

  async function doCodeLookup() {
    if (!codeSet.trim() || !codeNum.trim()) return;
    setSearching(true);
    setError("");
    setResult(null);
    try {
      const r = await scryfallByCode(codeSet, codeNum);
      setResult(r);
    } catch (e) {
      setError(e.message);
    }
    setSearching(false);
  }

  function buildQuery() {
    const terms = [];
    if (query.trim()) terms.push(query.trim());
    if (fSet.trim()) terms.push(`e:${fSet.trim().toLowerCase()}`);
    if (fType.trim())
      terms.push(fType.trim().includes(" ") ? `t:"${fType.trim()}"` : `t:${fType.trim()}`);
    if (fRarity) terms.push(`r:${fRarity}`);
    if (fColors.length) terms.push(`c:${fColors.join("").toLowerCase()}`);
    return terms.join(" ");
  }

  async function doSearch() {
    const q = buildQuery();
    if (!q) return;
    setSearching(true);
    setError("");
    setResult(null);
    setCandidates([]);
    setChosenName("");
    setPrintings([]);
    try {
      const found = await scryfallSearch(q, "cards", 18);
      if (found.length === 0) setError("Nothing found — check the spelling or loosen the filters.");
      else if (found.length === 1) await pickCandidate(found[0]);
      else setCandidates(found);
    } catch (e) {
      setError(`Search failed — ${e.message}`);
    }
    setSearching(false);
  }

  async function pickCandidate(c) {
    setChosenName(c.name);
    setError("");
    setSearching(true);
    try {
      // a set filter narrows the printings step to that set too
      const pq = `!"${c.name}"` + (fSet.trim() ? ` e:${fSet.trim().toLowerCase()}` : "");
      const prints = await scryfallSearch(pq, "prints", 16);
      setPrintings(prints.length ? prints : [c]);
      setResult(prints[0] || c);
    } catch (e) {
      setPrintings([c]);
      setResult(c);
    }
    setSearching(false);
  }

  async function doCodeLookup() {
    if (!codeSet.trim() || !codeNum.trim()) return;
    setSearching(true);
    setError("");
    setResult(null);
    try {
      const r = await scryfallByCode(codeSet, codeNum);
      setResult(r);
    } catch (e) {
      setError(e.message);
    }
    setSearching(false);
  }

  function submit(keepOpen = false) {
    let finalCollectionId = collectionId;
    if (collectionId === "__new__") {
      if (!newCollectionName.trim()) return;
      finalCollectionId = onCreateCollection({
        name: newCollectionName.trim(),
        purchasePrice: 0,
        purchaseDate: new Date().toISOString().slice(0, 10),
        note: "",
      });
    }
    if (!result) return;
    const base = result;
    // Art series cards store their name as "X // X" (same front/back name);
    // cleanArtCardName collapses that for display and is a no-op for every
    // other card, so it's safe to apply unconditionally here.
    const isArt = mode === "art" || !!prefill?.isArt;
    const outcome = onAdd(
      {
        ...base,
        name: cleanArtCardName(base.name),
        quantity: Number(quantity) || 1,
        finish,
        foil: finish === "foil",
        condition,
        collectionId: finalCollectionId,
        location: location.trim(),
        costOverride,
        isArt,
        signed: isArt ? signed : false,
      },
      keepOpen
    );
    setSession((prev) => [
      {
        name: base.name,
        set: base.set,
        num: base.collectorNumber,
        qty: Number(quantity) || 1,
        finish,
        merged: !!outcome?.merged,
      },
      ...prev,
    ]);

    if (keepOpen) {
      // Rapid entry. Collection, finish, condition and location all stay put —
      // they're usually the same across a batch — and only the card is cleared.
      setLastAdded(base.name);
      setResult(null);
      setQuantity(1);
      setCostOverride(null);
      if (mode === "code") {
        setCodeNum("");
        setTimeout(() => codeNumRef.current?.focus(), 0);
      } else {
        setQuery("");
        setCandidates([]);
        setChosenName("");
        setPrintings([]);
        setError("");
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    }
  }

  return (
    <ModalShell title={prefill ? "Add another copy" : "Add a card"} onClose={onClose}>
      {prefill && (
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            background: C.bgPanel2,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: 10,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 44,
              aspectRatio: "5 / 7",
              borderRadius: 4,
              overflow: "hidden",
              border: `1px solid ${C.border}`,
              flexShrink: 0,
            }}
          >
            <CardArt card={prefill} />
          </div>
          <div style={{ fontSize: 12.5, color: C.parchmentDim, lineHeight: 1.5 }}>
            Duplicating <b style={{ color: C.parchment }}>{prefill.name}</b> — same printing,
            same {(prefill.set || "").toUpperCase()} #{prefill.collectorNumber}. Change the
            finish below if this pull is different (a foil, say), then add it as its own copy.
          </div>
        </div>
      )}

      {prefill?.isArt && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: C.parchment,
            marginBottom: 16,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} style={{ width: 15, height: 15 }} />
          This copy has the artist's signature (gold-stamped)
        </label>
      )}

      {!prefill && (
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <TabButton active={mode === "search"} onClick={() => setMode("search")}>
          By name
        </TabButton>
        <TabButton active={mode === "code"} onClick={() => setMode("code")}>
          By code
        </TabButton>
        <TabButton active={mode === "art"} onClick={() => setMode("art")}>
          Art card
        </TabButton>
      </div>
      )}

      {prefill ? null : mode === "search" ? (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              ref={searchInputRef}
              style={inputStyle}
              placeholder="Card name (e.g. Sol Ring)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              autoFocus
            />
            <button
              onClick={doSearch}
              disabled={searching}
              style={{
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 6,
                padding: "0 14px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              {searching ? "..." : "Search"}
            </button>
          </div>

          {/* optional filters — any combination works, with or without a name */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input
              style={{ ...inputStyle, width: 74, textTransform: "uppercase" }}
              placeholder="Set"
              title="Set code, e.g. HOB"
              value={fSet}
              onChange={(e) => setFSet(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
            />
            <input
              style={{ ...inputStyle, flex: 1, minWidth: 110 }}
              placeholder="Type (creature, wolf, aura…)"
              title="Matches card types and subtypes"
              value={fType}
              onChange={(e) => setFType(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
            />
            <select
              style={{ ...inputStyle, width: 118 }}
              value={fRarity}
              onChange={(e) => setFRarity(e.target.value)}
            >
              <option value="">Any rarity</option>
              <option value="common">Common</option>
              <option value="uncommon">Uncommon</option>
              <option value="rare">Rare</option>
              <option value="mythic">Mythic</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 12 }}>
            {["W", "U", "B", "R", "G"].map((k) => {
              const on = fColors.includes(k);
              return (
                <button
                  key={k}
                  title={k}
                  onClick={() =>
                    setFColors((prev) => (on ? prev.filter((x) => x !== k) : [...prev, k]))
                  }
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: MANA[k],
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    boxShadow: on
                      ? `0 0 0 2px ${C.bgPanel}, 0 0 0 3.5px ${C.goldBright}`
                      : "inset 0 0 0 1px rgba(0,0,0,0.4)",
                    opacity: on || fColors.length === 0 ? 1 : 0.35,
                  }}
                />
              );
            })}
            <span className="mono" style={{ fontSize: 9.5, color: C.parchmentDim, marginLeft: 6 }}>
              colors (optional)
            </span>
          </div>

          {error && (
            <div style={{ color: C.redBright, fontSize: 12.5, marginBottom: 12, display: "flex", gap: 6 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* step 1: pick the card */}
          {candidates.length > 0 && !chosenName && (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                maxHeight: 300,
                overflowY: "auto",
                marginBottom: 14,
              }}
            >
              {candidates.map((c) => (
                <div
                  key={c.scryfallId}
                  onClick={() => pickCandidate(c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    cursor: "pointer",
                    borderBottom: `1px solid rgba(185,191,199,0.09)`,
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      aspectRatio: "5 / 7",
                      borderRadius: 3,
                      overflow: "hidden",
                      flexShrink: 0,
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    <CardArt card={c} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="serif" style={{ fontWeight: 600, fontSize: 13.5, color: C.parchment }}>
                      {c.name}
                    </div>
                    <div className="mono" style={{ fontSize: 9.5, color: C.parchmentDim, textTransform: "uppercase" }}>
                      {(c.typeLine || "").split("—")[0].trim()}
                    </div>
                  </div>
                  <div className="mono" style={{ marginLeft: "auto", fontSize: 11, color: C.goldBright, flexShrink: 0 }}>
                    {c.usd !== null ? fmt(c.usd) : ""}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* step 2: pick the printing */}
          {chosenName && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 7,
                }}
              >
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", color: C.parchmentDim }}>
                  Printings — {chosenName}
                </span>
                <button
                  onClick={() => {
                    setChosenName("");
                    setPrintings([]);
                    setResult(null);
                  }}
                  className="mono"
                  style={{ background: "none", border: "none", color: C.parchmentDim, fontSize: 10.5, cursor: "pointer", textDecoration: "underline" }}
                >
                  back to results
                </button>
              </div>
              <div
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  maxHeight: 200,
                  overflowY: "auto",
                  marginBottom: 14,
                }}
              >
                {printings.map((p) => {
                  const sel = result?.scryfallId === p.scryfallId;
                  return (
                    <div
                      key={p.scryfallId}
                      onClick={() => setResult(p)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "7px 11px",
                        cursor: "pointer",
                        fontSize: 12.5,
                        background: sel ? "rgba(232,236,241,0.09)" : "transparent",
                        borderLeft: sel ? `3px solid ${C.goldBright}` : "3px solid transparent",
                        borderBottom: `1px solid rgba(185,191,199,0.09)`,
                      }}
                    >
                      <span className="serif" style={{ color: C.parchment, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.setName}
                      </span>
                      <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, flexShrink: 0 }}>
                        #{p.collectorNumber} · {p.usd !== null ? fmt(p.usd) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {result && (
            <div
              style={{
                display: "flex",
                gap: 12,
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 10,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 60,
                  aspectRatio: "5 / 7",
                  borderRadius: 4,
                  overflow: "hidden",
                  border: `1px solid ${C.border}`,
                  flexShrink: 0,
                  position: "relative",
                }}
              >
                <CardArt card={result} />
                {finish !== "nonfoil" && (
                  <>
                    <div className="foil-sheen" />
                    <div className="foil-edge" />
                  </>
                )}
              </div>
              <div style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: C.parchment }}>{result.name}</div>
                <div style={{ color: C.parchmentDim, fontSize: 12 }}>
                  {result.setName} · #{result.collectorNumber}
                </div>
                <div className="mono" style={{ color: C.goldBright, marginTop: 4 }}>
                  {fmt(result.usd)} {result.usdFoil ? ` / ${fmt(result.usdFoil)} foil` : ""}
                </div>
              </div>
            </div>
          )}
        </>
      ) : mode === "code" ? (
        <>
          <p style={{ fontSize: 12, color: C.parchmentDim, marginTop: 0 }}>
            The bottom-left corner of the card: set code and collector number
            (e.g. <span className="mono">HOB 0191</span>). Set sticks between adds, so a stack
            goes number → Enter → number → Enter.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              style={{ ...inputStyle, width: 90, textTransform: "uppercase" }}
              placeholder="Set"
              value={codeSet}
              onChange={(e) => setCodeSet(e.target.value)}
            />
            <input
              ref={codeNumRef}
              style={inputStyle}
              placeholder="Collector number"
              value={codeNum}
              onChange={(e) => setCodeNum(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doCodeLookup()}
              autoFocus
            />
            <button
              onClick={doCodeLookup}
              disabled={searching}
              style={{
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 6,
                padding: "0 14px",
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                boxShadow: STOCK_SHADOW,
              }}
            >
              {searching ? "..." : "Find"}
            </button>
          </div>
          {lastAdded && !result && !error && (
            <div className="mono" style={{ fontSize: 11.5, color: C.greenBright, marginBottom: 12 }}>
              ✓ {lastAdded} added — next number
            </div>
          )}
          {error && (
            <div style={{ color: C.redBright, fontSize: 12.5, marginBottom: 12, display: "flex", gap: 6 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}
          {result && (
            <div
              style={{
                display: "flex",
                gap: 12,
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 10,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 60,
                  aspectRatio: "5 / 7",
                  borderRadius: 4,
                  overflow: "hidden",
                  border: `1px solid ${C.border}`,
                  flexShrink: 0,
                  position: "relative",
                }}
              >
                <CardArt card={result} />
                {finish !== "nonfoil" && (
                  <>
                    <div className="foil-sheen" />
                    <div className="foil-edge" />
                  </>
                )}
              </div>
              <div style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: C.parchment }}>{result.name}</div>
                <div style={{ color: C.parchmentDim, fontSize: 12 }}>
                  {result.setName} · #{result.collectorNumber}
                </div>
                <div className="mono" style={{ color: C.goldBright, marginTop: 4 }}>
                  {fmt(result.usd)} {result.usdFoil ? ` / ${fmt(result.usdFoil)} foil` : ""}
                </div>
              </div>
            </div>
          )}
        </>
      ) : mode === "art" ? (
        <>
          {artSetsError && (
            <div style={{ color: C.redBright, fontSize: 12.5, marginBottom: 12 }}>{artSetsError}</div>
          )}
          {artSets === null && !artSetsError && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.parchmentDim, fontSize: 13, marginBottom: 12 }}>
              <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
              Loading the list of art series from Scryfall…
            </div>
          )}

          {artSets && artSets.length > 0 && (
            <>
              <p style={{ fontSize: 12, color: C.parchmentDim, marginTop: 0 }}>
                Searches only within real art-series sets — Sol Ring the playable card won't show
                up here, only Sol Ring the art card. Since Scryfall doesn't track signed vs.
                unsigned (they're the same database entry either way), mark it yourself below if
                your copy has the gold-stamped signature.
              </p>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                  ref={artInputRef}
                  style={inputStyle}
                  placeholder="Card name (e.g. Hidden Blade)"
                  value={artQuery}
                  onChange={(e) => setArtQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doArtSearch()}
                  autoFocus
                />
                <button
                  onClick={doArtSearch}
                  disabled={artSearching || !artQuery.trim()}
                  style={{
                    background: STOCK_BG,
                    color: C.stockInk,
                    border: "none",
                    borderRadius: 6,
                    padding: "0 18px",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: artSearching || !artQuery.trim() ? "default" : "pointer",
                    opacity: artSearching || !artQuery.trim() ? 0.6 : 1,
                  }}
                >
                  {artSearching ? "…" : "Search"}
                </button>
              </div>

              <select
                value={artSeriesFilter}
                onChange={(e) => setArtSeriesFilter(e.target.value)}
                style={{ ...inputStyle, marginBottom: 12 }}
              >
                <option value="">Any art series</option>
                {artSets.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>

              {artError && (
                <div style={{ color: C.redBright, fontSize: 12.5, marginBottom: 12 }}>{artError}</div>
              )}

              {artCandidates.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    maxHeight: 280,
                    overflowY: "auto",
                    marginBottom: 12,
                  }}
                >
                  {artCandidates.map((c) => (
                    <div
                      key={c.scryfallId}
                      onClick={() => {
                        setResult(c);
                        setArtCandidates([]);
                        setArtQuery(cleanArtCardName(c.name));
                      }}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        padding: "8px 10px",
                        borderRadius: 6,
                        cursor: "pointer",
                        border: `1px solid ${C.border}`,
                        background: C.bgPanel2,
                      }}
                    >
                      <div style={{ width: 36, aspectRatio: "5 / 7", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
                        <CardArt card={c} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: C.parchment, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {cleanArtCardName(c.name)}
                        </div>
                        <div className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
                          {c.setName} · #{c.collectorNumber}
                          {c.artist ? ` · ${c.artist}` : ""}
                        </div>
                      </div>
                      <div className="mono" style={{ fontSize: 12, color: C.goldBright, flexShrink: 0 }}>
                        {fmt(c.usd)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {result && (
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 10,
                marginBottom: 16,
              }}
            >
              <div style={{ width: 44, aspectRatio: "5 / 7", borderRadius: 4, overflow: "hidden", flexShrink: 0 }}>
                <CardArt card={result} />
              </div>
              <div style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: C.parchment }}>{cleanArtCardName(result.name)}</div>
                <div style={{ color: C.parchmentDim, fontSize: 12 }}>
                  {result.setName} · #{result.collectorNumber}
                  {result.artist ? ` · ${result.artist}` : ""}
                </div>
                <div className="mono" style={{ color: C.goldBright, marginTop: 4 }}>
                  {fmt(result.usd)}
                </div>
              </div>
            </div>
          )}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: C.parchment,
              marginBottom: 16,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} style={{ width: 15, height: 15 }} />
            This copy has the artist's signature (gold-stamped)
          </label>
        </>
      ) : null}

      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Quantity">
          <input
            type="number"
            min={1}
            style={inputStyle}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Condition">
          <select style={inputStyle} value={condition} onChange={(e) => setCondition(e.target.value)}>
            {["NM", "LP", "MP", "HP", "DMG"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Finish">
        <FinishPicker card={result || {}} value={finish} onChange={setFinish} />
        {result && <TreatmentTags card={result} />}
      </Field>

      <Field label="Collection">
        <select style={inputStyle} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value={UNCATEGORIZED}>Uncategorized</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new__">+ New collection...</option>
        </select>
      </Field>
      {collectionId === "__new__" && (
        <Field label="New collection name">
          <input
            style={inputStyle}
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            placeholder="e.g. Hobbit Bundle"
          />
        </Field>
      )}

      <Field label="Physical location (optional)">
        <input
          style={inputStyle}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Binder 2, page 4"
        />
      </Field>

      <Field label="Purchase price (optional — blank shares the collection's total)">
        <MoneyInput valueUsd={costOverride} onChange={setCostOverride} placeholder="auto-split" />
        {(() => {
          if (costOverride !== null && costOverride !== undefined) return null;
          const prev = allocationPreview ? allocationPreview(collectionId) : null;
          if (!prev) {
            return (
              <div className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, marginTop: 6 }}>
                Uncategorized cards carry no cost. Put it in a collection to give it a share of
                what you paid.
              </div>
            );
          }
          if (prev.total <= 0) {
            return (
              <div className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, marginTop: 6 }}>
                This collection has no invested total yet, so the card is allocated nothing. Set
                what you paid in Collections.
              </div>
            );
          }
          return (
            <div className="mono" style={{ fontSize: 10.5, color: C.greenBright, marginTop: 6 }}>
              Will be allocated {fmt(prev.each)} — {fmt(prev.total)} split across {prev.sharers}{" "}
              cards.
            </div>
          );
        })()}
      </Field>

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button
          onClick={() => submit(true)}
          disabled={!result}
          style={{
            flex: 2,
            background: result ? STOCK_BG : C.border,
            color: result ? C.stockInk : C.parchmentDim,
            border: "none",
            borderRadius: 6,
            padding: "11px",
            fontWeight: 700,
            fontSize: 14,
            cursor: result ? "pointer" : "default",
            boxShadow: result ? STOCK_SHADOW : "none",
          }}
        >
          Add &amp; next
        </button>
        <button
          onClick={() => submit(false)}
          disabled={!result}
          style={{
            flex: 1,
            background: "transparent",
            color: C.parchmentDim,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "11px",
            fontWeight: 700,
            fontSize: 14,
            cursor: result ? "pointer" : "default",
            opacity: result ? 1 : 0.5,
          }}
        >
          Add &amp; close
        </button>
      </div>

      {/* what this session has put in the vault so far */}
      {session.length > 0 && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <div
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: C.parchmentDim,
              marginBottom: 7,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>Added this session</span>
            <span>
              {session.reduce((n, x) => n + x.qty, 0)} card
              {session.reduce((n, x) => n + x.qty, 0) === 1 ? "" : "s"}
            </span>
          </div>
          <div style={{ maxHeight: 116, overflowY: "auto" }}>
            {session.map((x, i) => (
              <div
                key={i}
                className="mono"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 10.5,
                  color: C.parchmentDim,
                  padding: "2px 0",
                }}
              >
                <span style={{ color: i === 0 ? C.greenBright : C.parchmentDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {i === 0 ? "✓ " : ""}
                  {x.qty > 1 ? `${x.qty}× ` : ""}
                  {x.name}
                  {x.merged && (
                    <span style={{ opacity: 0.7 }}> (already owned — quantity bumped)</span>
                  )}
                </span>
                <span style={{ flexShrink: 0, opacity: 0.8 }}>
                  {(x.set || "").toUpperCase()} {x.num || ""}
                  {x.finish !== "nonfoil" ? ` · ${x.finish}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function FinishPicker({ card, value, onChange }) {
  const avail = availableFinishes(card);
  const opts = FINISHES.filter((f) => avail.includes(f.key));
  const list = opts.length ? opts : [FINISHES[0]];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {list.map((f) => {
        const on = value === f.key;
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            style={{
              background: on ? STOCK_BG : "transparent",
              color: on ? C.stockInk : C.parchmentDim,
              border: `1px solid ${on ? C.stock : C.border}`,
              borderRadius: 5,
              padding: "7px 13px",
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              cursor: "pointer",
              boxShadow: on ? STOCK_SHADOW : "none",
            }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

// Read-only description of the printing's treatment.
function TreatmentTags({ card }) {
  const tags = treatmentTags(card);
  if (!tags.length) return null;
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
      {tags.map((t) => (
        <span
          key={t}
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            border: `1px solid ${C.border}`,
            color: C.parchmentDim,
            borderRadius: 3,
            padding: "2px 7px",
          }}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? C.bgPanel2 : "transparent",
        color: active ? C.goldBright : C.parchmentDim,
        border: `1px solid ${active ? C.gold : C.border}`,
        borderRadius: 6,
        padding: "8px 0",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}


function CollectionsModal({
  overAllocation,
  collections,
  cards,
  valueOf,
  costOf,
  onClose,
  onUpdate,
  onDelete,
  onResetCost,
  onResetAll,
  onCreate,
}) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  const stats = collections.map((col) => {
    const mine = cards.filter((c) => c.collectionId === col.id);
    const held = mine.filter((c) => !c.sold);
    const value = held.reduce((s, c) => s + valueOf(c), 0);
    const paid = mine.reduce((s, c) => s + costOf(c), 0);
    const overrides = mine.filter(
      (c) => c.costOverride !== null && c.costOverride !== undefined
    ).length;
    return {
      col,
      count: mine.length,
      sold: mine.length - held.length,
      value,
      paid,
      overrides,
      over: overAllocation ? overAllocation(col.id) : 0,
    };
  });

  return (
    <ModalShell title="Collections" onClose={onClose} width={620}>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Set what you paid for each collection as a whole — a precon, a bundle, a booster box.
        That total is split evenly across its cards, so you never need to price singles you
        never bought individually.
      </p>

      {stats.length === 0 && (
        <div
          style={{
            border: `1px dashed ${C.border}`,
            borderRadius: 8,
            padding: 24,
            textAlign: "center",
            color: C.parchmentDim,
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          No collections yet.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {stats.map(({ col, count, sold, value, paid, overrides, over }) => {
          const delta = value - paid;
          return (
            <div
              key={col.id}
              style={{
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                <input
                  value={col.name}
                  onChange={(e) => onUpdate(col.id, { name: e.target.value })}
                  style={{
                    ...inputStyle,
                    flex: 1,
                    fontWeight: 600,
                    background: "transparent",
                    border: `1px solid transparent`,
                  }}
                />
                <span
                  className="mono"
                  style={{ fontSize: 11.5, color: C.parchmentDim, whiteSpace: "nowrap" }}
                >
                  {count} card{count === 1 ? "" : "s"}
                  {sold > 0 ? ` · ${sold} sold` : ""}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(150px, 1fr) auto auto",
                  gap: 10,
                  alignItems: "end",
                }}
              >
                <div>
                  <label
                    style={{ display: "block", fontSize: 11, color: C.parchmentDim, marginBottom: 4 }}
                  >
                    Invested
                  </label>
                  <MoneyInput
                    valueUsd={col.purchasePrice ?? 0}
                    onChange={(usd) => onUpdate(col.id, { purchasePrice: usd ?? 0 })}
                  />
                </div>

                <div style={{ textAlign: "right", paddingBottom: 6 }}>
                  <div className="mono" style={{ fontSize: 13, color: C.parchment }}>
                    {fmt(value)}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 11.5, color: delta >= 0 ? C.greenBright : C.redBright }}
                  >
                    {delta >= 0 ? "+" : "-"}
                    {fmt(Math.abs(delta))}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, paddingBottom: 4 }}>
                  <button
                    onClick={() => onResetCost(col.id)}
                    title="Set invested back to zero and clear per-card overrides"
                    style={{
                      background: "none",
                      border: `1px solid ${C.border}`,
                      color: C.parchmentDim,
                      borderRadius: 6,
                      padding: "7px 10px",
                      fontSize: 12,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Reset
                  </button>
                  {confirmDelete === col.id ? (
                    <button
                      onClick={() => {
                        onDelete(col.id);
                        setConfirmDelete(null);
                      }}
                      style={{
                        background: C.red,
                        border: "none",
                        color: C.parchment,
                        borderRadius: 6,
                        padding: "7px 10px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Sure?
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(col.id)}
                      title="Delete collection (cards move to Uncategorized)"
                      style={{
                        background: "none",
                        border: `1px solid ${C.red}`,
                        color: C.redBright,
                        borderRadius: 6,
                        padding: "7px 9px",
                        cursor: "pointer",
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {overrides > 0 && over === 0 && (
                <div style={{ fontSize: 11, color: C.parchmentDim, marginTop: 7 }}>
                  {overrides} card{overrides === 1 ? " has" : "s have"} an individual purchase
                  price set — the rest share what's left of the total.
                </div>
              )}

              {over > 0 && (
                <div
                  style={{
                    fontSize: 11.5,
                    color: C.redBright,
                    marginTop: 7,
                    lineHeight: 1.55,
                    display: "flex",
                    gap: 7,
                  }}
                >
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    The individual prices on {overrides} card{overrides === 1 ? "" : "s"} add up to{" "}
                    {fmt(over)} <b>more</b> than this collection's total, so every other card is
                    allocated nothing. Either raise the Invested figure or clear the individual
                    prices (Reset below, or select the cards and use “Clear individual prices”).
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onCreate}
          style={{
            flex: 1,
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 6,
            padding: "11px",
            fontWeight: 700,
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          <Plus size={15} style={{ verticalAlign: "-3px", marginRight: 4 }} />
          New collection
        </button>
        {confirmResetAll ? (
          <button
            onClick={() => {
              onResetAll();
              setConfirmResetAll(false);
            }}
            style={{
              background: C.red,
              border: "none",
              color: C.parchment,
              borderRadius: 6,
              padding: "11px 16px",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Reset every total?
          </button>
        ) : (
          <button
            onClick={() => setConfirmResetAll(true)}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.parchmentDim,
              borderRadius: 6,
              padding: "11px 16px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Reset all invested
          </button>
        )}
      </div>
    </ModalShell>
  );
}

function SellModal({ card, suggested, onClose, onSell }) {
  const qty = card.quantity || 1;
  const [price, setPrice] = useState(suggested || null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const unit = price || 0;
  const proceeds = unit * qty;

  return (
    <ModalShell title={`Sell ${card.name}`} onClose={onClose} width={420}>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Marking a card sold moves it off the main grid onto the Sold shelf. What you paid for it
        stays on the books, and the difference shows up as realized gain or loss.
      </p>

      <Field label={`Sale price each${qty > 1 ? ` (${qty} copies)` : ""}`}>
        <MoneyInput valueUsd={price} onChange={setPrice} autoFocus />
      </Field>

      <Field label="Date sold">
        <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      {qty > 1 && (
        <div className="mono" style={{ fontSize: 12.5, color: C.parchmentDim, marginBottom: 14 }}>
          Total proceeds: <span style={{ color: C.goldBright }}>{fmt(proceeds)}</span>
        </div>
      )}

      <button
        onClick={() => onSell({ sold: true, soldPrice: unit, soldDate: date })}
        style={{
          width: "100%",
          background: STOCK_BG,
          color: C.stockInk,
          border: "none",
          borderRadius: 6,
          padding: "11px",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Mark sold for {fmt(proceeds)}
      </button>
    </ModalShell>
  );
}

function AddCollectionModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  return (
    <ModalShell title="New collection" onClose={onClose}>
      <Field label="Name">
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Commander Deck — Dina"
        />
      </Field>
      <Field label="Total purchase price">
        <MoneyInput valueUsd={price} onChange={setPrice} />
      </Field>
      <Field label="Purchase date">
        <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Note (optional)">
        <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button
        onClick={() => {
          if (!name.trim()) return;
          onAdd({ name: name.trim(), purchasePrice: price || 0, purchaseDate: date, note });
        }}
        style={{
          width: "100%",
          background: STOCK_BG,
          color: C.stockInk,
          border: "none",
          borderRadius: 6,
          padding: "11px",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Create collection
      </button>
    </ModalShell>
  );
}

const HEADER_HINTS = {
  name: ["name", "card name", "card", "cardname", "title"],
  set: ["set code", "set", "setcode", "edition", "set id", "set_code"],
  setName: ["set name", "edition name", "setname"],
  collectorNumber: [
    "collector number",
    "collector_number",
    "collectornumber",
    "card number",
    "number",
    "cn",
    "collector #",
    "card #",
  ],
  quantity: ["quantity", "qty", "count", "amount"],
  foil: ["foil", "finish", "printing", "is foil", "foil?"],
  purchasePrice: ["purchase price", "price", "paid", "cost", "purchase_price"],
  currentValue: ["current value", "market price", "value", "price (current)", "trend price"],
  scryfallId: ["scryfall id", "scryfall_id", "scryfallid", "scryfall", "id"],
  condition: ["condition", "cond", "grade"],
  language: ["language", "lang"],
  collection: ["binder name", "collection", "binder", "deck", "folder", "list", "group"],
  location: ["location", "shelf", "box", "storage"],
};

function guessMapping(headers) {
  const map = {};
  const used = new Set();
  Object.entries(HEADER_HINTS).forEach(([field, hints]) => {
    const found = headers.find(
      (h) => !used.has(h) && hints.includes(h.trim().toLowerCase())
    );
    if (found) {
      map[field] = found;
      used.add(found);
    }
  });
  return map;
}

function truthy(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "foil" || s === "etched";
}

function ImportModal({ collections, onClose, onCreateCollection, onImportCards, onAddToCollectionTotal }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState("");

  const [fallbackCollection, setFallbackCollection] = useState(UNCATEGORIZED);
  const [lookupPrices, setLookupPrices] = useState(true);
  // Sealed product is bought as a lump: prices in the file should feed the
  // collection's total and split evenly, not stick to individual cards.
  const [costMode, setCostMode] = useState("allocate"); // allocate | perCard
  const [fileCurrency, setFileCurrency] = useState(CUR.code);
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const [fatalError, setFatalError] = useState("");
  const fileInput = useRef(null);

  function handleFile(f) {
    setFile(f);
    setParseError("");
    setReport(null);
    setFatalError("");
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hdrs = (res.meta.fields || []).filter(Boolean);
        if (hdrs.length === 0) {
          setParseError("No column headers found. The first row should name the columns.");
          return;
        }
        setHeaders(hdrs);
        setMapping(guessMapping(hdrs));
        setRows(res.data);
      },
      error: (err) => setParseError(err.message || "Couldn't read that file."),
    });
  }

  function val(row, field) {
    const col = mapping[field];
    if (!col) return "";
    return String(row[col] ?? "").trim();
  }

  async function runImport() {
    if (!rows || rows.length === 0) return;
    if (!mapping.name) {
      setParseError("Pick which column holds the card name before importing.");
      return;
    }

    setFatalError("");
    setProgress({ done: 0, total: rows.length, phase: "Reading file" });

    // Group rows by the collection named in the file so each one becomes a real
    // collection with its own purchase total.
    const collectionTotals = {};
    const prepared = rows.map((row, i) => {
      const name = val(row, "name");
      const setCode = val(row, "set").toLowerCase();
      const qty = Number(val(row, "quantity")) || 1;
      const money = (field) => {
        const raw = val(row, field).replace(/[^0-9.,-]/g, "").replace(",", ".");
        if (raw === "") return null;
        const n = Number(raw);
        return isNaN(n) ? null : n;
      };
      const rate =
        fileCurrency === "USD" ? 1 : fileCurrency === "EUR" ? CUR.eurRate : CUR.czkRate;
      const inUsd = (v) => (v === null ? null : rate ? v / rate : v);
      const price = inUsd(money("purchasePrice"));
      const value = inUsd(money("currentValue"));
      const colName = val(row, "collection");
      if (colName && price !== null) {
        collectionTotals[colName] = (collectionTotals[colName] || 0) + price * qty;
      }
      const cn = val(row, "collectorNumber");
      const sid = val(row, "scryfallId");
      let identifier;
      if (sid) identifier = { id: sid };
      else if (setCode && cn) identifier = { set: setCode, collector_number: cn };
      else if (setCode && name) identifier = { name, set: setCode };
      else identifier = { name };
      return { i, row, name, setCode, cn, sid, qty, price, value, colName, identifier, card: null };
    });

    // Optional enrichment: resolve each row against Scryfall for prices and art.
    if (lookupPrices) {
      const withNames = prepared.filter((p) => p.name || p.sid);
      const index = { byId: {}, bySetCn: {}, byName: {} };
      let anySuccess = false;
      let lastError = "";

      for (let start = 0; start < withNames.length; start += 75) {
        const chunk = withNames.slice(start, start + 75);
        try {
          const data = await scryfallCollection(chunk.map((p) => p.identifier));
          (data.data || []).forEach((raw) => {
            const card = normalizeCard(raw);
            index.byId[raw.id] = card;
            index.bySetCn[`${raw.set}|${raw.collector_number}`] = card;
            const key = raw.name.toLowerCase();
            if (!index.byName[key]) index.byName[key] = card;
            const front = raw.name.split("//")[0].trim().toLowerCase();
            if (!index.byName[front]) index.byName[front] = card;
            anySuccess = true;
          });
        } catch (e) {
          lastError = e.message;
        }
        setProgress({
          done: Math.min(start + 75, withNames.length),
          total: withNames.length,
          phase: "Matching cards",
        });
        await sleep(RATE_MS);
      }

      if (!anySuccess && withNames.length > 0) {
        setProgress(null);
        setFatalError(
          `Couldn't reach Scryfall${lastError ? ` — ${lastError}` : ""}. ` +
            `Untick "Look up prices and art" to import the file as-is, or check your connection.`
        );
        return;
      }

      prepared.forEach((p) => {
        p.card =
          (p.sid && index.byId[p.sid]) ||
          (p.setCode && p.cn && index.bySetCn[`${p.setCode}|${p.cn}`]) ||
          (p.name && index.byName[p.name.toLowerCase()]) ||
          null;
      });

      // One fuzzy retry for anything the batch missed.
      const leftovers = prepared.filter((p) => !p.card && p.name);
      for (let i = 0; i < leftovers.length; i++) {
        try {
          leftovers[i].card = await scryfallLookup(leftovers[i].name);
        } catch (e) {
          // stays unmatched
        }
        setProgress({ done: i + 1, total: leftovers.length, phase: "Retrying near misses" });
        await sleep(RATE_MS);
      }
    }

    // Create a collection for every distinct name found in the file.
    const nameToId = {};
    collections.forEach((c) => {
      nameToId[c.name.toLowerCase()] = c.id;
    });
    Object.keys(collectionTotals).forEach((cn) => {
      if (!nameToId[cn.toLowerCase()]) {
        nameToId[cn.toLowerCase()] = onCreateCollection({
          name: cn,
          purchasePrice: Number(collectionTotals[cn].toFixed(2)),
          purchaseDate: new Date().toISOString().slice(0, 10),
          note: `Imported from ${file?.name || "CSV"}`,
        });
      }
    });
    // Rows landing in a collection that already exists: in allocate mode their
    // spend is added to that collection's total, so importing more cards never
    // dilutes what the earlier ones were allocated.
    if (costMode === "allocate") {
      Object.keys(collectionTotals).forEach((cn) => {
        const existing = collections.find((c) => c.name.toLowerCase() === cn.toLowerCase());
        if (existing && collectionTotals[cn] > 0) {
          onAddToCollectionTotal(existing.id, Number(collectionTotals[cn].toFixed(2)));
        }
      });
    }

    prepared.forEach((p) => {
      if (p.colName && !nameToId[p.colName.toLowerCase()]) {
        nameToId[p.colName.toLowerCase()] = onCreateCollection({
          name: p.colName,
          purchasePrice: 0,
          purchaseDate: new Date().toISOString().slice(0, 10),
          note: `Imported from ${file?.name || "CSV"}`,
        });
      }
    });

    const built = [];
    const failed = [];
    prepared.forEach((p) => {
      if (!p.name && !p.card) return;
      const c = p.card;
      if (!c && lookupPrices) failed.push(p.name || `row ${p.i + 2}`);
      // The column may say "foil"/"etched"/"normal" (our own export) or a
      // yes/no flag (most other tools). Read both.
      const finishRaw = val(p.row, "foil").trim().toLowerCase();
      const finish = /etch/.test(finishRaw)
        ? "etched"
        : /^(foil|yes|true|1|y)$/.test(finishRaw) || (finishRaw && /foil/.test(finishRaw))
        ? "foil"
        : "nonfoil";
      const foil = finish === "foil";
      built.push({
        id: uid(),
        added: Date.now() + p.i,
        name: c ? c.name : p.name,
        set: c ? c.set : p.setCode,
        setName: c ? c.setName : val(p.row, "setName"),
        collectorNumber: c ? c.collectorNumber : p.cn || "",
        scryfallId: c ? c.scryfallId : p.sid || null,
        imageUrl: c ? c.imageUrl : null,
        imageUrlLarge: c ? c.imageUrlLarge : null,
        scryfallUri: c ? c.scryfallUri : null,
        quantity: p.qty,
        finish,
        foil,
        condition: val(p.row, "condition") || "NM",
        collectionId: p.colName
          ? nameToId[p.colName.toLowerCase()]
          : fallbackCollection,
        location: val(p.row, "location"),
        // In allocate mode the money lives on the collection, so cards carry no
        // individual price and share the total evenly.
        costOverride:
          costMode === "perCard" && p.price !== null ? p.price * p.qty : null,
        valueOverride: p.value !== null && !c ? p.value : null,
        usd: c ? c.usd : p.value,
        usdFoil: c ? c.usdFoil : null,
        prevUsd: null,
        prevUsdFoil: null,
        cmc: c ? c.cmc : 0,
        typeLine: c ? c.typeLine : "",
        colors: c ? c.colors : [],
        rarity: c ? c.rarity : "",
      });
    });

    onImportCards(built);
    setProgress(null);
    setReport({
      total: built.length,
      failed,
      collections: Object.keys(collectionTotals).length,
    });
  }

  const mappingRows = [
    ["name", "Card name", true],
    ["set", "Set code"],
    ["collectorNumber", "Collector number"],
    ["currentValue", "Current value"],
    ["scryfallId", "Scryfall ID"],
    ["quantity", "Quantity"],
    ["foil", "Foil"],
    ["purchasePrice", "Purchase price"],
    ["condition", "Condition"],
    ["collection", "Collection / binder"],
    ["location", "Location"],
  ];

  return (
    <ModalShell title="Import from CSV" onClose={onClose} width={560}>
      {!progress && !report && (
        <>
          <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
            Works with ManaBox, Moxfield, Deckbox and TCGplayer exports. Columns are matched
            automatically — check them below and adjust anything that looks wrong.
          </p>

          <div
            onClick={() => fileInput.current?.click()}
            style={{
              border: `1px dashed ${C.border}`,
              borderRadius: 8,
              padding: 22,
              textAlign: "center",
              cursor: "pointer",
              marginBottom: 16,
              color: C.parchmentDim,
            }}
          >
            <Upload size={20} style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 13 }}>{file ? file.name : "Click to choose a CSV file"}</div>
            {rows && (
              <div style={{ fontSize: 12, marginTop: 4, color: C.goldBright }}>
                {rows.length} rows · {headers.length} columns
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
            />
          </div>

          {parseError && (
            <div
              style={{
                color: C.redBright,
                fontSize: 12.5,
                marginBottom: 14,
                display: "flex",
                gap: 6,
              }}
            >
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              {parseError}
            </div>
          )}

          {rows && (
            <>
              <div
                style={{
                  fontSize: 12,
                  color: C.parchmentDim,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                Column mapping
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px 12px",
                  marginBottom: 18,
                }}
              >
                {mappingRows.map(([field, label, required]) => (
                  <div key={field}>
                    <label
                      style={{
                        display: "block",
                        fontSize: 11.5,
                        color: required && !mapping[field] ? C.redBright : C.parchmentDim,
                        marginBottom: 3,
                      }}
                    >
                      {label}
                      {required ? " *" : ""}
                    </label>
                    <select
                      style={{ ...inputStyle, padding: "7px 8px", fontSize: 12 }}
                      value={mapping[field] || ""}
                      onChange={(e) =>
                        setMapping({ ...mapping, [field]: e.target.value || undefined })
                      }
                    >
                      <option value="">Not in file</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <Field label="Prices in this file are in">
                <select
                  style={inputStyle}
                  value={fileCurrency}
                  onChange={(e) => setFileCurrency(e.target.value)}
                >
                  {Object.entries(CURRENCIES).map(([code, meta]) => (
                    <option key={code} value={code}>
                      {code} — {meta.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Collection for rows with no collection named in the file">
                <select
                  style={inputStyle}
                  value={fallbackCollection}
                  onChange={(e) => setFallbackCollection(e.target.value)}
                >
                  <option value={UNCATEGORIZED}>Uncategorized</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>

              {mapping.collection && (
                <p style={{ fontSize: 12, color: C.parchmentDim, marginTop: -4 }}>
                  Each distinct value in <b>{mapping.collection}</b> becomes its own collection.
                  {mapping.purchasePrice
                    ? " Purchase prices are summed per collection automatically."
                    : ""}
                </p>
              )}
            </>
          )}

          {rows && (
            <label
              style={{
                display: "flex",
                gap: 9,
                alignItems: "flex-start",
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "11px 12px",
                marginBottom: 14,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={lookupPrices}
                onChange={(e) => setLookupPrices(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span style={{ fontSize: 12.5, color: C.parchmentDim }}>
                <b style={{ color: C.parchment }}>Look up prices and art</b> — matches every row
                against Scryfall to pull card images, current market prices, colors, rarity and
                mana value. Resolves 75 cards per request, so even large collections take only a
                few seconds. Leave this off to import using only what's in your file.
              </span>
            </label>
          )}

          {rows && (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "11px 13px",
                marginBottom: 14,
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 9.5,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  color: C.parchmentDim,
                  marginBottom: 8,
                }}
              >
                Purchase prices in this file
              </div>
              <label style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 9, cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={costMode === "allocate"}
                  onChange={() => setCostMode("allocate")}
                  style={{ marginTop: 3 }}
                />
                <span style={{ fontSize: 12.5, color: C.parchmentDim }}>
                  <b style={{ color: C.parchment }}>Add to the collection's total</b> — prices are
                  summed into what you paid for the collection and split evenly across its cards.
                  Right for boosters, bundles and precons.
                </span>
              </label>
              <label style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={costMode === "perCard"}
                  onChange={() => setCostMode("perCard")}
                  style={{ marginTop: 3 }}
                />
                <span style={{ fontSize: 12.5, color: C.parchmentDim }}>
                  <b style={{ color: C.parchment }}>Keep each card's own price</b> — every row keeps
                  its individual purchase price. Right for singles you bought one at a time.
                </span>
              </label>
            </div>
          )}

          <button
            onClick={runImport}
            disabled={!rows}
            style={{
              width: "100%",
              background: rows ? STOCK_BG : C.border,
              color: rows ? C.stockInk : C.parchmentDim,
              border: "none",
              borderRadius: 6,
              padding: "11px",
              fontWeight: 700,
              fontSize: 14,
              cursor: rows ? "pointer" : "default",
              marginTop: 6,
            }}
          >
            Import {rows ? `${rows.length} cards` : ""}
          </button>
        </>
      )}

      {progress && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <Loader2
            size={24}
            color={C.gold}
            style={{ animation: "spin 1s linear infinite", marginBottom: 10 }}
          />
          <div style={{ fontSize: 13, color: C.parchmentDim }}>
            {progress.phase} — {progress.done}/{progress.total}
          </div>
          <div
            style={{
              height: 6,
              background: C.bgPanel2,
              borderRadius: 3,
              marginTop: 10,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`,
                background: C.gold,
                transition: "width 0.2s ease",
              }}
            />
          </div>
        </div>
      )}

      {fatalError && !progress && (
        <div
          style={{
            color: C.redBright,
            fontSize: 12.5,
            marginTop: 14,
            display: "flex",
            gap: 6,
          }}
        >
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          {fatalError}
        </div>
      )}

      {report && (
        <div style={{ padding: "6px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Check size={18} color={C.greenBright} />
            <span style={{ fontSize: 14, color: C.parchment, fontWeight: 600 }}>
              {report.total} cards added
            </span>
          </div>
          {report.collections > 0 && (
            <div style={{ fontSize: 12.5, color: C.parchmentDim, marginBottom: 8 }}>
              {report.collections} collection{report.collections === 1 ? "" : "s"} created from
              the file, with purchase totals filled in.
            </div>
          )}
          {report.failed.length > 0 && (
            <div style={{ fontSize: 12.5, color: C.redBright, marginBottom: 12 }}>
              {report.failed.length} card{report.failed.length === 1 ? "" : "s"} couldn't be
              matched and were added without prices or images:{" "}
              {report.failed.slice(0, 12).join(", ")}
              {report.failed.length > 12 ? `, +${report.failed.length - 12} more` : ""}
            </div>
          )}
          <button
            onClick={onClose}
            style={{
              width: "100%",
              background: STOCK_BG,
              color: C.stockInk,
              border: "none",
              borderRadius: 6,
              padding: "11px",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      )}
    </ModalShell>
  );
}

function DetailModal({ card, collections, decks, onAddToDeck, cost, onClose, onUpdate, onDelete, onSell, onUnsell, onDuplicate }) {
  const [deckNote, setDeckNote] = useState("");
  const [quantity, setQuantity] = useState(card.quantity);
  const [finish, setFinish] = useState(finishOf(card));
  const [condition, setCondition] = useState(card.condition);
  const [collectionId, setCollectionId] = useState(card.collectionId || UNCATEGORIZED);
  const [costOverride, setCostOverride] = useState(card.costOverride ?? null);
  const [valueOverride, setValueOverride] = useState(card.valueOverride ?? null);
  const [location, setLocation] = useState(card.location || "");
  const [signed, setSigned] = useState(!!card.signed);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-identification: CSV imports often land on the wrong printing (or the
  // wrong card). "prints" swaps the printing, "search" relinks the card entirely.
  const [fixMode, setFixMode] = useState(null); // null | "prints" | "search"
  const [fixLoading, setFixLoading] = useState(false);
  const [fixError, setFixError] = useState("");
  const [fixResults, setFixResults] = useState([]);
  const [fixQuery, setFixQuery] = useState(card.name);

  // Rules text right in the modal — the actual fix for cards being
  // unreadable at grid size, since no reasonable thumbnail size makes full
  // oracle text legible. fetchOracleTexts caches by scryfallId, so revisiting
  // the same card is free after the first open.
  const [oracle, setOracle] = useState(null); // { t, ty, parts } | null
  const [oracleLoading, setOracleLoading] = useState(false);
  useEffect(() => {
    if (!card.scryfallId) return;
    let live = true;
    setOracleLoading(true);
    fetchOracleTexts([card.scryfallId])
      .then((cache) => {
        if (live) setOracle(cache[card.scryfallId] || null);
      })
      .finally(() => {
        if (live) setOracleLoading(false);
      });
    return () => {
      live = false;
    };
  }, [card.scryfallId]);

  async function loadPrintings() {
    setFixMode("prints");
    setFixError("");
    setFixResults([]);
    setFixLoading(true);
    try {
      const r = await scryfallSearch(`!"${card.name}"`, "prints", 40);
      if (r.length === 0) setFixError("No printings found for that name.");
      setFixResults(r);
    } catch (e) {
      setFixError(`Couldn't load printings — ${e.message}`);
    }
    setFixLoading(false);
  }

  async function searchByName() {
    if (!fixQuery.trim()) return;
    setFixError("");
    setFixResults([]);
    setFixLoading(true);
    try {
      const r = await scryfallSearch(fixQuery.trim(), "prints", 40);
      if (r.length === 0) setFixError("Nothing found — check the spelling.");
      setFixResults(r);
    } catch (e) {
      setFixError(`Search failed — ${e.message}`);
    }
    setFixLoading(false);
  }

  // Replaces the card's identity while keeping everything personal to your copy:
  // quantity, condition, foil, collection, location, cost basis, sold state.
  function applyPrinting(p) {
    onUpdate({
      name: p.name,
      set: p.set,
      setName: p.setName,
      collectorNumber: p.collectorNumber,
      scryfallId: p.scryfallId,
      scryfallUri: p.scryfallUri,
      imageUrl: p.imageUrl,
      imageUrlLarge: p.imageUrlLarge,
      prevUsd: null,
      prevUsdFoil: null,
      usd: p.usd,
      usdFoil: p.usdFoil,
      cmc: p.cmc,
      typeLine: p.typeLine,
      colors: p.colors,
      rarity: p.rarity,
      lastChecked: Date.now(),
    });
    setFixMode(null);
    setFixResults([]);
  }

  function save() {
    onUpdate({
      quantity: Number(quantity) || 1,
      finish,
      foil: finish === "foil", // kept in step for anything reading the old flag
      condition,
      collectionId,
      location: location.trim(),
      costOverride,
      valueOverride,
      signed,
    });
    onClose();
  }

  async function refreshPrice() {
    setRefreshing(true);
    try {
      const fresh = card.scryfallId
        ? await scryfallById(card.scryfallId)
        : await scryfallLookup(card.name, card.set || undefined);
      onUpdate({
        prevUsd: card.usd,
        prevUsdFoil: card.usdFoil,
        usd: fresh.usd,
        usdFoil: fresh.usdFoil,
        imageUrl: fresh.imageUrl || card.imageUrl,
        imageUrlLarge: fresh.imageUrlLarge || card.imageUrlLarge,
        scryfallUri: fresh.scryfallUri || card.scryfallUri,
        collectorNumber: card.collectorNumber || fresh.collectorNumber,
        scryfallId: card.scryfallId || fresh.scryfallId,
        lastChecked: Date.now(),
      });
    } catch (e) {}
    setRefreshing(false);
  }

  const currentVal = priceForFinish(card) ?? 0;

  return (
    <ModalShell title={card.name} onClose={onClose} width={640}>
      <div style={{ display: "flex", gap: 20, marginBottom: 18 }}>
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              width: 240,
              aspectRatio: "5 / 7",
              borderRadius: 11,
              overflow: "hidden",
              border: `1px solid ${C.border}`,
              background: C.bg,
              position: "relative",
            }}
          >
            <CardArt card={card} large />
            {finishOf(card) !== "nonfoil" && (
              <>
                <div className="foil-sheen" />
                <div className="foil-edge" />
              </>
            )}
          </div>
          {card.scryfallUri && (
            <a
              href={card.scryfallUri}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "block",
                textAlign: "center",
                marginTop: 8,
                fontSize: 11.5,
                color: C.parchmentDim,
                textDecoration: "none",
              }}
            >
              View on Scryfall ↗
            </a>
          )}

          {/* wrong card or wrong printing (common after a CSV import) */}
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => (fixMode === "prints" ? setFixMode(null) : loadPrintings())}
              className="mono"
              style={{
                flex: 1,
                background: fixMode === "prints" ? "rgba(232,236,241,0.1)" : "transparent",
                border: `1px solid ${fixMode === "prints" ? C.goldBright : C.border}`,
                color: fixMode === "prints" ? C.goldBright : C.parchmentDim,
                borderRadius: 5,
                padding: "6px 8px",
                fontSize: 10,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Change art
            </button>
            <button
              onClick={() => {
                if (fixMode === "search") return setFixMode(null);
                setFixMode("search");
                setFixResults([]);
                setFixError("");
                setFixQuery(card.name);
              }}
              className="mono"
              style={{
                flex: 1,
                background: fixMode === "search" ? "rgba(232,236,241,0.1)" : "transparent",
                border: `1px solid ${fixMode === "search" ? C.goldBright : C.border}`,
                color: fixMode === "search" ? C.goldBright : C.parchmentDim,
                borderRadius: 5,
                padding: "6px 8px",
                fontSize: 10,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Wrong card
            </button>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: C.parchment, marginBottom: 8, opacity: 0.85 }}>
            {card.setName || card.set}
            {card.rarity ? ` · ${card.rarity}` : ""}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div className="mono" style={{ fontSize: 19, fontWeight: 600, color: C.goldBright }}>
              {fmt(currentVal)} <span style={{ fontSize: 11.5, color: C.parchmentDim }}>/ each</span>
            </div>
            {(
              <button
                onClick={refreshPrice}
                disabled={refreshing}
                style={{
                  background: "none",
                  border: `1px solid ${C.border}`,
                  borderRadius: 5,
                  color: C.parchmentDim,
                  fontSize: 11,
                  padding: "2px 8px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <RefreshCw size={11} style={refreshing ? { animation: "spin 1s linear infinite" } : {}} />
                refresh
              </button>
            )}
          </div>
          <div style={{ fontSize: 13, color: C.parchmentDim }}>
            Allocated cost: <span className="mono" style={{ color: C.parchment }}>{fmt(cost)}</span>
          </div>
          <div style={{ fontSize: 13.5, marginTop: 5, fontWeight: 600 }}>
            <span style={{ color: (currentVal * card.quantity - cost) >= 0 ? C.greenBright : C.redBright }}>
              {(currentVal * card.quantity - cost) >= 0 ? "+" : "-"}
              {fmt(Math.abs(currentVal * card.quantity - cost))} total
            </span>
          </div>

          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: `1px solid ${C.border}`,
              fontSize: 12.5,
              color: C.parchmentDim,
              lineHeight: 1.55,
            }}
          >
            {oracleLoading && !oracle && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.8 }}>
                <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                Loading rules text…
              </div>
            )}
            {oracle && (
              <>
                {oracle.ty && (
                  <div className="mono" style={{ fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: C.goldBright, marginBottom: 6 }}>
                    {oracle.ty}
                  </div>
                )}
                {oracle.t ? (
                  <div style={{ whiteSpace: "pre-line" }}>{oracle.t}</div>
                ) : card.isArt ? (
                  <div style={{ fontStyle: "italic", opacity: 0.85 }}>
                    Art card — no rules text.{card.artist ? ` Illustrated by ${card.artist}.` : ""}
                    {card.signed && <span style={{ color: C.goldBright }}> · Signed copy</span>}
                  </div>
                ) : (
                  <div style={{ fontStyle: "italic", opacity: 0.7 }}>No rules text on file for this card.</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {fixMode && (
        <div
          style={{
            border: `1px solid rgba(185,191,199,0.25)`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            background: "rgba(0,0,0,0.25)",
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 9.5,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: C.parchmentDim,
              marginBottom: 9,
            }}
          >
            {fixMode === "prints"
              ? `Printings of ${card.name} — pick the one you own`
              : "Find the right card"}
          </div>

          {fixMode === "search" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={fixQuery}
                onChange={(e) => setFixQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchByName()}
                placeholder="Card name"
                autoFocus
              />
              <button
                onClick={searchByName}
                style={{
                  background: STOCK_BG,
                  color: C.stockInk,
                  border: "none",
                  borderRadius: 6,
                  padding: "0 14px",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  boxShadow: STOCK_SHADOW,
                }}
              >
                Search
              </button>
            </div>
          )}

          {fixLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.parchmentDim }}>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading…
            </div>
          )}
          {fixError && <div style={{ color: C.redBright, fontSize: 12.5 }}>{fixError}</div>}

          {fixResults.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
                gap: 10,
                maxHeight: 300,
                overflowY: "auto",
              }}
            >
              {fixResults.map((p) => {
                const current = p.scryfallId === card.scryfallId;
                return (
                  <div
                    key={p.scryfallId}
                    onClick={() => !current && applyPrinting(p)}
                    title={`${p.setName} #${p.collectorNumber}`}
                    style={{ cursor: current ? "default" : "pointer", opacity: current ? 0.5 : 1 }}
                  >
                    <div
                      style={{
                        position: "relative",
                        aspectRatio: "5 / 7",
                        borderRadius: 6,
                        overflow: "hidden",
                        border: current ? `2px solid ${C.goldBright}` : `1px solid ${C.border}`,
                      }}
                    >
                      <CardArt card={p} />
                      {current && (
                        <span
                          className="mono"
                          style={{
                            position: "absolute",
                            bottom: 3,
                            left: 3,
                            right: 3,
                            textAlign: "center",
                            fontSize: 7.5,
                            letterSpacing: 0.8,
                            background: STOCK_BG,
                            color: C.stockInk,
                            borderRadius: 2,
                            padding: "1px 0",
                          }}
                        >
                          CURRENT
                        </span>
                      )}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 8.5,
                        color: C.parchmentDim,
                        marginTop: 4,
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {p.set} #{p.collectorNumber}
                    </div>
                    <div className="mono" style={{ fontSize: 8.5, color: C.gold }}>
                      {p.usd !== null ? fmt(p.usd) : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {fixResults.length > 0 && (
            <div className="mono" style={{ fontSize: 10, color: C.parchmentDim, marginTop: 9, lineHeight: 1.5 }}>
              Picking one swaps the art, set, number and price. Your quantity, condition,
              collection, location and cost basis stay as they are.
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Quantity">
          <input
            type="number"
            min={1}
            style={inputStyle}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Condition">
          <select style={inputStyle} value={condition} onChange={(e) => setCondition(e.target.value)}>
            {["NM", "LP", "MP", "HP", "DMG"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Finish">
        <FinishPicker card={card} value={finish} onChange={setFinish} />
        <TreatmentTags card={card} />
      </Field>

      {card.isArt && (
        <Field label="Signature">
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: C.parchment,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} style={{ width: 15, height: 15 }} />
            This copy has the artist's signature (gold-stamped)
          </label>
        </Field>
      )}

      <Field label="Collection">
        <select style={inputStyle} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value={UNCATEGORIZED}>Uncategorized</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Physical location">
        <input
          style={inputStyle}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Binder 2, page 4"
        />
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Purchase price override">
          <MoneyInput valueUsd={costOverride} onChange={setCostOverride} placeholder="auto-split" />
        </Field>
        <Field label="Current value override">
          <MoneyInput
            valueUsd={valueOverride}
            onChange={setValueOverride}
            placeholder="use market price"
          />
        </Field>
      </div>

      {card.sold && (
        <div
          style={{
            background: C.bgPanel2,
            border: `1px solid ${C.borderLight}`,
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 12,
            fontSize: 12.5,
          }}
        >
          <div style={{ color: C.parchment, fontWeight: 600, marginBottom: 3 }}>
            Sold {card.soldDate ? `on ${card.soldDate}` : ""}
          </div>
          <div className="mono" style={{ color: C.parchmentDim }}>
            {fmt((card.soldPrice || 0) * (card.quantity || 1))} received ·{" "}
            <span
              style={{
                color:
                  (card.soldPrice || 0) * (card.quantity || 1) - cost >= 0
                    ? C.greenBright
                    : C.redBright,
              }}
            >
              {(card.soldPrice || 0) * (card.quantity || 1) - cost >= 0 ? "+" : "-"}
              {fmt(Math.abs((card.soldPrice || 0) * (card.quantity || 1) - cost))} realized
            </span>
          </div>
          <button
            onClick={onUnsell}
            style={{
              marginTop: 8,
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.parchmentDim,
              borderRadius: 6,
              padding: "6px 11px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Put back in collection
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button
          onClick={save}
          style={{
            flex: 1,
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 6,
            padding: "10px",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Save changes
        </button>
        {!card.sold && (
          <button
            onClick={() => onDuplicate(card)}
            title="Add another copy of this exact printing — handy for a foil or another pull of the same card"
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.parchmentDim,
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Copy size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Duplicate
          </button>
        )}
        {!card.sold && (
          <button
            onClick={onSell}
            style={{
              background: "none",
              border: `1px solid ${C.gold}`,
              color: C.goldBright,
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Tag size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Sell
          </button>
        )}
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            style={{
              background: "none",
              border: `1px solid ${C.red}`,
              color: C.redBright,
              borderRadius: 6,
              padding: "10px 14px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Trash2 size={14} />
          </button>
        ) : (
          <button
            onClick={onDelete}
            style={{
              background: C.red,
              border: "none",
              color: C.parchment,
              borderRadius: 6,
              padding: "10px 14px",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            Confirm delete
          </button>
        )}
      </div>
    </ModalShell>
  );
}

// Exported for the test harness only (see deck-click-test.jsx); unused by the app.
export const __test_DecksView = DecksView;

// Exported for the test harness only (see roundtrip-test.jsx); unused by the app.
export const __test_guessMapping = guessMapping;
export const __test_parseDecklist = parseDecklist;
export const __test_matchDecklist = matchDecklist;
export const __test_deckToText = deckToText;
export const __test_deckToJson = deckToJson;
export const __test_jsonToParsed = jsonToParsed;
