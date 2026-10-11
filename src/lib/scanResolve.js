// The "does this make sense?" half of the live scanner. A frame gives us two
// independent readings of the same card: the NAME across the top and the
// set code + collector number along the bottom. Reading is only trusted once
// they agree: the code is looked up (local card database first, so it's a few
// milliseconds) and the card that comes back must carry the name that was read.
//
// That is what makes a single frame enough — a misread digit, or a "™ & ©
// Wizards of the Coast" line mistaken for a set code, resolves to nothing or
// to a different card, and never gets through.
import { scryfallByCode, scryfallLookup } from "./scryfall";

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Does a name read off the card (OCR: may drop or swap a letter, may be cut
// short on a long title) belong to this card? Either face of a double-faced
// card counts.
export function nameMatches(read, cardName) {
  const r = fold(read);
  if (r.replace(/ /g, "").length < 3) return false;
  const faces = [cardName, ...String(cardName || "").split(" // ")].map(fold).filter(Boolean);
  return faces.some((f) => {
    if (f === r) return true;
    const tol = Math.max(1, Math.floor(Math.max(f.length, r.length) * 0.2));
    if (Math.abs(f.length - r.length) <= tol && lev(f, r) <= tol) return true;
    return r.length >= 6 && f.includes(r);
  });
}

export const anyNameMatches = (names, card) => (names || []).some((n) => nameMatches(n, card?.name));

// resolve({ candidates, names }) →
//   confirmed    name and code agree (or the name fixed a misread number in a
//                set that was read right) — safe to take on one frame
//   code-only    the code is a real card but no name was readable this frame
//   unverifiable the lookup couldn't be done (offline) — caller falls back to
//                its own two-frame agreement
//   mismatch     the code is a real card with a DIFFERENT name — don't take it
//   none         nothing resolved
export function createResolver({ byCode = scryfallByCode, byName = scryfallLookup } = {}) {
  const self = {};
  const codes = new Map();
  const named = new Map();
  const remember = (map, key, fn) => {
    if (!map.has(key)) {
      const p = fn().then(
        (card) => ({ card }),
        (e) => ({ error: e })
      );
      map.set(key, p);
      // a genuine "no such card" is final; a network failure is worth retrying
      p.then((r) => {
        if (r.error && !/^(No card|Card not found)/.test(String(r.error?.message))) map.delete(key);
      });
    }
    return map.get(key);
  };

  return Object.assign(self, {
    async resolve({ candidates = [], names = [] }) {
      const tops = candidates.slice(0, 3);
      let unverifiable = false;
      let mismatch = null;
      let codeOnly = null;
      // All candidates are looked up at once — the slowest one sets the wait,
      // not the sum of them.
      const t0 = Date.now();
      const looked = await Promise.all(tops.map((c) => remember(codes, `${c.set}#${c.number}`, () => byCode(c.set, c.number))));
      self.lastLookupMs = Date.now() - t0;
      for (let i = 0; i < tops.length; i++) {
        const c = tops[i];
        const r = looked[i];
        if (r.card) {
          if (!names.length) codeOnly = codeOnly || { candidate: c, card: r.card };
          else if (anyNameMatches(names, r.card)) return { status: "confirmed", set: c.set, number: c.number, card: r.card };
          else mismatch = mismatch || { candidate: c, card: r.card };
        } else if (!/^(No card|Card not found)/.test(String(r.error?.message))) {
          unverifiable = true;
        }
      }
      // A real set, but the number didn't resolve to this name: look the name up
      // inside that set instead (a digit misread, a promo/variant number).
      if (names.length) {
        const n = names[0];
        const byNameRes = await Promise.all(tops.map((c) => remember(named, `${c.set}|${fold(n)}`, () => byName(n, c.set.toLowerCase()))));
        for (const r of byNameRes) {
          if (r.card && anyNameMatches(names, r.card)) {
            return { status: "confirmed", set: r.card.set.toUpperCase(), number: r.card.collectorNumber, card: r.card };
          }
        }
      }
      if (codeOnly) return { status: "code-only", ...codeOnly.candidate, card: codeOnly.card };
      if (mismatch) return { status: "mismatch", ...mismatch.candidate, card: mismatch.card };
      return { status: unverifiable ? "unverifiable" : "none" };
    },
  });
}
