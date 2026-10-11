import React, { useState } from "react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { TagEditor } from "../../../components/ui/TagEditor";
import { UNCATEGORIZED } from "../../../lib/scryfall";
import { C, STOCK_BG } from "../../../lib/tokens";
import { collectionOptions } from "../../../lib/collectionTree";

export function BulkEditModal({ count, decks, overrideCount, collections, tagSuggestions, onClose, onApply }) {
  const [collectionId, setCollectionId] = useState("");
  const [location, setLocation] = useState("");
  const [condition, setCondition] = useState("");
  const [foil, setFoil] = useState("");
  const [costMode, setCostMode] = useState("");
  const [proxyMode, setProxyMode] = useState("");
  const [wantMode, setWantMode] = useState("");
  const [tradeMode, setTradeMode] = useState("");
  const [deckId, setDeckId] = useState("");
  // Added to whatever each card already carries, never replacing it.
  const [tags, setTags] = useState([]);

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
    if (proxyMode) patch.proxy = proxyMode === "on";
    if (wantMode) {
      patch.wanted = wantMode === "on";
      if (wantMode === "off") patch.wantNote = "";
    }
    if (tradeMode) {
      patch.forTrade = tradeMode === "on";
      // Off the list, the note has nothing left to describe.
      if (tradeMode === "off") patch.tradeNote = "";
    }
    if (tags.length) patch.addTags = tags;
    if (Object.keys(patch).length === 0 && !deckId) return;
    onApply(patch, deckId || null);
  }

  return (
    <ModalShell title={`Edit ${count} cards`} onClose={onClose}>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Leave a field blank to keep each card's existing setting.
      </p>

      <Field label="Move to collection" htmlFor="be-collection">
        <select id="be-collection" style={inputStyle} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value="">Keep as is</option>
          <option value={UNCATEGORIZED}>Uncategorized</option>
          {collectionOptions(collections).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ marginBottom: 14 }}>
        <TagEditor tags={tags} suggestions={tagSuggestions || []} onChange={setTags} label="Add tags" />
      </div>

      <Field label="Physical location" htmlFor="be-location">
        <input
          id="be-location"
          style={inputStyle}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Binder 2, page 4"
        />
      </Field>

      <Field label="Purchase price" htmlFor="be-cost">
        <select id="be-cost" style={inputStyle} value={costMode} onChange={(e) => setCostMode(e.target.value)}>
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

      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Proxy" htmlFor="be-proxy">
          <select id="be-proxy" style={inputStyle} value={proxyMode} onChange={(e) => setProxyMode(e.target.value)}>
            <option value="">Keep as is</option>
            <option value="on">Mark as proxies — no value, no cost</option>
            <option value="off">These are real cards</option>
          </select>
        </Field>
        <Field label="Wishlist" htmlFor="be-want">
          <select id="be-want" style={inputStyle} value={wantMode} onChange={(e) => setWantMode(e.target.value)}>
            <option value="">Keep as is</option>
            <option value="on">Want real copies of these</option>
            <option value="off">Take off the wishlist</option>
          </select>
        </Field>
        <Field label="Trade list" htmlFor="be-trade">
          <select id="be-trade" style={inputStyle} value={tradeMode} onChange={(e) => setTradeMode(e.target.value)}>
            <option value="">Keep as is</option>
            <option value="on">Put these up for trade</option>
            <option value="off">Take off the trade list</option>
          </select>
        </Field>
      </div>

      {decks?.length > 0 && (
        <Field label="Add all selected to deck" htmlFor="be-deck">
          <select id="be-deck" style={inputStyle} value={deckId} onChange={(e) => setDeckId(e.target.value)}>
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
        <Field label="Condition" htmlFor="be-condition">
          <select id="be-condition" style={inputStyle} value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">Keep as is</option>
            {["NM", "LP", "MP", "HP", "DMG"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Finish" htmlFor="be-finish">
          <select id="be-finish" style={inputStyle} value={foil} onChange={(e) => setFoil(e.target.value)}>
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

