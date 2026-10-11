/*
 * Exchange rates, fetched instead of typed.
 *
 * Every figure in Binderwyrm is stored in USD, because that's what Scryfall
 * quotes; EUR and CZK are conversions. Those rates used to be two numbers you
 * kept up to date by hand, which meant they were usually wrong. Now they come
 * from the ECB's daily reference rates.
 *
 * Two sources, tried in order, because a hobby install shouldn't lose its
 * totals to one endpoint having a bad day. Both are keyless and CORS-enabled,
 * so the fetch happens in the browser and no rate ever passes through the
 * Binderwyrm server. If both fail — offline, blocked, a firewall that doesn't
 * like outbound calls — the caller keeps whatever rates it already had.
 */

export const RATE_SOURCES = [
  {
    name: "ECB via Frankfurter",
    url: "https://api.frankfurter.app/latest?base=USD&symbols=EUR,CZK",
    read: (d) => ({ eur: d?.rates?.EUR, czk: d?.rates?.CZK, date: d?.date || null }),
  },
  {
    name: "open.er-api.com",
    url: "https://open.er-api.com/v6/latest/USD",
    read: (d) => ({
      eur: d?.rates?.EUR,
      czk: d?.rates?.CZK,
      date: d?.time_last_update_utc ? String(d.time_last_update_utc).slice(0, 16) : null,
    }),
  },
];

// Sanity bounds. A malformed response that parsed as a number would otherwise
// silently multiply every total on screen by nonsense — better to treat an
// implausible rate as a failed fetch and keep the last good one.
const PLAUSIBLE = {
  eur: [0.3, 3],
  czk: [5, 100],
};

function usable(value, bounds) {
  const n = Number(value);
  return Number.isFinite(n) && n >= bounds[0] && n <= bounds[1] ? n : null;
}

export async function fetchRates(timeoutMs = 8000) {
  let lastError = null;
  for (const source of RATE_SOURCES) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let data;
      try {
        const res = await fetch(source.url, { signal: ctl.signal });
        if (!res.ok) throw new Error(`${source.name} answered ${res.status}`);
        data = await res.json();
      } finally {
        clearTimeout(timer);
      }
      const raw = source.read(data);
      const eur = usable(raw.eur, PLAUSIBLE.eur);
      const czk = usable(raw.czk, PLAUSIBLE.czk);
      if (eur === null || czk === null) throw new Error(`${source.name} sent rates that don't look right`);
      return { eur, czk, date: raw.date, source: source.name };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("No rate source answered");
}

// How often to go looking on its own. Reference rates move once a day, so
// checking twice a day is generous and costs one request.
export const RATES_MAX_AGE_MS = 12 * 3600 * 1000;

export function ratesAreStale(updatedAt) {
  return !updatedAt || Date.now() - updatedAt > RATES_MAX_AGE_MS;
}

// "just now" / "3 hours ago" / "on 2026-09-04" — for the one line in Settings
// that says how current the numbers are.
export function ratesAgeLabel(updatedAt) {
  if (!updatedAt) return "never";
  const mins = Math.floor((Date.now() - updatedAt) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
