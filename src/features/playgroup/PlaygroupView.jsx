import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { fmt } from "../../lib/format";
import { priceForFinish } from "../../lib/scryfall";
import { C, NOTCH_SM, STOCK_BG, STOCK_SHADOW } from "../../lib/tokens";
import { matchPlaygroup } from "./matching";
import { apiUrl, apiCredentials, authHeaders } from "../../lib/platform";

/*
 * The playgroup tab.
 *
 * Everyone on this server with a public handle publishes a wishlist, and can publish a
 * trade list; this reads those public pages — the same ones a stranger could
 * open — and works out who has what the others are after. It never touches
 * anyone's vault: if a page isn't shared, the
 * match simply doesn't appear.
 */

// Whose wishlist the priority came from decides how it reads — the left
// column is their list, the right column is yours.
const PRIORITY_LABEL = {
  theirs: { high: "top of their list", normal: "wanted", low: "someday" },
  mine: { high: "top of your list", normal: "wanted", low: "someday" },
};

function Note({ children }) {
  return (
    <div
      style={{
        border: `1px dashed ${C.border}`,
        padding: "26px 20px",
        color: C.parchmentDim,
        fontSize: 13,
        lineHeight: 1.6,
        maxWidth: 620,
      }}
    >
      {children}
    </div>
  );
}

function CardLine({ row, mine, whose = "theirs" }) {
  const price = row.card ? priceForFinish(row.card) : null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 0", flexWrap: "wrap" }}>
      <span className="serif" style={{ fontSize: 13, color: C.parchment, minWidth: 0, flex: "1 1 150px" }}>
        {row.name}
        {row.want > 1 && (
          <span className="mono" style={{ fontSize: 10, color: C.parchmentDim, marginLeft: 6 }}>
            wants {row.want}
          </span>
        )}
        {mine && row.onTradeList && (
          <span
            className="mono"
            title="You've marked a copy of this up for trade"
            style={{
              fontSize: 8.5,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              marginLeft: 6,
              padding: "1px 5px",
              border: `1px solid ${C.accent}`,
              color: C.accent,
              borderRadius: 3,
            }}
          >
            on your trade list
          </span>
        )}
      </span>
      <span className="mono" style={{ fontSize: 10, color: C.parchmentDim, flexShrink: 0 }}>
        {row.card?.set ? `${row.card.set.toUpperCase()} ` : ""}
        {row.have > 1 ? `×${row.have} ` : ""}
        {price !== null && price !== undefined ? fmt(price) : ""}
      </span>
      <span className="mono" style={{ fontSize: 9.5, color: row.priority === "high" ? C.accent : C.parchmentDim, flexShrink: 0 }}>
        {PRIORITY_LABEL[whose][row.priority] || ""}
      </span>
      {row.tradeNote ? (
        <div data-testid="trade-note" style={{ flexBasis: "100%", fontSize: 11.5, color: C.parchmentDim, fontStyle: "italic", marginTop: -1 }}>
          “{row.tradeNote}”
        </div>
      ) : null}
    </div>
  );
}

function Column({ title, blurb, rows, mine, whose }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        className="mono"
        style={{ fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: rows.length ? C.accent : C.parchmentDim, marginBottom: 5 }}
      >
        {title} · {rows.length}
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: C.parchmentDim, fontStyle: "italic" }}>{blurb}</div>
      ) : (
        rows.map((r) => <CardLine key={`${r.name}-${r.card?.id || ""}`} row={r} mine={mine} whose={whose} />)
      )}
    </div>
  );
}

export function PlaygroupView({ cards, wishlist, profileName, publicTrade, onOpenSettings }) {
  const [state, setState] = useState("loading"); // loading | ready | error
  const [others, setOthers] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    setState("loading");
    setError("");
    try {
      const res = await fetch(apiUrl("/api/profiles"), { credentials: apiCredentials(), headers: authHeaders() });
      if (!res.ok) throw new Error(`profiles ${res.status}`);
      const d = await res.json();
      const names = (d.profiles || []).filter((n) => n !== profileName).slice(0, 25);
      const loaded = [];
      for (const name of names) {
        try {
          const r = await fetch(apiUrl(`/api/public/wishlist/${encodeURIComponent(name)}`));
          if (!r.ok) continue;
          const payload = await r.json();
          loaded.push({
            profile: name,
            wishlist: payload.wishlist || [],
            trade: payload.trade || [],
            vaultOpen: !!payload.vaultOpen,
          });
        } catch (e) {
          // one unreachable profile shouldn't take the page down
        }
      }
      setOthers(loaded);
      setState("ready");
    } catch (e) {
      setError(e.message || "Couldn't reach the server.");
      setState("error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileName]);

  const matches = useMemo(
    () => matchPlaygroup({ myCards: cards, myWishlist: wishlist, others }),
    [cards, wishlist, others]
  );
  const withSomething = matches.filter((m) => m.total > 0);
  const myTradeCount = cards.filter((c) => c.forTrade && !c.sold).length;

  return (
    <main style={{ padding: "8px clamp(14px, 4vw, 28px) 48px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "18px 0 6px" }}>
        <h2 className="display" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.goldBright, letterSpacing: 0.5 }}>
          Your playgroup
        </h2>
        <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, letterSpacing: 0.6 }}>
          {others.length} other profile{others.length === 1 ? "" : "s"} on this server
          {withSomething.length > 0 ? ` · ${withSomething.length} with a match` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={load}
          className="mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: `1px solid ${C.border}`,
            color: C.parchmentDim,
            clipPath: NOTCH_SM,
            padding: "7px 12px",
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0, lineHeight: 1.6, maxWidth: 700 }}>
        Read from the pages everyone here already publishes — their wishlist, and their trade list if
        they share one. Nobody's vault or prices paid are involved: if a page isn't shared, the
        match just doesn't appear.
      </p>

      {!profileName && (
        <div
          style={{
            border: `1px solid ${C.accent}`,
            background: "rgba(111,166,209,0.07)",
            padding: "10px 12px",
            marginBottom: 16,
            fontSize: 12.5,
            color: C.parchment,
            lineHeight: 1.55,
            maxWidth: 700,
          }}
        >
          You don't have a public handle yet, so nobody can see your wishlist here.{" "}
          <button
            onClick={onOpenSettings}
            style={{ background: "none", border: "none", color: C.accent, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 12.5 }}
          >
            Pick one in Settings
          </button>{" "}
          to take part.
        </div>
      )}

      {profileName && !publicTrade && (
        <div
          style={{
            border: `1px solid ${C.accent}`,
            background: "rgba(111,166,209,0.07)",
            padding: "10px 12px",
            marginBottom: 16,
            fontSize: 12.5,
            color: C.parchment,
            lineHeight: 1.55,
            maxWidth: 700,
          }}
        >
          Your own trade list isn't shared, so the others see nothing coming back the other way. You
          have {myTradeCount} card{myTradeCount === 1 ? "" : "s"} marked up for trade —{" "}
          <button
            onClick={onOpenSettings}
            style={{ background: "none", border: "none", color: C.accent, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 12.5 }}
          >
            share the list in Settings
          </button>{" "}
          and matching works in both directions.
        </div>
      )}

      {state === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.parchmentDim, fontSize: 13.5, marginTop: 20 }}>
          <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
          Reading everyone's lists…
        </div>
      )}

      {state === "error" && (
        <div style={{ color: C.redBright, fontSize: 13, marginTop: 20 }}>
          Couldn't reach the server ({error}).
        </div>
      )}

      {state === "ready" && others.length === 0 && (
        <Note>
          Playgroup matching works between people on this server who've picked a public handle. When a
          friend does and puts a card on their wishlist, they'll show up here.
        </Note>
      )}

      {state === "ready" && others.length > 0 && withSomething.length === 0 && (
        <Note>
          Nobody's wishlist overlaps with what you own, and nothing on their trade lists is on
          yours. It'll fill in as the lists change.
        </Note>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(420px, 100%), 1fr))", gap: 16 }}>
        {withSomething.map((m) => (
          <div
            key={m.profile}
            data-role="playgroup-match"
            style={{ border: `1px solid ${m.twoWay ? C.accent : C.border}`, background: C.bgPanel, padding: "12px 14px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10, flexWrap: "wrap" }}>
              <span className="serif" style={{ fontSize: 16, fontWeight: 600, color: C.goldBright }}>
                {m.profile}
              </span>
              {m.twoWay && (
                <span
                  className="mono"
                  title="You each have something the other is after"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 9,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: C.goldBright,
                    background: C.accentFill,
                    border: `1px solid ${C.accent}`,
                    clipPath: NOTCH_SM,
                    padding: "2px 7px",
                  }}
                >
                  <ArrowLeftRight size={10} /> Swap
                </span>
              )}
              <span style={{ flex: 1 }} />
              <a
                href={`/w/${encodeURIComponent(m.profile)}`}
                target="_blank"
                rel="noreferrer"
                className="mono"
                style={{ fontSize: 9.5, letterSpacing: 0.8, textTransform: "uppercase", color: C.parchmentDim, textDecoration: "none" }}
              >
                their list <ExternalLink size={9} style={{ verticalAlign: "-1px" }} />
              </a>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 16 }}>
              <Column
                title={`${m.profile} wants, you have`}
                blurb="Nothing on their list is in your collection."
                rows={m.theyWant}
                mine
                whose="theirs"
              />
              <Column
                title="You want, they'll trade"
                blurb={
                  m.sharesTrade
                    ? "Nothing on their trade list is on your wishlist."
                    : "They haven't shared a trade list."
                }
                rows={m.youWant}
                whose="mine"
              />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
