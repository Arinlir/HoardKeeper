export const C = {
  // Ink & Slate: flat opaque ink canvas, hairline rules, no blur, no glow,
  // one deliberate accent. Cards keep soft rounded corners; everything else
  // (buttons, tabs, plaques, chips) is cut with a notched corner instead of
  // a radius — see NOTCH/NOTCH_SM below.
  bg: "#15171B",
  bgPanel: "#1B1F26",
  bgPanel2: "#20242B",
  border: "rgba(255,255,255,0.10)",
  borderLight: "rgba(255,255,255,0.20)",
  gold: "#C7CCD1",           // neutral bright accent (icon strokes, plain emphasis)
  goldBright: "#F2F4F6",     // brightest neutral text
  parchment: "#E4E7EA",
  parchmentDim: "#8A8F97",
  green: "#3E7D55",
  greenBright: "#84C7A0",
  red: "#8B2635",
  redBright: "#DE7386",
  // the single brand accent — slate blue. accent = text/icon/border/rule use
  // on the dark canvas; accentFill = solid fill for active/selected chrome,
  // paired with bright text on top (contrast-checked: ~7:1).
  accent: "#6FA6D1",
  accentFill: "#2E5C82",
  // flat plaque surface — a solid notched chip, not a gradient or glass.
  // Every STOCK_BG/STOCK_SHADOW consumer (card name plates, stat plaques,
  // modal title bars, buttons) reads from here.
  stock: "#20242B",
  stockInk: "#F2F4F6",
  stockDim: "#8B9098",
  // rarity (the one place warm metal survives, as data — not a brand accent)
  rarityCommon: "#71767E",
  rarityUncommon: "#9FB2BF",
  rarityRare: "#C9A227",
  rarityMythic: "#D2691E",
};

// Flat plaque surface — a solid chip, no gradient, no blur. Paired with a
// small flat offset shadow (cut-paper, not a glow) instead of an inset ring.
export const STOCK_BG = C.stock;
export const STOCK_SHADOW = `0 2px 0 rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.08)`;

// The recurring geometric device: one corner of every piece of UI chrome is
// cut at an angle instead of rounded — buttons, tabs, plaques, chips, modal
// title bars. Cards (art tiles) are the deliberate exception and keep a
// normal border-radius, since they read as physical objects, not chrome.
// Apply via `clipPath: NOTCH` (or NOTCH_SM on small elements like chips/
// badges) and pair with `borderRadius: 0` on the same element.
export const NOTCH = "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)";
export const NOTCH_SM = "polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)";

// Root-canvas background — flat, solid, no gradient, no radial glow.
export const ROOT_BG = C.bg;

// Sets tab sub-palette — dense, mono, functional color-coding, same ink
// canvas and the same single slate accent as the rest of the app (not its
// own separate brand color).
export const CONSOLE = {
  panel: "#101317",
  panel2: "#171B21",
  line: "rgba(255,255,255,0.08)",
  line2: "rgba(255,255,255,0.16)",
  dim: "#6B7178",
  bright: "#EEF1F4",
  accent: C.accent,
  green: "#4E9A6E",
  red: "#C25B54",
};

export const RARITY_COLORS = {
  common: "#8C8778",
  uncommon: "#A8B4BE",
  rare: "#C9A227",
  mythic: "#D4622B",
  special: "#9B6BB5",
  bonus: "#5FA8A0",
};

// Spacing scale — snaps the app's previously ad hoc 6/8/10/12/14/16/18/20/22/24px
// values onto one consistent rhythm. Existing pixel values were chosen to stay close
// to what was already on screen, not to change the layout.
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

// Radius scale — used for cards/art tiles now (chrome uses NOTCH instead).
export const RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  pill: 999,
};

// Type scale — the sizes already in use across the app, named instead of repeated.
export const TYPE = {
  xs: 11,
  sm: 12.5,
  base: 14,
  md: 15,
  lg: 16.5,
  xl: 20,
  xxl: 26,
};

// Shared focus-ring token. Inline `style` objects can't express `:focus-visible`,
// so this is meant to be paired with the `.fr` utility class defined in App.jsx's
// global stylesheet (outline + offset), not applied as an inline style itself.
export const FOCUS_RING = {
  outline: `2px solid ${C.goldBright}`,
  outlineOffset: 2,
};
