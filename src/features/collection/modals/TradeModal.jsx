import React, { useState } from "react";
import { Plus, X } from "lucide-react";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { fmt } from "../../../lib/format";
import { RATE_MS, scryfallLookup, sleep } from "../../../lib/scryfall";
import { C, STOCK_BG } from "../../../lib/tokens";

// Splits the value that just left evenly across whatever actually resolved —
// a card that failed to look up doesn't shrink everyone else's share, and an
// all-failed trade (entries === []) is just a trade with nothing to add.
function splitCost(entries, total) {
  if (entries.length === 0) return [];
  const share = total / entries.length;
  return entries.map((e) => ({ ...e, costOverride: share }));
}

// A trade is a sale where the payment is another card instead of cash. It
// reuses the same "sold" fields as SellModal for the outgoing card (App.jsx's
// onTrade) — soldPrice just means "what the trade was worth" here — but the
// cards coming back are the actual point: type a name and this looks it up
// on Scryfall itself and hands the resolved card straight to addCard, with no
// second "Add a card" modal and no manual search step. A name Scryfall can't
// match is never silently dropped: it stays in tradedFor's text either way,
// and confirming a second time records the trade anyway, leaving that one
// card for you to add by hand.
export function TradeModal({ card, suggested, onClose, onTrade }) {
  const qty = card.quantity || 1;
  const [value, setValue] = useState(suggested || null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [received, setReceived] = useState([{ name: "", qty: 1 }]);
  const [addNow, setAddNow] = useState(true);
  const [resolving, setResolving] = useState(false);
  // Set once a lookup has actually run. resolved holds whatever matched, so a
  // second click (after seeing what failed) doesn't repeat those requests.
  const [resolved, setResolved] = useState(null);
  const [failed, setFailed] = useState(null);

  const unit = value || 0;
  const total = unit * qty;

  function clearLookup() {
    setResolved(null);
    setFailed(null);
  }
  function updateRow(i, patch) {
    setReceived((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    clearLookup();
  }
  function addRow() {
    setReceived((prev) => [...prev, { name: "", qty: 1 }]);
  }
  function removeRow(i) {
    setReceived((prev) => prev.filter((_, idx) => idx !== i));
    clearLookup();
  }

  const summary = received.map((r) => r.name.trim()).filter(Boolean).join(", ");

  async function confirm() {
    const patch = { sold: true, soldPrice: unit, soldDate: date, tradedFor: summary };

    if (!addNow || !summary) {
      onTrade(patch, []);
      return;
    }
    // Already tried once this session and saw what didn't match — the button
    // now means "go ahead without those," not "try again."
    if (resolved) {
      onTrade(patch, splitCost(resolved, total));
      return;
    }

    const rows = received
      .map((r) => ({ name: r.name.trim(), qty: Number(r.qty) || 1 }))
      .filter((r) => r.name);
    setResolving(true);
    // One at a time, with the same gap the rest of the app leaves between
    // Scryfall requests (see RATE_MS/sleep) — firing them all at once was
    // the actual bug behind "trading for more than one card doesn't work":
    // a burst of simultaneous fuzzy-name lookups gets rate-limited, and the
    // later ones in the burst come back failed even though the name was fine.
    const ok = [];
    const bad = [];
    for (let i = 0; i < rows.length; i++) {
      if (i > 0) await sleep(RATE_MS);
      try {
        const found = await scryfallLookup(rows[i].name);
        ok.push({ card: found, qty: rows[i].qty });
      } catch (e) {
        bad.push(rows[i].name);
      }
    }
    setResolving(false);

    if (bad.length > 0) {
      setResolved(ok);
      setFailed(bad);
      return;
    }
    onTrade(patch, splitCost(ok, total));
  }

  return (
    <ModalShell title={`Trade ${card.name}`} onClose={onClose} width={460}>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Marking a card traded moves it off the main grid onto the Sold shelf, same as a sale —
        what you paid for it stays on the books, and the difference against what the trade was
        worth shows up as realized gain or loss.
      </p>

      <Field label={`Value given up each${qty > 1 ? ` (${qty} copies)` : ""}`} htmlFor="trade-value">
        <MoneyInput id="trade-value" valueUsd={value} onChange={setValue} autoFocus />
      </Field>

      <Field label="Date traded" htmlFor="trade-date">
        <input id="trade-date" type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      {qty > 1 && (
        <div className="mono" style={{ fontSize: 12.5, color: C.parchmentDim, marginBottom: 4 }}>
          Total value traded away: <span style={{ color: C.goldBright }}>{fmt(total)}</span>
        </div>
      )}

      <Field label="Received in return">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {received.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                id={i === 0 ? "trade-for" : undefined}
                style={{ ...inputStyle, flex: 1 }}
                value={row.name}
                onChange={(e) => updateRow(i, { name: e.target.value })}
                placeholder="Card name — e.g. Rhystic Study"
                aria-label="Card name received"
              />
              <input
                type="number"
                min={1}
                style={{ ...inputStyle, width: 52, textAlign: "center" }}
                value={row.qty}
                onChange={(e) => updateRow(i, { qty: e.target.value })}
                aria-label="Quantity received"
              />
              {received.length > 1 && (
                <button
                  onClick={() => removeRow(i)}
                  aria-label="Remove card"
                  style={{ background: "none", border: "none", color: C.parchmentDim, cursor: "pointer", padding: 4, display: "flex" }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addRow}
            style={{
              alignSelf: "flex-start",
              background: "none",
              border: "none",
              color: C.goldBright,
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 0",
            }}
          >
            <Plus size={12} /> Another card
          </button>
        </div>
      </Field>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          fontSize: 12.5,
          color: C.parchment,
          cursor: "pointer",
          userSelect: "none",
          margin: "4px 0 14px",
        }}
      >
        <input
          type="checkbox"
          checked={addNow}
          onChange={(e) => {
            setAddNow(e.target.checked);
            clearLookup();
          }}
          style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
        />
        <span>
          Add these to my collection now
          <span style={{ display: "block", fontSize: 11, color: C.parchmentDim, marginTop: 2 }}>
            Looks each one up and adds it directly, cost split evenly against the value you just
            traded away — no separate search step.
          </span>
        </span>
      </label>

      {failed && (
        <div
          style={{
            fontSize: 12,
            color: C.redBright,
            background: "rgba(222,115,134,0.08)",
            border: `1px solid rgba(222,115,134,0.35)`,
            borderRadius: 6,
            padding: "8px 10px",
            marginBottom: 12,
          }}
        >
          Couldn't find {failed.join(", ")} on Scryfall — fix the spelling above, or press the
          button again to record the trade anyway; {failed.length > 1 ? "those" : "that one"} will
          need adding by hand.
        </div>
      )}

      <button
        onClick={confirm}
        disabled={resolving}
        style={{
          width: "100%",
          background: STOCK_BG,
          color: C.stockInk,
          border: "none",
          borderRadius: 6,
          padding: "11px",
          fontWeight: 700,
          fontSize: 14,
          cursor: resolving ? "default" : "pointer",
          opacity: resolving ? 0.7 : 1,
        }}
      >
        {resolving ? "Looking up cards…" : failed ? "Mark traded anyway" : "Mark traded"}
      </button>
    </ModalShell>
  );
}
