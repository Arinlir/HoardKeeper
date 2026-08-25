import React, { useState } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { fmt } from "../../../lib/format";
import { C, STOCK_BG } from "../../../lib/tokens";

export function CollectionsModal({
  overAllocation,
  collections,
  cards,
  valueOf,
  costOf,
  onClose,
  onUpdate,
  onDelete,
  onResetCost,
  onResetAll,
  onCreate,
}) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  const stats = collections.map((col) => {
    const mine = cards.filter((c) => c.collectionId === col.id);
    const held = mine.filter((c) => !c.sold);
    const value = held.reduce((s, c) => s + valueOf(c), 0);
    const paid = mine.reduce((s, c) => s + costOf(c), 0);
    const overrides = mine.filter(
      (c) => c.costOverride !== null && c.costOverride !== undefined
    ).length;
    return {
      col,
      count: mine.length,
      sold: mine.length - held.length,
      value,
      paid,
      overrides,
      over: overAllocation ? overAllocation(col.id) : 0,
    };
  });

  return (
    <ModalShell title="Collections" onClose={onClose} width={620}>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Set what you paid for each collection as a whole — a precon, a bundle, a booster box.
        That total is split evenly across its cards, so you never need to price singles you
        never bought individually.
      </p>

      {stats.length === 0 && (
        <div
          style={{
            border: `1px dashed ${C.border}`,
            borderRadius: 8,
            padding: 24,
            textAlign: "center",
            color: C.parchmentDim,
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          No collections yet.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {stats.map(({ col, count, sold, value, paid, overrides, over }) => {
          const delta = value - paid;
          return (
            <div
              key={col.id}
              style={{
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                <input
                  value={col.name}
                  onChange={(e) => onUpdate(col.id, { name: e.target.value })}
                  aria-label="Collection name"
                  style={{
                    ...inputStyle,
                    flex: 1,
                    fontWeight: 600,
                    background: "transparent",
                    border: `1px solid transparent`,
                  }}
                />
                <span
                  className="mono"
                  style={{ fontSize: 11.5, color: C.parchmentDim, whiteSpace: "nowrap" }}
                >
                  {count} card{count === 1 ? "" : "s"}
                  {sold > 0 ? ` · ${sold} sold` : ""}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(150px, 1fr) auto auto",
                  gap: 10,
                  alignItems: "end",
                }}
              >
                <div>
                  <label
                    htmlFor={`cm-invested-${col.id}`}
                    style={{ display: "block", fontSize: 11, color: C.parchmentDim, marginBottom: 4 }}
                  >
                    Invested
                  </label>
                  <MoneyInput
                    id={`cm-invested-${col.id}`}
                    valueUsd={col.purchasePrice ?? 0}
                    onChange={(usd) => onUpdate(col.id, { purchasePrice: usd ?? 0 })}
                  />
                </div>

                <div style={{ textAlign: "right", paddingBottom: 6 }}>
                  <div className="mono" style={{ fontSize: 13, color: C.parchment }}>
                    {fmt(value)}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 11.5, color: delta >= 0 ? C.greenBright : C.redBright }}
                  >
                    {delta >= 0 ? "+" : "-"}
                    {fmt(Math.abs(delta))}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, paddingBottom: 4 }}>
                  <button
                    onClick={() => onResetCost(col.id)}
                    title="Set invested back to zero and clear per-card overrides"
                    style={{
                      background: "none",
                      border: `1px solid ${C.border}`,
                      color: C.parchmentDim,
                      borderRadius: 6,
                      padding: "7px 10px",
                      fontSize: 12,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Reset
                  </button>
                  {confirmDelete === col.id ? (
                    <button
                      onClick={() => {
                        onDelete(col.id);
                        setConfirmDelete(null);
                      }}
                      style={{
                        background: C.red,
                        border: "none",
                        color: C.parchment,
                        borderRadius: 6,
                        padding: "7px 10px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Sure?
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(col.id)}
                      title="Delete collection (cards move to Uncategorized)"
                      aria-label={`Delete ${col.name}`}
                      style={{
                        background: "none",
                        border: `1px solid ${C.red}`,
                        color: C.redBright,
                        borderRadius: 6,
                        padding: "7px 9px",
                        cursor: "pointer",
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {overrides > 0 && over === 0 && (
                <div style={{ fontSize: 11, color: C.parchmentDim, marginTop: 7 }}>
                  {overrides} card{overrides === 1 ? " has" : "s have"} an individual purchase
                  price set — the rest share what's left of the total.
                </div>
              )}

              {over > 0 && (
                <div
                  style={{
                    fontSize: 11.5,
                    color: C.redBright,
                    marginTop: 7,
                    lineHeight: 1.55,
                    display: "flex",
                    gap: 7,
                  }}
                >
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    The individual prices on {overrides} card{overrides === 1 ? "" : "s"} add up to{" "}
                    {fmt(over)} <b>more</b> than this collection's total, so every other card is
                    allocated nothing. Either raise the Invested figure or clear the individual
                    prices (Reset below, or select the cards and use “Clear individual prices”).
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onCreate}
          style={{
            flex: 1,
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 6,
            padding: "11px",
            fontWeight: 700,
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          <Plus size={15} style={{ verticalAlign: "-3px", marginRight: 4 }} />
          New collection
        </button>
        {confirmResetAll ? (
          <button
            onClick={() => {
              onResetAll();
              setConfirmResetAll(false);
            }}
            style={{
              background: C.red,
              border: "none",
              color: C.parchment,
              borderRadius: 6,
              padding: "11px 16px",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Reset every total?
          </button>
        ) : (
          <button
            onClick={() => setConfirmResetAll(true)}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.parchmentDim,
              borderRadius: 6,
              padding: "11px 16px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Reset all invested
          </button>
        )}
      </div>
    </ModalShell>
  );
}

