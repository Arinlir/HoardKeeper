import React, { useState } from "react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { C, STOCK_BG } from "../../../lib/tokens";

export function AddCollectionModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  return (
    <ModalShell title="New collection" onClose={onClose}>
      <Field label="Name" htmlFor="ac-name">
        <input
          id="ac-name"
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Commander Deck — Dina"
        />
      </Field>
      <Field label="Total purchase price" htmlFor="ac-price">
        <MoneyInput id="ac-price" valueUsd={price} onChange={setPrice} />
      </Field>
      <Field label="Purchase date" htmlFor="ac-date">
        <input id="ac-date" type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Note (optional)" htmlFor="ac-note">
        <input id="ac-note" style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} />
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

