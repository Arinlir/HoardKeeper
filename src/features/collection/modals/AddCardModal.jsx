import React, { useState, useEffect, useRef } from "react";
import { AlertCircle, Loader2, Search, X } from "lucide-react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { TabButton } from "../../../components/ui/TabButton";
import { fmt } from "../../../lib/format";
import { MANA } from "../../../lib/mana";
import { UNCATEGORIZED, finishOf, scryfallByCode, scryfallSearch } from "../../../lib/scryfall";
import { store } from "../../../lib/store";
import { C, STOCK_BG, STOCK_SHADOW } from "../../../lib/tokens";
import { cleanArtCardName, fetchAllArtSeriesSets } from "../../sets/rosterUtils";
import { CardArt } from "../CardTile";
import { FinishPicker, TreatmentTags } from "./FinishPicker";

export function AddCardModal({ prefill, defaultCollectionId, collections, cards, allocationPreview, onClose, onAdd, onCreateCollection }) {
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
              aria-label="Card name"
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
              aria-label="Set code"
              value={fSet}
              onChange={(e) => setFSet(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
            />
            <input
              style={{ ...inputStyle, flex: 1, minWidth: 110 }}
              placeholder="Type (creature, wolf, aura…)"
              title="Matches card types and subtypes"
              aria-label="Card type"
              value={fType}
              onChange={(e) => setFType(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
            />
            <select
              style={{ ...inputStyle, width: 118 }}
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
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 12 }}>
            {["W", "U", "B", "R", "G"].map((k) => {
              const on = fColors.includes(k);
              const colorName = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" }[k];
              return (
                <button
                  key={k}
                  title={k}
                  aria-label={colorName}
                  aria-pressed={on}
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
              aria-label="Set code"
              value={codeSet}
              onChange={(e) => setCodeSet(e.target.value)}
            />
            <input
              ref={codeNumRef}
              style={inputStyle}
              placeholder="Collector number"
              aria-label="Collector number"
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
                  aria-label="Art card name"
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
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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

