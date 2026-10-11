import React from "react";
import { MANA } from "../../lib/mana";
import { C } from "../../lib/tokens";
import { PanelFrame } from "../collection/Analytics";

// Two plain-language panels for the deck Stats tab. Both answer a yes/no
// question ("can my lands cast my spells?", "do I have enough lands?") with the
// number and the verdict spelled out, instead of leaving it to be read off axes.

const mono = { fontFamily: "'IBM Plex Mono', monospace" };
const track = { position: "relative", height: 10, background: "rgba(255,255,255,0.08)", borderRadius: 2 };

function Verdict({ ok, children }) {
  return (
    <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: ok ? C.greenBright : C.redBright }}>
      {ok ? "✓ " : "▲ "}
      {children}
    </span>
  );
}

// One bar per colour: how many cards of that colour are in the deck.
export function CardsByColorPanel({ data }) {
  const max = Math.max(1, ...data.map((d) => d.Cards));
  return (
    <PanelFrame title="CARDS BY COLOR" subtitle="Cards in the deck, per color">
      <div style={{ paddingBottom: 10 }}>
        {data.map((d) => (
          <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
            <span style={{ width: 70, fontSize: 13, color: C.parchment }}>{d.name}</span>
            <div style={{ ...track, flex: 1 }} role="img" aria-label={`${d.name}: ${d.Cards} cards`}>
              <div style={{ width: `${(d.Cards / max) * 100}%`, height: "100%", background: d.key === "C" ? "#7A7263" : MANA[d.key], borderRadius: 2 }} />
            </div>
            <span className="mono" style={{ width: 26, textAlign: "right", fontSize: 13, fontWeight: 600, color: C.goldBright }}>{d.Cards}</span>
          </div>
        ))}
        <div style={{ fontSize: 10.5, color: C.parchmentDim, lineHeight: 1.5, marginTop: 4 }}>
          Lands aren't counted. A multicolor card counts once in each of its colors.
        </div>
      </div>
    </PanelFrame>
  );
}

// Total land count against the recommendation. Lands = basics + every nonbasic
// land card already in the deck.
export function LandCountPanel({ plan }) {
  if (!plan) return null;
  const { have, basics, nonbasic, recommended, avgMv, cheapRamp } = plan;
  const diff = have - recommended;
  const close = Math.abs(diff) <= 1;
  const scale = Math.max(have, recommended) * 1.1;
  const verdict = close ? "about right" : diff < 0 ? `${-diff} too few` : `${diff} too many`;
  const seg = (n, bg) => ({ width: `${(n / scale) * 100}%`, height: "100%", background: bg });
  return (
    <PanelFrame title="LAND COUNT" subtitle="How many lands this deck wants">
      <div style={{ paddingBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ ...mono, fontSize: 26, fontWeight: 600, color: C.goldBright }}>{have}</span>
          <span className="mono" style={{ fontSize: 11.5, color: C.parchmentDim }}>
            lands now · recommended <b style={{ color: C.parchment }}>{recommended}</b>
          </span>
          <Verdict ok={close || diff > 0}>{verdict}</Verdict>
        </div>
        <div style={{ ...track, height: 18, display: "flex" }} role="img" aria-label={`${basics} basic and ${nonbasic} nonbasic lands, ${recommended} recommended`}>
          <div style={seg(basics, C.rarityUncommon)} />
          <div style={seg(nonbasic, C.accent)} />
          <div
            aria-hidden="true"
            style={{ position: "absolute", top: -4, bottom: -4, left: `${(recommended / scale) * 100}%`, width: 2, background: C.goldBright }}
          />
        </div>
        <div className="mono" style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 10.5, color: C.parchmentDim, marginTop: 8 }}>
          <span><span style={{ color: C.rarityUncommon }}>■</span> {basics} basic</span>
          <span><span style={{ color: C.accent }}>■</span> {nonbasic} non-basic</span>
          <span><span style={{ color: C.goldBright }}>|</span> {recommended} recommended</span>
        </div>
        <div style={{ fontSize: 10.5, color: C.parchmentDim, lineHeight: 1.5, marginTop: 10 }}>
          Non-basic lands are already counted in the total. Based on your average card cost ({avgMv.toFixed(1)})
          {cheapRamp > 0 ? ` and ${cheapRamp} cheap mana rock${cheapRamp === 1 ? "" : "s"}/dork${cheapRamp === 1 ? "" : "s"}` : ""}.
        </div>
      </div>
    </PanelFrame>
  );
}
