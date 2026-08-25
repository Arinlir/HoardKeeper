import React, { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AlertCircle, Loader2, Palette, Plus, X } from "lucide-react";
import { EmptyState } from "./components/ui/EmptyState";
import { ViewTab } from "./components/ui/ViewTab";
import { AuthGate } from "./features/auth/AuthGate";
import { ProfileGate } from "./features/auth/ProfileGate";
import { CardTile } from "./features/collection/CardTile";
import { FilterBar } from "./features/collection/FilterBar";
import { Header } from "./features/collection/Header";
import { SelectionBar } from "./features/collection/SelectionBar";
import { AddCardModal } from "./features/collection/modals/AddCardModal";
import { AddCollectionModal } from "./features/collection/modals/AddCollectionModal";
import { BulkEditModal } from "./features/collection/modals/BulkEditModal";
import { CollectionsModal } from "./features/collection/modals/CollectionsModal";
import { DetailModal } from "./features/collection/modals/DetailModal";
import { SellModal } from "./features/collection/modals/SellModal";
import { classifyRole, isBasicLand } from "./features/decks/draftLogic";
import { cleanArtCardName, fetchAllArtSeriesSets } from "./features/sets/rosterUtils";
import { CUR, convert, dayKey, fmt } from "./lib/format";
import { RARITY_GROUP_LABELS, RARITY_GROUP_ORDER, RATE_MS, SOLD, UNCATEGORIZED, bucketOf, cardTypes, finishOf, normalizeCard, priceForFinish, scryfallCollection, scryfallLookup, sleep } from "./lib/scryfall";
import { store, uid } from "./lib/store";
import { C, STOCK_BG, STOCK_SHADOW, ROOT_BG, NOTCH } from "./lib/tokens";
export * from "./lib/testExports.js";

// Lazily loaded: each of these is a whole tab (or a rarely-opened modal) that
// most sessions never visit. Splitting them out of the main chunk is the
// actual fix for HoardKeeper's load time - see PERF.md.
const DecksView = lazy(() => import("./features/decks/DecksView").then((m) => ({ default: m.DecksView })));
const SetsView = lazy(() => import("./features/sets/SetsView").then((m) => ({ default: m.SetsView })));
const GlossaryView = lazy(() => import("./features/glossary/GlossaryView").then((m) => ({ default: m.GlossaryView })));
const LifeCounterView = lazy(() => import("./features/life/LifeCounterView").then((m) => ({ default: m.LifeCounterView })));
const Analytics = lazy(() => import("./features/collection/Analytics").then((m) => ({ default: m.Analytics })));
const ImportModal = lazy(() => import("./features/collection/modals/ImportModal").then((m) => ({ default: m.ImportModal })));
const SettingsModal = lazy(() => import("./features/collection/modals/SettingsModal").then((m) => ({ default: m.SettingsModal })));

function ViewLoading() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 20px", color: C.parchmentDim, fontFamily: "'Archivo', sans-serif", fontSize: 13 }}>
      <Loader2 size={16} style={{ animation: "spin 1s linear infinite", marginRight: 8 }} />
      Loading…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function App() {
  const [collections, setCollections] = useState([]);
  const [cards, setCards] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // One-time backfill: cards added before art-card tracking existed (CSV
  // imports, mainly) never got isArt set, even when they genuinely are art
  // cards — so the Art Cards sub-tab never has anything to show for them.
  // Identify them the reliable way: check each card's actual set code
  // against Scryfall's real list of art-series sets, not a guess based on a
  // blank type line (which could just mean the card's data never finished
  // refreshing). Runs once after load, silently, and only writes if it
  // actually found something to fix.
  const artBackfillRan = useRef(false);
  useEffect(() => {
    if (!loaded || artBackfillRan.current || cards.length === 0) return;
    artBackfillRan.current = true;
    fetchAllArtSeriesSets()
      .then((artSets) => {
        const artCodes = new Set(artSets.map((s) => s.code.toLowerCase()));
        let changed = false;
        setCards((prev) =>
          prev.map((c) => {
            const looksLikeArt = !c.isArt && c.set && artCodes.has(c.set.toLowerCase());
            if (!looksLikeArt) return c;
            changed = true;
            return { ...c, isArt: true, name: cleanArtCardName(c.name) };
          })
        );
        if (!changed) return;
      })
      .catch(() => {});
  }, [loaded, cards.length]);
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

  async function exportCsv() {
    // papaparse is only needed for this one action - deferred here rather
    // than imported at the top of the file, so a session that never exports
    // never pays for it.
    const { default: Papa } = await import("papaparse");
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
        background: ROOT_BG,
        color: C.parchment,
        fontFamily: "'Archivo', sans-serif",
        position: "relative",
      }}
    >
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 6px; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .display { font-family: 'Cinzel', serif; }
        .serif { font-family: 'Spectral', serif; }
        .felt-weave {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
        }
        .mat {
          position: relative; z-index: 1;
          max-width: 1200px; margin: 22px auto 0;
        }
        .card-tile { transition: transform 0.16s ease; cursor: pointer; }
        .card-tile:hover .sleeve { transform: translateY(-5px) rotate(-0.4deg); box-shadow: 0 18px 32px -10px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(242,244,246,0.35); }
        .sleeve { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .sleeve::after {
          content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
          background: linear-gradient(115deg, rgba(255,255,255,0.13) 0%, transparent 30%, transparent 72%, rgba(255,255,255,0.05) 100%);
        }
        .chip { transition: all 0.15s ease; }
        input, select, textarea { font-family: inherit; }
        input:focus, select:focus, textarea:focus { outline: 2px solid ${C.gold}; outline-offset: 1px; }
        button:focus-visible, a:focus-visible, [role="button"]:focus-visible, [tabindex]:focus-visible {
          outline: 2px solid ${C.goldBright}; outline-offset: 2px; border-radius: 4px;
        }
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
        <Suspense fallback={<ViewLoading />}>
          <GlossaryView cards={cards} />
        </Suspense>
      ) : view === "life" ? (
        <Suspense fallback={<ViewLoading />}>
          <LifeCounterView onExit={() => setView("collection")} />
        </Suspense>
      ) : view === "decks" ? (
        <Suspense fallback={<ViewLoading />}>
          <DecksView
            cards={cards}
            collections={collections}
            decks={decks}
            setDecks={setDecks}
            valueOf={(c) => currentUnitValue(c) * (c.quantity || 1)}
          />
        </Suspense>
      ) : view === "sets" ? (
        <Suspense fallback={<ViewLoading />}>
          <SetsView
            cards={cards}
            collections={collections}
            onAddCopy={addCopyFromRoster}
            onRemoveCopy={removeCopyFromRoster}
          />
        </Suspense>
      ) : (
      <main style={{ padding: "8px clamp(14px, 4vw, 28px) 48px" }}>
        {loaded && cards.length === 0 && (
          <EmptyState onAddCard={() => setShowAddCard(true)} onImport={() => setShowImport(true)} />
        )}

        {showCharts && cards.length > 0 && (
          <Suspense fallback={<ViewLoading />}>
            <Analytics
              history={history}
              rows={filtered.map((c) => ({
                card: c,
                value: currentUnitValue(c) * (c.quantity || 1),
                cost: allocatedCost(c),
                collection: collectionName(c.collectionId),
              }))}
            />
          </Suspense>
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
        <Suspense fallback={null}>
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
        </Suspense>
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
            borderRadius: 0,
            clipPath: NOTCH,
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 10px 24px -6px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.16)",
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
        <Suspense fallback={null}>
          <ImportModal
            collections={collections}
            onClose={() => setShowImport(false)}
            onCreateCollection={addCollection}
            onAddToCollectionTotal={addToCollectionTotal}
            onImportCards={(newCards) => {
              setCards((prev) => [...prev, ...newCards]);
            }}
          />
        </Suspense>
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

