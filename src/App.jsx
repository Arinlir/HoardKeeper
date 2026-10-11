import React, { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AlertCircle, Loader2, Palette, Plus, X } from "lucide-react";
import { EmptyState } from "./components/ui/EmptyState";
import { ViewTab } from "./components/ui/ViewTab";
import { AuthGate } from "./features/auth/AuthGate";
import { ConnectGate } from "./features/auth/ConnectGate";
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
import { TradeModal } from "./features/collection/modals/TradeModal";
import { classifyRole, isBasicLand } from "./features/decks/draftLogic";
import { linkAcquired } from "./features/decks/externals";
import { cleanArtCardName, fetchAllArtSeriesSets } from "./features/sets/rosterUtils";
import { CUR, convert, dayKey, fmt, legacySource } from "./lib/format";
import { fetchRates, ratesAreStale } from "./lib/rates";
import { matchQuery, parseQuery } from "./features/collection/query";
import { legalityOf } from "./lib/formats";
import { addTag, allTags } from "./lib/tags";
import { addGame } from "./features/decks/record";
import { PROXY, RARITY_GROUP_LABELS, RARITY_GROUP_ORDER, RATE_MS, SOLD, UNCATEGORIZED, bucketOf, cardTypes, codeCompare, fetchOracleTexts, finishOf, normalizeCard, priceForFinish, pricePatch, scryfallCollection, scryfallLookup, sleep } from "./lib/scryfall";
import { store, uid } from "./lib/store";
import { parsePath, pathFor } from "./lib/router";
import { NotFound } from "./components/ui/NotFound";
import { mergeImported } from "./lib/importMerge";
import { childrenOf, collectionPath, parentIdOf, scopeIds, topLevel } from "./lib/collectionTree";
import { C, STOCK_BG, STOCK_SHADOW, ROOT_BG, NOTCH } from "./lib/tokens";
import { apiUrl, apiCredentials, authHeaders, isNativeApp, serverChoice, serverBase, setAuthToken } from "./lib/platform";
import { combinedIdentity, commanderPatchFromOracle, needsCommanderCheck } from "./lib/commander";
export * from "./lib/testExports.js";

// Lazily loaded: each of these is a whole tab (or a rarely-opened modal) that
// most sessions never visit. Splitting them out of the main chunk is the
// actual fix for Binderwyrm's load time - see PERF.md.
const DecksView = lazy(() => import("./features/decks/DecksView").then((m) => ({ default: m.DecksView })));
const SetsView = lazy(() => import("./features/sets/SetsView").then((m) => ({ default: m.SetsView })));
const GlossaryView = lazy(() => import("./features/glossary/GlossaryView").then((m) => ({ default: m.GlossaryView })));
const LifeCounterView = lazy(() => import("./features/life/LifeCounterView").then((m) => ({ default: m.LifeCounterView })));
const Analytics = lazy(() => import("./features/collection/Analytics").then((m) => ({ default: m.Analytics })));
const ImportModal = lazy(() => import("./features/collection/modals/ImportModal").then((m) => ({ default: m.ImportModal })));
const SettingsModal = lazy(() => import("./features/collection/modals/SettingsModal").then((m) => ({ default: m.SettingsModal })));
const ExportModal = lazy(() => import("./features/collection/modals/ExportModal").then((m) => ({ default: m.ExportModal })));
const PlaygroupView = lazy(() => import("./features/playgroup/PlaygroupView").then((m) => ({ default: m.PlaygroupView })));
const WishlistView = lazy(() => import("./features/wishlist/WishlistView").then((m) => ({ default: m.WishlistView })));

function ViewLoading() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 20px", color: C.parchmentDim, fontFamily: "'Archivo', sans-serif", fontSize: 13 }}>
      <Loader2 size={16} style={{ animation: "spin 1s linear infinite", marginRight: 8 }} />
      Loading…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// Which cards a filter chip means, before type, color and search narrow it
// further. Proxies get their own chip so "what am I still running fake" is one
// click away, the same way sold cards are.
function scopeByCollection(list, filter, collections) {
  if (filter === SOLD) return list.filter((c) => c.sold);
  const held = list.filter((c) => !c.sold);
  if (filter === PROXY) return held.filter((c) => c.proxy);
  if (filter === "all") return held;
  if (filter === UNCATEGORIZED) return held.filter((c) => (c.collectionId || UNCATEGORIZED) === UNCATEGORIZED);
  // A parent collection shows everything in its sub-collections too.
  const ids = scopeIds(collections, filter);
  return held.filter((c) => ids.has(c.collectionId || UNCATEGORIZED));
}

export default function App() {
  const [collections, setCollections] = useState([]);
  const [cards, setCards] = useState([]);
  // Cards you want but don't own. Kept beside the collection in the same
  // vault, because the public wishlist page reads them out of the same file.
  const [wishlist, setWishlist] = useState([]);
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
  const [claimAvailable, setClaimAvailable] = useState(false);
  const [contactInfo, setContactInfo] = useState("");
  const [account, setAccount] = useState(null);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [saveError, setSaveError] = useState(false);
  // Another device saved since this one loaded, so our save was refused
  // (server.cjs, X-Base-Rev). Saving stops until the latest is loaded.
  const [saveConflict, setSaveConflict] = useState(false);
  const [connectError, setConnectError] = useState("");
  // Loading the vault failed (see the load effect): shown instead of an empty
  // collection, and nothing is saved until a retry succeeds.
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [activeFilter, setActiveFilter] = useState("all");
  const [search, setSearch] = useState("");
  // Search looks at rules text as well as names by default — the oracle text
  // is already cached locally for the glossary and the card zoom, so matching
  // on it costs nothing once a card has been scanned.
  const [searchScope, setSearchScope] = useState(() => {
    try {
      return localStorage.getItem("hk-search-scope") || "text";
    } catch (e) {
      return "text";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("hk-search-scope", searchScope);
    } catch (e) {}
  }, [searchScope]);
  // Same localStorage cache fetchOracleTexts reads and writes, loaded once so
  // a search can match rules text without waiting on the network.
  const [oracleIndex, setOracleIndex] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("lf-oracle-v4")) || {};
    } catch (e) {
      return {};
    }
  });
  const [textScan, setTextScan] = useState(null); // null | { total }
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
  // The current tab lives in the URL (/decks, /sets, … — "/" is the collection)
  // so back / forward and reload work. The phone app has no address bar and its
  // back button is wired separately, so it keeps the plain in-memory behaviour.
  const routing = !isNativeApp();
  const [view, setViewState] = useState(() => (routing ? parsePath(window.location.pathname).view : "collection"));
  const [routeDeck, setRouteDeck] = useState(() => (routing ? parsePath(window.location.pathname).deckId : null));
  const setView = useCallback(
    (v) => {
      setViewState(v);
      setRouteDeck(null);
      if (routing && window.location.pathname !== pathFor(v)) window.history.pushState({}, "", pathFor(v));
    },
    [routing]
  );
  const onOpenDeckChange = useCallback(
    (id) => {
      setRouteDeck(id);
      const target = pathFor("decks", id);
      if (routing && window.location.pathname !== target) window.history.pushState({}, "", target);
    },
    [routing]
  );
  useEffect(() => {
    if (!routing) return;
    const onPop = () => {
      const r = parsePath(window.location.pathname);
      setViewState(r.view);
      setRouteDeck(r.deckId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [routing]);

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
  const [tradeCard, setTradeCard] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [detailCard, setDetailCard] = useState(null);
  // The card ids the grid was showing (filter + sort) when a card was opened,
  // so the detail modal's previous/next walks that same list. Snapshotted, not
  // live: editing a card can move it out of the filter or re-sort it, and the
  // stepper shouldn't jump around under you. null = opened from elsewhere.
  const [detailNav, setDetailNav] = useState(null);

  const [refreshing, setRefreshing] = useState(null);

  const [currency, setCurrency] = useState("USD");
  const [czkRate, setCzkRate] = useState(23);
  const [eurRate, setEurRate] = useState(0.92);
  // Which market prices come from: "cardmarket" (EU) or "tcgplayer" (US).
  // Separate from the display currency — the two markets differ far more than
  // any exchange rate does, so a Prague collection shown in koruna still wants
  // Cardmarket's numbers.
  const [priceSource, setPriceSource] = useState("tcgplayer");
  // On for a brand-new vault (nothing is reachable until a public handle is
  // chosen anyway); a vault that was saved before keeps exactly what it saved,
  // and one that never recorded a choice stays off. Deliberately part of the
  // saved vault rather than a server-side flag: the server reads it from the
  // same blob it already guards.
  const [publicVault, setPublicVault] = useState(true);
  // Sharing the trade binder is its own decision, separate from sharing the
  // collection — you can publish what you'll trade without publishing the rest.
  const [publicTrade, setPublicTrade] = useState(true);
  // Finished games, newest first — filed by the Life Counter, read by the deck
  // view. See features/decks/record.js.
  const [games, setGames] = useState([]);
  // Rates look after themselves unless you say otherwise. ratesUpdated is when
  // they last came off the wire, so a reload doesn't refetch what's still fresh.
  const [ratesAuto, setRatesAuto] = useState(true);
  const [ratesUpdated, setRatesUpdated] = useState(null);
  const [ratesBusy, setRatesBusy] = useState(false);
  const [ratesError, setRatesError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState([]);
  const [decks, setDecks] = useState([]);
  // A /decks/<id> link to a deck that doesn't exist (deleted, or another
  // profile's) falls back to the deck list once the decks have loaded.
  useEffect(() => {
    if (!loaded || view !== "decks" || !routeDeck) return;
    if (!decks.some((d) => d.id === routeDeck)) {
      setRouteDeck(null);
      if (routing) window.history.replaceState({}, "", pathFor("decks"));
    }
  }, [loaded, view, routeDeck, decks, routing]);
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
  CUR.source = priceSource;
  // fmt() reads the three lines above from module state rather than from props,
  // so a memoized child can't see a currency switch or a rate refresh happen.
  // Passing this key down makes that change visible to React.memo — see CardTile.
  const moneyKey = `${currency}:${czkRate}:${eurRate}:${priceSource}`;

  // detect server mode, then either restore the saved profile or show the gate
  useEffect(() => {
    (async () => {
      // The phone app has no server behind its own pages: it asks which one
      // to use on first launch, or runs on the phone alone if told to.
      const choice = serverChoice();
      if (choice === "unset") {
        setBoot("connect");
        return;
      }
      if (choice === "local") {
        setServerMode(false);
        setBoot("ready");
        return;
      }
      let onServer = false;
      let mode = "accounts";
      try {
        const ctl = new AbortController();
        // Same-origin in a browser answers in milliseconds; a phone on mobile
        // data reaching a home server can honestly take a few seconds.
        const t = setTimeout(() => ctl.abort(), isNativeApp() ? 8000 : 1500);
        const res = await fetch(apiUrl("/api/health"), { signal: ctl.signal });
        clearTimeout(t);
        // Dev servers answer unknown URLs with the app's HTML and a 200, so a
        // status check alone gets fooled — require the actual JSON handshake.
        if (res.ok) {
          const d = await res.json();
          onServer = d && d.ok === true;
          // PIN profiles no longer exist; only a server this version can't
          // sign in to would answer anything but "accounts".
          mode = d?.mode === "accounts" ? "accounts" : "unsupported";
          setRegistrationOpen(d?.registration !== false);
          setClaimAvailable(d?.claim === true);
          setContactInfo(typeof d?.contact === "string" ? d.contact : "");
        }
      } catch (e) {}
      setServerMode(onServer);
      if (onServer && mode === "unsupported") {
        setConnectError("This server still uses PIN profiles, which this version no longer supports. Update the server, or pick another one.");
        setBoot("connect");
        return;
      }
      if (!onServer && isNativeApp()) {
        // A browser without a server falls back to this-browser-only storage.
        // The phone app must not: that would show an empty collection and
        // start saving into it as if the real one didn't exist.
        setConnectError(`Couldn't reach ${serverBase()}. Check your connection, or pick another server.`);
        setBoot("connect");
        return;
      }
      if (!onServer) {
        setBoot("ready");
        return;
      }
      try {
        const me = await fetch(apiUrl("/api/auth/me"), { credentials: apiCredentials(), headers: authHeaders() });
        if (me.ok) {
          const d = await me.json();
          setAccount(d.user);
          store.configure("accounts");
          setBoot("ready");
        } else {
          // A phone-app token the server no longer accepts (signed out
          // elsewhere, password changed, expired) is useless: drop it.
          if (me.status === 401) setAuthToken(null);
          setBoot("auth");
        }
      } catch (e) {
        setBoot("auth");
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

  // Puts a saved vault into state. Used by the first load and again whenever
  // the latest copy is pulled from the server (another device saved).
  function applyVault(d) {
    setCollections(d.collections || []);
    setCards(d.cards || []);
    setWishlist(d.wishlist || []);
    if (d.currency) setCurrency(d.currency);
    if (d.czkRate) setCzkRate(d.czkRate);
    if (d.eurRate) setEurRate(d.eurRate);
    // Older vaults only had "use Cardmarket while showing euros".
    setPriceSource(legacySource(d));
    setPublicVault(typeof d.publicVault === "boolean" ? d.publicVault : false);
    setPublicTrade(typeof d.publicTrade === "boolean" ? d.publicTrade : false);
    setGames(d.games || []);
    if (typeof d.ratesAuto === "boolean") setRatesAuto(d.ratesAuto);
    if (d.ratesUpdated) setRatesUpdated(d.ratesUpdated);
    setHistory(d.history || []);
    setDecks(d.decks || []);
  }

  // load
  //
  // Only "there is nothing saved yet" (a new profile) may start from an empty
  // vault. Any other failure — the server unreachable, a 500, a wrong or
  // locked-out PIN, a corrupt file — must NOT: the first autosave after an
  // "empty" load would overwrite the real vault with nothing. So on failure
  // the app stays unloaded (saving never starts) and says why, with a retry.
  useEffect(() => {
    if (boot !== "ready") return;
    let cancelled = false;
    (async () => {
      let res;
      try {
        res = await store.get("ledger-foil-data");
      } catch (e) {
        if (cancelled) return;
        if (e?.message === "signed-out") return setBoot("auth");
        setLoadError(
          e?.status === 429
            ? e.message
            : "Couldn't load your collection from the server. Nothing has been changed; check the connection and try again."
        );
        return;
      }
      if (cancelled) return;
      if (res && res.value) {
        try {
          applyVault(JSON.parse(res.value));
        } catch (e) {
          setLoadError("The saved collection couldn't be read, so it was left untouched. Export a backup from another device before changing anything here.");
          return;
        }
      }
      setLoadError("");
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [boot, loadAttempt]);

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
  // Unsaved-edit bookkeeping for pulling in another device's changes: every
  // scheduled save bumps editSeq, every completed one records the editSeq it
  // covered. Equal means nothing here is waiting to go out.
  const editSeq = useRef(0);
  const savedSeq = useRef(0);
  const conflicted = useRef(false);
  // Set right before state is replaced by a fresh copy from the server, so
  // that copy isn't immediately written straight back as if it were an edit.
  const skipNextSave = useRef(false);
  // Always holds the CURRENT state, updated every render. runSave reads from
  // this rather than closing over collections/cards/etc directly, so a retry
  // triggered from inside runSave's own finally block (see below) sends the
  // freshest data rather than replaying whatever was current when that
  // particular call started.
  const latestSnapshot = useRef(null);
  latestSnapshot.current = { collections, cards, wishlist, currency, czkRate, eurRate, priceSource, publicVault, publicTrade, games, ratesAuto, ratesUpdated, history, decks };

  const runSave = useCallback(async () => {
    if (saveInFlight.current) {
      // a save is already on the wire; ask it to run again with whatever's
      // freshest once it finishes, instead of starting an overlapping one
      savePending.current = true;
      return;
    }
    if (conflicted.current) return;
    saveInFlight.current = true;
    const mySeq = ++saveSeq.current;
    const covers = editSeq.current;
    try {
      const result = await store.set("ledger-foil-data", JSON.stringify(latestSnapshot.current));
      if (result?.conflict) {
        conflicted.current = true;
        savePending.current = false;
        setSaveConflict(true);
        return;
      }
      if (result) savedSeq.current = Math.max(savedSeq.current, covers);
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
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    editSeq.current += 1;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(runSave, 500);
    return () => clearTimeout(saveTimer.current);
  }, [collections, cards, wishlist, loaded, currency, czkRate, eurRate, priceSource, publicVault, publicTrade, games, ratesAuto, ratesUpdated, history, decks, runSave]);

  // Pull the server's current copy into this device. Only safe with nothing
  // unsaved here (or after a refused save, where what's here is being
  // deliberately dropped in favour of the other device's version).
  const pullLatest = useCallback(async () => {
    const res = await store.get("ledger-foil-data");
    if (res && res.value) {
      skipNextSave.current = true;
      applyVault(JSON.parse(res.value));
    }
    savedSeq.current = editSeq.current;
    conflicted.current = false;
    setSaveConflict(false);
    setSaveError(false);
  }, []);

  // Coming back to the app (switching tabs, unlocking the phone) is when a
  // stale copy bites: you edited on the desktop meanwhile. Check then, and
  // take the newer copy if nothing here is waiting to be saved.
  useEffect(() => {
    if (!loaded || !serverMode) return;
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      if (conflicted.current || saveInFlight.current) return;
      if (editSeq.current !== savedSeq.current) return;
      const before = store.rev;
      if (before === null) return;
      try {
        const res = await store.get("ledger-foil-data");
        // Something was edited while we were asking — leave it alone; its
        // save will be refused if it's stale, and the banner takes over.
        if (editSeq.current !== savedSeq.current) {
          store.rev = before;
          return;
        }
        if (store.rev !== before && res && res.value) {
          skipNextSave.current = true;
          applyVault(JSON.parse(res.value));
        }
      } catch (e) {
        store.rev = before;
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loaded, serverMode]);

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
      // A proxy cost nothing to acquire, so it takes no share of a
      // collection's purchase total — otherwise every proxy would quietly
      // shrink what the real cards in that collection are recorded as costing.
      if (c.proxy) return;
      const key = c.collectionId || UNCATEGORIZED;
      const s = (m[key] = m[key] || { overrideSum: 0, noOverrideCount: 0, noOverrideUnits: 0 });
      if (c.costOverride !== null && c.costOverride !== undefined) {
        s.overrideSum += c.costOverride || 0;
      } else {
        s.noOverrideCount += 1;
        // The split is per physical copy, not per row — a stack of 7 took 7x
        // the budget a single did, and `value` already scales the same way
        // (currentUnitValue * quantity). Sharing evenly per row instead of
        // per copy was the bug: a 7-of and a 1-of got the same tiny slice, so
        // the 7-of's value shot past its (barely-there) cost and looked like
        // an enormous, fake profit.
        s.noOverrideUnits += c.quantity || 1;
      }
    });
    return m;
  }, [cards]);

  const collectionNameMap = useMemo(() => {
    const m = {};
    collections.forEach((c) => (m[c.id] = c.name));
    return m;
  }, [collections]);

  function collectionName(id) {
    if (id === UNCATEGORIZED || !id) return "Uncategorized";
    return collectionNameMap[id] || "Uncategorized";
  }

  function allocatedCost(card) {
    if (card.proxy) return 0;
    if (card.costOverride !== null && card.costOverride !== undefined) {
      return card.costOverride;
    }
    if (!card.collectionId || card.collectionId === UNCATEGORIZED) return 0;
    const collection = collections.find((c) => c.id === card.collectionId);
    if (!collection) return 0;
    const stats = collectionStats[card.collectionId];
    if (!stats || stats.noOverrideUnits === 0) return 0;
    // Individual prices can exceed the collection total (a CSV import with
    // per-card prices, or hand-edited figures). Cost can never be negative, so
    // clamp at zero — otherwise the leftover cards absorb a negative cost and
    // report an enormous phantom gain.
    const remaining = Math.max(0, collection.purchasePrice - stats.overrideSum);
    // Per-copy share, times how many copies this row holds — this row's cost
    // is the total for the whole stack, matching how `value` is already
    // `currentUnitValue(card) * card.quantity`.
    return (remaining / stats.noOverrideUnits) * (card.quantity || 1);
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
    // Proxies are worth nothing and cost nothing: they stay in the collection
    // as placeholders for the real card, and every total reads them as zero.
    if (card.proxy) return 0;
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
    // moneyKey: which market and rates the values are read at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, collections, moneyKey]);

  // Name first, then the card's actual rules text. The oracle cache is the
  // same one the glossary and the card zoom fill (localStorage "lf-oracle-v4"),
  // so a card that's been looked at even once is already searchable offline.
  // Everything the query language needs to know about a card that isn't on the
  // card itself. Keeping it here — rather than inside the parser — is what lets
  // `col:`, `deck:`, `is:wanted` and `price>` work without the parser knowing
  // this app exists. currentUnitValue is pure per card, so capturing it once is
  // safe and keeps `filtered` from recomputing on every render.
  const searchCtx = useMemo(
    () => ({
      textScope: searchScope === "text",
      oracleFor: (c) => (c.scryfallId ? oracleIndex[c.scryfallId] : null),
      // The full path, so col:"universes beyond" finds Marvel's cards too.
      collectionOf: (c) => collectionPath(collections, c.collectionId),
      deckNames: (c) =>
        decks
          .filter((d) => d.commanderId === c.id || d.partnerId === c.id || (d.entries || []).some((e) => e.cardId === c.id))
          .map((d) => d.name || ""),
      isWanted: (c) =>
        wishlist.some(
          (w) =>
            (w.scryfallId && c.scryfallId && w.scryfallId === c.scryfallId) ||
            (w.name || "").toLowerCase() === (c.name || "").toLowerCase()
        ),
      unitValue: (c) => currentUnitValue(c),
      legalityOf: (c, format) => legalityOf(c, format),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchScope, oracleIndex, collectionNameMap, collections, decks, wishlist]
  );

  // Tags already in use, most-used first: what the tag editors offer as
  // one-tap suggestions so a collection doesn't sprout six spellings of
  // "trade".
  const tagSuggestions = useMemo(() => allTags(cards), [cards]);

  const parsedQuery = useMemo(() => parseQuery(search), [search]);

  const matchesSearch = useCallback((c) => matchQuery(c, parsedQuery, searchCtx), [parsedQuery, searchCtx]);

  // Rules text only exists locally for cards that have been scanned before, so
  // the first time a search actually needs it, fetch whatever's missing for the
  // whole collection — once per session, in the background, with the result
  // written back to the shared cache.
  const textScanRan = useRef(false);
  useEffect(() => {
    if (!loaded || searchScope !== "text" || !search.trim() || textScanRan.current) return;
    const ids = cards.filter((c) => c.scryfallId).map((c) => c.scryfallId);
    const missing = ids.filter((id) => !oracleIndex[id]);
    if (missing.length === 0) return;
    textScanRan.current = true;
    setTextScan({ total: missing.length });
    fetchOracleTexts(ids)
      .then((cache) => setOracleIndex({ ...cache }))
      .catch(() => {})
      .finally(() => setTextScan(null));
  }, [loaded, search, searchScope, cards, oracleIndex]);

  // Legendary cards saved before canBeCommander / partner existed: a
  // planeswalker's type line doesn't say it can lead a deck, and no type line
  // says "Partner—Character select", so look up the rules text for just
  // those legends and record the answer either way — each card is only ever
  // looked up once. Uses the shared oracle cache, so a card
  // already scanned costs no network at all. Retried per card, never looped.
  const commanderChecked = useRef(new Set());
  useEffect(() => {
    if (!loaded) return;
    const todo = cards.filter((c) => needsCommanderCheck(c) && !commanderChecked.current.has(c.scryfallId));
    if (todo.length === 0) return;
    const ids = [...new Set(todo.map((c) => c.scryfallId))];
    ids.forEach((id) => commanderChecked.current.add(id));
    fetchOracleTexts(ids)
      .then((cache) => {
        setOracleIndex({ ...cache });
        setCards((prev) =>
          prev.map((c) => {
            if (!needsCommanderCheck(c) || !cache[c.scryfallId]) return c;
            return { ...c, ...commanderPatchFromOracle(c, cache[c.scryfallId]) };
          })
        );
      })
      .catch(() => {});
  }, [loaded, cards]);

  // Art cards vs. everything else, scoped to whatever's currently filtered
  // (a specific collection, "All", a search, etc). Computed separately from
  // `filtered` itself so the "does this scope even have any art cards"
  // question doesn't depend on which sub-tab is currently selected.
  const [cardsSubView, setCardsSubView] = useState("cards"); // "cards" | "art"
  const hasArtInScope = useMemo(() => {
    let list = scopeByCollection(cards, activeFilter, collections);
    if (typeFilter !== "all") list = list.filter((c) => cardTypes(c).includes(typeFilter));
    if (colorFilter !== "all") list = list.filter((c) => bucketOf(c) === colorFilter);
    if (search.trim()) {
      list = list.filter((c) => matchesSearch(c));
    }
    return list.some((c) => c.isArt);
  }, [cards, activeFilter, typeFilter, colorFilter, search, matchesSearch, collections]);
  // Don't get stuck on the Art Cards sub-tab showing an empty grid after
  // switching to a collection (or filter) that has none.
  useEffect(() => {
    if (!hasArtInScope && cardsSubView === "art") setCardsSubView("cards");
  }, [hasArtInScope, cardsSubView]);

  const filtered = useMemo(() => {
    let list = scopeByCollection(cards, activeFilter, collections);
    if (typeFilter !== "all") {
      list = list.filter((c) => cardTypes(c).includes(typeFilter));
    }
    if (colorFilter !== "all") {
      list = list.filter((c) => bucketOf(c) === colorFilter);
    }
    if (search.trim()) {
      list = list.filter((c) => matchesSearch(c));
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
    else if (sortBy === "code") list.sort(codeCompare);
    else list.sort((a, b) => (b.added || 0) - (a.added || 0));
    return list;
  }, [cards, activeFilter, search, sortBy, typeFilter, colorFilter, collections, hasArtInScope, cardsSubView, matchesSearch, moneyKey]);

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
      // Same reasoning for proxies: adding a real copy of a card you're
      // running as a proxy must create its own row, not bump the proxy's
      // quantity — the whole point is to see which slots are still fake.
      if (!!c.proxy !== !!cardData.proxy) return false;
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
        imageUrlBack: cardData.imageUrlBack || null,
        imageUrlBackLarge: cardData.imageUrlBackLarge || null,
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
        usdEtched: cardData.usdEtched ?? null,
        // Cardmarket euros, kept alongside the dollars so a European
        // collection can be valued in the prices it actually buys at.
        eur: cardData.eur ?? null,
        eurFoil: cardData.eurFoil ?? null,
        eurEtched: cardData.eurEtched ?? null,
        // Packed format legality; see lib/formats.js.
        legalities: cardData.legalities || null,
        tags: cardData.tags || [],
        colors: cardData.colors || [],
        cmc: cardData.cmc ?? 0,
        manaCost: cardData.manaCost || "",
        typeLine: cardData.typeLine || "",
        rarity: cardData.rarity || "",
        scryfallId: cardData.scryfallId || null,
        artist: cardData.artist || null,
        isArt: !!cardData.isArt,
        signed: !!cardData.signed,
        proxy: !!cardData.proxy,
        wanted: !!cardData.wanted,
        forTrade: !!cardData.forTrade,
        tradeNote: cardData.forTrade ? cardData.tradeNote || "" : "",
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

  // Move a collection one step up or down among the ones on the same level
  // (top level, or the parts of one parent). The list order is the order the
  // chips, the Collections dialog and the guest view all show.
  function moveCollection(id, dir) {
    setCollections((prev) => {
      const me = prev.find((c) => c.id === id);
      if (!me) return prev;
      const level = topLevel(prev).some((c) => c.id === id) ? topLevel(prev) : childrenOf(prev, parentIdOf(prev, id));
      const i = level.findIndex((c) => c.id === id);
      const other = level[i + dir];
      if (!other) return prev;
      const a = prev.indexOf(me);
      const b = prev.indexOf(other);
      const next = [...prev];
      next[a] = other;
      next[b] = me;
      return next;
    });
  }

  function deleteCollection(id) {
    // Its sub-collections step up to the top level rather than vanish.
    setCollections((prev) =>
      prev.filter((c) => c.id !== id).map((c) => (c.parentId === id ? { ...c, parentId: null } : c))
    );
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

  // ---- wishlist ----
  // Entries are cards you don't own yet. They deliberately carry the same
  // printing identity as a real card (set, collector number, Scryfall id), so
  // "I got it" can hand the whole thing to addCard without a second lookup.
  function addToWishlist(entry) {
    const existing = wishlist.find(
      (w) =>
        (entry.scryfallId && w.scryfallId === entry.scryfallId) ||
        (!entry.scryfallId && w.name === entry.name && !w.scryfallId)
    );
    if (existing) {
      updateWishlistEntry(existing.id, { quantity: (existing.quantity || 1) + (entry.quantity || 1) });
      return { id: existing.id, merged: true };
    }
    const id = uid();
    setWishlist((prev) => [
      ...prev,
      {
        id,
        added: Date.now(),
        name: entry.name,
        set: entry.set || "",
        setName: entry.setName || "",
        collectorNumber: entry.collectorNumber || "",
        scryfallId: entry.scryfallId || null,
        scryfallUri: entry.scryfallUri || null,
        imageUrl: entry.imageUrl || null,
        imageUrlLarge: entry.imageUrlLarge || null,
        imageUrlBack: entry.imageUrlBack || null,
        imageUrlBackLarge: entry.imageUrlBackLarge || null,
        quantity: entry.quantity || 1,
        finish: entry.finish || "nonfoil",
        priority: entry.priority || "normal",
        note: entry.note || "",
        usd: entry.usd ?? null,
        usdFoil: entry.usdFoil ?? null,
        usdEtched: entry.usdEtched ?? null,
        // Carried so a wishlist priced in euros reads Cardmarket's number, and
        // so "I got it" hands addCard everything it needs.
        eur: entry.eur ?? null,
        eurFoil: entry.eurFoil ?? null,
        eurEtched: entry.eurEtched ?? null,
        legalities: entry.legalities || null,
        colors: entry.colors || [],
        cmc: entry.cmc ?? 0,
        typeLine: entry.typeLine || "",
        rarity: entry.rarity || "",
        artist: entry.artist || null,
      },
    ]);
    return { id, merged: false };
  }

  function updateWishlistEntry(id, patch) {
    setWishlist((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }

  // Used by the Sets roster, where you're looking at a printing you don't own:
  // one click puts that exact printing on the wishlist, another takes it off.
  // addOnly is for "put all of these on the list": a second pass over cards
  // that are already wishlisted shouldn't quietly take them off again.
  function toggleWishlist(entry, addOnly = false) {
    const existing = wishlist.find(
      (w) => w.scryfallId && entry.scryfallId && w.scryfallId === entry.scryfallId
    );
    if (existing) {
      if (addOnly) return true;
      removeWishlistEntry(existing.id);
      return false;
    }
    addToWishlist(entry);
    return true;
  }

  function removeWishlistEntry(id) {
    setWishlist((prev) => prev.filter((w) => w.id !== id));
  }

  // "I got it": the entry becomes a real card in the collection and leaves the
  // wishlist. Quantity, finish and printing all carry over.
  function acquireWishlistEntry(id, collectionId) {
    const entry = wishlist.find((w) => w.id === id);
    if (!entry) return null;
    const result = addCard({ ...entry, collectionId: collectionId || UNCATEGORIZED, id: undefined });
    removeWishlistEntry(id);
    return result;
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
        ...pricePatch(card, fresh),
        usdEtched: fresh.usdEtched ?? card.usdEtched ?? null,
        // Banlists change; a refresh is the moment to pick that up.
        legalities: fresh.legalities || card.legalities || null,
        imageUrl: fresh.imageUrl || card.imageUrl,
        imageUrlLarge: fresh.imageUrlLarge || card.imageUrlLarge,
        // Cards added before back faces were stored pick theirs up here.
        imageUrlBack: fresh.imageUrlBack || card.imageUrlBack || null,
        imageUrlBackLarge: fresh.imageUrlBackLarge || card.imageUrlBackLarge || null,
        scryfallUri: fresh.scryfallUri || card.scryfallUri,
        collectorNumber: card.collectorNumber || fresh.collectorNumber,
        cmc: card.cmc || fresh.cmc,
        manaCost: card.manaCost || fresh.manaCost || "",
        typeLine: card.typeLine || fresh.typeLine,
        rarity: card.rarity || fresh.rarity,
        colors: card.colors?.length ? card.colors : fresh.colors,
        scryfallId: card.scryfallId || fresh.scryfallId,
        canBeCommander: fresh.canBeCommander ?? card.canBeCommander,
        // null is an answer ("no partner ability"), so don't let ?? skip it
        partner: fresh.partner !== undefined ? fresh.partner : card.partner,
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
          console.error("[binderwyrm] batch refresh failed:", e);
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
      console.error("[binderwyrm] refresh aborted:", e);
      setNotice(`Refresh stopped early: ${e.message}. Already-fetched prices were kept.`);
    } finally {
      setRefreshing(null);
    }
  }

  // Pull today's reference rates. Called on its own when they're stale, and by
  // hand from Settings. A failure is not an error state for the app: the last
  // known rates stay in place and everything keeps converting, it just says so
  // in Settings.
  const refreshRates = useCallback(async () => {
    setRatesBusy(true);
    setRatesError("");
    try {
      const r = await fetchRates();
      setEurRate(r.eur);
      setCzkRate(r.czk);
      setRatesUpdated(Date.now());
      return r;
    } catch (e) {
      setRatesError(e.message || "Couldn't reach a rate source");
      return null;
    } finally {
      setRatesBusy(false);
    }
  }, []);

  // Once per session at most, and only when what we have has gone off.
  const ratesChecked = useRef(false);
  useEffect(() => {
    if (!loaded || !ratesAuto || ratesChecked.current) return;
    if (!ratesAreStale(ratesUpdated)) return;
    ratesChecked.current = true;
    refreshRates();
  }, [loaded, ratesAuto, ratesUpdated, refreshRates]);

  // A deck can hold cards you don't own yet. When one of them turns up in the
  // collection — bought and typed in, imported from a CSV, or acquired off the
  // wishlist — the deck should stop calling it missing without being asked.
  // Runs on the collection changing, not on every render, and only writes when
  // something actually linked.
  useEffect(() => {
    if (!loaded) return;
    let changed = false;
    const next = decks.map((d) => {
      const linked = linkAcquired(d, cards);
      if (!linked) return d;
      changed = true;
      return linked;
    });
    if (changed) setDecks(next);
  }, [cards, decks, loaded]);

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
        !c.proxy && // a proxy doesn't fill a roster slot; see SetsView
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
        imageUrlBack: entry.imageUrlBack || null,
        imageUrlBackLarge: entry.imageUrlBackLarge || null,
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
        usdEtched: entry.usdEtched ?? null,
        eur: entry.eur ?? null,
        eurFoil: entry.eurFoil ?? null,
        eurEtched: entry.eurEtched ?? null,
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
    const cmd2 = !isStd && deck.partnerId ? cards.find((c) => c.id === deck.partnerId) : null;
    const identity = isStd ? deck.colors || [] : combinedIdentity([cmd, cmd2]);
    const ids = new Set(deck.entries.map((e) => e.cardId));
    const names = new Set(
      deck.entries.map((e) => cards.find((c) => c.id === e.cardId)?.name).filter(Boolean)
    );
    if (cmd) names.add(cmd.name);
    if (cmd2) names.add(cmd2.name);

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
  const filteredRef = useRef(filtered);
  // Previous/next for the detail modal: the nearest neighbours in the
  // snapshot that still exist (a card deleted meanwhile is just skipped).
  const detailNavInfo = (() => {
    if (!detailCard || !detailNav) return null;
    const i = detailNav.indexOf(detailCard.id);
    if (i === -1) return null;
    const step = (dir) => {
      for (let j = i + dir; j >= 0 && j < detailNav.length; j += dir) {
        const c = cards.find((x) => x.id === detailNav[j]);
        if (c) return c;
      }
      return null;
    };
    const prev = step(-1);
    const next = step(1);
    return {
      index: i,
      total: detailNav.length,
      onPrev: prev ? () => setDetailCard(prev) : null,
      onNext: next ? () => setDetailCard(next) : null,
    };
  })();
  filteredRef.current = filtered;
  const handleCardClick = useCallback(
    (card, e) => {
      if (selectMode) toggleSelectRef.current(card.id, e.shiftKey);
      else {
        setDetailCard(card);
        setDetailNav(filteredRef.current.map((c) => c.id));
      }
    },
    [selectMode]
  );

  function exitSelectMode() {
    setSelectMode(false);
    setSelected([]);
  }

  function applyBulk(patch, deckId) {
    // Tags are added to what a card already has, never swapped for them —
    // bulk-tagging 40 cards "trade" shouldn't wipe the one that was already
    // marked "sentimental".
    const { addTags, ...fields } = patch || {};
    if (Object.keys(fields).length > 0 || addTags?.length) {
      setCards((prev) =>
        prev.map((c) => {
          if (!selected.includes(c.id)) return c;
          const next = { ...c, ...fields };
          if (addTags?.length) next.tags = addTags.reduce((acc, t) => addTag(acc, t), c.tags || []);
          return next;
        })
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

  // Everything the export builders need to turn cards into somebody else's
  // format, gathered in one place so the dialog stays about choosing.
  const exportCtx = {
    collectionName,
    allocatedCost,
    currentUnitValue,
    convert,
    currency,
  };

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

  if (boot === "connect") {
    return <ConnectGate error={connectError} onDone={() => window.location.reload()} />;
  }

  if (boot === "auth") {
    return (
      <AuthGate
        registrationOpen={registrationOpen}
        claimAvailable={claimAvailable}
        contact={contactInfo}
        onSignedIn={(user) => {
          setAccount(user);
          store.configure("accounts");
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
          /* Was a flat 1200px cap regardless of screen size -- fine on a
             laptop, a huge waste of a 4K/ultrawide monitor (the card grid
             below is auto-fill/minmax, so it already knows how to add more
             columns given more room; the cap was the only thing stopping
             it). Fluid width with a high ceiling so it genuinely fills a
             big screen instead of floating in a column with dead margins
             on either side, while still leaving a small gutter and never
             running fully edge-to-edge even on a super-ultrawide monitor. */
          position: relative; z-index: 1;
          max-width: min(3200px, 97vw);
          margin: 22px auto 0;
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
        /* The search box reserves room on its right for the scope switch, and
           the switch itself gets a shorter label on a narrow screen — the long
           one sat on top of the placeholder. */
        .search-input { padding-right: 108px !important; }
        .scope-short { display: none; }
        @media (max-width: 620px) {
          .search-input { padding-right: 60px !important; }
          .scope-long { display: none; }
          .scope-short { display: inline; }
        }

        /* On a phone the header's secondary controls were three rows of
           labelled buttons before a single card came into view. Same buttons,
           icons only — the accessible name moves to aria-label (see
           IconButton), so nothing is lost to a screen reader. */
        @media (max-width: 620px) {
          .icon-btn-label { display: none; }
          .view-tab { padding: 8px 12px !important; font-size: 12.5px !important; letter-spacing: 0.8px !important; }
        }

        /* Nav tabs: swipeable strip instead of wrapping or overflowing on phones */
        .nav-tabs {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .nav-tabs::-webkit-scrollbar { display: none; }

        /* Sets tab's art-series dense roster row: 4 fixed columns (#, name,
           artist, stepper) fit on desktop but overflow a phone — drop the artist
           column and narrow the number/stepper columns under ~560px so the
           name gets the room instead of forcing horizontal scroll. */
        @media (max-width: 560px) {
          .art-roster-row {
            grid-template-columns: 28px 1fr 84px !important;
            column-gap: 8px !important;
            padding: 8px 8px !important;
          }
          .art-roster-row .art-roster-artist { display: none; }
        }

        /* Card grid: fewer, wider tiles below ~460px so art stays legible
           instead of shrinking into unreadable thumbnails. minmax(0, 1fr) — not
           plain 1fr — because a track's implicit minimum is its content, and a
           card name doesn't wrap: with 1fr the two columns each demanded a full
           name's width and the grid ran off the side of a phone. */
        @media (max-width: 460px) {
          .card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 12px !important; }
        }

        /* Full-screen card search (AddCardModal). Wide screens: the results grid
           on the left, the selected card and its form on the right. Narrow ones:
           the panel becomes a sheet laid over the results (opened by picking a
           card, closed with Back), and a bar at the bottom keeps the pick one
           tap from being added. minmax(0, 1fr) for the same reason as
           .card-grid — a long set name must not widen a column. */
        .acs-only-narrow { display: none !important; }
        .acs-tile .acs-art { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .acs-tile:hover .acs-art { transform: translateY(-4px); box-shadow: 0 16px 28px -10px rgba(0,0,0,0.9); }

        /* The selected-card panel is built so nothing needed to add a card is
           below the fold: the action bar is pinned, and the card's details only
           ever take the room the form leaves them. Up to ~1400px the card is a
           small picture beside its name and price (the results grid already
           showed it big); past that there is width for two columns — the card
           on the left, the form on the right — and the image is sized by the
           window's HEIGHT so both columns fit a short, wide screen. The
           session log and long oracle text scroll; the form and the buttons
           don't have to. */
        .acs-aside {
          display: flex; flex-direction: column; min-height: 0;
          width: clamp(400px, 30vw, 460px); flex: 0 0 auto;
        }
        .acs-a-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 20px; }
        .acs-a-bar { flex: none; padding: 12px 20px; }
        .acs-a-log { margin-top: 4px; }
        .acs-pv { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 4px 14px; align-items: start; margin-bottom: 16px; }
        .acs-pv-img { min-width: 0; }
        .acs-pv-text { min-width: 0; }
        .acs-oracle { grid-column: 1 / -1; margin-top: 8px; max-height: 6.6em; overflow-y: auto; }
        @media (min-width: 1400px) {
          .acs-aside { width: clamp(640px, 34vw, 780px); }
          .acs-a-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 22px; align-items: start; }
          .acs-pv { display: block; margin-bottom: 0; }
          .acs-pv-img { width: min(100%, 340px, max(150px, calc((100vh - 350px) * 0.714))); margin: 0 auto 14px; }
          .acs-oracle { max-height: none; overflow: visible; margin-top: 12px; }
        }
        @media (max-width: 900px) {
          .acs-aside {
            position: absolute !important; top: 0; left: 0; right: 0; bottom: 0;
            width: auto !important; flex: none !important; z-index: 3;
            display: none; border-left: none !important;
          }
          .acs-aside.acs-open { display: flex; }
          .acs-only-narrow { display: flex !important; }
          .acs-mobilebar { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; }
          .acs-main { padding-bottom: 88px !important; }
        }
        @media (max-width: 700px) {
          .fss-tabs { flex: 1 1 100% !important; order: 3; }
          .acs-searchbtns { flex: 1 1 100% !important; }
          .acs-searchbtn { flex: 1 !important; }
        }
        @media (max-width: 460px) {
          .acs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 10px !important; }
          .acs-size { display: none !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .acs-tile .acs-art { transition: none; }
          .acs-tile:hover .acs-art { transform: none; }
        }

        /* Stepper (+/- quantity control): shrinks and grows its tap targets
           together under ~480px so it still fits a narrowed table column
           without becoming harder to tap. */
        @media (max-width: 480px) {
          .stepper { width: 80px !important; height: 32px !important; }
          .stepper .stepper-btn { width: 24px !important; font-size: 16px !important; }
          .stepper .stepper-count { width: 32px !important; }
        }

        /* Deck-builder role rows are deliberately dense for a mouse — on a
           touch device grow just the tap targets, not the row's footprint. */
        @media (pointer: coarse) {
          .qty-btn-sm { width: 26px !important; height: 26px !important; }
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
        onAddCard={() => setShowAddCard(true)}
        onManageCollections={() => setShowCollections(true)}
        onImport={() => setShowImport(true)}
        onExport={() => setShowExport(true)}
        onRefresh={refreshAllPrices}
        refreshing={refreshing}
        saveError={saveError}
        showCharts={showCharts}
        onToggleCharts={() => setShowCharts((s) => !s)}
        onSettings={() => setShowSettings(true)}
        onHome={() => setView("collection")}
      />

      <div className="nav-tabs" style={{ display: "flex", gap: 8, padding: "10px clamp(14px, 4vw, 30px) 0" }}>
        <ViewTab label="Collection" active={view === "collection"} onClick={() => setView("collection")} />
        <ViewTab label="Sets" active={view === "sets"} onClick={() => setView("sets")} />
        <ViewTab label="Decks" active={view === "decks"} onClick={() => setView("decks")} />
        <ViewTab label="Wishlist" active={view === "wishlist"} onClick={() => setView("wishlist")} />
        <ViewTab label="Glossary" active={view === "glossary"} onClick={() => setView("glossary")} />
        {serverMode && (
          <ViewTab label="Playgroup" active={view === "playgroup"} onClick={() => setView("playgroup")} />
        )}
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
        searchScope={searchScope}
        setSearchScope={setSearchScope}
        textScan={textScan}
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

      {loadError && (
        <div
          role="alert"
          data-testid="load-error"
          style={{
            margin: "14px 28px 0",
            background: C.bgPanel2,
            border: `1px solid ${C.redBright}`,
            borderRadius: 0,
            clipPath: NOTCH,
            padding: "10px 14px",
            fontSize: 12.5,
            color: C.parchment,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <AlertCircle size={14} color={C.redBright} style={{ flexShrink: 0 }} />
          <span style={{ flex: "1 1 220px" }}>{loadError}</span>
          <button
            onClick={() => setLoadAttempt((n) => n + 1)}
            style={{
              background: C.accentFill,
              border: `1px solid ${C.accent}`,
              borderRadius: 0,
              clipPath: NOTCH,
              color: C.goldBright,
              padding: "7px 12px",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      )}

            {saveConflict && (
        <div
          role="alert"
          data-testid="save-conflict"
          style={{
            margin: "14px 28px 0",
            background: C.bgPanel2,
            border: `1px solid ${C.accent}`,
            borderRadius: 0,
            clipPath: NOTCH,
            padding: "10px 14px",
            fontSize: 12.5,
            color: C.parchment,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <AlertCircle size={14} color={C.accent} style={{ flexShrink: 0 }} />
          <span style={{ flex: "1 1 220px" }}>
            Your collection was changed on another device. Your latest change here wasn't saved, so
            nothing got overwritten. Load the newer copy, then redo it.
          </span>
          <button
            onClick={() => pullLatest().catch(() => setSaveError(true))}
            style={{
              background: C.accentFill,
              border: `1px solid ${C.accent}`,
              borderRadius: 0,
              clipPath: NOTCH,
              color: C.goldBright,
              padding: "7px 12px",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Load latest
          </button>
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

      {view === "notfound" ? (
        <NotFound path={window.location.pathname} onHome={() => setView("collection")} />
      ) : view === "glossary" ? (
        <Suspense fallback={<ViewLoading />}>
          <GlossaryView cards={cards} />
        </Suspense>
      ) : view === "playgroup" ? (
        <Suspense fallback={<ViewLoading />}>
          <PlaygroupView
            cards={cards}
            wishlist={wishlist}
            profileName={serverMode ? account?.handle || null : null}
            publicTrade={publicTrade}
            onOpenSettings={() => setShowSettings(true)}
          />
        </Suspense>
      ) : view === "life" ? (
        <Suspense fallback={<ViewLoading />}>
          <LifeCounterView
            onExit={() => setView("collection")}
            decks={decks}
            onRecordGame={(g) => setGames((prev) => addGame(prev, g))}
          />
        </Suspense>
      ) : view === "decks" ? (
        <Suspense fallback={<ViewLoading />}>
          <DecksView
            cards={cards}
            collections={collections}
            decks={decks}
            setDecks={setDecks}
            games={games}
            valueOf={(c) => currentUnitValue(c) * (c.quantity || 1)}
            unitValueOf={currentUnitValue}
            wishlist={wishlist}
            routeDeckId={routeDeck}
            onOpenDeckChange={onOpenDeckChange}
            onWishlistCard={toggleWishlist}
            onAcquireCard={(card, collectionId) =>
              addCard({ ...card, id: undefined, notOwned: false, quantity: 1, collectionId: collectionId || UNCATEGORIZED })
            }
          />
        </Suspense>
      ) : view === "wishlist" ? (
        <Suspense fallback={<ViewLoading />}>
          <WishlistView
            wishlist={wishlist}
            cards={cards}
            collections={collections}
            profileName={serverMode ? account?.handle || null : null}
            onAdd={addToWishlist}
            onUpdate={updateWishlistEntry}
            onRemove={removeWishlistEntry}
            onAcquire={acquireWishlistEntry}
            onUpdateCard={updateCard}
            onOpenCard={(c) => {
              setDetailCard(c);
              setDetailNav(null);
            }}
          />
        </Suspense>
      ) : view === "sets" ? (
        <Suspense fallback={<ViewLoading />}>
          <SetsView
            cards={cards}
            collections={collections}
            wishlist={wishlist}
            onAddCopy={addCopyFromRoster}
            onRemoveCopy={removeCopyFromRoster}
            onToggleWishlist={toggleWishlist}
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
                      moneyKey={moneyKey}
                      selectMode={selectMode}
                      selected={selectedSet.has(card.id)}
                      onClick={handleCardClick}
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
                moneyKey={moneyKey}
                selectMode={selectMode}
                selected={selectedSet.has(card.id)}
                onClick={handleCardClick}
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
          tagSuggestions={tagSuggestions}
          onClose={() => setShowBulkEdit(false)}
          onApply={applyBulk}
        />
      )}

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            serverMode={serverMode}
            onAccountChange={setAccount}
            account={account}
            currency={currency}
            setCurrency={setCurrency}
            czkRate={czkRate}
            setCzkRate={setCzkRate}
            eurRate={eurRate}
            setEurRate={setEurRate}
            priceSource={priceSource}
            setPriceSource={setPriceSource}
            publicVault={publicVault}
            setPublicVault={setPublicVault}
            publicTrade={publicTrade}
            setPublicTrade={setPublicTrade}
            tradeCount={cards.filter((c) => c.forTrade && !c.sold).length}
            profileName={serverMode ? account?.handle || null : null}
            eurPricedCount={cards.filter((c) => c.eur !== null && c.eur !== undefined).length}
            ratesAuto={ratesAuto}
            setRatesAuto={(on) => {
              setRatesAuto(on);
              // Turning it back on should show today's numbers, not whatever
              // was typed while it was off.
              if (on) refreshRates();
            }}
            ratesUpdated={ratesUpdated}
            ratesBusy={ratesBusy}
            ratesError={ratesError}
            onRefreshRates={refreshRates}
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
          onMove={moveCollection}
          onDelete={deleteCollection}
          onResetCost={resetCollectionCost}
          onResetAll={resetAllCosts}
          onCreate={() => {
            setShowCollections(false);
            setShowAddCollection(true);
          }}
        />
      )}

      {showAddCollection && (
        <AddCollectionModal
          collections={collections}
          // Created while looking at a top-level collection: offer to put the
          // new one inside it.
          defaultParentId={activeFilter}
          onClose={() => setShowAddCollection(false)}
          onAdd={(data) => {
            addCollection(data);
            setShowAddCollection(false);
          }}
        />
      )}

      {showExport && (
        <Suspense fallback={null}>
          <ExportModal cards={cards} ctx={exportCtx} onClose={() => setShowExport(false)} />
        </Suspense>
      )}

      {showImport && (
        <Suspense fallback={null}>
          <ImportModal
            collections={collections}
            onClose={() => setShowImport(false)}
            onCreateCollection={addCollection}
            onAddToCollectionTotal={addToCollectionTotal}
            onImportCards={(newCards) => {
              setCards((prev) => mergeImported(prev, newCards).cards);
            }}
          />
        </Suspense>
      )}

      {detailCard && (
        <DetailModal
          // Keyed by card so stepping to another card starts a fresh form
          // (the old one writes any pending edit to ITS card as it unmounts).
          key={detailCard.id}
          nav={detailNavInfo}
          card={cards.find((c) => c.id === detailCard.id) || detailCard}
          collections={collections}
          tagSuggestions={tagSuggestions}
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
          onTrade={() => setTradeCard(cards.find((c) => c.id === detailCard.id) || detailCard)}
          onUnsell={() =>
            updateCard(detailCard.id, { sold: false, soldPrice: null, soldDate: null, tradedFor: null })
          }
          onDuplicate={(c) => {
            setDetailCard(null);
            setShowAddCard(c);
          }}
        />
      )}
      {/* Rendered last, and so painted on top: selling is reached from a card's
          own detail view, which stays open behind it. Anywhere earlier in this
          list and it would paint underneath — same stacking context, same
          z-index — so the sell dialog would open behind the card you opened it
          from. */}
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
      {/* Same reasoning as the sell dialog above: rendered last so it paints
          on top of the card it was opened from. A trade is recorded through
          the same "sold" fields as a cash sale (see TradeModal) — the only
          new field is tradedFor. TradeModal already resolved each received
          name against Scryfall itself, so toAdd arrives as real card data
          ready for addCard — no second modal, no search step here. */}
      {tradeCard && (
        <TradeModal
          card={tradeCard}
          suggested={currentUnitValue(tradeCard)}
          onClose={() => setTradeCard(null)}
          onTrade={(patch, toAdd) => {
            const collectionId = tradeCard.collectionId || UNCATEGORIZED;
            updateCard(tradeCard.id, patch);
            (toAdd || []).forEach(({ card: received, qty, costOverride }) => {
              addCard({ ...received, quantity: qty, collectionId, costOverride });
            });
            setTradeCard(null);
            setDetailCard(null);
          }}
        />
      )}

    </div>
  );
}

