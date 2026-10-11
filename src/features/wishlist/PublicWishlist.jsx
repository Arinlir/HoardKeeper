import React, { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { CUR, fmt } from "../../lib/format";
import { priceForFinish } from "../../lib/scryfall";
import { C, ROOT_BG, STOCK_BG, STOCK_SHADOW, NOTCH, NOTCH_SM } from "../../lib/tokens";
import { CardArt } from "../collection/CardTile";
import { MarketPrices } from "../../components/ui/MarketPrices";
import { buyLinks } from "../../lib/buyLinks";
import { apiUrl } from "../../lib/platform";

const PRIORITY_LABEL = { high: "Top of the list", normal: "Wanted", low: "Someday" };

const cardmarketUrl = (name) =>
  `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(name)}`;

function Entry({ e, replacing, trading }) {
  const price = priceForFinish(e) ?? e.usd ?? null;
  return (
    <div style={{ minWidth: 0 }}>
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
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            maxWidth: "calc(100% - 12px)",
          }}
        >
          <span
            style={{
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
          </span>
          {e.finish && e.finish !== "nonfoil" && (
            <span
              style={{
                background: "rgba(10,11,13,0.82)",
                border: `1px solid rgba(201,162,39,0.5)`,
                borderRadius: 3,
                padding: "1px 6px",
                fontSize: 9,
                letterSpacing: 0.4,
                color: C.goldBright,
                textTransform: "uppercase",
              }}
            >
              {e.finish}
            </span>
          )}
          {replacing && e.proxy && (
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
              Playing a proxy
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
          {price !== null ? fmt(price) : "—"}
        </span>
      </div>

      {/* Both markets, so a visitor from either side of the Atlantic reads
          the price they'd actually pay. */}
      <MarketPrices card={e} compact style={{ marginTop: 6 }} />

      {/* A want-priority means nothing on a card being offered. */}
      {!trading && <div
        className="mono"
        style={{
          marginTop: 6,
          fontSize: 9.5,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: e.priority === "high" ? C.accent : C.parchmentDim,
        }}
      >
        {PRIORITY_LABEL[e.priority] || PRIORITY_LABEL.normal}
      </div>}

      {e.note && (
        <div style={{ marginTop: 5, fontSize: 12, color: C.parchmentDim, lineHeight: 1.45 }}>{e.note}</div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 7 }}>
        <a
          href={cardmarketUrl(e.name)}
          target="_blank"
          rel="noreferrer"
          className="mono"
          style={{ fontSize: 9.5, letterSpacing: 0.6, textTransform: "uppercase", color: C.parchmentDim, textDecoration: "none" }}
        >
          Cardmarket <ExternalLink size={9} style={{ verticalAlign: "-1px" }} />
        </a>
        <a
          href={buyLinks(e).find((l) => l.key === "tcgplayer")?.url}
          target="_blank"
          rel="noreferrer"
          className="mono"
          style={{ fontSize: 9.5, letterSpacing: 0.6, textTransform: "uppercase", color: C.parchmentDim, textDecoration: "none" }}
        >
          TCGplayer <ExternalLink size={9} style={{ verticalAlign: "-1px" }} />
        </a>
        {/^https:\/\/scryfall\.com\//i.test(e.scryfallUri || "") && (
          <a
            href={e.scryfallUri}
            target="_blank"
            rel="noreferrer"
            className="mono"
            style={{ fontSize: 9.5, letterSpacing: 0.6, textTransform: "uppercase", color: C.parchmentDim, textDecoration: "none" }}
          >
            Scryfall <ExternalLink size={9} style={{ verticalAlign: "-1px" }} />
          </a>
        )}
      </div>
    </div>
  );
}

function Section({ title, blurb, entries, replacing, trading }) {
  if (entries.length === 0) return null;
  return (
    <section style={{ marginTop: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.goldBright, letterSpacing: 0.5 }}>
          {title}
        </h2>
        <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, letterSpacing: 0.6 }}>
          {entries.length} card{entries.length === 1 ? "" : "s"}
        </span>
        <span style={{ flex: 1, height: 1, background: "rgba(185,191,199,0.15)" }} />
      </div>
      {blurb && <div style={{ fontSize: 12.5, color: C.parchmentDim, marginBottom: 14 }}>{blurb}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 100%), 1fr))", gap: 20 }}>
        {entries.map((e) => (
          <Entry key={e.id} e={e} replacing={replacing} trading={trading} />
        ))}
      </div>
    </section>
  );
}

// The one screen in Binderwyrm that renders without a profile, a PIN or any
// stored state: it asks the server for one profile's wishlist and shows it.
// Everything it can display is what /api/public/wishlist chose to hand over,
// so there is nothing here to leak even if someone guesses a profile name.
export function PublicWishlist({ name }) {
  const [state, setState] = useState("loading"); // loading | ready | missing | error
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    fetch(apiUrl(`/api/public/wishlist/${encodeURIComponent(name)}`))
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) return setState("missing");
        if (!res.ok) return setState("error");
        const d = await res.json();
        if (!live) return;
        // Prices are stored in USD; show them in whatever currency the list's
        // owner reads their own collection in.
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
    document.title = `${name}'s wishlist — Binderwyrm`;
  }, [name]);

  const wishlist = data?.wishlist || [];
  const replacing = data?.replacing || [];
  const trade = data?.trade || [];
  const empty = state === "ready" && wishlist.length === 0 && replacing.length === 0 && trade.length === 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: ROOT_BG,
        color: C.parchment,
        fontFamily: "'Archivo', sans-serif",
      }}
    >
      <div style={{ maxWidth: "min(1400px, 94vw)", margin: "0 auto", padding: "34px 0 60px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div aria-hidden="true" style={{ width: 22, height: 22, flexShrink: 0, background: C.accent, clipPath: NOTCH_SM }} />
          <h1
            className="display"
            style={{ fontSize: "clamp(21px, 6vw, 28px)", margin: 0, fontWeight: 700, letterSpacing: 1.5, color: C.goldBright }}
          >
            BINDERWYRM
          </h1>
        </header>
        <div
          className="mono"
          style={{ fontSize: 10.5, letterSpacing: 2.4, textTransform: "uppercase", color: C.parchmentDim, marginTop: 7 }}
        >
          {name}'s wishlist
        </div>

        {state === "loading" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 40, color: C.parchmentDim, fontSize: 13.5 }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            Fetching the list…
          </div>
        )}

        {state === "missing" && (
          <div style={{ marginTop: 40, fontSize: 14, color: C.parchmentDim, lineHeight: 1.6 }}>
            There's no wishlist at this address. Check the link — profile names are lowercase, letters, digits,
            dashes and underscores only.
          </div>
        )}

        {state === "error" && (
          <div style={{ marginTop: 40, fontSize: 14, color: C.redBright, lineHeight: 1.6 }}>
            Couldn't reach the server. Try again in a moment.
          </div>
        )}

        {empty && (
          <div style={{ marginTop: 40, fontSize: 14, color: C.parchmentDim }}>
            This wishlist is empty right now.
          </div>
        )}

        {state === "ready" && (
          <>
            <Section
              title="Looking for"
              entries={wishlist}
              blurb="Cards not in the collection yet. Prices are current market rates, for reference only."
            />
            <Section
              title="Up for trade"
              entries={data?.trade || []}
              trading
              blurb="Spare copies going free to a good deck — say the word and they're yours."
            />
            <Section
              title="Playing a stand-in"
              entries={replacing}
              replacing
              blurb="Already in the deck, but as a proxy or a copy worth upgrading — a real one would replace it."
            />
          </>
        )}

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
          }}
        >
          A Binderwyrm wishlist · prices paid and totals stay private
          {data?.vaultOpen && (
            <>
              {" · "}
              <a href={`/v/${encodeURIComponent(name)}`} style={{ color: C.accent, textDecoration: "none" }}>
                browse the collection <ExternalLink size={9} style={{ verticalAlign: "-1px" }} />
              </a>
            </>
          )}
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
