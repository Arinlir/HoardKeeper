import React, { useState } from "react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { fmt } from "../../../lib/format";
import { C, STOCK_BG } from "../../../lib/tokens";

export function SellModal({ card, suggested, onClose, onSell }) {
  const qty = card.quantity || 1;
  const [price, setPrice] = useState(suggested || null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const unit = price || 0;
  const proceeds = unit * qty;

  return (
    <ModalShell title={`Sell ${card.name}`} onClose={onClose} width={420}>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Marking a card sold moves it off the main grid onto the Sold shelf. What you paid for it
        stays on the books, and the difference shows up as realized gain or loss.
      </p>

      <Field label={`Sale price each${qty > 1 ? ` (${qty} copies)` : ""}`} htmlFor="sell-price">
        <MoneyInput id="sell-price" valueUsd={price} onChange={setPrice} autoFocus />
      </Field>

      <Field label="Date sold" htmlFor="sell-date">
        <input id="sell-date" type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      {qty > 1 && (
        <div className="mono" style={{ fontSize: 12.5, color: C.parchmentDim, marginBottom: 14 }}>
          Total proceeds: <span style={{ color: C.goldBright }}>{fmt(proceeds)}</span>
        </div>
      )}

      <button
        onClick={() => onSell({ sold: true, soldPrice: unit, soldDate: date })}
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
        Mark sold for {fmt(proceeds)}
      </button>
    </ModalShell>
  );
}

