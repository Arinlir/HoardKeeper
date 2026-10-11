/*
 * Search syntax for the collection.
 *
 * The search box has always matched names (and, since the rules-text work,
 * oracle text). That's the right default and it stays the default: a query
 * with no colons in it behaves exactly as it did before. What's new is that
 * you can *say what you mean* — `t:goblin c:r cmc<=3 -is:proxy` — in the same
 * box, borrowing Scryfall's spelling so the syntax you already know works
 * here too.
 *
 * The parser is deliberately pure and data-only: it knows nothing about React
 * or the collection, and every fact it needs about a card (rules text, which
 * collection it's in, what it's worth today, whether it's wishlisted) arrives
 * through `ctx`. That's what makes it testable, and what lets the deck view
 * and the wishlist reuse it later.
 */

import { isCommanderCard } from "../../lib/commander";

// ---- tokenizer -------------------------------------------------------------

// Splits on whitespace but keeps "quoted phrases" together, including the
// common `o:"draw a card"` shape where the quotes start after the key.
function tokenize(input) {
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of String(input || "")) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// Keys that take a comparison rather than a substring.
const NUMERIC = {
  cmc: "cmc",
  mv: "cmc",
  cost: "cmc",
  price: "price",
  usd: "price",
  value: "price",
  qty: "qty",
  n: "qty",
  copies: "qty",
  year: "year",
};

const KEY_ALIASES = {
  t: "type",
  type: "type",
  o: "oracle",
  oracle: "oracle",
  text: "oracle",
  c: "color",
  color: "color",
  colors: "color",
  id: "color",
  ci: "color",
  r: "rarity",
  rarity: "rarity",
  s: "set",
  e: "set",
  set: "set",
  edition: "set",
  cn: "number",
  number: "number",
  a: "artist",
  art: "artist",
  artist: "artist",
  is: "is",
  not: "not",
  tag: "tag",
  tags: "tag",
  col: "collection",
  collection: "collection",
  in: "collection",
  deck: "deck",
  f: "format",
  format: "format",
  legal: "format",
  banned: "banned",
  restricted: "restricted",
  note: "note",
  finish: "finish",
  lang: "lang",
};

const OPS = [">=", "<=", "!=", ">", "<", "=", ":"];

function splitTerm(raw) {
  for (const op of OPS) {
    const i = raw.indexOf(op);
    if (i > 0) return { key: raw.slice(0, i).toLowerCase(), op, value: raw.slice(i + op.length) };
  }
  return null;
}

/*
 * `parseQuery("t:goblin or t:elf")` → alternatives, each a list of terms that
 * must all hold. `or` is the only combinator; everything else is an and, which
 * is how people actually type searches.
 */
export function parseQuery(input) {
  const groups = [[]];
  tokenize(input).forEach((tok) => {
    if (/^or$/i.test(tok)) {
      groups.push([]);
      return;
    }
    if (/^and$/i.test(tok)) return;
    let neg = false;
    let raw = tok;
    if (raw.startsWith("-") && raw.length > 1) {
      neg = true;
      raw = raw.slice(1);
    }
    if (raw.startsWith("!") && raw.length > 1) {
      groups[groups.length - 1].push({ kind: "exact", value: raw.slice(1).toLowerCase(), neg });
      return;
    }
    const split = splitTerm(raw);
    if (split && (KEY_ALIASES[split.key] || NUMERIC[split.key])) {
      const numeric = NUMERIC[split.key];
      if (numeric) {
        const n = parseFloat(String(split.value).replace(",", "."));
        if (!Number.isNaN(n)) {
          groups[groups.length - 1].push({
            kind: "num",
            field: numeric,
            op: split.op === ":" || split.op === "=" ? "=" : split.op,
            value: n,
            neg,
          });
          return;
        }
      } else {
        groups[groups.length - 1].push({
          kind: KEY_ALIASES[split.key],
          value: String(split.value).toLowerCase(),
          neg: KEY_ALIASES[split.key] === "not" ? !neg : neg,
        });
        return;
      }
    }
    if (raw) groups[groups.length - 1].push({ kind: "word", value: raw.toLowerCase(), neg });
  });
  const alternatives = groups.filter((g) => g.length > 0);
  return {
    alternatives,
    // True once the query says something a plain name search couldn't.
    advanced: alternatives.some((g) => g.some((t) => t.kind !== "word")),
    empty: alternatives.length === 0,
  };
}

// ---- matching --------------------------------------------------------------

const COLOR_WORDS = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  w: "W",
  u: "U",
  b: "B",
  r: "R",
  g: "G",
};

function colorMatch(card, value) {
  const have = (card.colors || []).map((x) => x.toUpperCase());
  const v = value.trim();
  if (v === "c" || v === "colorless") return have.length === 0;
  if (v === "m" || v === "multi" || v === "multicolor" || v === "gold") return have.length > 1;
  if (COLOR_WORDS[v]) return have.includes(COLOR_WORDS[v]);
  // A bare letter run: c:wu means "is white and blue".
  const wanted = v.split("").map((ch) => COLOR_WORDS[ch]).filter(Boolean);
  if (wanted.length === 0) return false;
  return wanted.every((k) => have.includes(k));
}

function cmp(a, op, b) {
  if (op === ">=") return a >= b;
  if (op === "<=") return a <= b;
  if (op === ">") return a > b;
  if (op === "<") return a < b;
  if (op === "!=") return a !== b;
  return a === b;
}

function oracleText(card, ctx) {
  const o = ctx?.oracleFor ? ctx.oracleFor(card) : null;
  return `${o?.t || card.oracleText || ""}`.toLowerCase();
}

function typeText(card, ctx) {
  const o = ctx?.oracleFor ? ctx.oracleFor(card) : null;
  return `${o?.ty || card.typeLine || ""}`.toLowerCase();
}

function finishOf(card) {
  return card.finish || (card.foil ? "foil" : "nonfoil");
}

// The `is:` vocabulary. Each entry answers a yes/no about one card; `not:` is
// the same list read backwards.
const IS = {
  foil: (c) => finishOf(c) === "foil",
  etched: (c) => finishOf(c) === "etched",
  nonfoil: (c) => finishOf(c) === "nonfoil",
  proxy: (c) => !!c.proxy,
  real: (c) => !c.proxy,
  sold: (c) => !!c.sold,
  // A trade is a disposal too (see App.jsx's onTrade) — is:sold still finds
  // it, and is:traded narrows to the ones given up for another card rather
  // than cash.
  traded: (c) => !!c.sold && !!c.tradedFor,
  owned: (c) => !c.sold && !c.notOwned,
  art: (c) => !!c.isArt,
  dfc: (c) => !!c.imageUrlBack,
  doublefaced: (c) => !!c.imageUrlBack,
  transform: (c) => !!c.imageUrlBack,
  // Legendary creatures and "can be your commander" cards — the rules text
  // check covers cards whose flag hasn't been backfilled yet.
  commander: (c, ctx) => isCommanderCard(c, oracleText(c, ctx)),
  legendary: (c) => (c.typeLine || "").includes("Legendary"),
  land: (c, ctx) => typeText(c, ctx).includes("land"),
  creature: (c, ctx) => typeText(c, ctx).includes("creature"),
  // Two ways to want a card: it's on the wishlist, or it's a copy you own
  // (often a proxy) that you've marked as wanting a real one.
  wanted: (c, ctx) => !!c.wanted || !!ctx?.isWanted?.(c),
  wishlist: (c, ctx) => !!c.wanted || !!ctx?.isWanted?.(c),
  tagged: (c) => (c.tags || []).length > 0,
  trade: (c) => !!c.forTrade,
  fortrade: (c) => !!c.forTrade,
  indeck: (c, ctx) => !!ctx?.deckNames?.(c)?.length,
  missing: (c) => !!c.notOwned,
};

function termMatches(term, card, ctx) {
  switch (term.kind) {
    case "word": {
      if ((card.name || "").toLowerCase().includes(term.value)) return true;
      if (ctx?.textScope === false) return false;
      return `${oracleText(card, ctx)} ${typeText(card, ctx)}`.includes(term.value);
    }
    case "exact":
      return (card.name || "").toLowerCase() === term.value;
    case "type":
      return typeText(card, ctx).includes(term.value);
    case "oracle":
      return oracleText(card, ctx).includes(term.value);
    case "color":
      return colorMatch(card, term.value);
    case "rarity":
      return (card.rarity || "").toLowerCase().startsWith(term.value);
    case "set":
      return (
        (card.set || "").toLowerCase() === term.value ||
        (card.setName || "").toLowerCase().includes(term.value)
      );
    case "number":
      return String(card.collectorNumber || "").toLowerCase() === term.value;
    case "artist":
      return (card.artist || "").toLowerCase().includes(term.value);
    case "note":
      return (card.note || "").toLowerCase().includes(term.value);
    case "finish":
      return finishOf(card) === term.value;
    case "lang":
      return (card.lang || "en").toLowerCase() === term.value;
    case "tag":
      return (card.tags || []).some((t) => String(t).toLowerCase().includes(term.value));
    case "collection":
      return (ctx?.collectionOf?.(card) || "").toLowerCase().includes(term.value);
    case "deck":
      return (ctx?.deckNames?.(card) || []).some((n) => n.toLowerCase().includes(term.value));
    case "format":
      return (ctx?.legalityOf?.(card, term.value) || "") === "legal";
    case "banned":
      return (ctx?.legalityOf?.(card, term.value) || "") === "banned";
    case "restricted":
      return (ctx?.legalityOf?.(card, term.value) || "") === "restricted";
    case "is":
    case "not": {
      const fn = IS[term.value];
      return fn ? !!fn(card, ctx) : false;
    }
    case "num": {
      const v =
        term.field === "cmc"
          ? card.cmc ?? 0
          : term.field === "qty"
          ? card.quantity ?? 1
          : term.field === "year"
          ? new Date(card.added || 0).getFullYear()
          : ctx?.unitValue
          ? ctx.unitValue(card) || 0
          : card.usd ?? 0;
      return cmp(Number(v), term.op, term.value);
    }
    default:
      return false;
  }
}

export function matchQuery(card, parsed, ctx) {
  if (!parsed || parsed.empty) return true;
  return parsed.alternatives.some((group) =>
    group.every((term) => {
      const hit = termMatches(term, card, ctx);
      return term.neg ? !hit : hit;
    })
  );
}

// Shown in the search help popover, and the closest thing to documentation
// the syntax has.
export const QUERY_HELP = [
  { q: "t:goblin", d: "type line contains goblin" },
  { q: 'o:"draw a card"', d: "rules text contains the phrase" },
  { q: "c:rg", d: "red and green (c:colorless, c:multi also work)" },
  { q: "r:mythic", d: "rarity — r:m is enough" },
  { q: "set:ltr", d: "set code, or part of the set's name" },
  { q: "cmc<=3", d: "mana value; >, <, >=, <=, = all work" },
  { q: "price>20", d: "what a copy is worth today, in your display currency" },
  { q: "qty>=4", d: "how many copies you have" },
  { q: "is:foil", d: "foil, etched, proxy, sold, traded, wanted, dfc, commander, land…" },
  { q: "-is:proxy", d: "any term can be negated with a leading minus" },
  { q: "tag:trade", d: "your own tags" },
  { q: "is:trade", d: "cards on your trade list — willing to trade, not yet gone" },
  { q: "is:traded", d: "already gone, traded away for another card (is:sold catches cash sales too)" },
  { q: "col:vault", d: "cards in a collection, by name" },
  { q: "deck:atraxa", d: "cards sleeved in a deck" },
  { q: "f:commander", d: "legal in a format — banned:modern, restricted:vintage too" },
  { q: '!"sol ring"', d: "exact name" },
  { q: "goblin or elf", d: "either side" },
];
