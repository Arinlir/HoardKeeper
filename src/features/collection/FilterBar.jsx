import React, { useMemo, useState } from "react";
import { CheckSquare, CornerDownRight, Grid3x3, HelpCircle, Layers, LayoutGrid, Loader2, Maximize2, Search } from "lucide-react";
import { Chip } from "../../components/ui/Chip";
import { MANA } from "../../lib/mana";
import { PROXY, SOLD, TYPE_FILTERS, UNCATEGORIZED } from "../../lib/scryfall";
import { C, NOTCH_SM } from "../../lib/tokens";
import { QUERY_HELP } from "./query";
import { childrenOf, parentIdOf, topLevel } from "../../lib/collectionTree";

export function FilterBar({ collections, cards, active, setActive, search, setSearch, sortBy, setSortBy, typeFilter, setTypeFilter, colorFilter, setColorFilter, searchScope, setSearchScope, textScan, selectMode, onToggleSelectMode, tileSize, setTileSize }) {
  const counts = useMemo(() => {
    const m = {};
    cards.filter((c) => !c.sold).forEach((c) => {
      const k = c.collectionId || UNCATEGORIZED;
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [cards]);
  // Only top-level collections get a chip in the main row; each one's count
  // includes whatever sits inside it. Sub-collections appear in a second row
  // once their parent (or one of them) is picked.
  const tops = useMemo(() => topLevel(collections), [collections]);
  const kids = useMemo(() => {
    const m = {};
    tops.forEach((t) => (m[t.id] = childrenOf(collections, t.id)));
    return m;
  }, [collections, tops]);
  const rollup = (id) => (counts[id] || 0) + (kids[id] || []).reduce((n, k) => n + (counts[k.id] || 0), 0);
  // Which top-level collection's sub-row is open: the active one, or the
  // parent of the active sub-collection.
  const openParent = kids[active]?.length ? active : parentIdOf(collections, active);
  const soldCount = useMemo(() => cards.filter((c) => c.sold).length, [cards]);
  const proxyCount = useMemo(() => cards.filter((c) => !c.sold && c.proxy).length, [cards]);
  const heldCount = useMemo(() => cards.filter((c) => !c.sold).length, [cards]);
  // The query language is discoverable or it may as well not exist.
  const [showSyntax, setShowSyntax] = useState(false);

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
        {tops.map((col) => (
          <Chip
            key={col.id}
            testId={`collection-chip-${col.id}`}
            label={
              kids[col.id]?.length ? (
                <>
                  <Layers size={11} style={{ verticalAlign: "-1px", marginRight: 5 }} aria-hidden="true" />
                  {`${col.name} (${rollup(col.id)})`}
                </>
              ) : (
                `${col.name} (${rollup(col.id)})`
              )
            }
            active={active === col.id}
            partial={openParent === col.id && active !== col.id}
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
        {proxyCount > 0 && (
          <Chip
            label={`Proxies (${proxyCount})`}
            active={active === PROXY}
            onClick={() => setActive(PROXY)}
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

      {openParent && kids[openParent]?.length > 0 && (
        <div
          data-testid="subcollection-row"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", flexBasis: "100%", alignItems: "center", marginTop: -4 }}
        >
          <CornerDownRight size={14} color={C.parchmentDim} aria-hidden="true" style={{ marginLeft: 4 }} />
          <Chip
            label={`All (${rollup(openParent)})`}
            active={active === openParent}
            onClick={() => setActive(openParent)}
          />
          {kids[openParent].map((k) => (
            <Chip
              key={k.id}
              testId={`collection-chip-${k.id}`}
              label={`${k.name} (${counts[k.id] || 0})`}
              active={active === k.id}
              onClick={() => setActive(k.id)}
            />
          ))}
        </div>
      )}

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

      <div style={{ position: "relative", flex: "1 1 140px", minWidth: 120 }}>
        <Search
          size={14}
          color={C.parchmentDim}
          style={{ position: "absolute", left: 10, top: 10 }}
        />
        <input
          className="search-input"
          type="search"
          autoComplete="off"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            searchScope === "text"
              ? "Search name, rules text, or t: c: cmc<=3…"
              : "Search card names, or t: c: cmc<=3…"
          }
          aria-label={searchScope === "text" ? "Search card names and rules text" : "Search card names"}
          style={{
            background: C.bgPanel2,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "8px 12px 8px 30px",
            color: C.parchment,
            fontSize: 13,
            width: "100%",
          }}
        />
        {/* What the box searches. "Text" also matches the words printed on the
            card — the rules text is already cached locally for the glossary and
            the card zoom, so searching it needs no extra data for any card
            you've already looked at. */}
        <button
          onClick={() => setSearchScope(searchScope === "text" ? "name" : "text")}
          aria-pressed={searchScope === "text"}
          title={
            searchScope === "text"
              ? "Searching card names and rules text — click for names only"
              : "Searching card names only — click to include rules text"
          }
          className="mono"
          style={{
            position: "absolute",
            right: 5,
            top: 5,
            height: 24,
            padding: "0 8px",
            background: searchScope === "text" ? C.accentFill : "transparent",
            color: searchScope === "text" ? C.goldBright : C.parchmentDim,
            border: `1px solid ${searchScope === "text" ? C.accent : C.border}`,
            borderRadius: 0,
            clipPath: NOTCH_SM,
            fontSize: 9.5,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {textScan && <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} />}
          <span className="scope-long">{searchScope === "text" ? "Name + text" : "Name"}</span>
          <span className="scope-short">{searchScope === "text" ? "A+T" : "A"}</span>
        </button>
      </div>
      <button
        onClick={() => setShowSyntax((v) => !v)}
        aria-expanded={showSyntax}
        aria-label="Search syntax help"
        title="Search syntax — t:, o:, c:, cmc<=3, is:foil…"
        style={{
          background: showSyntax ? C.accentFill : "transparent",
          border: `1px solid ${showSyntax ? C.accent : C.border}`,
          color: showSyntax ? C.goldBright : C.parchmentDim,
          borderRadius: 10,
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <HelpCircle size={15} />
      </button>
      {showSyntax && (
        <div
          style={{
            flexBasis: "100%",
            background: C.bgPanel2,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "10px 12px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 250px), 1fr))",
            gap: "4px 16px",
          }}
        >
          <div
            className="mono"
            style={{ gridColumn: "1 / -1", fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.accent, marginBottom: 2 }}
          >
            Search syntax — click one to add it. Terms combine; plain words still search names.
          </div>
          {QUERY_HELP.map((h) => (
            <button
              key={h.q}
              onClick={() => setSearch(`${search.trim()} ${h.q}`.trim())}
              style={{
                background: "transparent",
                border: "none",
                padding: "2px 0",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                gap: 8,
                alignItems: "baseline",
                minWidth: 0,
              }}
            >
              <span className="mono" style={{ fontSize: 11, color: C.goldBright, flexShrink: 0 }}>
                {h.q}
              </span>
              <span style={{ fontSize: 11.5, color: C.parchmentDim, minWidth: 0 }}>{h.d}</span>
            </button>
          ))}
        </div>
      )}
      {textScan && (
        <div
          className="mono"
          role="status"
          aria-live="polite"
          style={{ flexBasis: "100%", fontSize: 10.5, color: C.parchmentDim, letterSpacing: 0.6 }}
        >
          Reading the rules text of {textScan.total} card{textScan.total === 1 ? "" : "s"} for the first
          time — text matches will fill in as it finishes.
        </div>
      )}

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
        <option value="code">Set + collector #</option>
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

