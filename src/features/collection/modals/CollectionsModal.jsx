import React, { useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { MoneyInput } from "../../../components/ui/MoneyInput";
import { fmt } from "../../../lib/format";
import { C, STOCK_BG } from "../../../lib/tokens";
import { childrenOf, collectionOptions, possibleParents, topLevel } from "../../../lib/collectionTree";

export function CollectionsModal({
  overAllocation,
  collections,
  cards,
  valueOf,
  costOf,
  onClose,
  onUpdate,
  onMove,
  onDelete,
  onResetCost,
  onResetAll,
  onCreate,
}) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  // Parents first, each followed by its sub-collections.
  const ordered = collectionOptions(collections);
  // Position among siblings, so the arrows know when they're at an end.
  const siblingsOf = (col, depth) =>
    depth ? childrenOf(collections, col.parentId) : topLevel(collections);
  const stats = ordered.map(({ col, depth }) => {
    const mine = cards.filter((c) => c.collectionId === col.id);
    const held = mine.filter((c) => !c.sold);
    const value = held.reduce((s, c) => s + valueOf(c), 0);
    const paid = mine.reduce((s, c) => s + costOf(c), 0);
    const overrides = mine.filter(
      (c) => c.costOverride !== null && c.costOverride !== undefined
    ).length;
    // Cards that take a share of the Invested total: no individual price and
    // not a proxy (mirrors collectionStats in App.jsx).
    const sharers = mine.filter(
      (c) => !c.proxy && (c.costOverride === null || c.costOverride === undefined)
    ).length;
    const sibs = siblingsOf(col, depth);
    const pos = sibs.findIndex((s) => s.id === col.id);
    return {
      col,
      depth,
      canUp: pos > 0,
      canDown: pos >= 0 && pos < sibs.length - 1,
      count: mine.length,
      sold: mine.length - held.length,
      value,
      paid,
      overrides,
      sharers,
      over: overAllocation ? overAllocation(col.id) : 0,
    };
  });

  // A parent's totals are its own cards plus everything inside it.
  const byId = Object.fromEntries(stats.map((st) => [st.col.id, st]));
  const rollupOf = (id) => {
    const kids = childrenOf(collections, id);
    if (kids.length === 0) return null;
    const parts = [byId[id], ...kids.map((k) => byId[k.id])].filter(Boolean);
    return {
      kids: kids.length,
      count: parts.reduce((n, p) => n + p.count, 0),
      value: parts.reduce((n, p) => n + p.value, 0),
      paid: parts.reduce((n, p) => n + p.paid, 0),
    };
  };

  return (
    <ModalShell title="Collections" onClose={onClose} width={620}>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Set what you paid for each collection as a whole — a precon, a bundle, a booster box.
        That total is split evenly across its copies (so a card you own 7 of gets 7x the share
        of a single), so you never need to price singles you never bought individually.
      </p>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Use the arrows to put collections in the order you like — it's the order of the filter
        chips and of what guests see.
      </p>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
        Put a collection <b>inside</b> another to group them — e.g. Marvel, Assassin's Creed and
        TMNT inside Universes Beyond. The parent's totals add up everything inside it; each part
        keeps its own Invested figure.
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
        {stats.map(({ col, depth, canUp, canDown, count, sold, value, paid, overrides, sharers, over }) => {
          const delta = value - paid;
          const roll = depth === 0 ? rollupOf(col.id) : null;
          const parents = possibleParents(collections, col.id);
          // Every card carries its own price (bought as singles): what was paid
          // is just their sum and the Invested figure plays no part, so there is
          // nothing to reconcile — and nobody left to be "allocated nothing".
          const allPriced = overrides > 0 && sharers === 0;
          const hasPool = (col.purchasePrice || 0) > 0;
          return (
            <div
              key={col.id}
              data-testid={`collection-row-${col.id}`}
              style={{
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderLeft: depth ? `3px solid ${C.accent}` : `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 12,
                marginLeft: depth ? 22 : 0,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {[
                    { dir: -1, ok: canUp, Icon: ArrowUp, label: "up" },
                    { dir: 1, ok: canDown, Icon: ArrowDown, label: "down" },
                  ].map(({ dir, ok, Icon, label }) => (
                    <button
                      key={label}
                      onClick={() => onMove && onMove(col.id, dir)}
                      disabled={!ok}
                      title={`Move ${label}`}
                      aria-label={`Move ${col.name} ${label}`}
                      style={{
                        background: "none",
                        border: `1px solid ${C.border}`,
                        color: C.parchmentDim,
                        borderRadius: 4,
                        padding: "1px 5px",
                        lineHeight: 0,
                        cursor: ok ? "pointer" : "default",
                        opacity: ok ? 1 : 0.3,
                      }}
                    >
                      <Icon size={12} />
                    </button>
                  ))}
                </div>
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
                  {roll ? " directly in here" : ""}
                  {sold > 0 ? ` · ${sold} sold` : ""}
                </span>
              </div>

              {/* Where this collection sits. A collection that already holds
                  sub-collections stays top-level — one level deep only. */}
              {(parents.length > 0 || depth > 0) && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 11.5, color: C.parchmentDim }}>
                  <label htmlFor={`cm-parent-${col.id}`}>Inside</label>
                  <select
                    id={`cm-parent-${col.id}`}
                    value={depth ? col.parentId : ""}
                    onChange={(e) => onUpdate(col.id, { parentId: e.target.value || null })}
                    style={{ ...inputStyle, width: "auto", flex: "0 1 240px", padding: "5px 8px", fontSize: 12 }}
                  >
                    <option value="">— Top level —</option>
                    {parents.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {roll && (
                <div
                  data-testid={`collection-rollup-${col.id}`}
                  className="mono"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "4px 14px",
                    fontSize: 11.5,
                    color: C.parchment,
                    background: C.bgPanel,
                    border: `1px solid ${C.border}`,
                    padding: "7px 10px",
                    marginBottom: 10,
                  }}
                >
                  <span style={{ color: C.accent, letterSpacing: 1, textTransform: "uppercase", fontSize: 10 }}>
                    With {roll.kids} sub-collection{roll.kids === 1 ? "" : "s"}
                  </span>
                  <span>{roll.count} cards</span>
                  <span>worth {fmt(roll.value)}</span>
                  <span>invested {fmt(roll.paid)}</span>
                  <span style={{ color: roll.value - roll.paid >= 0 ? C.greenBright : C.redBright }}>
                    {roll.value - roll.paid >= 0 ? "+" : "-"}
                    {fmt(Math.abs(roll.value - roll.paid))}
                  </span>
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(min(150px, 100%), 1fr) auto auto",
                  gap: 8,
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
                      title={
                        roll
                          ? "Delete collection (its cards move to Uncategorized; its sub-collections move to the top level)"
                          : "Delete collection (cards move to Uncategorized)"
                      }
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

              {allPriced && (
                <div style={{ fontSize: 11, color: C.parchmentDim, marginTop: 7 }}>
                  Every card here has its own purchase price, so what you paid is simply their sum
                  ({fmt(paid)}) — the Invested figure isn't used.
                </div>
              )}

              {!allPriced && over > 0 && hasPool && (
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

              {!allPriced && overrides > 0 && !hasPool && (
                <div style={{ fontSize: 11, color: C.parchmentDim, marginTop: 7 }}>
                  {overrides} card{overrides === 1 ? " has" : "s have"} an individual purchase
                  price set. No Invested total is set, so the other cards are allocated nothing.
                </div>
              )}

              {!allPriced && overrides > 0 && hasPool && over === 0 && (
                <div style={{ fontSize: 11, color: C.parchmentDim, marginTop: 7 }}>
                  {overrides} card{overrides === 1 ? " has" : "s have"} an individual purchase
                  price set — the rest share what's left of the total.
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

