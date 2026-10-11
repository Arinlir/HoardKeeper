import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, Heart, Loader2, X } from "lucide-react";
import { BuyLinks } from "../../components/ui/BuyLinks";
import { CUR, fmt } from "../../lib/format";
import { FORMATS, formatMeta } from "../../lib/formats";
import { priceForFinish } from "../../lib/scryfall";
import { MarketPrices } from "../../components/ui/MarketPrices";
import { C, ROOT_BG, STOCK_BG, STOCK_SHADOW, NOTCH_SM } from "../../lib/tokens";
import { matchQuery, parseQuery } from "../collection/query";
import { CardArt } from "../collection/CardTile";
import { Chip } from "../../components/ui/Chip";
import { useBackdropClose } from "../../components/ui/ModalShell";
import { childrenOf, parentIdOf, scopeIds, topLevel } from "../../lib/collectionTree";
import { deckCategories } from "../decks/categories";
import { fetchSetInfo } from "../sets/rosterUtils";
import { apiUrl } from "../../lib/platform";

/*
 * /v/<profile> — someone else's collection, read-only.
 *
 * The second address in Binderwyrm that renders without a profile, a PIN or
 * any stored state (the wishlist was the first). It shows what the server's
 * allow-list hands over — the cards, what they're worth today, and the decks —
 * and there is deliberately no way to change anything from here: no steppers,
 * no add, no settings, no save path at all.
 *
 * Everything about the owner's books stays behind the PIN: what they paid,
 * their collection totals, their gain, their value history, where a card is
 * kept, and anything they sold. See public-vault.cjs for the actual list.
 */

const SORTS = [
  { key: "value", label: "Most valuable" },
  { key: "name", label: "A–Z" },
  { key: "set", label: "By set" },
];

function valueOf(card) {
  // A proxy is a placeholder, not a possession worth anything — the same rule
  // the owner's own totals use.
  if (card.proxy) return 0;
  return priceForFinish(card) ?? 0;
}

function Tile({ card, onOpen }) {
  const price = valueOf(card);
  return (
    <button
      onClick={() => onOpen(card)}
      style={{
        minWidth: 0,
        background: "none",
        border: "none",
        padding: 0,
        textAlign: "left",
        cursor: "pointer",
        display: "block",
        width: "100%",
      }}
      aria-label={`Look at ${card.name}`}
    >
      <div
        style={{
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
          background: "#0C0E10",
          aspectRatio: "5 / 7",
          boxShadow: "0 10px 20px -8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)",
        }}
      >
        <CardArt card={card} />
        {(card.quantity || 1) > 1 && (
          <div
            className="mono"
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: STOCK_BG,
              clipPath: NOTCH_SM,
              padding: "1px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: C.stockInk,
            }}
          >
            x{card.quantity}
          </div>
        )}
        <div
          className="mono"
          style={{
            position: "absolute",
            bottom: 6,
            left: 6,
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            maxWidth: "calc(100% - 12px)",
          }}
        >
          {card.set && (
            <span
              style={{
                background: "rgba(10,11,13,0.82)",
                border: "1px solid rgba(232,236,241,0.25)",
                borderRadius: 3,
                padding: "1px 6px",
                fontSize: 9,
                letterSpacing: 0.4,
                color: C.parchment,
                textTransform: "uppercase",
              }}
            >
              {card.set.toUpperCase()}
              {card.collectorNumber ? ` #${card.collectorNumber}` : ""}
            </span>
          )}
          {card.finish && card.finish !== "nonfoil" && (
            <span
              style={{
                background: "rgba(10,11,13,0.82)",
                border: `1px solid ${C.accent}`,
                borderRadius: 3,
                padding: "1px 6px",
                fontSize: 9,
                letterSpacing: 0.4,
                color: C.accent,
                textTransform: "uppercase",
              }}
            >
              {card.finish}
            </span>
          )}
          {card.proxy && (
            <span
              style={{
                background: C.accentFill,
                border: `1px solid ${C.accent}`,
                borderRadius: 3,
                padding: "1px 6px",
                fontSize: 9,
                letterSpacing: 0.8,
                fontWeight: 700,
                color: C.goldBright,
                textTransform: "uppercase",
              }}
            >
              Proxy
            </span>
          )}
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
          clipPath: NOTCH_SM,
          color: C.stockInk,
          boxShadow: STOCK_SHADOW,
        }}
      >
        <span
          className="serif"
          title={card.name}
          style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}
        >
          {card.name}
        </span>
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
          {card.proxy ? "—" : fmt(price)}
        </span>
      </div>
    </button>
  );
}

// A closer look at one card: the big art (flippable, for two-sided cards),
// what it is, and where to buy one yourself.
function CardOverlay({ card, onClose }) {
  const backdropProps = useBackdropClose(onClose);
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      {...backdropProps}
      role="dialog"
      aria-label={card.name}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,9,11,0.86)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bgPanel,
          border: `1px solid ${C.border}`,
          padding: 18,
          width: "min(420px, 100%)",
          maxHeight: "94vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="serif" style={{ fontSize: 17, fontWeight: 600, color: C.goldBright }}>
              {card.name}
            </div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: C.parchmentDim, marginTop: 3 }}>
              {card.setName || card.set} {card.collectorNumber ? `#${card.collectorNumber}` : ""} · {card.rarity}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.parchmentDim, cursor: "pointer", padding: 5, display: "flex" }}
          >
            <X size={14} />
          </button>
        </div>
        <div style={{ borderRadius: 11, overflow: "hidden", aspectRatio: "5 / 7", background: "#0C0E10", position: "relative" }}>
          <CardArt card={card} large flippable />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12, fontSize: 12.5, color: C.parchmentDim }}>
          <span>{card.typeLine}</span>
          <span className="mono" style={{ color: C.goldBright, flexShrink: 0 }}>
            {card.proxy ? "Proxy — no value" : fmt(valueOf(card))}
          </span>
        </div>
        {!card.proxy && <MarketPrices card={card} style={{ marginTop: 10, marginBottom: 0 }} />}
        {card.forTrade && card.tradeNote ? (
          <div data-testid="trade-note" style={{ marginTop: 10, fontSize: 12.5, color: C.parchment, lineHeight: 1.5 }}>
            <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.accent, marginRight: 6 }}>
              Up for trade
            </span>
            {card.tradeNote}
          </div>
        ) : null}
        <BuyLinks card={card} compact style={{ marginTop: 12 }} />
      </div>
    </div>
  );
}

function SetsPanel({ cards }) {
  // Proxies don't fill a slot, exactly as in the owner's own Sets view.
  const bySet = useMemo(() => {
    const m = {};
    cards
      .filter((c) => c.set && !c.proxy)
      .forEach((c) => {
        const k = c.set.toLowerCase();
        if (!m[k]) m[k] = { code: k, setName: c.setName || k.toUpperCase(), cards: [] };
        m[k].cards.push(c);
      });
    return Object.values(m)
      .map((s) => ({
        ...s,
        distinct: new Set(s.cards.map((c) => c.collectorNumber || c.name)).size,
        copies: s.cards.reduce((n, c) => n + (c.quantity || 1), 0),
        value: s.cards.reduce((n, c) => n + valueOf(c) * (c.quantity || 1), 0),
      }))
      .sort((a, b) => b.value - a.value);
  }, [cards]);

  const [infos, setInfos] = useState({});
  useEffect(() => {
    let live = true;
    (async () => {
      for (const s of bySet) {
        if (infos[s.code]) continue;
        try {
          const d = await fetchSetInfo(s.code);
          if (!live) return;
          setInfos((prev) => ({ ...prev, [s.code]: d }));
        } catch (e) {
          if (!live) return;
          setInfos((prev) => ({ ...prev, [s.code]: { name: s.setName, count: null } }));
        }
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bySet]);

  if (bySet.length === 0)
    return <div style={{ color: C.parchmentDim, fontSize: 13.5, marginTop: 24 }}>No sets to show.</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))", gap: 14, marginTop: 20 }}>
      {bySet.map((s) => {
        const total = infos[s.code]?.count || null;
        const pct = total ? Math.min(100, Math.round((s.distinct / total) * 100)) : null;
        return (
          <div key={s.code} style={{ border: `1px solid ${C.border}`, background: C.bgPanel, padding: "12px 14px" }}>
            <div className="serif" style={{ fontWeight: 600, fontSize: 14, color: C.goldBright, marginBottom: 2 }}>
              {infos[s.code]?.name || s.setName}
            </div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: C.parchmentDim }}>
              {s.code.toUpperCase()} · {s.copies} card{s.copies === 1 ? "" : "s"} · {fmt(s.value)}
            </div>
            <div style={{ height: 5, background: "rgba(255,255,255,0.08)", marginTop: 9 }}>
              <div style={{ width: `${pct ?? 0}%`, height: "100%", background: C.accent }} />
            </div>
            <div className="mono" style={{ fontSize: 10, color: C.parchmentDim, marginTop: 5 }}>
              {total ? `${s.distinct} of ${total} · ${pct}%` : `${s.distinct} distinct`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DecksPanel({ decks, cards, onOpenCard }) {
  const [openId, setOpenId] = useState(null);
  const byId = useMemo(() => {
    const m = {};
    cards.forEach((c) => (m[c.id] = c));
    decks.forEach((d) => (d.external || []).forEach((x) => (m[x.id] = x)));
    return m;
  }, [cards, decks]);

  if (decks.length === 0)
    return <div style={{ color: C.parchmentDim, fontSize: 13.5, marginTop: 24 }}>No decks to show.</div>;

  const deck = decks.find((d) => d.id === openId) || null;

  if (deck) {
    const commander = deck.commanderId ? byId[deck.commanderId] : null;
    const partner = deck.partnerId ? byId[deck.partnerId] : null;
    const zone = [commander, partner].filter(Boolean);
    const grouped = {};
    deck.entries.forEach((e) => {
      const c = byId[e.cardId];
      if (!c) return;
      (grouped[e.role] = grouped[e.role] || []).push({ card: c, qty: e.qty });
    });
    Object.values(grouped).forEach((list) => list.sort((a, b) => a.card.name.localeCompare(b.card.name)));
    const basicsN = Object.values(deck.basics || {}).reduce((a, b) => a + b, 0);
    const total = deck.entries.reduce((n, e) => n + e.qty, 0) + basicsN + zone.length;
    const value =
      deck.entries.reduce((n, e) => n + valueOf(byId[e.cardId] || {}) * e.qty, 0) +
      zone.reduce((n, c) => n + valueOf(c), 0);
    const meta = formatMeta(deck.format);

    return (
      <div style={{ marginTop: 20 }}>
        <button
          onClick={() => setOpenId(null)}
          className="mono"
          style={{ background: "none", border: "none", color: C.parchmentDim, fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", cursor: "pointer", padding: 0 }}
        >
          ← All decks
        </button>
        <h2 className="serif" style={{ fontSize: 21, color: C.goldBright, margin: "10px 0 4px" }}>
          {deck.name}
        </h2>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.parchmentDim }}>
          {meta?.label || deck.format} · {zone.length ? `${zone.map((c) => c.name).join(" & ")} · ` : ""}
          {total} cards · worth {fmt(value)}
        </div>

        {zone.some((c) => c.imageUrl) && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
            {zone.filter((c) => c.imageUrl).map((c) => (
              <div key={c.id} style={{ width: zone.length > 1 ? 160 : 190, borderRadius: 10, overflow: "hidden", aspectRatio: "5 / 7", background: "#0C0E10" }}>
                <CardArt card={c} large flippable />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(230px, 100%), 1fr))", gap: 16, marginTop: 18 }}>
          {deckCategories(deck)
            .filter((cat) => grouped[cat.key]?.length || (cat.key === "land" && basicsN > 0))
            .map((cat) => (
              <div key={cat.key} style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(185,191,199,0.18)", borderRadius: 10, padding: "12px 14px" }}>
                <div
                  className="mono"
                  style={{ fontSize: 9, letterSpacing: 1.6, textTransform: "uppercase", background: STOCK_BG, color: C.stockInk, padding: "3px 8px", borderRadius: 3, display: "inline-block", marginBottom: 9 }}
                >
                  {cat.label}
                </div>
                {(grouped[cat.key] || []).map(({ card, qty }) => (
                  <button
                    key={card.id}
                    onClick={() => onOpenCard(card)}
                    style={{
                      display: "flex",
                      width: "100%",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "4px 0",
                      background: "none",
                      // border last, so the hairline rule isn't reset to the
                      // browser's default 3px by the shorthand above it
                      border: "none",
                      borderBottom: "1px solid rgba(185,191,199,0.08)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span className="serif" style={{ fontSize: 12.5, color: C.parchment, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {qty > 1 ? `${qty}× ` : ""}
                      {card.name}
                      {card.notOwned && (
                        <span className="mono" style={{ fontSize: 8, letterSpacing: 0.8, marginLeft: 6, padding: "1px 5px", border: `1px solid ${C.accent}`, color: C.accent, borderRadius: 3 }}>
                          TO BUY
                        </span>
                      )}
                    </span>
                    <span className="mono" style={{ fontSize: 9.5, color: C.parchmentDim, flexShrink: 0 }}>
                      {card.cmc ?? 0}
                    </span>
                  </button>
                ))}
                {cat.key === "land" &&
                  Object.entries(deck.basics || {}).map(([basic, n]) => (
                    <div key={basic} className="mono" style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11.5, color: C.parchmentDim }}>
                      <span>{basic}</span>
                      <span>{n}×</span>
                    </div>
                  ))}
              </div>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gap: 16, marginTop: 20 }}>
      {decks.map((d) => {
        const commander = d.commanderId ? byId[d.commanderId] : null;
        const basicsN = Object.values(d.basics || {}).reduce((a, b) => a + b, 0);
        const count = d.entries.reduce((n, e) => n + e.qty, 0) + basicsN + (commander ? 1 : 0) + (d.partnerId && byId[d.partnerId] ? 1 : 0);
        return (
          <button
            key={d.id}
            onClick={() => setOpenId(d.id)}
            style={{ background: C.bgPanel, border: `1px solid ${C.border}`, padding: 0, cursor: "pointer", textAlign: "left", overflow: "hidden" }}
          >
            {commander?.imageUrl && (
              <div style={{ height: 118, overflow: "hidden", background: "#0C0E10" }}>
                <img src={commander.imageUrl} alt="" style={{ width: "100%", display: "block" }} />
              </div>
            )}
            <div style={{ padding: "10px 12px" }}>
              <div className="serif" style={{ fontWeight: 600, fontSize: 14.5, color: C.goldBright }}>
                {d.name}
              </div>
              <div className="mono" style={{ fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: C.parchmentDim, marginTop: 3 }}>
                {formatMeta(d.format)?.label || d.format} · {count} cards
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function PublicVault({ name }) {
  const [state, setState] = useState("loading"); // loading | ready | missing | error
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("cards");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("value");
  const [colFilter, setColFilter] = useState("all");
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let live = true;
    fetch(apiUrl(`/api/public/vault/${encodeURIComponent(name)}`))
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) return setState("missing");
        if (!res.ok) return setState("error");
        const d = await res.json();
        if (!live) return;
        // Show the collection in the currency its owner reads it in.
        CUR.code = d.currency || "USD";
        if (d.czkRate) CUR.czkRate = d.czkRate;
        if (d.eurRate) CUR.eurRate = d.eurRate;
        CUR.source = d.priceSource === "cardmarket" ? "cardmarket" : "tcgplayer";
        setData(d);
        setState("ready");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [name]);

  useEffect(() => {
    document.title = `${name}'s collection — Binderwyrm`;
  }, [name]);

  const cards = data?.cards || [];
  // Only present when its owner shared the trade list — see public-vault.cjs.
  const tradeCards = useMemo(() => cards.filter((c) => c.forTrade), [cards]);
  const parsed = useMemo(() => parseQuery(search), [search]);
  // The same query language the owner searches with, minus the parts that
  // depend on their private data (collections, wishlist, tags).
  const ctx = useMemo(
    () => ({
      textScope: true,
      oracleFor: () => null,
      unitValue: valueOf,
      legalityOf: (c, f) => {
        const meta = formatMeta(f);
        const packed = c.legalities || {};
        return meta ? { l: "legal", n: "not_legal", b: "banned", r: "restricted" }[packed[meta.code]] || "" : "";
      },
    }),
    []
  );

  // The owner's collections, in the order they arranged them.
  const collections = data?.collections || [];
  const tops = useMemo(() => topLevel(collections), [collections]);
  const knownIds = useMemo(() => new Set(collections.map((c) => c.id)), [collections]);
  const countIn = (ids) =>
    cards.reduce((n, c) => (ids.has(c.collectionId) ? n + 1 : n), 0);
  const hasLoose = cards.some((c) => !knownIds.has(c.collectionId));
  const selParent = colFilter === "all" || colFilter === "none" ? null : parentIdOf(collections, colFilter) || colFilter;
  const parts = selParent ? childrenOf(collections, selParent) : [];

  const shown = useMemo(() => {
    let list = search.trim() ? cards.filter((c) => matchQuery(c, parsed, ctx)) : [...cards];
    if (colFilter === "none") list = list.filter((c) => !knownIds.has(c.collectionId));
    else if (colFilter !== "all") {
      const ids = scopeIds(collections, colFilter);
      list = list.filter((c) => ids.has(c.collectionId));
    }
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "set")
      list.sort((a, b) => (a.set || "").localeCompare(b.set || "") || a.name.localeCompare(b.name));
    else list.sort((a, b) => valueOf(b) * (b.quantity || 1) - valueOf(a) * (a.quantity || 1));
    return list;
  }, [cards, parsed, ctx, search, sort, colFilter, collections, knownIds]);

  const totals = useMemo(
    () => ({
      copies: cards.reduce((n, c) => n + (c.quantity || 1), 0),
      value: cards.reduce((n, c) => n + valueOf(c) * (c.quantity || 1), 0),
      sets: new Set(cards.map((c) => (c.set || "").toLowerCase()).filter(Boolean)).size,
    }),
    [cards]
  );

  const tabBtn = (key, label) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      aria-pressed={tab === key}
      className="mono"
      style={{
        background: tab === key ? C.accentFill : "transparent",
        border: `1px solid ${tab === key ? C.accent : C.border}`,
        color: tab === key ? C.goldBright : C.parchmentDim,
        clipPath: NOTCH_SM,
        padding: "7px 14px",
        fontSize: 10.5,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: ROOT_BG, color: C.parchment, fontFamily: "'Archivo', sans-serif" }}>
      <div style={{ maxWidth: "min(1400px, 94vw)", margin: "0 auto", padding: "34px 0 60px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div aria-hidden="true" style={{ width: 22, height: 22, flexShrink: 0, background: C.accent, clipPath: NOTCH_SM }} />
          <h1 className="display" style={{ fontSize: "clamp(21px, 6vw, 28px)", margin: 0, fontWeight: 700, letterSpacing: 1.5, color: C.goldBright }}>
            BINDERWYRM
          </h1>
        </header>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: 2.4, textTransform: "uppercase", color: C.parchmentDim, marginTop: 7 }}>
          {name}'s collection · read only
        </div>

        {state === "loading" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 40, color: C.parchmentDim, fontSize: 13.5 }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            Opening the binder…
          </div>
        )}

        {state === "missing" && (
          <div style={{ marginTop: 40, fontSize: 14, color: C.parchmentDim, lineHeight: 1.6, maxWidth: 520 }}>
            There's nothing to browse at this address. Either the profile doesn't exist, or its owner
            hasn't opened their collection for guests — it's off unless they turn it on.
          </div>
        )}

        {state === "error" && (
          <div style={{ marginTop: 40, fontSize: 14, color: C.redBright, lineHeight: 1.6 }}>
            Couldn't reach the server. Try again in a moment.
          </div>
        )}

        {state === "ready" && (
          <>
            <div className="mono" style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 18, fontSize: 11, letterSpacing: 0.8, color: C.parchmentDim }}>
              <span>
                <span style={{ color: C.goldBright, fontSize: 15 }}>{totals.copies}</span> card
                {totals.copies === 1 ? "" : "s"}
              </span>
              <span>
                <span style={{ color: C.goldBright, fontSize: 15 }}>{fmt(totals.value)}</span> market value
              </span>
              <span>
                <span style={{ color: C.goldBright, fontSize: 15 }}>{totals.sets}</span> set
                {totals.sets === 1 ? "" : "s"}
              </span>
              <span>
                <span style={{ color: C.goldBright, fontSize: 15 }}>{(data.decks || []).length}</span> deck
                {(data.decks || []).length === 1 ? "" : "s"}
              </span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
              {[
                tabBtn("cards", "Cards"),
                tabBtn("sets", "Sets"),
                tabBtn("decks", "Decks"),
                ...(tradeCards.length > 0 ? [tabBtn("trade", `Trade · ${tradeCards.length}`)] : []),
              ]}
              {/* The wishlist lives on its own page; this is the door to it,
                  mirroring the wishlist page's "browse the collection" link. */}
              {data.wishlistCount > 0 && (
                <a
                  href={`/w/${encodeURIComponent(name)}`}
                  data-testid="wishlist-link"
                  className="mono"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginLeft: "auto",
                    background: "transparent",
                    border: `1px solid ${C.accent}`,
                    color: C.accent,
                    clipPath: NOTCH_SM,
                    padding: "7px 14px",
                    fontSize: 10.5,
                    letterSpacing: 1.2,
                    textTransform: "uppercase",
                    textDecoration: "none",
                  }}
                >
                  <Heart size={11} />
                  Wishlist · {data.wishlistCount}
                </a>
              )}
            </div>

            {tab === "cards" && (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
                  <input
                    className="pv-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search — name, t:creature, c:rg, cmc<=3, is:foil…"
                    aria-label="Search this collection"
                    style={{
                      flex: "1 1 220px",
                      minWidth: 0,
                      background: C.bgPanel2,
                      border: `1px solid ${C.border}`,
                      padding: "9px 12px",
                      color: C.parchment,
                      fontSize: 13,
                    }}
                  />
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    aria-label="Sort cards"
                    style={{ background: C.bgPanel2, border: `1px solid ${C.border}`, color: C.parchment, fontSize: 13, padding: "9px 10px" }}
                  >
                    {SORTS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                {collections.length > 0 && (
                  <div data-testid="pv-collections" style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Chip label={`All (${cards.length})`} active={colFilter === "all"} onClick={() => setColFilter("all")} />
                      {tops.map((t) => (
                        <Chip
                          key={t.id}
                          label={`${t.name} (${countIn(scopeIds(collections, t.id))})`}
                          active={colFilter === t.id}
                          partial={selParent === t.id && colFilter !== t.id}
                          onClick={() => setColFilter(t.id)}
                        />
                      ))}
                      {hasLoose && (
                        <Chip
                          label={`Uncategorized (${cards.filter((c) => !knownIds.has(c.collectionId)).length})`}
                          active={colFilter === "none"}
                          onClick={() => setColFilter("none")}
                        />
                      )}
                    </div>
                    {parts.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, marginLeft: 14 }}>
                        <Chip label="All" active={colFilter === selParent} onClick={() => setColFilter(selParent)} />
                        {parts.map((p) => (
                          <Chip
                            key={p.id}
                            label={`${p.name} (${countIn(new Set([p.id]))})`}
                            active={colFilter === p.id}
                            onClick={() => setColFilter(p.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, marginTop: 10, letterSpacing: 0.6 }}>
                  Showing {shown.length} of {cards.length} different card
                  {cards.length === 1 ? "" : "s"}
                </div>
                {shown.length === 0 ? (
                  <div style={{ marginTop: 24, fontSize: 13.5, color: C.parchmentDim }}>
                    Nothing matches that search.
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 100%), 1fr))", gap: 20, marginTop: 16 }}>
                    {shown.map((c) => (
                      <Tile key={c.id} card={c} onOpen={setOpen} />
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === "trade" && (
              <>
                <div style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 16, maxWidth: 620, lineHeight: 1.6 }}>
                  Spare copies {name} is happy to trade away. Prices are today's market rates, for
                  reference.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 100%), 1fr))", gap: 20, marginTop: 16 }}>
                  {tradeCards.map((c) => (
                    <Tile key={c.id} card={c} onOpen={setOpen} />
                  ))}
                </div>
              </>
            )}

            {tab === "sets" && <SetsPanel cards={cards} />}
            {tab === "decks" && <DecksPanel decks={data.decks || []} cards={cards} onOpenCard={setOpen} />}
          </>
        )}

        {open && <CardOverlay card={open} onClose={() => setOpen(null)} />}

        <footer
          className="mono"
          style={{
            marginTop: 50,
            paddingTop: 16,
            borderTop: `1px solid ${C.border}`,
            fontSize: 9.5,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: C.parchmentDim,
            lineHeight: 1.8,
          }}
        >
          A Binderwyrm collection, shared read-only · prices paid, totals, gain and history stay private
          {" · "}
          <a href={`/w/${encodeURIComponent(name)}`} style={{ color: C.accent, textDecoration: "none" }}>
            wishlist <ExternalLink size={9} style={{ verticalAlign: "-1px" }} />
          </a>
        </footer>
      </div>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .display { font-family: 'Cinzel', serif; }
        .serif { font-family: 'Spectral', serif; }
        a:hover { color: ${C.accent} !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
