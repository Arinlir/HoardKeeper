import { store } from "./store";

export const CUR = {
  code: "USD",
  czkRate: 23,
  eurRate: 0.92,
};

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

