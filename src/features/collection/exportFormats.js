/*
 * What a collection looks like to somebody else's importer.
 *
 * Binderwyrm's own CSV keeps everything — cost basis, sold history, the
 * display currency — which is exactly what makes it useless to anyone else:
 * a column called "Purchase Price allocated (CZK)" means nothing to Archidekt.
 * So each format here writes the column names and the vocabulary that site
 * actually reads, and the money in these goes out in plain USD, because that's
 * what those importers assume and a 1499 typed as CZK arriving as $1499 is a
 * silent, expensive mistake.
 *
 * Column names and value vocabularies are from each site's own export/import
 * format (Archidekt's collection importer, Moxfield's collection CSV, ManaBox's
 * export), matched field for field rather than guessed.
 *
 * Nothing here imports papaparse: a builder returns plain rows, the caller
 * serialises. That keeps the rules testable on their own.
 */
import { finishOf } from "../../lib/scryfall";

export const EXPORT_FORMATS = [
  {
    key: "binderwyrm",
    label: "Binderwyrm",
    ext: "csv",
    proxiesByDefault: true,
    blurb:
      "Everything: cost basis, sold history, proxies, wishlist flags — in your display currency. The one to keep as a backup, and the only one this app can read back in full.",
  },
  {
    key: "archidekt",
    label: "Archidekt",
    ext: "csv",
    proxiesByDefault: false,
    blurb:
      "Archidekt's own column names, so its collection importer maps the file without you matching anything by hand. Collections come across as tags.",
  },
  {
    key: "moxfield",
    label: "Moxfield",
    ext: "csv",
    proxiesByDefault: true,
    blurb:
      "Moxfield's collection CSV, which several other sites read too. It has a proxy column of its own, so proxies stay marked as proxies.",
  },
  {
    key: "manabox",
    label: "ManaBox",
    ext: "csv",
    proxiesByDefault: false,
    blurb: "ManaBox's export format — the phone scanner app. Also what Binderwyrm's own importer knows best.",
  },
  {
    key: "text",
    label: "Decklist text",
    ext: "txt",
    proxiesByDefault: false,
    blurb:
      "One line per card: 1 Sol Ring (LTC) 59. The list format Archidekt, Moxfield, playgroup.gg and most other sites accept when you paste cards in.",
  },
];

export const FORMAT_BY_KEY = Object.fromEntries(EXPORT_FORMATS.map((f) => [f.key, f]));

// Binderwyrm records the five TCG grades. Each site names them its own way.
const CONDITION = {
  archidekt: { NM: "NM", LP: "LP", MP: "MP", HP: "HP", DMG: "D" },
  moxfield: { NM: "Near Mint", LP: "Good (Lightly Played)", MP: "Played", HP: "Heavily Played", DMG: "Damaged" },
  // ManaBox grades on the Cardmarket scale rather than the TCG one, so this is
  // the usual crossing: LP↔EX, MP↔GD, HP↔played, DMG↔poor.
  manabox: { NM: "near_mint", LP: "excellent", MP: "good", HP: "played", DMG: "poor" },
};

const FINISH = {
  archidekt: { nonfoil: "Normal", foil: "Foil", etched: "Etched" },
  moxfield: { nonfoil: "", foil: "foil", etched: "etched" },
  manabox: { nonfoil: "normal", foil: "foil", etched: "etched" },
};

function condition(site, card) {
  const table = CONDITION[site];
  return table[(card.condition || "NM").toUpperCase()] || table.NM;
}

function finish(site, card) {
  return FINISH[site][finishOf(card)] ?? FINISH[site].nonfoil;
}

function money(n) {
  return n === null || n === undefined || isNaN(n) ? "" : Number(n).toFixed(2);
}

function isoDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

// Which cards a given export should carry.
export function selectCards(cards, { includeSold = false, includeProxies = false } = {}) {
  return cards.filter((c) => (includeSold || !c.sold) && (includeProxies || !c.proxy));
}

/*
 * ctx: { collectionName(id), allocatedCost(card), currentUnitValue(card),
 *        convert(usd), currency, includeSold, includeProxies }
 * Returns { kind: "csv", columns, rows } or { kind: "text", content }, plus a
 * filename and how many cards went in.
 */
export function buildExport(formatKey, cards, ctx) {
  const format = FORMAT_BY_KEY[formatKey] || FORMAT_BY_KEY.binderwyrm;
  const list = selectCards(cards, ctx);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `binderwyrm-${format.key === "binderwyrm" ? "collection" : format.key}-${stamp}.${format.ext}`;
  const built = BUILDERS[format.key](list, ctx);
  return { ...built, filename, format, rowCount: list.length };
}

const BUILDERS = {
  // Unchanged from what Binderwyrm has always written, so an older export and
  // a new one still read the same way — plus the proxy and wishlist flags.
  binderwyrm(list, ctx) {
    const { currency = "USD", convert = (n) => n, collectionName = () => "", allocatedCost = () => 0, currentUnitValue = () => 0 } = ctx;
    const rows = list.map((c) => ({
      Name: c.name,
      Set: (c.set || "").toUpperCase(),
      "Collector Number": c.collectorNumber || "",
      "Set Name": c.setName || "",
      "Scryfall ID": c.scryfallId || "",
      Rarity: c.rarity || "",
      Quantity: c.quantity,
      Finish: finishOf(c),
      Condition: c.condition,
      Collection: collectionName(c.collectionId),
      Location: c.location || "",
      [`Purchase Price allocated (${currency})`]: money(convert(allocatedCost(c))),
      [`Current Value each (${currency})`]: money(convert(currentUnitValue(c))),
      [`Current Value total (${currency})`]: money(convert(currentUnitValue(c) * c.quantity)),
      Tags: (c.tags || []).join("; "),
      "For Trade": c.forTrade ? "Yes" : "No",
      "Trade Note": c.forTrade ? c.tradeNote || "" : "",
      Proxy: c.proxy ? "Yes" : "No",
      Wanted: c.wanted ? "Yes" : "No",
      Sold: c.sold ? "Yes" : "No",
      [`Sale Price (${currency})`]: c.sold ? money(convert((c.soldPrice || 0) * c.quantity)) : "",
      "Date Sold": c.soldDate || "",
      "Traded For": c.tradedFor || "",
    }));
    return { kind: "csv", columns: Object.keys(rows[0] || {}), rows };
  },

  archidekt(list, ctx) {
    const { collectionName = () => "", allocatedCost = () => 0 } = ctx;
    const rows = list.map((c) => {
      const tags = [collectionName(c.collectionId), c.proxy ? "proxy" : null, c.location || null]
        .filter(Boolean)
        .join(",");
      return {
        Quantity: c.quantity,
        Name: c.name,
        Finish: finish("archidekt", c),
        Condition: condition("archidekt", c),
        "Date Added": isoDate(c.added),
        Language: "EN",
        // per copy, in USD — Archidekt reads this column as dollars
        "Purchase Price": money((allocatedCost(c) || 0) / (c.quantity || 1)),
        Tags: tags,
        "Edition Name": c.setName || "",
        "Edition Code": (c.set || "").toUpperCase(),
        "Multiverse Id": "",
        "Scryfall ID": c.scryfallId || "",
        "Collector Number": c.collectorNumber || "",
      };
    });
    return { kind: "csv", columns: ARCHIDEKT_COLUMNS, rows };
  },

  moxfield(list, ctx) {
    const { collectionName = () => "", allocatedCost = () => 0 } = ctx;
    const rows = list.map((c) => ({
      Count: c.quantity,
      "Tradelist Count": 0,
      Name: c.name,
      Edition: (c.set || "").toLowerCase(),
      Condition: condition("moxfield", c),
      Language: "English",
      Foil: finish("moxfield", c),
      Tags: collectionName(c.collectionId),
      "Last Modified": isoDate(c.added),
      "Collector Number": c.collectorNumber || "",
      Alter: "false",
      Proxy: c.proxy ? "true" : "false",
      "Purchase Price": money((allocatedCost(c) || 0) / (c.quantity || 1)),
    }));
    return { kind: "csv", columns: MOXFIELD_COLUMNS, rows };
  },

  manabox(list, ctx) {
    const { allocatedCost = () => 0 } = ctx;
    const rows = list.map((c) => ({
      Name: c.name,
      "Set code": (c.set || "").toLowerCase(),
      "Set name": c.setName || "",
      "Collector number": c.collectorNumber || "",
      Foil: finish("manabox", c),
      Rarity: (c.rarity || "").toLowerCase(),
      Quantity: c.quantity,
      "ManaBox ID": "",
      "Scryfall ID": c.scryfallId || "",
      "Purchase price": money((allocatedCost(c) || 0) / (c.quantity || 1)),
      Misprint: "false",
      Altered: "false",
      Condition: condition("manabox", c),
      Language: "en",
      "Purchase price currency": "USD",
    }));
    return { kind: "csv", columns: MANABOX_COLUMNS, rows };
  },

  // "1 Sol Ring (LTC) 59" — quantity, name, set in brackets, collector number.
  // No foil markers: the plain line is the one every site parses.
  text(list) {
    const content = list
      .map((c) => {
        const printing = c.set ? ` (${c.set.toUpperCase()})${c.collectorNumber ? ` ${c.collectorNumber}` : ""}` : "";
        return `${c.quantity || 1} ${c.name}${printing}`;
      })
      .join("\n");
    return { kind: "text", content };
  },
};

// Column order matters to a few importers, so it's stated rather than inferred
// from whichever card happened to be first.
export const ARCHIDEKT_COLUMNS = [
  "Quantity", "Name", "Finish", "Condition", "Date Added", "Language", "Purchase Price",
  "Tags", "Edition Name", "Edition Code", "Multiverse Id", "Scryfall ID", "Collector Number",
];
export const MOXFIELD_COLUMNS = [
  "Count", "Tradelist Count", "Name", "Edition", "Condition", "Language", "Foil", "Tags",
  "Last Modified", "Collector Number", "Alter", "Proxy", "Purchase Price",
];
export const MANABOX_COLUMNS = [
  "Name", "Set code", "Set name", "Collector number", "Foil", "Rarity", "Quantity",
  "ManaBox ID", "Scryfall ID", "Purchase price", "Misprint", "Altered", "Condition",
  "Language", "Purchase price currency",
];
