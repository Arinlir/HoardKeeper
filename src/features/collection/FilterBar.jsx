import React, { useMemo } from "react";
import { CheckSquare, Grid3x3, LayoutGrid, Maximize2, Search } from "lucide-react";
import { Chip } from "../../components/ui/Chip";
import { MANA } from "../../lib/mana";
import { SOLD, TYPE_FILTERS, UNCATEGORIZED } from "../../lib/scryfall";
import { C } from "../../lib/tokens";

export function FilterBar({ collections, cards, active, setActive, search, setSearch, sortBy, setSortBy, typeFilter, setTypeFilter, colorFilter, setColorFilter, selectMode, onToggleSelectMode, tileSize, setTileSize }) {
  const counts = useMemo(() => {
    const m = {};
    cards.filter((c) => !c.sold).forEach((c) => {
      const k = c.collectionId || UNCATEGORIZED;
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [cards]);
  const soldCount = useMemo(() => cards.filter((c) => c.sold).length, [cards]);
  const heldCount = useMemo(() => cards.filter((c) => !c.sold).length, [cards]);

  return (
    <div
      style={{
        padding: "14px clamp(14px, 4vw, 28px)",
        display: "flex",
        gap: 14,
        alignItems: "center",
        flexWrap: "wrap",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      {/* Collection chips always own their full row. Without this, once
          the chip list wraps onto a second line, flexbox can still judge
          there's "just enough" room to squeeze the color pips onto that
          same line — which is exactly what crowded the collection names
          against the color dots. Giving this group flex-basis:100% makes
          that impossible regardless of how many collections exist or how
          long their names are. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexBasis: "100%" }}>
        <Chip label={`All (${heldCount})`} active={active === "all"} onClick={() => setActive("all")} />
        {collections.map((col) => (
          <Chip
            key={col.id}
            label={`${col.name} (${counts[col.id] || 0})`}
            active={active === col.id}
            onClick={() => setActive(col.id)}
          />
        ))}
        {soldCount > 0 && (
          <Chip
            label={`Sold (${soldCount})`}
            active={active === SOLD}
            onClick={() => setActive(SOLD)}
          />
        )}
        {counts[UNCATEGORIZED] > 0 && (
          <Chip
            label={`Uncategorized (${counts[UNCATEGORIZED]})`}
            active={active === UNCATEGORIZED}
            onClick={() => setActive(UNCATEGORIZED)}
          />
        )}
      </div>

      {/* color pips — actual mana colors as the buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {[
          { k: "W", c: MANA.W, t: "White" },
          { k: "U", c: MANA.U, t: "Blue" },
          { k: "B", c: MANA.B, t: "Black" },
          { k: "R", c: MANA.R, t: "Red" },
          { k: "G", c: MANA.G, t: "Green" },
          { k: "M", c: "#C9A227", t: "Multicolor" },
          { k: "C", c: "#8C8878", t: "Colorless" },
        ].map((p) => {
          const on = colorFilter === p.k;
          return (
            <button
              key={p.k}
              title={p.t}
              aria-label={p.t}
              aria-pressed={on}
              onClick={() => setColorFilter(on ? "all" : p.k)}
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: p.c,
                border: "none",
                cursor: "pointer",
                boxShadow: on
                  ? `0 0 0 2px ${C.bg}, 0 0 0 3.5px ${C.goldBright}`
                  : "inset 0 0 0 1px rgba(0,0,0,0.4)",
                opacity: colorFilter === "all" || on ? 1 : 0.35,
                transition: "opacity 0.12s ease, box-shadow 0.12s ease",
                padding: 0,
              }}
            />
          );
        })}
      </div>

      <select
        value={typeFilter}
        onChange={(e) => setTypeFilter(e.target.value)}
        aria-label="Filter by card type"
        style={{
          background: C.bgPanel2,
          border: `1px solid ${typeFilter !== "all" ? C.goldBright : C.border}`,
          borderRadius: 10,
          padding: "8px 10px",
          color: typeFilter !== "all" ? C.goldBright : C.parchment,
          fontSize: 13,
        }}
      >
        <option value="all">All types</option>
        {TYPE_FILTERS.map((t) => (
          <option key={t} value={t}>
            {t}s
          </option>
        ))}
      </select>

      <div style={{ position: "relative" }}>
        <Search
          size={14}
          color={C.parchmentDim}
          style={{ position: "absolute", left: 10, top: 10 }}
        />
        <input
          type="search"
          autoComplete="off"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cards..."
          aria-label="Search cards"
          style={{
            background: C.bgPanel2,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "8px 10px 8px 30px",
            color: C.parchment,
            fontSize: 13,
            width: 180,
          }}
        />
      </div>

      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value)}
        aria-label="Sort cards by"
        style={{
          background: C.bgPanel2,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "8px 10px",
          color: C.parchment,
          fontSize: 13,
        }}
      >
        <option value="added">Recently added</option>
        <option value="name">Name (A-Z)</option>
        <option value="value-desc">Value (high to low)</option>
        <option value="value-asc">Value (low to high)</option>
        <option value="gain">Biggest gainers</option>
        <option value="alpha-grouped">A–Z, grouped</option>
        <option value="rarity-grouped">Rarity, grouped</option>
      </select>

      <button
        onClick={onToggleSelectMode}
        aria-pressed={selectMode}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: selectMode ? C.gold : "transparent",
          color: selectMode ? C.bg : C.parchmentDim,
          border: `1px solid ${selectMode ? C.gold : C.border}`,
          borderRadius: 10,
          padding: "8px 12px",
          fontSize: 13,
          fontWeight: selectMode ? 700 : 500,
          cursor: "pointer",
        }}
      >
        <CheckSquare size={15} />
        {selectMode ? "Done" : "Select"}
      </button>

      {/* card tile size — persisted, since low-res thumbnails at the default
          density are genuinely hard to read without opening the card */}
      <div
        title="Card size"
        style={{
          display: "flex",
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {[
          { key: "compact", icon: <Grid3x3 size={13} /> },
          { key: "comfortable", icon: <LayoutGrid size={13} /> },
          { key: "large", icon: <Maximize2 size={13} /> },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTileSize(t.key)}
            title={t.key.charAt(0).toUpperCase() + t.key.slice(1)}
            aria-label={`${t.key} tile size`}
            aria-pressed={tileSize === t.key}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 9px",
              background: tileSize === t.key ? C.gold : "transparent",
              color: tileSize === t.key ? C.bg : C.parchmentDim,
              border: "none",
              cursor: "pointer",
            }}
          >
            {t.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

