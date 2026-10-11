import { store } from "./store";

export const CUR = {
  code: "USD",
  czkRate: 23,
  eurRate: 0.92,
  // Which market card prices come from — "cardmarket" (EU, euros) or
  // "tcgplayer" (US, dollars). Independent of the display currency: a CZK
  // collection can be valued on Cardmarket, a EUR one on TCGplayer. See
  // priceForFinish in lib/scryfall.js.
  source: "tcgplayer",
};

export const PRICE_SOURCES = {
  cardmarket: { label: "Cardmarket", region: "EU", native: "EUR", symbol: "€" },
  tcgplayer: { label: "TCGplayer", region: "US", native: "USD", symbol: "$" },
};

export function normalizeSource(s) {
  return s === "cardmarket" ? "cardmarket" : "tcgplayer";
}

// What older vaults meant before the source was its own setting: Cardmarket
// was used only while showing euros, and only if that box was left ticked.
export function legacySource(d) {
  if (d && (d.priceSource === "cardmarket" || d.priceSource === "tcgplayer")) return d.priceSource;
  return d && d.currency === "EUR" && d.eurNative !== false ? "cardmarket" : "tcgplayer";
}

// A price in the market's own currency, as the market itself lists it —
// "€1.20" for Cardmarket, "$1.45" for TCGplayer — whatever the display
// currency is. For putting the two markets side by side.
export function fmtNative(amount, source) {
  if (amount === null || amount === undefined || isNaN(amount)) return "—";
  const code = PRICE_SOURCES[normalizeSource(source)].native;
  return amount.toLocaleString(undefined, { style: "currency", currency: code });
}

export const CURRENCIES = {
  USD: { symbol: "$", label: "US Dollar" },
  EUR: { symbol: "€", label: "Euro" },
  CZK: { symbol: "Kč", label: "Czech koruna" },
};

export function convert(usdAmount) {
  if (usdAmount === null || usdAmount === undefined || isNaN(usdAmount)) return null;
  if (CUR.code === "USD") return usdAmount;
  if (CUR.code === "EUR") return usdAmount * CUR.eurRate;
  return usdAmount * CUR.czkRate;
}

// Turns an amount typed in the display currency back into the USD we store.
export function unconvert(displayAmount) {
  if (displayAmount === null || displayAmount === undefined || isNaN(displayAmount)) return null;
  if (CUR.code === "USD") return displayAmount;
  if (CUR.code === "EUR") return CUR.eurRate ? displayAmount / CUR.eurRate : displayAmount;
  return CUR.czkRate ? displayAmount / CUR.czkRate : displayAmount;
}

export function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const v = convert(n);
  if (CUR.code === "CZK") {
    return `${Math.round(v).toLocaleString()} Kč`;
  }
  return v.toLocaleString(undefined, { style: "currency", currency: CUR.code });
}

export function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function shortDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

