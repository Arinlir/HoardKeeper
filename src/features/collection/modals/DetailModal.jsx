import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Copy, Heart, LibraryBig, Loader2, RefreshCw, Repeat, Search, Tag, Trash2 } from "lucide-react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { TagEditor } from "../../../components/ui/TagEditor";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { PrintingSortBar } from "../../../components/ui/PrintingSortBar";
import { fmt } from "../../../lib/format";
import { MarketPrices } from "../../../components/ui/MarketPrices";
import { renderManaSymbols } from "../../../lib/mana";
import { BuyLinks } from "../../../components/ui/BuyLinks";
import { FORMATS, LEGALITY_LABEL, legalityOf } from "../../../lib/formats";
import { UNCATEGORIZED, fetchOracleTexts, finishOf, printingMatches, printingPrice, priceForFinish, pricePatch, scryfallById, scryfallLookup, scryfallSearch, sortPrintings } from "../../../lib/scryfall";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH_SM } from "../../../lib/tokens";
import { CardArt } from "../CardTile";
import { FinishPicker, TreatmentTags } from "./FinishPicker";
import { collectionOptions } from "../../../lib/collectionTree";

// `nav` (optional): { index, total, onPrev, onNext } — steps through the cards
// the grid was showing when this was opened. onPrev/onNext are null at the ends.
export function DetailModal({ card, collections, decks, tagSuggestions, onAddToDeck, cost, onClose, onUpdate, onDelete, onSell, onTrade, onUnsell, onDuplicate, nav = null }) {
  const [deckNote, setDeckNote] = useState("");
  // Every deck that holds this card, either as a regular entry or as the
  // commander — computed fresh from the real deck data, not a manually
  // tracked flag, so it can never drift out of sync with reality.
  const deckMembership = useMemo(() => {
    return (decks || [])
      .map((d) => {
        if (d.commanderId === card.id || d.partnerId === card.id) return { deck: d, role: "commander", qty: 1 };
        const entry = d.entries.find((e) => e.cardId === card.id);
        return entry ? { deck: d, role: entry.role, qty: entry.qty || 1 } : null;
      })
      .filter(Boolean);
  }, [decks, card.id]);
  const [quantity, setQuantity] = useState(card.quantity);
  const [finish, setFinish] = useState(finishOf(card));
  const [condition, setCondition] = useState(card.condition);
  const [collectionId, setCollectionId] = useState(card.collectionId || UNCATEGORIZED);
  const [costOverride, setCostOverride] = useState(card.costOverride ?? null);
  const [valueOverride, setValueOverride] = useState(card.valueOverride ?? null);
  const [location, setLocation] = useState(card.location || "");
  const [signed, setSigned] = useState(!!card.signed);
  const [proxy, setProxy] = useState(!!card.proxy);
  const [wanted, setWanted] = useState(!!card.wanted);
  const [wantNote, setWantNote] = useState(card.wantNote || "");
  const [tags, setTags] = useState(card.tags || []);
  const [forTrade, setForTrade] = useState(!!card.forTrade);
  const [tradeNote, setTradeNote] = useState(card.tradeNote || "");
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-identification: CSV imports often land on the wrong printing (or the
  // wrong card). "prints" swaps the printing, "search" relinks the card entirely.
  const [fixMode, setFixMode] = useState(null); // null | "prints" | "search"
  const [fixLoading, setFixLoading] = useState(false);
  const [fixError, setFixError] = useState("");
  const [fixResults, setFixResults] = useState([]);
  const [fixQuery, setFixQuery] = useState(card.name);
  // Sort/filter for "prints" mode only — "search" mode's results are
  // different cards by name, not printings of one, so ordering by set or
  // price doesn't mean the same thing there.
  const [fixSort, setFixSort] = useState("released");
  const [fixDir, setFixDir] = useState("desc");
  const [fixFilter, setFixFilter] = useState("");

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
    setFixFilter("");
    setFixLoading(true);
    try {
      const r = await scryfallSearch(`!"${card.name}"`, "prints", 175);
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
    setFixFilter("");
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
      imageUrlBack: p.imageUrlBack || null,
      imageUrlBackLarge: p.imageUrlBackLarge || null,
      // A different printing is a different product on both markets — carry
      // all of its prices, and don't let Movers compare it with the old one.
      ...pricePatch({}, p),
      cmc: p.cmc,
      typeLine: p.typeLine,
      colors: p.colors,
      rarity: p.rarity,
      lastChecked: Date.now(),
    });
    setFixMode(null);
    setFixResults([]);
  }

  // Edits save themselves — there is no Save button. Going through a stack
  // of cards one by one, a Save click per card was the slowest part.
  // Toggles, selects and tags commit the moment they change; typed fields
  // (quantity, location, notes, price overrides) wait until you pause for
  // half a second. Anything still pending is written before the modal closes
  // or steps to another card, so nothing typed is ever lost.
  // Only fields that actually changed since the last write are sent, so just
  // opening a card never rewrites it.
  function draftPatch() {
    return {
      quantity: Number(quantity) || 1,
      finish,
      foil: finish === "foil", // kept in step for anything reading the old flag
      condition,
      collectionId,
      location: location.trim(),
      costOverride,
      valueOverride,
      signed,
      proxy,
      wanted,
      wantNote: wanted ? wantNote.trim() : "",
      tags,
      forTrade,
      tradeNote: forTrade ? tradeNote.trim() : "",
    };
  }
  const committedRef = useRef(null);
  if (committedRef.current === null) committedRef.current = draftPatch();
  const [savedFlash, setSavedFlash] = useState(false);
  const commitRef = useRef(() => {});
  commitRef.current = () => {
    const next = draftPatch();
    const prev = committedRef.current;
    const changed = {};
    for (const k of Object.keys(next)) {
      if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) changed[k] = next[k];
    }
    if (Object.keys(changed).length === 0) return;
    committedRef.current = next;
    onUpdate(changed);
    setSavedFlash(true);
  };
  const timerRef = useRef(null);
  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    commitRef.current();
  }, []);
  useEffect(() => {
    flush();
  }, [finish, condition, collectionId, signed, proxy, wanted, tags, forTrade, flush]);
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 500);
  }, [quantity, location, wantNote, tradeNote, costOverride, valueOverride, flush]);
  useEffect(() => () => flush(), [flush]); // closing (X, Esc, backdrop) or stepping away
  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(false), 1500);
    return () => clearTimeout(t);
  }, [savedFlash]);

  // Previous / next card, without leaving the modal. ← and → do the same,
  // unless you're typing in a field (where arrows move the cursor) or another
  // dialog (Sell, Trade) is open on top of this one.
  const rootRef = useRef(null);
  const goTo = useCallback(
    (dir) => {
      const fn = dir < 0 ? nav?.onPrev : nav?.onNext;
      if (!fn) return;
      flush();
      fn();
    },
    [nav, flush]
  );
  useEffect(() => {
    if (!nav) return;
    const onKey = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (t && t.tagName === "INPUT" && !["checkbox", "radio", "button"].includes(t.type)) return;
      const backdrops = document.querySelectorAll('[data-role="modal-backdrop"]');
      const top = backdrops[backdrops.length - 1];
      if (!top || !rootRef.current || !top.contains(rootRef.current)) return;
      e.preventDefault();
      goTo(e.key === "ArrowLeft" ? -1 : 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [nav, goTo]);

  // Phones: swipe left / right anywhere on the dialog to step cards (the big
  // side arrows are hidden there — no room). Only a clearly horizontal, quick
  // flick counts, so scrolling the form up and down never changes card. Swipes
  // that start in a text field or in something that scrolls sideways are left
  // alone.
  useEffect(() => {
    if (!nav) return;
    const dialogEl = rootRef.current?.closest('[role="dialog"]');
    if (!dialogEl) return;
    let start = null;
    const scrollsSideways = (el) => {
      for (let n = el; n && n !== dialogEl; n = n.parentElement) {
        const ox = window.getComputedStyle(n).overflowX;
        if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth) return true;
      }
      return false;
    };
    const onStart = (e) => {
      const t = e.target;
      if (e.touches.length !== 1 || (t && (t.closest?.("input, select, textarea, [contenteditable]") || scrollsSideways(t)))) {
        start = null;
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() };
    };
    const onEnd = (e) => {
      if (!start) return;
      const tc = e.changedTouches[0];
      const dx = tc.clientX - start.x;
      const dy = tc.clientY - start.y;
      const quick = Date.now() - start.at < 700;
      start = null;
      if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      goTo(dx < 0 ? 1 : -1); // finger moves left → next card, like turning a page
    };
    dialogEl.addEventListener("touchstart", onStart, { passive: true });
    dialogEl.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      dialogEl.removeEventListener("touchstart", onStart);
      dialogEl.removeEventListener("touchend", onEnd);
    };
  }, [nav, goTo]);

  // Just the position in the title bar; moving is done with the big side
  // arrows (desktop), ← / → keys, or swiping (phone).
  const navControls =
    nav && nav.total > 1 ? (
      <span
        data-role="card-nav"
        className="mono"
        style={{ fontSize: 11, color: C.stockDim, whiteSpace: "nowrap", marginRight: 4 }}
      >
        {nav.index + 1} / {nav.total}
      </span>
    ) : null;

  async function refreshPrice() {
    setRefreshing(true);
    try {
      const fresh = card.scryfallId
        ? await scryfallById(card.scryfallId)
        : await scryfallLookup(card.name, card.set || undefined);
      onUpdate({
        ...pricePatch(card, fresh),
        usdEtched: fresh.usdEtched ?? card.usdEtched ?? null,
        imageUrl: fresh.imageUrl || card.imageUrl,
        imageUrlLarge: fresh.imageUrlLarge || card.imageUrlLarge,
        imageUrlBack: fresh.imageUrlBack || card.imageUrlBack || null,
        imageUrlBackLarge: fresh.imageUrlBackLarge || card.imageUrlBackLarge || null,
        scryfallUri: fresh.scryfallUri || card.scryfallUri,
        collectorNumber: card.collectorNumber || fresh.collectorNumber,
        scryfallId: card.scryfallId || fresh.scryfallId,
        lastChecked: Date.now(),
      });
    } catch (e) {}
    setRefreshing(false);
  }

  const currentVal = priceForFinish(card) ?? 0;

  // Only "prints" mode's results are all the same card — sorting/filtering
  // "search" mode's results (different card names) wouldn't mean anything.
  const visibleFixResults =
    fixMode === "prints"
      ? sortPrintings(fixResults.filter((p) => printingMatches(p, fixFilter)), fixSort, fixDir)
      : fixResults;

  return (
    <ModalShell title={card.name} onClose={onClose} width={fixMode ? 900 : 640} headerExtra={navControls}
      sideNav={
        nav && nav.total > 1
          ? { onPrev: nav.onPrev ? () => goTo(-1) : null, onNext: nav.onNext ? () => goTo(1) : null }
          : null
      }
    >
      <div ref={rootRef} style={{ display: "none" }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: 18 }}>
        <div style={{ flexShrink: 0, width: "min(240px, 100%)" }}>
          <div
            style={{
              width: "100%",
              maxWidth: 240,
              aspectRatio: "5 / 7",
              borderRadius: 11,
              overflow: "hidden",
              border: `1px solid ${C.border}`,
              background: C.bg,
              position: "relative",
            }}
          >
            <CardArt card={card} large flippable />
            {finishOf(card) !== "nonfoil" && (
              <>
                <div className="foil-sheen" />
                <div className="foil-edge" />
              </>
            )}
          </div>
          {/* Where to buy another one — or a real copy, if this is a proxy. */}
          <BuyLinks card={card} compact style={{ marginTop: 8, justifyContent: "center" }} />

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
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontSize: 13, color: C.parchment, marginBottom: 8, opacity: 0.85 }}>
            {card.setName || card.set}
            {card.rarity ? ` · ${card.rarity}` : ""}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
            {card.proxy ? (
              <div
                className="mono"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 1.6,
                  color: C.goldBright,
                  background: C.accentFill,
                  border: `1px solid ${C.accent}`,
                  borderRadius: 0,
                  clipPath: NOTCH_SM,
                  padding: "5px 11px",
                }}
              >
                PROXY
              </div>
            ) : (
              <div className="mono" style={{ fontSize: 19, fontWeight: 600, color: C.goldBright }}>
                {fmt(currentVal)} <span style={{ fontSize: 11.5, color: C.parchmentDim }}>/ each</span>
              </div>
            )}
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
          <MarketPrices card={card} />
          {card.proxy ? (
            <div style={{ fontSize: 12.5, color: C.parchmentDim, lineHeight: 1.6 }}>
              Counts as nothing in your totals, and Sets still lists the real card as missing.
              <div style={{ marginTop: 3 }}>
                A real copy currently runs{" "}
                <span className="mono" style={{ color: C.parchment }}>{fmt(currentVal)}</span>.
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: C.parchmentDim }}>
                Allocated cost: <span className="mono" style={{ color: C.parchment }}>{fmt(cost)}</span>
              </div>
              <div style={{ fontSize: 13.5, marginTop: 5, fontWeight: 600 }}>
                <span style={{ color: (currentVal * card.quantity - cost) >= 0 ? C.greenBright : C.redBright }}>
                  {(currentVal * card.quantity - cost) >= 0 ? "+" : "-"}
                  {fmt(Math.abs(currentVal * card.quantity - cost))} total
                </span>
              </div>
            </>
          )}

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
                  <div style={{ whiteSpace: "pre-line" }}>{renderManaSymbols(oracle.t)}</div>
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

            {/* Where this card is allowed to be played. Absent for cards added
                before legality was stored — they fill in on the next price
                refresh rather than being guessed at here. */}
            {card.legalities && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
                {FORMATS.map((f) => {
                  const status = legalityOf(card, f.key);
                  if (!status || status === "not_legal") return null;
                  const bad = status === "banned";
                  const warn = status === "restricted";
                  return (
                    <span
                      key={f.key}
                      className="mono"
                      title={`${f.label}: ${LEGALITY_LABEL[status]}`}
                      style={{
                        fontSize: 9,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                        padding: "3px 7px",
                        clipPath: NOTCH_SM,
                        color: bad ? C.redBright : warn ? C.goldBright : C.parchmentDim,
                        border: `1px solid ${bad ? "rgba(222,115,134,0.5)" : warn ? C.accent : C.border}`,
                      }}
                    >
                      {f.label}
                      {bad ? " · banned" : warn ? " · restricted" : ""}
                    </span>
                  );
                })}
              </div>
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
            background: "rgba(255,255,255,0.05)",
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
                aria-label="Card name"
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

          {fixMode === "prints" && fixResults.length > 1 && (
            <PrintingSortBar
              sortKey={fixSort}
              onSortKey={setFixSort}
              dir={fixDir}
              onToggleDir={() => setFixDir((d) => (d === "asc" ? "desc" : "asc"))}
              filterText={fixFilter}
              onFilterText={setFixFilter}
            />
          )}

          {fixMode === "prints" && fixResults.length > 0 && visibleFixResults.length === 0 && (
            <div style={{ fontSize: 12.5, color: C.parchmentDim }}>No printing's set matches "{fixFilter}".</div>
          )}

          {visibleFixResults.length > 0 && (
            <div
              style={{
                display: "grid",
                // Big enough to actually read the printed text and compare
                // borders/frames at a glance, the way picking a printing
                // works in other deckbuilders — not a strip of thumbnails
                // you have to zoom each one to tell apart.
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                gap: 16,
                maxHeight: 480,
                overflowY: "auto",
                paddingRight: 2,
              }}
            >
              {visibleFixResults.map((p) => {
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
                        borderRadius: 8,
                        overflow: "hidden",
                        border: current ? `2px solid ${C.goldBright}` : `1px solid ${C.border}`,
                        boxShadow: "0 6px 14px -6px rgba(0,0,0,0.7)",
                      }}
                    >
                      <CardArt card={p} />
                      {current && (
                        <span
                          className="mono"
                          style={{
                            position: "absolute",
                            bottom: 5,
                            left: 5,
                            right: 5,
                            textAlign: "center",
                            fontSize: 9,
                            letterSpacing: 1,
                            background: STOCK_BG,
                            color: C.stockInk,
                            borderRadius: 3,
                            padding: "2px 0",
                          }}
                        >
                          CURRENT
                        </span>
                      )}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 10.5,
                        color: C.parchmentDim,
                        marginTop: 6,
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {p.set} #{p.collectorNumber}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: C.gold }}>
                      {fmt(printingPrice(p))}
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

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Field label="Quantity" htmlFor="dm-quantity">
          <input
            id="dm-quantity"
            type="number"
            min={1}
            style={inputStyle}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Condition" htmlFor="dm-condition">
          <select id="dm-condition" style={inputStyle} value={condition} onChange={(e) => setCondition(e.target.value)}>
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

      {/* The two flags that change what this copy MEANS rather than what it is:
          a proxy is a placeholder standing in for a card you don't really own,
          and the wishlist flag is how that placeholder (or a beaten-up real
          copy) reaches the public wishlist page. */}
      <Field label="This copy">
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 13,
            color: C.parchment,
            cursor: "pointer",
            userSelect: "none",
            marginBottom: 10,
          }}
        >
          <input
            type="checkbox"
            checked={proxy}
            onChange={(e) => setProxy(e.target.checked)}
            style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
          />
          <span>
            Proxy
            <span style={{ display: "block", fontSize: 11.5, color: C.parchmentDim, marginTop: 2 }}>
              Stays in the collection, but carries no price and no share of the collection's cost.
              Sets keeps counting the real card as missing; decks can still use it.
            </span>
          </span>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 13,
            color: C.parchment,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={wanted}
            onChange={(e) => setWanted(e.target.checked)}
            style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
          />
          <span>
            <Heart size={12} style={{ verticalAlign: "-1px", marginRight: 4, color: C.accent }} />
            Want a real copy
            <span style={{ display: "block", fontSize: 11.5, color: C.parchmentDim, marginTop: 2 }}>
              Shows on your wishlist, including the public page anyone can open.
            </span>
          </span>
        </label>
        {wanted && (
          <input
            style={{ ...inputStyle, marginTop: 8 }}
            value={wantNote}
            onChange={(e) => setWantNote(e.target.value)}
            placeholder="Note for whoever reads the wishlist — e.g. any printing, foil preferred"
            aria-label="Wishlist note"
          />
        )}

        {/* The other half of a wishlist: what you'd give for one. */}
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 13,
            color: C.parchment,
            cursor: "pointer",
            userSelect: "none",
            marginTop: 10,
          }}
        >
          <input
            type="checkbox"
            checked={forTrade}
            onChange={(e) => setForTrade(e.target.checked)}
            style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
          />
          <span>
            <Repeat size={12} style={{ verticalAlign: "-1px", marginRight: 4, color: C.accent }} />
            Up for trade
            <span style={{ display: "block", fontSize: 11.5, color: C.parchmentDim, marginTop: 2 }}>
              Keeps the card exactly where it is, and puts it on your trade list — which your
              playgroup can match against what they're after, if you share it.
            </span>
          </span>
        </label>
        {forTrade && (
          <input
            style={{ ...inputStyle, marginTop: 8 }}
            value={tradeNote}
            onChange={(e) => setTradeNote(e.target.value)}
            placeholder="Optional note for your trade list — e.g. only for Commander staples, slight whitening"
            aria-label="Trade note"
            maxLength={200}
          />
        )}
      </Field>

      <Field label="Collection" htmlFor="dm-collection">
        <select id="dm-collection" style={inputStyle} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value={UNCATEGORIZED}>Uncategorized</option>
          {collectionOptions(collections).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Your own labels for this card. Searchable with tag: in the box. */}
      <div style={{ marginBottom: 14 }}>
        <TagEditor tags={tags} suggestions={tagSuggestions || []} onChange={setTags} />
      </div>

      <Field label="Physical location" htmlFor="dm-location">
        <input
          id="dm-location"
          style={inputStyle}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Binder 2, page 4"
        />
      </Field>

      {/* Deck membership -- the other kind of "where is this card", since a
          copy can be tied up in a deck the same way it's tied up in a binder
          slot. Always shown, even when empty, so silence never gets read as
          "the check didn't run" -- an explicit "not in any deck" is the
          answer just as much as a list of decks would be. */}
      <div
        style={{
          marginBottom: 14,
          padding: "10px 12px",
          borderRadius: 8,
          background: deckMembership.length ? "rgba(201,162,39,0.08)" : "transparent",
          border: `1px solid ${deckMembership.length ? "rgba(201,162,39,0.3)" : C.border}`,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: C.parchmentDim,
            marginBottom: deckMembership.length ? 8 : 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <LibraryBig size={11} />
          In decks
        </div>
        {deckMembership.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.parchmentDim }}>Not in any deck.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {deckMembership.map(({ deck, role, qty }) => (
              <div
                key={deck.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}
              >
                <span style={{ color: C.parchment, fontWeight: 500 }}>{deck.name}</span>
                <span className="mono" style={{ fontSize: 10.5, color: C.goldBright, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {role === "commander" ? "Commander" : `${qty > 1 ? `${qty}× · ` : ""}${role || "deck"}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Field label="Purchase price override" htmlFor="dm-cost-override">
          <MoneyInput id="dm-cost-override" valueUsd={costOverride} onChange={setCostOverride} placeholder="auto-split" />
        </Field>
        <Field label="Current value override" htmlFor="dm-value-override">
          <MoneyInput
            id="dm-value-override"
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
            {card.tradedFor ? "Traded" : "Sold"} {card.soldDate ? `on ${card.soldDate}` : ""}
          </div>
          {card.tradedFor && (
            <div style={{ color: C.parchmentDim, marginBottom: 3 }}>
              For: <span style={{ color: C.parchment }}>{card.tradedFor}</span>
            </div>
          )}
          <div className="mono" style={{ color: C.parchmentDim }}>
            {fmt((card.soldPrice || 0) * (card.quantity || 1))}{" "}
            {card.tradedFor ? "value received" : "received"} ·{" "}
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

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
        <div
          className="mono"
          aria-live="polite"
          style={{
            flex: "1 1 100%",
            fontSize: 10.5,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: savedFlash ? C.greenBright : C.parchmentDim,
            opacity: savedFlash ? 1 : 0.7,
            textAlign: "center",
          }}
        >
          {savedFlash ? "Saved" : "Changes save automatically"}
        </div>
        {!card.sold && (
          <button
            onClick={() => onDuplicate(card)}
            title="Add another copy of this exact printing — handy for a foil or another pull of the same card"
            style={{
              flex: "1 1 auto",
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
              flex: "1 1 auto",
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
        {!card.sold && (
          <button
            onClick={onTrade}
            title="Card for card — traded away for something else, not cash"
            style={{
              flex: "1 1 auto",
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
            <Repeat size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Trade
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
