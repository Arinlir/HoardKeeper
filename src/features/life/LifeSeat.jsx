/*
 * One seat on the board.
 *
 * A seat is a block of flat colour. Its life total sits in the middle in heavy
 * numerals, turned to face its player; the colour on either side of it is the
 * control — tap the half on your left to lose a life, the half on your right to
 * gain one, hold to run. (For a seat facing sideways that's the top and bottom
 * halves of the screen.) The number itself opens the seat's own panel.
 */
import React, { useRef, useState } from "react";
import { Check, ChevronLeft, Contact, Crown, Flag, Keyboard, Minus, Plus, RotateCcw, RotateCw, Skull, Sword } from "lucide-react";
import { COUNTERS, STARS_THEME, SEAT_COLORS, counterValue, maxCmdDamage, seatBackground, tapSides } from "./lifeState";
import { CUT, FONT, L, NOTCH_CLIP_SM, NUMBER_FONT, PartnersIcon, Rotated, Sign, StrokeNumber, TILE_CLIP, TILE_RADIUS, labelStyle, pill, roundBtn, useSize } from "./lifeUi";

// A background is either one flat colour or a stack of images (the stars theme).
// Longhand properties only: mixing `background` with `backgroundSize` makes React
// warn and misrender on update.
export function bgStyle(background) {
  if (typeof background === "string" && /url\(|gradient/.test(background)) {
    return { backgroundColor: "#1E2250", backgroundImage: background, backgroundSize: "140px 140px, cover", backgroundPosition: "0 0, center" };
  }
  // A faint diagonal hatch over the flat colour — card stock, not a screen fill.
  return {
    backgroundColor: background,
    backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.05) 0 1px, transparent 1px 7px)",
  };
}

// ---- the tile itself --------------------------------------------------------

// The hairline a seat is framed with, following the same cut corners as the
// tile, inset a few pixels. Drawn as a polygon from the tile's measured size.
function SeatFrame() {
  const ref = useRef(null);
  const { w, h } = useSize(ref, { w: 200, h: 200 });
  const i = 7;
  const d = i * (Math.SQRT2 - 1);
  const pts = [
    [i, i], [w - CUT - d, i], [w - i, CUT + d], [w - i, h - i], [CUT + d, h - i], [i, h - CUT - d],
  ].map((p) => p.map((v) => Math.round(v * 10) / 10).join(",")).join(" ");
  return (
    <span ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }}>
      <svg width={w} height={h} style={{ display: "block" }}>
        <polygon points={pts} fill="none" stroke="rgba(128,128,128,0.6)" strokeWidth="1" />
      </svg>
    </span>
  );
}

export function Tile({ seat, background, children, out = false, style }) {
  return (
    <div
      data-seat={seat.index}
      style={{
        gridRow: seat.row + 1,
        gridColumn: seat.span === 2 ? "1 / span 2" : seat.col + 1,
        position: "relative",
        display: "flex",
        minWidth: 0,
        minHeight: 0,
        borderRadius: TILE_RADIUS,
        clipPath: TILE_CLIP,
        overflow: "hidden",
        ...bgStyle(background),
        opacity: out ? 0.42 : 1,
        transition: "background-color 0.2s ease, opacity 0.2s ease",
        ...style,
      }}
    >
      {/* the inner rule: a card's border, which is what makes a seat read as a
          card rather than a screen of colour */}
      <SeatFrame />
      {children}
    </div>
  );
}

// ---- one number with its two tap halves ------------------------------------

/*
 * `onDelta` is what the halves do; leave it off and the face is just a number
 * (the who-starts roll uses it that way). `press` is the shared hold-to-repeat
 * helper from the view, so only one thing can be held at a time.
 */
export function Face({
  value,
  rot,
  ink,
  press,
  onDelta,
  decLabel,
  incLabel,
  onCenter,
  centerLabel,
  name,
  scale = 1,
  badge,
  chips,
  chipsHeight = 0,
  signOpacity = 0.3,
  gap = 0,
}) {
  const sides = tapSides(rot);
  const text = String(value);
  const zoneBase = { position: "absolute", touchAction: "manipulation", userSelect: "none", WebkitTapHighlightColor: "transparent", cursor: "pointer" };
  const zoneBox = (pos) => {
    if (sides.axis === "y") return pos === "top" ? { top: 0, left: 0, right: 0, height: "50%" } : { bottom: 0, left: 0, right: 0, height: "50%" };
    return pos === "left" ? { left: 0, top: 0, bottom: 0, width: "50%" } : { right: 0, top: 0, bottom: 0, width: "50%" };
  };
  // The ± mark sits near the outer edge of its half — out of the way of the
  // number, which gets the middle of the seat.
  const signAt = (pos) => {
    const at = pos === "top" || pos === "left" ? "30%" : "70%";
    const base = { position: "absolute", transform: "translate(-50%, -50%)", display: "flex" };
    return sides.axis === "y" ? { ...base, left: "50%", top: at } : { ...base, top: "50%", left: at };
  };
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0, marginLeft: gap }}>
      {onDelta && (
        <>
          <div role="button" tabIndex={0} aria-label={decLabel} style={{ ...zoneBase, ...zoneBox(sides.dec) }} {...press((m) => onDelta(-m))}>
            <span style={signAt(sides.dec)}><Sign kind="minus" color={ink} opacity={signOpacity} /></span>
          </div>
          <div role="button" tabIndex={0} aria-label={incLabel} style={{ ...zoneBase, ...zoneBox(sides.inc) }} {...press((m) => onDelta(m))}>
            <span style={signAt(sides.inc)}><Sign kind="plus" color={ink} opacity={signOpacity} /></span>
          </div>
        </>
      )}
      <Rotated rot={rot}>
        {({ w, h }) => {
          // How big the number can be: no taller than most of the player's
          // frame (less what the name and chips need) and no wider than the
          // frame — a three-digit total on a narrow seat shrinks to fit.
          const extra = (name ? 22 : 0) + chipsHeight;
          const em = Math.max(22, Math.min((h - extra) * 0.7, (w * 0.84) / (0.8 * Math.max(2, text.length))) * scale);
          return (
            <>
              {badge && (
                <div
                  className={`life-badge${badge.fading ? " poofing" : ""}`}
                  style={{ position: "absolute", top: "7%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none", zIndex: 4 }}
                >
                  <span
                    className="mono"
                    style={{
                      display: "inline-block",
                      fontFamily: NUMBER_FONT,
                      fontSize: Math.max(16, Math.min(30, h * 0.12)),
                      fontWeight: 800,
                      padding: "2px 14px",
                      borderRadius: 0,
                      clipPath: NOTCH_CLIP_SM,
                      background: ink === "#000000" ? "rgba(0,0,0,0.82)" : "rgba(255,255,255,0.9)",
                      color: ink === "#000000" ? "#fff" : "#000",
                    }}
                  >
                    {badge.amount > 0 ? "+" : ""}
                    {badge.amount}
                  </span>
                </div>
              )}
              {name && (
                <div style={{ ...labelStyle, color: ink, opacity: 0.62, fontSize: 12, maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2, height: 20, lineHeight: "20px" }}>
                  {name}
                </div>
              )}
              <div
                role={onCenter ? "button" : undefined}
                tabIndex={onCenter ? 0 : undefined}
                aria-label={centerLabel}
                onClick={onCenter}
                onKeyDown={(e) => {
                  if (onCenter && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onCenter();
                  }
                }}
                style={{ pointerEvents: onCenter ? "auto" : "none", cursor: onCenter ? "pointer" : "default", userSelect: "none", zIndex: 2, touchAction: "manipulation" }}
              >
                <StrokeNumber text={text} em={em} color={ink} />
              </div>
              {chips && <div style={{ pointerEvents: "auto", zIndex: 3, marginTop: 4 }}>{chips}</div>}
            </>
          );
        }}
      </Rotated>
    </div>
  );
}

// ---- the little things under the number ------------------------------------

const CHIP_H = 34;

export function SeatChips({ player, table, visibleCounters, commander, lethal, ink, press, onCounter, onCommander, onDeal, compact }) {
  const dark = ink === "#000000";
  const chip = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: CHIP_H - 6,
    padding: "0 8px",
    borderRadius: 0,
    clipPath: NOTCH_CLIP_SM,
    background: dark ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.2)",
    color: ink,
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: compact ? 10 : 11,
    letterSpacing: "0.05em",
    border: "none",
  };
  const mini = { ...roundBtn(CHIP_H - 10, false, { background: dark ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.25)", color: ink }) };
  const shown = COUNTERS.filter((c) => visibleCounters.includes(c.key));
  const hit = maxCmdDamage(player);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", alignItems: "center" }}>
      {table.monarch === player.id && (
        <span style={chip} title="Monarch" aria-label={`${player.name} is the monarch`}>
          <Crown size={14} fill={ink} />
        </span>
      )}
      {table.initiative === player.id && (
        <span style={chip} title="Initiative" aria-label={`${player.name} has the initiative`}>
          <Flag size={14} fill={ink} />
        </span>
      )}
      {shown.map((c) => {
        const n = counterValue(player, c.key);
        const hot = c.lethalAt && n >= c.lethalAt;
        const step = c.step || 1;
        return (
          <span key={c.key} style={{ ...chip, boxShadow: hot ? `inset 0 0 0 2px ${ink}` : "none" }}>
            <span style={{ opacity: 0.7 }}>{c.short}</span>
            <button className="life-mini" aria-label={`${player.name}: fewer ${c.label.toLowerCase()}`} style={mini} {...press((m) => onCounter(c.key, -step * m))}>
              <Minus size={12} strokeWidth={3} />
            </button>
            <span className="mono" style={{ minWidth: 14, textAlign: "center", fontFamily: NUMBER_FONT, fontSize: 13 }}>{n}</span>
            <button className="life-mini" aria-label={`${player.name}: more ${c.label.toLowerCase()}`} style={mini} {...press((m) => onCounter(c.key, step * m))}>
              <Plus size={12} strokeWidth={3} />
            </button>
          </span>
        );
      })}
      {commander && player.partner && onDeal && (
        // Two commanders on this seat: pick the one that's dealing damage.
        <>
          {[false, true].map((second) => (
            <button
              key={second ? "b" : "a"}
              onClick={() => onDeal(second)}
              aria-label={`${player.name}: deal commander damage with commander ${second ? "B" : "A"}`}
              title={`Deal commander damage with commander ${second ? "B" : "A"}`}
              style={{ ...chip, cursor: "pointer", gap: 5, paddingRight: 10 }}
            >
              <Sword size={14} strokeWidth={2.5} />
              <span style={{ fontWeight: 800 }}>{second ? "B" : "A"}</span>
            </button>
          ))}
        </>
      )}
      {commander && (
        <button
          onClick={onCommander}
          aria-label={`${player.name}: commander damage`}
          title="Commander damage this seat has taken"
          style={{ ...chip, cursor: "pointer", boxShadow: hit >= 21 ? `inset 0 0 0 2px ${ink}` : "none" }}
        >
          <Sword size={14} strokeWidth={2.5} />
          {hit > 0 && <span className="mono" style={{ fontFamily: NUMBER_FONT, fontSize: 13 }}>{hit}</span>}
        </button>
      )}
      {lethal && (
        <span style={{ ...chip, background: ink, color: dark ? "#fff" : "#000" }}>
          <Skull size={13} /> {lethal}
        </span>
      )}
    </div>
  );
}

export function chipsHeightFor({ player, table, visibleCounters, commander, lethal }) {
  const any = visibleCounters.length > 0 || commander || lethal || table.monarch === player.id || table.initiative === player.id;
  return any ? CHIP_H + 4 : 0;
}

// ---- the seat's own panel --------------------------------------------------

function Item({ label, size, on, danger, onClick, children, ariaLabel, pressed }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, width: size + 16 }}>
      <button
        onClick={onClick}
        aria-label={ariaLabel || label}
        aria-pressed={pressed}
        style={{ ...roundBtn(size, on, danger ? { background: L.red, color: L.white } : {}) }}
      >
        {children}
      </button>
      <span style={{ ...labelStyle, fontSize: 9, textAlign: "center", lineHeight: 1.1, letterSpacing: "0.03em" }}>{label}</span>
    </div>
  );
}

/*
 * Background, kill, partners, name — and the rest of what a seat can do. It
 * covers the seat it belongs to and faces the same way, so whoever tapped
 * their number can read it without turning the device.
 */
export function SeatPanel({ player, rot, table, commander, onClose, onColor, onKill, onPartners, onRename, onTotal, onCrown, onInitiative, onCommander, onFlip, onReset, onScale }) {
  const [view, setView] = useState("main"); // main | color | name
  const swatchOf = (c) => ({ width: 40, height: 40, borderRadius: 14, border: "none", cursor: "pointer", ...bgStyle(seatBackground(c)), boxShadow: player.color === c ? "0 0 0 3px #fff" : "none", padding: 0, flexShrink: 0 });
  return (
    <Rotated rot={rot} interactive>
      {({ w, h }) => {
        const size = h < 260 || w < 330 ? 42 : 52;
        return (
          <div
            role="dialog"
            aria-label={`${player.name}: seat options`}
            style={{
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              background: L.panel,
              borderRadius: TILE_RADIUS,
              padding: "10px 8px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              overflowY: "auto",
              fontFamily: FONT,
            }}
          >
            {view === "main" && (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 2px", justifyContent: "center", alignItems: "flex-start", margin: "auto 0" }}>
                  <Item label="Background" size={size} onClick={() => setView("color")} ariaLabel={`${player.name}: background`}>
                    <span style={{ width: size * 0.62, height: size * 0.62, borderRadius: 9, ...bgStyle(seatBackground(player.color)), boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.18)" }} />
                  </Item>
                  <Item label="Kill" size={size} on={false} danger={player.out} pressed={!!player.out} onClick={onKill} ariaLabel={player.out ? `Bring ${player.name} back into the game` : `Knock ${player.name} out of the game`}>
                    <Skull size={size * 0.5} />
                  </Item>
                  {commander && (
                    <Item label="Partners" size={size} on={!!player.partner} pressed={!!player.partner} onClick={onPartners} ariaLabel={`${player.name}: partner commanders`}>
                      <PartnersIcon size={size * 0.5} />
                    </Item>
                  )}
                  <Item label="Name" size={size} onClick={() => setView("name")} ariaLabel={`${player.name}: rename`}>
                    <Contact size={size * 0.5} />
                  </Item>
                  <Item label="Total" size={size} onClick={onTotal} ariaLabel={`${player.name}: type an exact total`}>
                    <Keyboard size={size * 0.5} />
                  </Item>
                  <Item label="Crown" size={size} on={table.monarch === player.id} pressed={table.monarch === player.id} onClick={onCrown} ariaLabel={`${table.monarch === player.id ? "Take the crown from" : "Give the crown to"} ${player.name}`}>
                    <Crown size={size * 0.5} />
                  </Item>
                  <Item label="Initiative" size={size} on={table.initiative === player.id} pressed={table.initiative === player.id} onClick={onInitiative} ariaLabel={`${table.initiative === player.id ? "Take the initiative from" : "Give the initiative to"} ${player.name}`}>
                    <Flag size={size * 0.5} />
                  </Item>
                  {commander && (
                    <Item label="Commander" size={size} onClick={onCommander} ariaLabel={`${player.name}: commander damage received`}>
                      <Sword size={size * 0.5} />
                    </Item>
                  )}
                  <Item label="Flip" size={size} on={!!player.flip} pressed={!!player.flip} onClick={onFlip} ariaLabel={`Turn ${player.name}'s seat around`}>
                    <RotateCw size={size * 0.5} />
                  </Item>
                  <Item label="Reset" size={size} onClick={onReset} ariaLabel={`Reset ${player.name}`}>
                    <RotateCcw size={size * 0.5} />
                  </Item>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, width: size + 16 }}>
                    <div style={{ display: "flex", gap: 4, height: size, alignItems: "center" }}>
                      <button aria-label={`${player.name}: smaller number`} onClick={() => onScale(-0.1)} style={roundBtn(size * 0.6)}><Minus size={size * 0.3} strokeWidth={3} /></button>
                      <button aria-label={`${player.name}: bigger number`} onClick={() => onScale(0.1)} style={roundBtn(size * 0.6)}><Plus size={size * 0.3} strokeWidth={3} /></button>
                    </div>
                    <span style={{ ...labelStyle, fontSize: 10 }}>Size</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, width: size + 16 }}>
                    <button onClick={onClose} style={pill("go", { height: size, padding: "0 12px", fontSize: 12 })}>Done</button>
                    <span style={{ ...labelStyle, fontSize: 10, opacity: 0 }}>.</span>
                  </div>
                </div>
              </>
            )}

            {view === "color" && (
              <>
                <span style={labelStyle}>Background</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
                  {[...SEAT_COLORS, STARS_THEME.id].map((c) => (
                    <button key={c} aria-label={c === STARS_THEME.id ? `${player.name}: stars background` : `${player.name}: colour ${c}`} aria-pressed={player.color === c} onClick={() => onColor(c)} style={swatchOf(c)} />
                  ))}
                </div>
                <button onClick={() => setView("main")} style={pill("plain", { padding: "9px 16px" })}><ChevronLeft size={15} /> Back</button>
              </>
            )}

            {view === "name" && (
              <>
                <span style={labelStyle}>Name</span>
                <input
                  autoFocus
                  value={player.name}
                  onChange={(e) => onRename(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setView("main")}
                  aria-label="Player name"
                  maxLength={20}
                  style={{ width: "min(80%, 260px)", background: L.well, color: L.white, border: "none", borderRadius: 14, padding: "12px 14px", fontFamily: FONT, fontWeight: 800, fontSize: 18, textAlign: "center", outline: "none" }}
                />
                <button onClick={() => setView("main")} style={pill("go", { padding: "9px 18px" })}><Check size={15} /> Done</button>
              </>
            )}
          </div>
        );
      }}
    </Rotated>
  );
}

// ---- commander damage: the seat being read ---------------------------------

export function CommanderCard({ rot, onReturn, title: heading = "Commander", subtitle = "damage you've received" }) {
  return (
    <Rotated rot={rot} interactive>
      {({ w, h }) => {
        const title = Math.max(20, Math.min(w / 8.6, h / 3.4));
        return (
          <div style={{ width: "100%", height: "100%", boxSizing: "border-box", background: L.panel, borderRadius: TILE_RADIUS, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 14, fontFamily: FONT, color: L.white, textAlign: "center" }}>
            <div style={{ fontWeight: 800, fontSize: title, lineHeight: 0.95, textTransform: "uppercase", letterSpacing: "0.02em" }}>{heading}</div>
            <div style={{ fontWeight: 700, fontSize: title * 0.42, lineHeight: 1.1, textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.92 }}>{subtitle}</div>
            <button onClick={onReturn} style={pill("go", { marginTop: 10 })}>Return to game</button>
          </div>
        );
      }}
    </Rotated>
  );
}
