import React, { useState, useEffect, useMemo } from "react";
import { Copy, LibraryBig, Loader2, RefreshCw, Search, Tag, Trash2 } from "lucide-react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { fmt } from "../../../lib/format";
import { renderManaSymbols } from "../../../lib/mana";
import { UNCATEGORIZED, fetchOracleTexts, finishOf, priceForFinish, scryfallById, scryfallLookup, scryfallSearch } from "../../../lib/scryfall";
import { C, STOCK_BG, STOCK_SHADOW } from "../../../lib/tokens";
import { CardArt } from "../CardTile";
import { FinishPicker, TreatmentTags } from "./FinishPicker";

export function DetailModal({ card, collections, decks, onAddToDeck, cost, onClose, onUpdate, onDelete, onSell, onUnsell, onDuplicate }) {
  const [deckNote, setDeckNote] = useState("");
  // Every deck that holds this card, either as a regular entry or as the
  // commander — computed fresh from the real deck data, not a manually
  // tracked flag, so it can never drift out of sync with reality.
  const deckMembership = useMemo(() => {
    return (decks || [])
      .map((d) => {
        if (d.commanderId === card.id) return { deck: d, role: "commander", qty: 1 };
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

      <Field label="Collection" htmlFor="dm-collection">
        <select id="dm-collection" style={inputStyle} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value={UNCATEGORIZED}>Uncategorized</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

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

      <div style={{ display: "flex", gap: 12 }}>
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
