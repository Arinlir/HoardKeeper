import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { Field, inputStyle } from "../../components/ui/Field";
import { ModalShell } from "../../components/ui/ModalShell";
import { PrintingSortBar } from "../../components/ui/PrintingSortBar";
import { fmt } from "../../lib/format";
import { FINISHES, printingMatches, printingPrice, scryfallSearch, sortPrintings } from "../../lib/scryfall";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH, NOTCH_SM } from "../../lib/tokens";
import { CardArt } from "../collection/CardTile";

export const PRIORITIES = [
  { key: "high", label: "Top of the list" },
  { key: "normal", label: "Would like it" },
  { key: "low", label: "Someday" },
];

// Three steps, same shape as adding a real card: find the card, pick the
// printing you actually want (or say you don't mind), then say how many and
// why. Step two matters more here than it does in the collection — telling
// someone "this card" when you mean one specific art is how you end up with
// the wrong one.
export function AddWishlistModal({ onClose, onAdd }) {
  const [step, setStep] = useState("search"); // search | printing | details
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState([]);
  const [printings, setPrintings] = useState([]);
  const [printSort, setPrintSort] = useState("released");
  const [printDir, setPrintDir] = useState("desc");
  const [printFilter, setPrintFilter] = useState("");
  const [picked, setPicked] = useState(null);
  const [anyPrinting, setAnyPrinting] = useState(false);

  const [quantity, setQuantity] = useState(1);
  const [finish, setFinish] = useState("nonfoil");
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");
  const [added, setAdded] = useState([]);

  async function search() {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResults([]);
    try {
      const r = await scryfallSearch(query.trim(), "cards", 24);
      if (r.length === 0) setError("Nothing found — check the spelling.");
      setResults(r);
    } catch (e) {
      setError(`Search failed — ${e.message}`);
    }
    setLoading(false);
  }

  async function choose(card) {
    setPicked(card);
    setStep("printing");
    setLoading(true);
    setError("");
    setPrintings([]);
    setPrintFilter("");
    try {
      const r = await scryfallSearch(`!"${card.name}"`, "prints", 175);
      setPrintings(r);
    } catch (e) {
      // Not fatal: the card that came back from search is a perfectly good
      // printing on its own, so fall straight through to the details step.
      setError("Couldn't load the other printings — using the one you picked.");
    }
    setLoading(false);
  }

  function confirm() {
    if (!picked) return;
    onAdd({
      ...picked,
      // "Any printing" keeps the art for the tile but drops the identity, so
      // nobody reads it as a demand for that exact set.
      set: anyPrinting ? "" : picked.set,
      setName: anyPrinting ? "" : picked.setName,
      collectorNumber: anyPrinting ? "" : picked.collectorNumber,
      scryfallId: anyPrinting ? null : picked.scryfallId,
      quantity: Number(quantity) || 1,
      finish,
      priority,
      note: note.trim(),
    });
    setAdded((prev) => [{ name: picked.name, set: anyPrinting ? "any printing" : picked.set }, ...prev]);
    // Straight back to search, so a stack of wants goes in one after another.
    setPicked(null);
    setPrintings([]);
    setPrintFilter("");
    setAnyPrinting(false);
    setQuantity(1);
    setNote("");
    setStep("search");
  }

  const btn = {
    background: STOCK_BG,
    color: C.stockInk,
    border: "none",
    borderRadius: 0,
    clipPath: NOTCH,
    padding: "9px 16px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    boxShadow: STOCK_SHADOW,
  };

  const visiblePrintings = sortPrintings(
    printings.filter((p) => printingMatches(p, printFilter)),
    printSort,
    printDir
  );

  return (
    <ModalShell title="Add to wishlist" onClose={onClose} width={620}>
      {step === "search" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Card name"
              aria-label="Card name"
              autoFocus
            />
            <button onClick={search} style={btn}>
              Search
            </button>
          </div>

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.parchmentDim }}>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Searching…
            </div>
          )}
          {error && <div style={{ color: C.redBright, fontSize: 12.5 }}>{error}</div>}

          {results.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                gap: 12,
                maxHeight: 360,
                overflowY: "auto",
              }}
            >
              {results.map((r) => (
                <button
                  key={r.scryfallId}
                  onClick={() => choose(r)}
                  title={r.name}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <div
                    style={{
                      position: "relative",
                      aspectRatio: "5 / 7",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    <CardArt card={r} />
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 9,
                      color: C.parchmentDim,
                      marginTop: 4,
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.name}
                  </div>
                </button>
              ))}
            </div>
          )}

          {added.length > 0 && (
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: `1px solid ${C.border}`,
                fontSize: 12,
                color: C.parchmentDim,
              }}
            >
              <div className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 6 }}>
                Added this session
              </div>
              {added.map((a, i) => (
                <div key={i}>
                  {a.name} <span style={{ opacity: 0.7 }}>· {a.set || "any printing"}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {step === "printing" && picked && (
        <>
          <div style={{ fontSize: 13, color: C.parchment, marginBottom: 10 }}>
            Which printing of <strong>{picked.name}</strong> do you want?
          </div>
          {error && <div style={{ color: C.parchmentDim, fontSize: 12, marginBottom: 8 }}>{error}</div>}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: C.parchment,
              cursor: "pointer",
              marginBottom: 12,
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={anyPrinting}
              onChange={(e) => setAnyPrinting(e.target.checked)}
              style={{ width: 15, height: 15 }}
            />
            Any printing is fine
          </label>

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.parchmentDim }}>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading printings…
            </div>
          )}

          {!anyPrinting && printings.length > 1 && (
            <PrintingSortBar
              sortKey={printSort}
              onSortKey={setPrintSort}
              dir={printDir}
              onToggleDir={() => setPrintDir((d) => (d === "asc" ? "desc" : "asc"))}
              filterText={printFilter}
              onFilterText={setPrintFilter}
            />
          )}

          {!anyPrinting && printings.length > 0 && visiblePrintings.length === 0 && (
            <div style={{ fontSize: 12.5, color: C.parchmentDim, marginBottom: 14 }}>
              No printing's set matches "{printFilter}".
            </div>
          )}

          {!anyPrinting && visiblePrintings.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                gap: 10,
                maxHeight: 300,
                overflowY: "auto",
                marginBottom: 14,
              }}
            >
              {visiblePrintings.map((p) => {
                const on = p.scryfallId === picked.scryfallId;
                return (
                  <button
                    key={p.scryfallId}
                    onClick={() => setPicked(p)}
                    title={`${p.setName} #${p.collectorNumber}`}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                  >
                    <div
                      style={{
                        position: "relative",
                        aspectRatio: "5 / 7",
                        borderRadius: 6,
                        overflow: "hidden",
                        border: on ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                      }}
                    >
                      <CardArt card={p} />
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 8.5, color: on ? C.accent : C.parchmentDim, marginTop: 4, textTransform: "uppercase" }}
                    >
                      {p.set} #{p.collectorNumber}
                    </div>
                    <div className="mono" style={{ fontSize: 8.5, color: C.parchmentDim }}>
                      {fmt(printingPrice(p))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setStep("details")} style={{ ...btn, flex: 1 }}>
              Continue
            </button>
            <button
              onClick={() => {
                setStep("search");
                setPicked(null);
                setPrintings([]);
                setPrintFilter("");
              }}
              style={{
                background: "none",
                border: `1px solid ${C.border}`,
                color: C.parchmentDim,
                borderRadius: 0,
                clipPath: NOTCH_SM,
                padding: "9px 14px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Back
            </button>
          </div>
        </>
      )}

      {step === "details" && picked && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ width: 110, flexShrink: 0 }}>
              <div style={{ aspectRatio: "5 / 7", borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
                <CardArt card={picked} flippable />
              </div>
            </div>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div className="serif" style={{ fontSize: 16, color: C.goldBright, fontWeight: 600 }}>
                {picked.name}
              </div>
              <div className="mono" style={{ fontSize: 11, color: C.parchmentDim, marginTop: 4, textTransform: "uppercase" }}>
                {anyPrinting ? "Any printing" : `${picked.setName || picked.set} #${picked.collectorNumber}`}
              </div>
              <div className="mono" style={{ fontSize: 13, color: C.parchment, marginTop: 8 }}>
                {fmt(printingPrice(picked))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Field label="How many" htmlFor="wl-qty">
              <input
                id="wl-qty"
                type="number"
                min={1}
                style={inputStyle}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="Finish" htmlFor="wl-finish">
              <select id="wl-finish" style={inputStyle} value={finish} onChange={(e) => setFinish(e.target.value)}>
                {FINISHES.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority" htmlFor="wl-priority">
              <select id="wl-priority" style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Note" htmlFor="wl-note">
            <input
              id="wl-note"
              style={inputStyle}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything whoever reads this should know"
            />
          </Field>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={confirm} style={{ ...btn, flex: 1 }}>
              Add to wishlist
            </button>
            <button
              onClick={() => setStep("printing")}
              style={{
                background: "none",
                border: `1px solid ${C.border}`,
                color: C.parchmentDim,
                borderRadius: 0,
                clipPath: NOTCH_SM,
                padding: "9px 14px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Back
            </button>
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </ModalShell>
  );
}
