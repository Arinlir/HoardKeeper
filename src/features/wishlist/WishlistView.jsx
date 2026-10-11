import React, { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Heart, Plus, Trash2 } from "lucide-react";
import { Stepper } from "../../components/ui/Stepper";
import { fmt } from "../../lib/format";
import { BuyLinks } from "../../components/ui/BuyLinks";
import { UNCATEGORIZED, priceForFinish } from "../../lib/scryfall";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH, NOTCH_SM } from "../../lib/tokens";
import { CardArt } from "../collection/CardTile";
import { AddWishlistModal, PRIORITIES } from "./AddWishlistModal";
import { collectionOptions } from "../../lib/collectionTree";
import { publicOrigin } from "../../lib/platform";

const PRIORITY_ORDER = ["high", "normal", "low"];
const PRIORITY_LABEL = { high: "Top", normal: "Want", low: "Someday" };

function PriorityPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {PRIORITIES.map((p) => {
        const on = (value || "normal") === p.key;
        return (
          <button
            key={p.key}
            onClick={() => onChange(p.key)}
            title={p.label}
            aria-pressed={on}
            className="mono"
            style={{
              flex: 1,
              background: on ? C.accentFill : "transparent",
              color: on ? C.goldBright : C.parchmentDim,
              border: `1px solid ${on ? C.accent : C.border}`,
              borderRadius: 0,
              clipPath: NOTCH_SM,
              padding: "3px 0",
              fontSize: 9,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {PRIORITY_LABEL[p.key]}
          </button>
        );
      })}
    </div>
  );
}

// The wishlist has two halves that look the same to a reader but mean different
// things to you: cards you don't own at all, and cards you do own as a proxy or
// a copy you'd rather replace. Both go out on the public page; only the first
// can be "acquired" into the collection.
export function WishlistView({ wishlist, cards, collections, profileName, onAdd, onUpdate, onRemove, onAcquire, onUpdateCard, onOpenCard }) {
  const [showAdd, setShowAdd] = useState(false);
  const [acquireInto, setAcquireInto] = useState(UNCATEGORIZED);
  const [copied, setCopied] = useState(false);

  const sorted = useMemo(
    () =>
      [...wishlist].sort(
        (a, b) =>
          PRIORITY_ORDER.indexOf(a.priority || "normal") - PRIORITY_ORDER.indexOf(b.priority || "normal") ||
          (b.added || 0) - (a.added || 0)
      ),
    [wishlist]
  );

  const replacing = useMemo(
    () => cards.filter((c) => c.wanted && !c.sold).sort((a, b) => Number(!!b.proxy) - Number(!!a.proxy) || a.name.localeCompare(b.name)),
    [cards]
  );

  const publicUrl = profileName ? `${publicOrigin()}/w/${profileName}` : null;

  function copyLink() {
    if (!publicUrl) return;
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(publicUrl).then(done).catch(() => {});
    } else {
      done();
    }
  }

  const total = sorted.reduce((sum, e) => sum + (priceForFinish(e) ?? e.usd ?? 0) * (e.quantity || 1), 0);

  return (
    <main style={{ padding: "8px clamp(14px, 4vw, 28px) 48px" }}>
      {/* share strip — the whole point of the tab is that this link works for
          someone who has no account here, so it sits at the top rather than
          behind Settings. */}
      <div
        style={{
          marginTop: 16,
          background: C.bgPanel,
          border: `1px solid ${C.border}`,
          padding: "14px clamp(12px, 3vw, 18px)",
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "center",
        }}
      >
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div
            className="mono"
            style={{ fontSize: 9.5, letterSpacing: 1.6, textTransform: "uppercase", color: C.parchmentDim }}
          >
            Public link
          </div>
          {publicUrl ? (
            <>
              <div
                className="mono"
                style={{
                  fontSize: 13,
                  color: C.accent,
                  marginTop: 5,
                  overflowWrap: "anywhere",
                }}
              >
                {publicUrl}
              </div>
              <div style={{ fontSize: 11.5, color: C.parchmentDim, marginTop: 5 }}>
                Opens without signing in and shows only this wishlist — never your collection, prices paid or totals.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 5 }}>
              A public link needs a public handle. Pick one under Settings → Account and your wishlist
              gets an address anyone can open.
            </div>
          )}
        </div>
        {publicUrl && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={copyLink}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 0,
                clipPath: NOTCH,
                padding: "9px 16px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy link"}
            </button>
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${C.border}`,
                color: C.parchmentDim,
                borderRadius: 0,
                clipPath: NOTCH_SM,
                padding: "9px 14px",
                fontSize: 12.5,
                textDecoration: "none",
              }}
            >
              <ExternalLink size={14} /> Open
            </a>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          margin: "24px 0 14px",
        }}
      >
        <h2 className="display" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.goldBright, letterSpacing: 0.5 }}>
          Cards I want
        </h2>
        <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, letterSpacing: 0.6 }}>
          {sorted.length} entr{sorted.length === 1 ? "y" : "ies"}
          {total > 0 ? ` · about ${fmt(total)} to buy` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {collections.length > 0 && sorted.length > 0 && (
          <select
            value={acquireInto}
            onChange={(e) => setAcquireInto(e.target.value)}
            aria-label="Collection for cards you acquire"
            title="Where a card lands when you mark it acquired"
            style={{
              background: C.bgPanel2,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "7px 9px",
              color: C.parchment,
              fontSize: 12.5,
            }}
          >
            <option value={UNCATEGORIZED}>Got it → Uncategorized</option>
            {collectionOptions(collections).map((c) => (
              <option key={c.id} value={c.id}>
                Got it → {c.label}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => setShowAdd(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
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
          }}
        >
          <Plus size={15} /> Add card
        </button>
      </div>

      {sorted.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${C.border}`,
            padding: "34px 20px",
            textAlign: "center",
            color: C.parchmentDim,
            fontSize: 13,
          }}
        >
          Nothing on the list yet. Add the cards you're hunting for — anyone with the link above can see them.
        </div>
      ) : (
        <div
          className="card-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(190px, 100%), 1fr))",
            gap: 20,
          }}
        >
          {sorted.map((e) => (
            <div key={e.id} data-wishlist-id={e.id} style={{ minWidth: 0 }}>
              <div
                className="sleeve"
                style={{
                  position: "relative",
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "#0C0E10",
                  aspectRatio: "5 / 7",
                  boxShadow: "0 10px 20px -8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)",
                }}
              >
                <CardArt card={e} flippable />
                {(e.quantity || 1) > 1 && (
                  <div
                    className="mono"
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      background: STOCK_BG,
                      borderRadius: 0,
                      clipPath: NOTCH_SM,
                      padding: "1px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: C.stockInk,
                      zIndex: 2,
                    }}
                  >
                    x{e.quantity}
                  </div>
                )}
                <div
                  className="mono"
                  style={{
                    position: "absolute",
                    bottom: 6,
                    left: 6,
                    zIndex: 2,
                    background: "rgba(10,11,13,0.82)",
                    border: `1px solid rgba(232,236,241,0.25)`,
                    borderRadius: 3,
                    padding: "1px 6px",
                    fontSize: 9,
                    letterSpacing: 0.4,
                    color: C.parchment,
                    textTransform: "uppercase",
                  }}
                >
                  {e.set ? `${e.set.toUpperCase()}${e.collectorNumber ? ` #${e.collectorNumber}` : ""}` : "Any printing"}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 9px",
                  marginTop: 9,
                  background: STOCK_BG,
                  borderRadius: 0,
                  clipPath: NOTCH_SM,
                  color: C.stockInk,
                  boxShadow: STOCK_SHADOW,
                }}
              >
                <span
                  className="serif"
                  title={e.name}
                  style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}
                >
                  {e.name}
                </span>
                <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
                  {fmt((priceForFinish(e) ?? e.usd ?? 0) * (e.quantity || 1))}
                </span>
              </div>

              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Stepper
                  n={e.quantity || 1}
                  onMinus={() =>
                    (e.quantity || 1) <= 1 ? onRemove(e.id) : onUpdate(e.id, { quantity: (e.quantity || 1) - 1 })
                  }
                  onPlus={() => onUpdate(e.id, { quantity: (e.quantity || 1) + 1 })}
                />
                <div style={{ flex: "1 1 120px", minWidth: 0 }}>
                  <PriorityPicker value={e.priority} onChange={(p) => onUpdate(e.id, { priority: p })} />
                </div>
              </div>

              <input
                value={e.note || ""}
                onChange={(ev) => onUpdate(e.id, { note: ev.target.value })}
                placeholder="Note"
                aria-label={`Note for ${e.name}`}
                style={{
                  width: "100%",
                  marginTop: 8,
                  background: C.bgPanel2,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "6px 8px",
                  color: C.parchment,
                  fontSize: 12,
                }}
              />

              {/* A wishlist is a shopping list; give it the shops. */}
              <BuyLinks card={e} compact style={{ marginTop: 8 }} />

              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button
                  onClick={() => onAcquire(e.id, acquireInto)}
                  className="mono"
                  title="Move this into the collection"
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: `1px solid ${C.accent}`,
                    color: C.accent,
                    borderRadius: 0,
                    clipPath: NOTCH_SM,
                    padding: "6px 8px",
                    fontSize: 10,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  Got it
                </button>
                <button
                  onClick={() => onRemove(e.id)}
                  aria-label={`Remove ${e.name} from wishlist`}
                  style={{
                    background: "none",
                    border: `1px solid ${C.border}`,
                    color: C.parchmentDim,
                    borderRadius: 0,
                    clipPath: NOTCH_SM,
                    padding: "6px 10px",
                    cursor: "pointer",
                    display: "flex",
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "34px 0 14px" }}>
        <h2 className="display" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.goldBright, letterSpacing: 0.5 }}>
          Cards to replace
        </h2>
        <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, letterSpacing: 0.6 }}>
          {replacing.length} owned card{replacing.length === 1 ? "" : "s"} you want a real copy of
        </span>
      </div>

      {replacing.length === 0 ? (
        <div style={{ border: `1px dashed ${C.border}`, padding: "22px 20px", color: C.parchmentDim, fontSize: 12.5 }}>
          Nothing marked. Open any card you own — a proxy, or a copy you'd rather upgrade — and tick “Want a real
          copy”. It shows up here and on the public link.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {replacing.map((c) => (
            <div
              key={c.id}
              data-replace-id={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: C.bgPanel,
                border: `1px solid ${C.border}`,
                padding: "8px 12px",
              }}
            >
              <div style={{ width: 34, flexShrink: 0, aspectRatio: "5 / 7", borderRadius: 4, overflow: "hidden" }}>
                <CardArt card={c} />
              </div>
              <div style={{ flex: "1 1 120px", minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: C.parchment, fontWeight: 600, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{c.name}</span>
                  {c.proxy && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 8.5,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                        background: C.accentFill,
                        border: `1px solid ${C.accent}`,
                        color: C.goldBright,
                        padding: "1px 6px",
                        borderRadius: 0,
                        clipPath: NOTCH_SM,
                      }}
                    >
                      Proxy
                    </span>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 10, color: C.parchmentDim, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 3 }}>
                  {c.setName || c.set || "—"}
                  {c.collectorNumber ? ` #${c.collectorNumber}` : ""}
                  {c.wantNote ? ` · ${c.wantNote}` : ""}
                </div>
              </div>
              <span className="mono" style={{ fontSize: 12, color: C.parchment, whiteSpace: "nowrap" }}>
                {fmt(priceForFinish(c) ?? 0)}
              </span>
              <button
                onClick={() => onOpenCard(c)}
                className="mono"
                style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  color: C.parchmentDim,
                  borderRadius: 0,
                  clipPath: NOTCH_SM,
                  padding: "5px 10px",
                  fontSize: 10,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Open
              </button>
              <button
                onClick={() => onUpdateCard(c.id, { wanted: false, wantNote: "" })}
                aria-label={`Take ${c.name} off the wishlist`}
                title="Take off the wishlist"
                style={{
                  background: "none",
                  border: `1px solid ${C.accent}`,
                  color: C.accent,
                  borderRadius: 0,
                  clipPath: NOTCH_SM,
                  padding: "5px 9px",
                  cursor: "pointer",
                  display: "flex",
                }}
              >
                <Heart size={13} fill={C.accent} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddWishlistModal onClose={() => setShowAdd(false)} onAdd={onAdd} />}
    </main>
  );
}
