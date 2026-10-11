import React, { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { ModalShell } from "../../components/ui/ModalShell";
import { MANA } from "../../lib/mana";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH_SM } from "../../lib/tokens";
import { CardArt } from "../collection/CardTile";
import { bottomCards, buildLibrary, drawCard, handStats, isLandCard, newHand } from "./goldfish";
import { COLORS, analyseManabase } from "./manabase";

/*
 * The two questions a decklist can't answer by looking at it: does this hand
 * keep, and can this mana base cast this deck. Both live behind one button so
 * the deck page doesn't grow another two panels.
 */

function HandTab({ deck, cardById, commander }) {
  const library = useMemo(() => buildLibrary(deck, cardById), [deck, cardById]);
  const [state, setState] = useState(() => newHand(library));
  const [chosen, setChosen] = useState([]);

  function reset(mulligans) {
    setState(newHand(library, mulligans));
    setChosen([]);
  }

  const stats = handStats(state.hand);
  const needsBottom = state.toBottom > 0;
  const keyOf = (c, i) => `${c.id}:${i}`;

  if (library.length === 0)
    return (
      <div style={{ fontSize: 13, color: C.parchmentDim, lineHeight: 1.6 }}>
        This deck has no cards in it yet — add some, or auto-build it, and there'll be something to
        shuffle.
      </div>
    );

  return (
    <div>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: 0.8, color: C.parchmentDim, marginBottom: 10 }}>
        {library.length} cards in the library
        {[].concat(commander || []).length
          ? ` · ${[].concat(commander).map((c) => c.name).join(" & ")} ${[].concat(commander).length > 1 ? "wait" : "waits"} in the command zone`
          : ""}
        {state.mulligans > 0 ? ` · mulligan ${state.mulligans}` : ""}
        {state.drawn > 0 ? ` · turn ${state.drawn}` : ""}
      </div>

      {needsBottom && (
        <div
          className="mono"
          style={{ fontSize: 10.5, letterSpacing: 0.8, textTransform: "uppercase", color: C.accent, marginBottom: 10 }}
        >
          London mulligan — pick {state.toBottom} card{state.toBottom === 1 ? "" : "s"} to put on the
          bottom ({chosen.length} chosen)
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(110px, 100%), 1fr))", gap: 10 }}>
        {state.hand.map((c, i) => {
          const key = keyOf(c, i);
          const picked = chosen.includes(key);
          return (
            <button
              key={key}
              onClick={() => {
                if (!needsBottom) return;
                setChosen((prev) => (picked ? prev.filter((x) => x !== key) : [...prev, key]));
              }}
              aria-label={needsBottom ? `Put ${c.name} on the bottom` : c.name}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: needsBottom ? "pointer" : "default",
                opacity: picked ? 0.45 : 1,
                minWidth: 0,
                textAlign: "left",
              }}
            >
              <div
                style={{
                  aspectRatio: "5 / 7",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#0C0E10",
                  border: `1px solid ${picked ? C.accent : "rgba(232,236,241,0.14)"}`,
                }}
              >
                <CardArt card={c} />
              </div>
              <div
                className="serif"
                title={c.name}
                style={{ fontSize: 11, color: C.parchment, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {c.name}
              </div>
            </button>
          );
        })}
      </div>

      <div
        className="mono"
        style={{ fontSize: 11, color: C.parchmentDim, marginTop: 12, letterSpacing: 0.5, lineHeight: 1.7 }}
      >
        {stats.lands} land{stats.lands === 1 ? "" : "s"} · {stats.spells} spell
        {stats.spells === 1 ? "" : "s"}
        {stats.cheapest !== null ? ` · cheapest ${stats.cheapest}` : ""} · average cost{" "}
        {stats.avgCmc.toFixed(1)}
        {stats.screwed && <span style={{ color: C.redBright }}> · that's a mulligan</span>}
        {stats.flooded && !stats.screwed && <span style={{ color: C.goldBright }}> · all land</span>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {needsBottom ? (
          <button
            onClick={() => {
              setState(bottomCards(state, chosen));
              setChosen([]);
            }}
            disabled={chosen.length !== state.toBottom}
            style={{
              background: chosen.length === state.toBottom ? STOCK_BG : C.border,
              color: chosen.length === state.toBottom ? C.stockInk : C.parchmentDim,
              border: "none",
              borderRadius: 5,
              padding: "9px 16px",
              fontWeight: 700,
              fontSize: 13,
              cursor: chosen.length === state.toBottom ? "pointer" : "default",
              boxShadow: chosen.length === state.toBottom ? STOCK_SHADOW : "none",
            }}
          >
            Keep this hand
          </button>
        ) : (
          <button
            onClick={() => setState(drawCard(state))}
            disabled={state.library.length === 0}
            style={{
              background: STOCK_BG,
              color: C.stockInk,
              border: "none",
              borderRadius: 5,
              padding: "9px 16px",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              boxShadow: STOCK_SHADOW,
            }}
          >
            Draw a card
          </button>
        )}
        <button
          onClick={() => reset(state.mulligans + 1)}
          className="mono"
          style={{
            background: "transparent",
            border: `1px solid ${C.border}`,
            color: C.parchmentDim,
            clipPath: NOTCH_SM,
            padding: "9px 14px",
            fontSize: 10.5,
            letterSpacing: 1,
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Mulligan
        </button>
        <button
          onClick={() => reset(0)}
          className="mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: `1px solid ${C.border}`,
            color: C.parchmentDim,
            clipPath: NOTCH_SM,
            padding: "9px 14px",
            fontSize: 10.5,
            letterSpacing: 1,
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          <RotateCcw size={12} /> New hand
        </button>
      </div>
    </div>
  );
}

function ManaTab({ deck, cardById, commander, oracleMap, deckSize }) {
  const analysis = useMemo(() => {
    const entries = (deck?.entries || [])
      .map((e) => ({ card: cardById[e.cardId], qty: e.qty || 1 }))
      .filter((e) => e.card);
    return analyseManabase({
      cards: entries,
      basics: deck?.basics || {},
      commander,
      oracleOf: (c) => (c?.scryfallId ? oracleMap[c.scryfallId] : null),
      deckSize,
    });
  }, [deck, cardById, commander, oracleMap, deckSize]);

  if (analysis.rows.length === 0)
    return (
      <div style={{ fontSize: 13, color: C.parchmentDim, lineHeight: 1.6 }}>
        {analysis.known
          ? "Nothing in this deck asks for coloured mana — there's nothing to check."
          : "Mana costs haven't been fetched for these cards yet. Run Refresh prices & art and they'll fill in."}
      </div>
    );

  return (
    <div>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: 0.8, color: C.parchmentDim, marginBottom: 12, lineHeight: 1.6 }}>
        {analysis.lands} lands in {deckSize} cards. Each bar is how many sources of that colour the
        deck has against how many it wants — Frank Karsten's 90% numbers, scaled to this deck's size.
      </div>

      {analysis.rows.map((r) => {
        const pct = r.want ? Math.min(100, Math.round((r.have / r.want) * 100)) : 100;
        return (
          <div key={r.color} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
              <span
                aria-hidden="true"
                style={{ width: 14, height: 14, borderRadius: "50%", background: MANA[r.color], flexShrink: 0 }}
              />
              <span className="serif" style={{ fontSize: 13.5, color: C.parchment }}>
                {r.label}
              </span>
              <span className="mono" style={{ fontSize: 11, color: r.ok ? C.greenBright : C.redBright }}>
                {r.have} of {r.want} sources
                {r.short > 0 ? ` · ${r.short} short` : " · fine"}
              </span>
              {r.extra > 0 && (
                <span className="mono" style={{ fontSize: 10, color: C.parchmentDim }}>
                  (+{r.extra} off lands)
                </span>
              )}
            </div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.08)" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: r.ok ? C.greenBright : C.redBright }} />
            </div>
            {r.driver && (
              <div className="mono" style={{ fontSize: 10, color: C.parchmentDim, marginTop: 4 }}>
                set by {r.driver.name} — {r.driver.pips} pip{r.driver.pips === 1 ? "" : "s"} on turn{" "}
                {r.driver.turn}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ fontSize: 11.5, color: C.parchmentDim, lineHeight: 1.6, marginTop: 4 }}>
        Sources are counted from basic land types and from what a land's rules text says it adds.
        Anything unreadable counts as nothing, so this errs toward telling you you're short rather
        than telling you a broken base is fine.
      </div>
    </div>
  );
}

export function GoldfishModal({ deck, cardById, commander, oracleMap, deckSize, onClose }) {
  const [tab, setTab] = useState("hand");
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
        padding: "6px 12px",
        fontSize: 10,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <ModalShell title={`Test — ${deck?.name || "deck"}`} onClose={onClose} width={620}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[tabBtn("hand", "Opening hand"), tabBtn("mana", "Mana base")]}
      </div>
      {tab === "hand" ? (
        <HandTab deck={deck} cardById={cardById} commander={commander} />
      ) : (
        <ManaTab
          deck={deck}
          cardById={cardById}
          commander={commander}
          oracleMap={oracleMap}
          deckSize={deckSize}
        />
      )}
    </ModalShell>
  );
}
