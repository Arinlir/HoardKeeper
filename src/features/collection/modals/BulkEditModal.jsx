import React, { useState } from "react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { UNCATEGORIZED } from "../../../lib/scryfall";
import { C, STOCK_BG } from "../../../lib/tokens";

export function BulkEditModal({ count, decks, overrideCount, collections, onClose, onApply }) {
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

      <Field label="Move to collection" htmlFor="be-collection">
        <select id="be-collection" style={inputStyle} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value="">Keep as is</option>
          <option value={UNCATEGORIZED}>Uncategorized</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

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

