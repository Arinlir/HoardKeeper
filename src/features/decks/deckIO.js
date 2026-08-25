import { finishOf } from "../../lib/scryfall";

export const DECK_BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"];
export const DECK_SECTIONS =
  /^(deck|main(deck|board)?|commander|companion|sideboard|maybe(board)?|tokens?|considering)\b/i;

// Parses a pasted decklist. Handles the common exports — Moxfield, Archidekt,
// MTGO/Arena — and plain "4 Lightning Bolt" lists.
export function parseDecklist(text) {
  const out = { commander: null, entries: [], basics: {}, ignored: [], sideboard: [] };
  let section = "deck";

  String(text || "")
    .split(/\r?\n/)
    .forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      if (/^(\/\/|#)/.test(line)) return; // comments, including our own token block
      const head = line.replace(/[:(].*$/, "").trim();
      if (DECK_SECTIONS.test(head) && !/^\d/.test(line)) {
        section = head.toLowerCase();
        return;
      }

      // 4 Lightning Bolt (2X2) 117 *F* *CMDR*
      const m = line.match(
        /^(\d+)?\s*[xX]?\s*(.+?)\s*(?:\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9-★]+)?)?\s*((?:\*[^*]+\*\s*)*)$/
      );
      if (!m) {
        out.ignored.push(line);
        return;
      }
      const qty = parseInt(m[1] || "1", 10);
      const tags = (m[5] || "").toLowerCase();
      // double-faced cards export as "Front // Back"
      const name = (m[2] || "").split("//")[0].trim();
      if (!name) {
        out.ignored.push(line);
        return;
      }

      const rec = {
        qty,
        name,
        set: m[3] ? m[3].toLowerCase() : null,
        num: m[4] || null,
        foil: /\*f\*|foil/.test(tags),
      };

      if ((tags.includes("cmdr") || section === "commander") && !out.commander) {
        out.commander = rec;
        return;
      }
      if (section.startsWith("side") || section.startsWith("maybe") || section === "considering") {
        out.sideboard.push(rec);
        return;
      }
      if (section.startsWith("token")) return;

      const basic = DECK_BASICS.find((b) => b.toLowerCase() === name.toLowerCase());
      if (basic) {
        out.basics[basic] = (out.basics[basic] || 0) + qty;
        return;
      }
      out.entries.push(rec);
    });

  return out;
}

// Pairs parsed lines with cards you own. Prefers the exact printing when the
// list names one, then any copy not committed to another deck.
export function matchDecklist(parsed, cards, committed = {}) {
  const byName = {};
  cards
    .filter((c) => !c.sold)
    .forEach((c) => {
      const k = c.name.toLowerCase();
      (byName[k] = byName[k] || []).push(c);
    });

  const used = {};
  const entries = [];
  const missing = [];
  const partial = [];

  const freeCopies = (c) => (c.quantity || 1) - (committed[c.id] || 0) - (used[c.id] || 0);

  // Returns the card ids claimed, in order.
  function claim(rec, limit) {
    const pool = byName[rec.name.toLowerCase()] || [];
    const exact = pool.filter(
      (c) =>
        rec.set &&
        c.set?.toLowerCase() === rec.set &&
        (!rec.num || String(c.collectorNumber) === String(rec.num))
    );
    const order = [...exact, ...pool.filter((c) => !exact.includes(c))];
    const taken = [];
    let need = limit ?? rec.qty;
    for (const c of order) {
      if (need <= 0) break;
      const avail = Math.max(0, freeCopies(c));
      if (avail <= 0) continue;
      const take = Math.min(avail, need);
      used[c.id] = (used[c.id] || 0) + take;
      taken.push({ id: c.id, take });
      need -= take;
    }
    return taken;
  }

  // Commander first, so it gets the copy it names.
  let commanderId = null;
  if (parsed.commander) {
    const got = claim(parsed.commander, 1);
    if (got.length) commanderId = got[0].id;
    else missing.push({ ...parsed.commander, have: 0, isCommander: true });
  }

  parsed.entries.forEach((rec) => {
    const got = claim(rec);
    const total = got.reduce((n, g) => n + g.take, 0);
    got.forEach((g) => {
      const existing = entries.find((e) => e.cardId === g.id);
      if (existing) existing.qty += g.take;
      else entries.push({ cardId: g.id, qty: g.take, role: "other" });
    });
    if (total === 0) missing.push({ ...rec, have: 0 });
    else if (total < rec.qty) partial.push({ ...rec, have: total });
  });

  return { entries, commanderId, basics: { ...parsed.basics }, missing, partial };
}

// Plain-text decklist, the format every deckbuilder understands.
export function deckToText(deck, cardById, commander, tokens, tokenQty) {
  const lines = [];
  if (commander) {
    lines.push("Commander");
    lines.push(
      `1 ${commander.name}${commander.set ? ` (${commander.set.toUpperCase()}) ${commander.collectorNumber || ""}`.trimEnd() : ""}`
    );
    lines.push("");
    lines.push("Deck");
  }
  deck.entries.forEach((e) => {
    const c = cardById[e.cardId];
    if (!c) return;
    const printing = c.set ? ` (${c.set.toUpperCase()}) ${c.collectorNumber || ""}`.trimEnd() : "";
    lines.push(`${e.qty || 1} ${c.name}${printing}`);
  });
  Object.entries(deck.basics || {}).forEach(([name, n]) => lines.push(`${n} ${name}`));
  const wanted = (tokens || []).filter((t) => tokenQty(t.id) > 0);
  if (wanted.length) {
    lines.push("");
    lines.push("// Tokens needed:");
    wanted.forEach((t) => lines.push(`// ${tokenQty(t.id)} ${t.name}${t.ty ? ` (${t.ty})` : ""}`));
  }
  return lines.join("\n");
}

// Basics have no owned printing attached (a quick-add "Forest" isn't tied to
// any specific card in your binder) so there's no real set to record — but
// the type line is always knowable from the name, and leaving it out is
// exactly the gap that made lands unrecognizable on their own in an export.
export const BASIC_TYPE_LINES = {
  Plains: "Basic Land — Plains",
  Island: "Basic Land — Island",
  Swamp: "Basic Land — Swamp",
  Mountain: "Basic Land — Mountain",
  Forest: "Basic Land — Forest",
  Wastes: "Basic Land",
};

// Full fidelity: keeps the printing AND type of every card, so a re-import
// is exact and the file is self-documenting without cross-referencing
// Scryfall for what each line actually is.
export function deckToJson(deck, cardById, commander) {
  return JSON.stringify(
    {
      hoardkeeper: 1,
      name: deck.name,
      format: deck.format || "commander",
      colors: deck.colors || null,
      exported: new Date().toISOString(),
      commander: commander
        ? {
            name: commander.name,
            set: commander.set,
            collectorNumber: commander.collectorNumber,
            typeLine: commander.typeLine || null,
          }
        : null,
      cards: deck.entries
        .map((e) => {
          const c = cardById[e.cardId];
          if (!c) return null;
          return {
            qty: e.qty || 1,
            name: c.name,
            set: c.set,
            collectorNumber: c.collectorNumber,
            typeLine: c.typeLine || null,
            finish: finishOf(c),
            role: e.role,
          };
        })
        .filter(Boolean),
      // kept as a plain {name: qty} map for backward compatibility with
      // earlier exports, PLUS a richer parallel list carrying the type each
      // basic actually is -- jsonToParsed reads either shape.
      basics: deck.basics || {},
      basicsDetail: Object.entries(deck.basics || {}).map(([name, qty]) => ({
        name,
        qty,
        typeLine: BASIC_TYPE_LINES[name] || "Basic Land",
      })),
      tokenCounts: deck.tokenCounts || {},
      extraTokens: deck.extraTokens || [],
    },
    null,
    2
  );
}

// A HoardKeeper JSON export, converted back into the parser's shape.
export function jsonToParsed(json) {
  const d = JSON.parse(json);
  if (!d || !Array.isArray(d.cards)) throw new Error("Not a HoardKeeper deck file");
  return {
    meta: { name: d.name, format: d.format, colors: d.colors, tokenCounts: d.tokenCounts, extraTokens: d.extraTokens },
    commander: d.commander
      ? { qty: 1, name: d.commander.name, set: d.commander.set, num: d.commander.collectorNumber }
      : null,
    entries: d.cards.map((c) => ({
      qty: c.qty || 1,
      name: c.name,
      set: c.set || null,
      num: c.collectorNumber || null,
    })),
    basics: d.basics || {},
    ignored: [],
    sideboard: [],
  };
}

