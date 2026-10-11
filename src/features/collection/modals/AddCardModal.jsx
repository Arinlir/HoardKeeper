import React, { useState, useEffect, useMemo, useRef, startTransition } from "react";
import { AlertCircle, ArrowLeft, ExternalLink, Loader2, Search } from "lucide-react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { FullScreenShell } from "../../../components/ui/FullScreenShell";
import { ModalShell } from "../../../components/ui/ModalShell";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { PrintingSortBar } from "../../../components/ui/PrintingSortBar";
import { TabButton } from "../../../components/ui/TabButton";
import { fmt } from "../../../lib/format";
import { MANA } from "../../../lib/mana";
import {
  UNCATEGORIZED,
  fetchOracleTexts,
  finishOf,
  printingMatches,
  scryfallByCode,
  scryfallSearch,
  scryfallSearchPage,
  sortPrintings,
  treatmentTags,
} from "../../../lib/scryfall";
import { C, STOCK_BG, STOCK_SHADOW } from "../../../lib/tokens";
import { cleanArtCardName, fetchAllArtSeriesSets } from "../../sets/rosterUtils";
import { CardArt } from "../CardTile";
import { PriceLine, ResultGrid, ResultSizeControl, ResultTile, rarityColor, rarityLabel, useResultSize } from "./CardResultGrid";
import { FinishPicker, TreatmentTags } from "./FinishPicker";
import { ScanCardTab } from "./ScanCardTab";
import { isNativeApp } from "../../../lib/platform";
import { collectionOptions } from "../../../lib/collectionTree";

// Two shapes, one set of state:
//  - duplicating a card you own (`prefill`) is a short form — a small dialog.
//  - everything else is a card *search*, and that is judged by looking at
//    pictures, so it gets the whole screen: results as a grid of big card
//    faces with set / number / price printed underneath, and a side panel
//    holding the selected card and the "where does it go" form. The same
//    screen doubles as a plain lookup — pick a card and read it, adding is
//    optional.
export function AddCardModal({ prefill, defaultCollectionId, collections, cards, allocationPreview, onClose, onAdd, onCreateCollection }) {
  const [mode, setMode] = useState("search");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(prefill || null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  const [candidates, setCandidates] = useState([]);
  const [chosenName, setChosenName] = useState("");
  const [printings, setPrintings] = useState([]);
  // Scryfall answers in pages of up to 175. `total` is what it says exists,
  // which can be more than what's on screen until "Load more" is pressed.
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [printTotal, setPrintTotal] = useState(0);
  const [printHasMore, setPrintHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);
  const lastQueryRef = useRef("");
  const printPageRef = useRef(1);
  const printQueryRef = useRef("");
  // Order/filter live on top of whatever pickCandidate fetched — re-sorting
  // never needs another Scryfall request. Sort/direction persist across
  // candidates (most people pick the same way every time); the filter text
  // resets, since it's about *this* card's printings, not the next one.
  const [printSort, setPrintSort] = useState("released");
  const [printDir, setPrintDir] = useState("desc");
  const [printFilter, setPrintFilter] = useState("");
  const [fSet, setFSet] = useState("");
  const [fType, setFType] = useState("");
  const [fRarity, setFRarity] = useState("");
  const [fColors, setFColors] = useState([]);
  const [size, setSize] = useResultSize();
  // Narrow screens show the side panel as a sheet over the results; wide ones
  // show it beside them and this flag does nothing.
  const [panelOpen, setPanelOpen] = useState(false);
  const [oracle, setOracle] = useState(null);

  const [codeSet, setCodeSet] = useState("");
  const [codeNum, setCodeNum] = useState("");
  const [lastAdded, setLastAdded] = useState("");
  const [session, setSession] = useState([]); // everything added without closing
  const codeNumRef = useRef(null);
  const searchInputRef = useRef(null);

  // How many of each you already hold, so a result can say "Owned ×2" — by
  // printing on the printings grid, by name on the cards grid. Proxies and
  // sold cards aren't something you have.
  const owned = useMemo(() => {
    const byId = {};
    const byName = {};
    (cards || []).forEach((c) => {
      if (c.sold || c.proxy) return;
      const q = c.quantity || 1;
      if (c.scryfallId) byId[c.scryfallId] = (byId[c.scryfallId] || 0) + q;
      if (c.name) {
        const k = String(c.name).toLowerCase();
        byName[k] = (byName[k] || 0) + q;
      }
    });
    return { byId, byName };
  }, [cards]);

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

  // The rules text of whatever is selected, for the lookup side of this
  // screen. Cached by fetchOracleTexts, so re-selecting is free; a failed
  // fetch just leaves the block out.
  const resultId = result?.scryfallId;
  useEffect(() => {
    setOracle(null);
    if (prefill || !resultId) return undefined;
    let live = true;
    fetchOracleTexts([resultId])
      .then((m) => {
        if (live) setOracle(m?.[resultId] || null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [resultId, prefill]);

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

  function resetResults() {
    setResult(null);
    setCandidates([]);
    setChosenName("");
    setPrintings([]);
    setPrintFilter("");
    setTotal(0);
    setHasMore(false);
    setPrintTotal(0);
    setPrintHasMore(false);
    setPanelOpen(false);
  }

  async function doSearch() {
    const q = buildQuery();
    if (!q) return;
    setSearching(true);
    setError("");
    resetResults();
    lastQueryRef.current = q;
    pageRef.current = 1;
    try {
      const found = await scryfallSearchPage(q, { unique: "cards" });
      if (found.cards.length === 0) setError("Nothing found — check the spelling or loosen the filters.");
      else if (found.cards.length === 1) await pickCandidate(found.cards[0]);
      else {
        setCandidates(found.cards);
        setTotal(found.total);
        setHasMore(found.hasMore);
      }
    } catch (e) {
      setError(`Search failed — ${e.message}`);
    }
    setSearching(false);
  }

  async function loadMore() {
    const q = lastQueryRef.current;
    if (!q || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const r = await scryfallSearchPage(q, { unique: "cards", page: next });
      // a new search started while this page was in flight — drop it
      if (lastQueryRef.current !== q) return;
      pageRef.current = next;
      setCandidates((prev) => [...prev, ...r.cards]);
      setHasMore(r.hasMore);
    } catch (e) {
      setError(`Couldn't load more — ${e.message}`);
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadMorePrintings() {
    const q = printQueryRef.current;
    if (!q || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = printPageRef.current + 1;
      const r = await scryfallSearchPage(q, { unique: "prints", page: next });
      if (printQueryRef.current !== q) return;
      printPageRef.current = next;
      setPrintings((prev) => [...prev, ...r.cards]);
      setPrintHasMore(r.hasMore);
    } catch (e) {
      setError(`Couldn't load more — ${e.message}`);
    } finally {
      setLoadingMore(false);
    }
  }

  async function pickCandidate(c) {
    setChosenName(c.name);
    setError("");
    setSearching(true);
    setPrintFilter("");
    // a set filter narrows the printings step to that set too. Fetch a
    // full page (Scryfall's per-request max) rather than a small slice —
    // sorting by price or set name is only useful once every printing a
    // heavily-reprinted card has is actually in the list to sort.
    const pq = `!"${c.name}"` + (fSet.trim() ? ` e:${fSet.trim().toLowerCase()}` : "");
    printQueryRef.current = pq;
    printPageRef.current = 1;
    try {
      const r = await scryfallSearchPage(pq, { unique: "prints" });
      setPrintings(r.cards.length ? r.cards : [c]);
      setPrintTotal(r.cards.length ? r.total : 1);
      setPrintHasMore(r.hasMore);
      setResult(r.cards[0] || c);
    } catch (e) {
      setPrintings([c]);
      setPrintTotal(1);
      setPrintHasMore(false);
      setResult(c);
    }
    setSearching(false);
  }

  function clearSearch() {
    setQuery("");
    setFSet("");
    setFType("");
    setFRarity("");
    setFColors([]);
    setError("");
    setLastAdded("");
    lastQueryRef.current = "";
    resetResults();
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  // Optional overrides let a caller pass a just-detected set/number straight
  // through instead of reading (possibly-stale) state right after setting
  // it — the Scan tab's onDetected uses this to auto-run the lookup the
  // instant OCR finds a code, without waiting on a second render.
  async function doCodeLookup(overrideSet, overrideNum) {
    const set = (overrideSet ?? codeSet).trim();
    const num = (overrideNum ?? codeNum).trim();
    if (!set || !num) return;
    setSearching(true);
    setError("");
    setResult(null);
    try {
      const r = await scryfallByCode(set, num);
      setResult(r);
      setPanelOpen(true);
    } catch (e) {
      setError(e.message);
    }
    setSearching(false);
  }

  // Live scanner: every card it confirms is added straight away with the
  // collection / condition / finish currently chosen below (they stay put for
  // the whole run), and the camera keeps going.
  const liveCollectionRef = useRef(null);
  function liveAdd(card) {
    let cid = liveCollectionRef.current || collectionId;
    if (cid === "__new__") {
      cid = newCollectionName.trim()
        ? onCreateCollection({
            name: newCollectionName.trim(),
            purchasePrice: 0,
            purchaseDate: new Date().toISOString().slice(0, 10),
            note: "",
          })
        : UNCATEGORIZED;
      liveCollectionRef.current = cid;
    }
    // The add re-renders the whole (hidden) app; as a transition it never gets
    // in the way of the scanner's own, urgent, per-frame updates.
    startTransition(() => {
    const outcome = onAdd(
      {
        ...card,
        name: cleanArtCardName(card.name),
        quantity: 1,
        finish,
        foil: finish === "foil",
        condition,
        collectionId: cid,
        location: location.trim(),
        costOverride: null,
        isArt: false,
        signed: false,
      },
      true
    );
    setSession((prev) => {
      const same = prev.findIndex((x) => x.set === card.set && x.num === card.collectorNumber && x.finish === finish);
      if (same >= 0) {
        const next = prev.slice();
        next[same] = { ...next[same], qty: next[same].qty + 1 };
        return next;
      }
      return [
        { name: card.name, set: card.set, num: card.collectorNumber, qty: 1, finish, merged: !!outcome?.merged },
        ...prev,
      ];
    });
    });
    setLastAdded(card.name);
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
      setPanelOpen(false);
      if (mode === "code") {
        setCodeNum("");
        setTimeout(() => codeNumRef.current?.focus(), 0);
      } else if (mode === "scan") {
        // ScanCardTab is remounted (keyed off session length) so it drops
        // back to the camera/upload chooser for the next card.
        setCodeSet("");
        setCodeNum("");
      } else if (prefill) {
        setQuery("");
        setCandidates([]);
        setChosenName("");
        setPrintings([]);
        setPrintFilter("");
        setError("");
      } else if (mode === "art") {
        // The art results stay up — the next card is usually one click away
        // in the same list — and the box is selected for a fresh name.
        setTimeout(() => artInputRef.current?.select?.(), 0);
      } else {
        // Same for the name search: whatever is on screen (a set's worth of
        // cards, a card's printings) stays, so a run of cards from one search
        // is a run of clicks. Typing a new name simply replaces the old one.
        setTimeout(() => searchInputRef.current?.select?.(), 0);
      }
    }
  }

  const visiblePrintings = sortPrintings(
    printings.filter((p) => printingMatches(p, printFilter)),
    printSort,
    printDir
  );

  const printSize = visiblePrintings.length <= 4 ? "large" : size;
  const sessionCount = session.reduce((n, x) => n + x.qty, 0);
  const setTag = (c) => `${(c.set || "").toUpperCase()} #${c.collectorNumber}`;
  const yearOf = (c) => (c.releasedAt ? c.releasedAt.slice(0, 4) : "");

  // ---------- the form: shared by the small duplicate dialog and the side panel ----------
  const signedCheckbox = (
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
  );

  const formFields = (
    <>
      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Quantity" htmlFor="acm-quantity">
          <input
            id="acm-quantity"
            type="number"
            min={1}
            style={inputStyle}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Condition" htmlFor="acm-condition">
          <select id="acm-condition" style={inputStyle} value={condition} onChange={(e) => setCondition(e.target.value)}>
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

      <Field label="Collection" htmlFor="acm-collection">
        <select id="acm-collection" style={inputStyle} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value={UNCATEGORIZED}>Uncategorized</option>
          {collectionOptions(collections).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          <option value="__new__">+ New collection...</option>
        </select>
      </Field>
      {collectionId === "__new__" && (
        <Field label="New collection name" htmlFor="acm-new-collection">
          <input
            id="acm-new-collection"
            style={inputStyle}
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            placeholder="e.g. Hobbit Bundle"
          />
        </Field>
      )}

      <Field label="Physical location (optional)" htmlFor="acm-location">
        <input
          id="acm-location"
          style={inputStyle}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Binder 2, page 4"
        />
      </Field>

      <Field label="Purchase price (optional — blank shares the collection's total)" htmlFor="acm-cost">
        <MoneyInput id="acm-cost" valueUsd={costOverride} onChange={setCostOverride} placeholder="auto-split" />
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
    </>
  );

  const addButtons = (
    <div style={{ display: "flex", gap: 8 }}>
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
  );

  // what this session has put in the vault so far
  const sessionLog =
    session.length > 0 ? (
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
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
            {sessionCount} card{sessionCount === 1 ? "" : "s"}
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
    ) : null;

  // ---------- duplicating a card you own: the small dialog ----------
  if (prefill) {
    return (
      <ModalShell title="Add another copy" onClose={onClose}>
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

        {prefill.isArt && signedCheckbox}
        {formFields}
        <div style={{ marginTop: 6 }}>{addButtons}</div>
        {sessionLog}
      </ModalShell>
    );
  }

  // ---------- the full-screen search ----------
  const tabs = (
    <>
      <TabButton active={mode === "search"} onClick={() => setMode("search")}>
        By name
      </TabButton>
      <TabButton active={mode === "code"} onClick={() => setMode("code")}>
        By code
      </TabButton>
      <TabButton active={mode === "scan"} onClick={() => setMode("scan")}>
        Scan
      </TabButton>
      <TabButton active={mode === "art"} onClick={() => setMode("art")}>
        Art card
      </TabButton>
    </>
  );

  const primaryBtn = (disabled) => ({
    background: C.accentFill,
    color: C.goldBright,
    border: `1px solid ${C.accent}`,
    borderRadius: 6,
    padding: "0 22px",
    fontWeight: 700,
    fontSize: 14,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.7 : 1,
  });

  const loadMoreBtn = (onClick, label) => (
    <div style={{ display: "flex", justifyContent: "center", margin: "22px 0 6px" }}>
      <button
        onClick={onClick}
        disabled={loadingMore}
        style={{
          background: "transparent",
          color: C.parchment,
          border: `1px solid ${C.borderLight}`,
          borderRadius: 6,
          padding: "10px 22px",
          fontSize: 13,
          fontWeight: 600,
          cursor: loadingMore ? "default" : "pointer",
        }}
      >
        {loadingMore ? "Loading…" : label}
      </button>
    </div>
  );

  const errorLine = (text) => (
    <div style={{ color: C.redBright, fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
      <AlertCircle size={14} /> {text}
    </div>
  );

  const searchPane = (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 0 }}>
          <Search
            size={16}
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.parchmentDim, pointerEvents: "none" }}
          />
          <input
            ref={searchInputRef}
            style={{ ...inputStyle, fontSize: 15, padding: "12px 12px 12px 36px" }}
            placeholder="Card name (e.g. Sol Ring) — or Scryfall syntax, like t:goblin o:haste"
            aria-label="Card name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            autoFocus
          />
        </div>
        <div className="acs-searchbtns" style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
          <button className="acs-searchbtn" onClick={doSearch} disabled={searching} style={{ ...primaryBtn(searching), minHeight: 44 }}>
            Search
          </button>
          <button
            onClick={clearSearch}
            style={{
              background: "transparent",
              color: C.parchmentDim,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "0 16px",
              fontSize: 13,
              cursor: "pointer",
              minHeight: 44,
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* optional filters — any combination works, with or without a name. Not
          needed once a card is picked and its printings are up. */}
      {!chosenName && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            style={{ ...inputStyle, width: 84, textTransform: "uppercase" }}
            placeholder="Set"
            title="Set code, e.g. HOB"
            aria-label="Set code"
            value={fSet}
            onChange={(e) => setFSet(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
          <input
            style={{ ...inputStyle, flex: "1 1 150px", maxWidth: 280, minWidth: 110, width: "auto" }}
            placeholder="Type (creature, wolf, aura…)"
            title="Matches card types and subtypes"
            aria-label="Card type"
            value={fType}
            onChange={(e) => setFType(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
          <select
            style={{ ...inputStyle, width: 130 }}
            aria-label="Rarity"
            value={fRarity}
            onChange={(e) => setFRarity(e.target.value)}
          >
            <option value="">Any rarity</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="mythic">Mythic</option>
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px" }}>
            {["W", "U", "B", "R", "G"].map((k) => {
              const on = fColors.includes(k);
              const colorName = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" }[k];
              return (
                <button
                  key={k}
                  title={colorName}
                  aria-label={colorName}
                  aria-pressed={on}
                  onClick={() =>
                    setFColors((prev) => (on ? prev.filter((x) => x !== k) : [...prev, k]))
                  }
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: MANA[k],
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    boxShadow: on
                      ? `0 0 0 2px ${C.bg}, 0 0 0 3.5px ${C.goldBright}`
                      : "inset 0 0 0 1px rgba(0,0,0,0.4)",
                    opacity: on || fColors.length === 0 ? 1 : 0.35,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* one status line: searching / error / how many results — and the size switch */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: C.parchmentDim, minWidth: 0 }}>
          {searching ? (
            <>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Searching…
            </>
          ) : error ? (
            errorLine(error)
          ) : chosenName ? null : candidates.length > 0 ? (
            <span className="mono">
              Total results: {total || candidates.length}
              {hasMore ? ` · showing ${candidates.length}` : ""}
            </span>
          ) : lastAdded ? (
            <span className="mono" style={{ color: C.greenBright }}>✓ {lastAdded} added</span>
          ) : null}
        </div>
        <ResultSizeControl value={size} onChange={setSize} />
      </div>

      {/* step 1: pick the card */}
      {candidates.length > 0 && !chosenName && (
        <>
          <ResultGrid size={size}>
            {candidates.map((c) => (
              <ResultTile
                key={c.scryfallId}
                card={c}
                size={size}
                title={c.name}
                primary={c.name}
                secondary={`${setTag(c)} · ${c.setName}`}
                tertiary={(c.typeLine || "").split("—")[0].trim()}
                ownedQty={owned.byName[String(c.name).toLowerCase()] || 0}
                onSelect={() => pickCandidate(c)}
              />
            ))}
          </ResultGrid>
          {hasMore && loadMoreBtn(loadMore, `Load more (${Math.max(0, total - candidates.length)} more)`)}
        </>
      )}

      {/* step 2: pick the printing */}
      {chosenName && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            <span className="mono" style={{ fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: C.parchmentDim }}>
              Printings — {chosenName}
            </span>
            <span style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
              <span className="mono" style={{ fontSize: 11, color: C.parchmentDim }}>
                {printHasMore ? `${printings.length} of ${printTotal}` : `${printings.length}`} printing
                {printings.length === 1 ? "" : "s"}
              </span>
              <button
                onClick={() => {
                  setChosenName("");
                  setPrintings([]);
                  setPrintFilter("");
                  setResult(null);
                  setPanelOpen(false);
                }}
                className="mono"
                style={{ background: "none", border: "none", color: C.parchmentDim, fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}
              >
                back to results
              </button>
            </span>
          </div>

          {printings.length > 1 && (
            <PrintingSortBar
              sortKey={printSort}
              onSortKey={setPrintSort}
              dir={printDir}
              onToggleDir={() => setPrintDir((d) => (d === "asc" ? "desc" : "asc"))}
              filterText={printFilter}
              onFilterText={setPrintFilter}
            />
          )}

          {visiblePrintings.length === 0 && (
            <div style={{ padding: "10px 2px", fontSize: 12.5, color: C.parchmentDim }}>
              No printing's set matches "{printFilter}".
            </div>
          )}
          {/* a card with only a few printings gets big tiles: one small tile in an
              empty pane helps nobody */}
          <ResultGrid size={printSize}>
            {visiblePrintings.map((p) => {
              const treatments = treatmentTags(p).slice(0, 2);
              return (
                <ResultTile
                  key={p.scryfallId}
                  card={p}
                  size={printSize}
                  title={`${p.setName} ${setTag(p)}`}
                  selected={result?.scryfallId === p.scryfallId}
                  primary={<span className="serif">{p.setName}</span>}
                  secondary={`${setTag(p)}${p.rarity ? ` · ${rarityLabel(p.rarity)}` : ""}`}
                  tertiary={[yearOf(p), ...treatments].filter(Boolean).join(" · ")}
                  ownedQty={owned.byId[p.scryfallId] || 0}
                  onSelect={() => {
                    setResult(p);
                    setPanelOpen(true);
                  }}
                />
              );
            })}
          </ResultGrid>
          {printHasMore && loadMoreBtn(loadMorePrintings, `Load more printings (${Math.max(0, printTotal - printings.length)} more)`)}
        </>
      )}

      {!searching && !error && candidates.length === 0 && !chosenName && (
        <div style={{ textAlign: "center", color: C.parchmentDim, padding: "clamp(28px, 9vh, 90px) 12px" }}>
          <Search size={34} style={{ opacity: 0.45 }} />
          <div className="serif" style={{ fontSize: 19, color: C.parchment, margin: "12px 0 6px" }}>
            Find any card
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.7, maxWidth: 460, margin: "0 auto" }}>
            Type a name, or leave it empty and use the set, type, rarity and colour filters to
            browse — <span className="mono">HOB</span> and a type gets you a whole set's
            creatures. Scryfall syntax works in the box, like <span className="mono">t:goblin o:haste</span>.
            Pick a card to see every printing, then click the one you own.
          </div>
        </div>
      )}
    </>
  );

  const codePane = (
    <div style={{ maxWidth: 680 }}>
      {mode === "scan" && (
        <ScanCardTab
          // the phone app's live scanner stays mounted across adds; the web photo scanner resets after each
          key={isNativeApp() ? "live" : session.length}
          onScanned={liveAdd}
          onDetected={(set, num) => {
            setCodeSet(set);
            setCodeNum(num);
            doCodeLookup(set, num);
          }}
        />
      )}
      <p style={{ fontSize: 12, color: C.parchmentDim, marginTop: 0 }}>
        {mode === "scan"
          ? "Detected values land in these fields — check them and hit Find, or fix them by hand."
          : <>The bottom-left corner of the card: set code and collector number
          (e.g. <span className="mono">HOB 0191</span>). Set sticks between adds, so a stack
          goes number → Enter → number → Enter.</>}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <input
          style={{ ...inputStyle, width: 90, flexShrink: 0, textTransform: "uppercase" }}
          placeholder="Set"
          aria-label="Set code"
          value={codeSet}
          onChange={(e) => setCodeSet(e.target.value)}
        />
        <input
          ref={codeNumRef}
          style={{ ...inputStyle, flex: "1 1 140px" }}
          placeholder="Collector number"
          aria-label="Collector number"
          value={codeNum}
          onChange={(e) => setCodeNum(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doCodeLookup()}
          autoFocus={mode === "code"}
        />
        <button onClick={() => doCodeLookup()} disabled={searching} style={{ ...primaryBtn(searching), minHeight: 40, whiteSpace: "nowrap" }}>
          {searching ? "..." : "Find"}
        </button>
      </div>
      {lastAdded && !result && !error && (
        <div className="mono" style={{ fontSize: 11.5, color: C.greenBright, marginBottom: 12 }}>
          ✓ {lastAdded} added — next number
        </div>
      )}
      {error && <div style={{ marginBottom: 12 }}>{errorLine(error)}</div>}
      {result && (
        <div className="mono" style={{ fontSize: 11.5, color: C.parchmentDim }}>
          Found {result.name} — see the panel to add it.
        </div>
      )}
    </div>
  );

  const artPane = (
    <div>
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
          <p style={{ fontSize: 12, color: C.parchmentDim, marginTop: 0, maxWidth: 720 }}>
            Searches only within real art-series sets — Sol Ring the playable card won't show
            up here, only Sol Ring the art card. Since Scryfall doesn't track signed vs.
            unsigned (they're the same database entry either way), mark it yourself in the
            panel if your copy has the gold-stamped signature.
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <input
              ref={artInputRef}
              style={{ ...inputStyle, flex: "1 1 280px", width: "auto", fontSize: 15, padding: "12px" }}
              placeholder="Card name (e.g. Hidden Blade)"
              aria-label="Art card name"
              value={artQuery}
              onChange={(e) => setArtQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doArtSearch()}
              autoFocus
            />
            <button
              onClick={doArtSearch}
              disabled={artSearching || !artQuery.trim()}
              style={{ ...primaryBtn(artSearching || !artQuery.trim()), minHeight: 44 }}
            >
              {artSearching ? "…" : "Search"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={artSeriesFilter}
              onChange={(e) => setArtSeriesFilter(e.target.value)}
              style={{ ...inputStyle, flex: "1 1 220px", maxWidth: 360, width: "auto" }}
              aria-label="Art series"
            >
              <option value="">Any art series</option>
              {artSets.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
            <div style={{ flex: 1 }} />
            <ResultSizeControl value={size} onChange={setSize} />
          </div>

          {artError && <div style={{ marginBottom: 12 }}>{errorLine(artError)}</div>}

          {artCandidates.length > 0 && (
            <ResultGrid size={size}>
              {artCandidates.map((c) => (
                <ResultTile
                  key={c.scryfallId}
                  card={c}
                  size={size}
                  title={cleanArtCardName(c.name)}
                  selected={result?.scryfallId === c.scryfallId}
                  primary={cleanArtCardName(c.name)}
                  secondary={`${c.setName} · #${c.collectorNumber}`}
                  tertiary={c.artist || ""}
                  ownedQty={owned.byId[c.scryfallId] || 0}
                  onSelect={() => {
                    setResult(c);
                    setPanelOpen(true);
                  }}
                />
              ))}
            </ResultGrid>
          )}
        </>
      )}
    </div>
  );

  // ---------- the side panel: the selected card, and where it goes ----------
  const oracleText = oracle?.t || "";
  const preview = result ? (
    <div className="acs-pv">
      <div className="acs-pv-img">
        <div
          style={{
            position: "relative",
            aspectRatio: "5 / 7",
            borderRadius: "4.7% / 3.4%",
            overflow: "hidden",
            background: C.bgPanel2,
            boxShadow: "0 14px 28px -12px rgba(0,0,0,0.9)",
          }}
        >
          <CardArt card={result} large flippable />
          {finish !== "nonfoil" && (
            <>
              <div className="foil-sheen" />
              <div className="foil-edge" />
            </>
          )}
        </div>
      </div>
      <div className="acs-pv-text">
        <div className="serif" style={{ fontSize: 19, fontWeight: 700, color: C.goldBright, lineHeight: 1.25 }}>
          {cleanArtCardName(result.name)}
        </div>
        {result.typeLine && (
          <div className="mono" style={{ fontSize: 11.5, color: C.parchmentDim, marginTop: 3 }}>
            {result.typeLine}
          </div>
        )}
        <div style={{ fontSize: 13, color: C.parchment, marginTop: 9 }}>{result.setName}</div>
        <div className="mono" style={{ fontSize: 11.5, color: C.parchmentDim, marginTop: 1 }}>
          {setTag(result)}
          {result.rarity && (
            <>
              {" · "}
              <span style={{ color: rarityColor(result.rarity) }}>{rarityLabel(result.rarity)}</span>
            </>
          )}
          {yearOf(result) ? ` · ${yearOf(result)}` : ""}
          {result.artist ? ` · ${result.artist}` : ""}
        </div>
        <div style={{ marginTop: 8 }}>
          <PriceLine card={result} style={{ fontSize: 13 }} />
        </div>
        {/^https:\/\/scryfall\.com\//i.test(result.scryfallUri || "") && (
          <a
            href={result.scryfallUri}
            target="_blank"
            rel="noopener noreferrer"
            className="mono"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 11, color: C.accent }}
          >
            View on Scryfall <ExternalLink size={11} />
          </a>
        )}
      </div>
      {oracleText && (
        <div
          className="acs-oracle"
          style={{
            padding: "8px 10px",
            borderLeft: `2px solid ${C.border}`,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: C.parchment,
            whiteSpace: "pre-line",
          }}
        >
          {oracleText}
        </div>
      )}
    </div>
  ) : (
    <div
      style={{
        border: `1px dashed ${C.border}`,
        borderRadius: 8,
        padding: "26px 16px",
        textAlign: "center",
        fontSize: 12.5,
        lineHeight: 1.6,
        color: C.parchmentDim,
      }}
    >
      {mode === "search"
        ? "Pick a card, then a printing. It shows up here — read it, or set the finish, quantity and collection and add it."
        : "The card you find shows up here."}
    </div>
  );

  return (
    <FullScreenShell
      title="Add a card"
      onClose={onClose}
      tabs={tabs}
      status={
        sessionCount > 0 ? (
          <span className="mono" style={{ fontSize: 11.5, color: C.greenBright, whiteSpace: "nowrap" }}>
            ✓ {sessionCount} added
          </span>
        ) : null
      }
    >
      <div className="acs-main" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "16px clamp(10px, 2vw, 24px) 40px" }}>
        {mode === "search" ? searchPane : mode === "art" ? artPane : codePane}
      </div>

      <aside
        className={`acs-aside${panelOpen ? " acs-open" : ""}`}
        aria-label="Selected card"
        style={{ background: C.bgPanel, borderLeft: `1px solid ${C.border}` }}
      >
        <div className="acs-a-scroll">
          <button
            className="acs-only-narrow"
            onClick={() => setPanelOpen(false)}
            style={{
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              color: C.accent,
              fontSize: 13,
              cursor: "pointer",
              padding: "0 0 12px",
            }}
          >
            <ArrowLeft size={15} /> Back to results
          </button>
          {/* wide screens: the card on the left, the form beside it — both in view at once */}
          <div className="acs-a-grid">
            <div className="acs-a-info">{preview}</div>
            <div className="acs-a-form">
              {mode === "art" && signedCheckbox}
              {formFields}
            </div>
          </div>
          {sessionLog && <div className="acs-a-log">{sessionLog}</div>}
        </div>
        <div className="acs-a-bar" style={{ background: C.bgPanel, borderTop: `1px solid ${C.border}` }}>
          {addButtons}
        </div>
      </aside>

      {/* phones: the panel is a sheet, so keep the selection one tap away */}
      {result && !panelOpen && (
        <div
          className="acs-only-narrow acs-mobilebar"
          style={{
            alignItems: "center",
            gap: 10,
            background: C.bgPanel,
            borderTop: `1px solid ${C.borderLight}`,
            padding: "8px 12px",
          }}
        >
          <div style={{ width: 34, aspectRatio: "5 / 7", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
            <CardArt card={result} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.parchment, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {cleanArtCardName(result.name)}
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {setTag(result)}
            </div>
          </div>
          <button onClick={() => setPanelOpen(true)} style={{ ...primaryBtn(false), padding: "10px 18px", whiteSpace: "nowrap" }}>
            Add…
          </button>
        </div>
      )}
    </FullScreenShell>
  );
}
