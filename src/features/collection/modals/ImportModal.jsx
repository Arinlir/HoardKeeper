import React, { useState, useRef } from "react";
import { AlertCircle, Check, Loader2, Upload } from "lucide-react";
import Papa from "papaparse";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { TabButton } from "../../../components/ui/TabButton";
import { CUR, CURRENCIES } from "../../../lib/format";
import { RATE_MS, UNCATEGORIZED, normalizeCard, scryfallCollection, scryfallLookup, sleep } from "../../../lib/scryfall";
import { uid } from "../../../lib/store";
import { C, STOCK_BG } from "../../../lib/tokens";
import { parseDecklist } from "../../decks/deckIO";
import { fetchPrecon, fetchPreconList, filterPrecons } from "../../../lib/precons";
import { collectionOptions } from "../../../lib/collectionTree";

// Flattens a parseDecklist() result into plain {qty, name, set, num, foil}
// records. parseDecklist is built for deck lists (commander/sideboard
// sections, "considering" piles), but a collection paste has no such
// concept — everything named goes in the binder, so the commander and any
// sideboard lines fold in as ordinary cards, and each basic land becomes its
// own record instead of staying a {name: qty} map.
export function flattenPasteList(parsed) {
  const recs = [];
  if (parsed.commander) recs.push(parsed.commander);
  if (parsed.partner) recs.push(parsed.partner);
  recs.push(...parsed.entries);
  recs.push(...parsed.sideboard);
  Object.entries(parsed.basics || {}).forEach(([name, qty]) => {
    recs.push({ qty, name, set: null, num: null, foil: false });
  });
  return recs;
}

export const HEADER_HINTS = {
  name: ["name", "card name", "card", "cardname", "title"],
  set: ["set code", "set", "setcode", "edition", "set id", "set_code"],
  setName: ["set name", "edition name", "setname"],
  collectorNumber: [
    "collector number",
    "collector_number",
    "collectornumber",
    "card number",
    "number",
    "cn",
    "collector #",
    "card #",
  ],
  quantity: ["quantity", "qty", "count", "amount"],
  foil: ["foil", "finish", "printing", "is foil", "foil?"],
  purchasePrice: ["purchase price", "price", "paid", "cost", "purchase_price"],
  currentValue: ["current value", "market price", "value", "price (current)", "trend price"],
  scryfallId: ["scryfall id", "scryfall_id", "scryfallid", "scryfall", "id"],
  condition: ["condition", "cond", "grade"],
  language: ["language", "lang"],
  collection: ["binder name", "collection", "binder", "deck", "folder", "list", "group"],
  location: ["location", "shelf", "box", "storage"],
  // Binderwyrm's own export writes these two, so a file that leaves here
  // comes back with its proxies and its wishlist flags intact.
  proxy: ["proxy", "is proxy", "proxy?", "is_proxy"],
  wanted: ["wanted", "wishlist", "want", "wanted?"],
  tags: ["tags", "tag", "labels"],
  forTrade: ["for trade", "fortrade", "trade", "tradelist", "trade list"],
  tradeNote: ["trade note", "tradenote", "trade notes"],
};

export function guessMapping(headers) {
  const map = {};
  const used = new Set();
  Object.entries(HEADER_HINTS).forEach(([field, hints]) => {
    const found = headers.find(
      (h) => !used.has(h) && hints.includes(h.trim().toLowerCase())
    );
    if (found) {
      map[field] = found;
      used.add(found);
    }
  });
  return map;
}

export function truthy(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "foil" || s === "etched";
}

export function ImportModal({ collections, onClose, onCreateCollection, onImportCards, onAddToCollectionTotal }) {
  // CSV file (full column mapping, purchase history, per-row collections) or
  // a plain pasted list (the format Binderwyrm's own text export writes, and
  // what most deckbuilders paste in) — two different shapes of input feeding
  // the same "cards land in the binder" outcome below.
  const [mode, setMode] = useState("file"); // file | paste
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState("");

  const [fallbackCollection, setFallbackCollection] = useState(UNCATEGORIZED);
  const [lookupPrices, setLookupPrices] = useState(true);
  // Sealed product is bought as a lump: prices in the file should feed the
  // collection's total and split evenly, not stick to individual cards.
  const [costMode, setCostMode] = useState("allocate"); // allocate | perCard
  const [fileCurrency, setFileCurrency] = useState(CUR.code);
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const [fatalError, setFatalError] = useState("");
  const fileInput = useRef(null);

  const [pasteText, setPasteText] = useState("");
  const [pasteParsed, setPasteParsed] = useState(null);
  const [pasteCollection, setPasteCollection] = useState(UNCATEGORIZED);
  const pasteInput = useRef(null);

  // Precon decks: pick a boxed deck, add every card in it as its exact printing.
  const [preconList, setPreconList] = useState(null);
  const [preconQuery, setPreconQuery] = useState("");
  const [preconError, setPreconError] = useState("");
  const [precon, setPrecon] = useState(null); // {name, type, recs}
  const [preconLoading, setPreconLoading] = useState(false);
  const [preconNewCollection, setPreconNewCollection] = useState(true);

  async function openPreconTab() {
    setMode("precon");
    if (preconList) return;
    setPreconError("");
    try {
      setPreconList(await fetchPreconList());
    } catch (e) {
      setPreconError(`Couldn't load the list of precon decks — ${e.message}. Check your connection and try again.`);
    }
  }

  async function pickPrecon(d) {
    setPreconLoading(true);
    setPreconError("");
    try {
      setPrecon(await fetchPrecon(d.fileName));
    } catch (e) {
      setPreconError(`Couldn't load ${d.name} — ${e.message}.`);
    }
    setPreconLoading(false);
  }

  function analysePaste(source) {
    setParseError("");
    const raw = (source ?? pasteText).trim();
    if (!raw) return;
    setPasteParsed(parseDecklist(raw));
  }

  function handlePasteFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || "");
      setPasteText(content);
      analysePaste(content);
    };
    reader.readAsText(f);
  }

  const pasteRecs = pasteParsed ? flattenPasteList(pasteParsed) : [];
  const pasteCount = pasteRecs.reduce((n, r) => n + (r.qty || 1), 0);

  async function runPasteImport(override) {
    const recs = override && override.recs ? override.recs : pasteRecs;
    if (recs.length === 0) return;
    setFatalError("");
    setProgress({ done: 0, total: recs.length, phase: "Matching cards" });

    const index = { bySetCn: {}, byName: {}, byId: {} };
    let anySuccess = false;
    let lastError = "";
    for (let start = 0; start < recs.length; start += 75) {
      const chunk = recs.slice(start, start + 75);
      const identifiers = chunk.map((r) =>
        r.scryfallId
          ? { id: r.scryfallId }
          : r.set && r.num
          ? { set: r.set, collector_number: String(r.num) }
          : { name: r.name }
      );
      try {
        const data = await scryfallCollection(identifiers);
        (data.data || []).forEach((raw) => {
          const card = normalizeCard(raw);
          index.byId[raw.id] = card;
          index.bySetCn[`${raw.set}|${raw.collector_number}`] = card;
          const key = raw.name.toLowerCase();
          if (!index.byName[key]) index.byName[key] = card;
          const front = raw.name.split("//")[0].trim().toLowerCase();
          if (!index.byName[front]) index.byName[front] = card;
          anySuccess = true;
        });
      } catch (e) {
        lastError = e.message;
      }
      setProgress({ done: Math.min(start + 75, recs.length), total: recs.length, phase: "Matching cards" });
      await sleep(RATE_MS);
    }

    if (!anySuccess) {
      setProgress(null);
      setFatalError(
        `Couldn't reach Scryfall${lastError ? ` — ${lastError}` : ""}. Check your connection and try again.`
      );
      return;
    }

    recs.forEach((r) => {
      r.card =
        (r.scryfallId && index.byId[r.scryfallId]) ||
        (r.set && r.num && index.bySetCn[`${r.set}|${r.num}`]) ||
        (r.name && index.byName[r.name.toLowerCase()]) ||
        null;
    });

    // One fuzzy retry for anything the batch missed, same as the CSV path.
    const leftovers = recs.filter((r) => !r.card && r.name);
    for (let i = 0; i < leftovers.length; i++) {
      try {
        leftovers[i].card = await scryfallLookup(leftovers[i].name);
      } catch (e) {
        // stays unmatched
      }
      setProgress({ done: i + 1, total: leftovers.length, phase: "Retrying near misses" });
      await sleep(RATE_MS);
    }

    // A new collection is only made once the lookup worked, so a dead
    // connection doesn't leave an empty one behind.
    const targetCollection = override && override.newCollection
      ? onCreateCollection(override.newCollection)
      : override && override.collectionId
      ? override.collectionId
      : pasteCollection;
    const built = [];
    const failed = [];
    recs.forEach((r, i) => {
      const c = r.card;
      if (!c) failed.push(r.name);
      built.push({
        id: uid(),
        added: Date.now() + i,
        name: c ? c.name : r.name,
        set: c ? c.set : r.set || "",
        setName: c ? c.setName : "",
        collectorNumber: c ? c.collectorNumber : r.num || "",
        scryfallId: c ? c.scryfallId : null,
        imageUrl: c ? c.imageUrl : null,
        imageUrlLarge: c ? c.imageUrlLarge : null,
        imageUrlBack: c ? c.imageUrlBack : null,
        imageUrlBackLarge: c ? c.imageUrlBackLarge : null,
        scryfallUri: c ? c.scryfallUri : null,
        quantity: r.qty || 1,
        finish: r.finish || (r.foil ? "foil" : "nonfoil"),
        foil: !!r.foil,
        condition: "NM",
        collectionId: targetCollection,
        location: "",
        proxy: false,
        wanted: false,
        forTrade: false,
        tags: [],
        costOverride: null,
        valueOverride: null,
        usd: c ? c.usd : null,
        usdFoil: c ? c.usdFoil : null,
        usdEtched: c ? c.usdEtched ?? null : null,
        eur: c ? c.eur ?? null : null,
        eurFoil: c ? c.eurFoil ?? null : null,
        eurEtched: c ? c.eurEtched ?? null : null,
        prevUsd: null,
        prevUsdFoil: null,
        cmc: c ? c.cmc : 0,
        typeLine: c ? c.typeLine : "",
        colors: c ? c.colors : [],
        rarity: c ? c.rarity : "",
      });
    });

    onImportCards(built);
    setProgress(null);
    setReport({ total: built.length, failed, collections: 0 });
  }

  function handleFile(f) {
    setFile(f);
    setParseError("");
    setReport(null);
    setFatalError("");
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hdrs = (res.meta.fields || []).filter(Boolean);
        if (hdrs.length === 0) {
          setParseError("No column headers found. The first row should name the columns.");
          return;
        }
        setHeaders(hdrs);
        setMapping(guessMapping(hdrs));
        setRows(res.data);
      },
      error: (err) => setParseError(err.message || "Couldn't read that file."),
    });
  }

  function val(row, field) {
    const col = mapping[field];
    if (!col) return "";
    return String(row[col] ?? "").trim();
  }

  async function runImport() {
    if (!rows || rows.length === 0) return;
    if (!mapping.name) {
      setParseError("Pick which column holds the card name before importing.");
      return;
    }

    setFatalError("");
    setProgress({ done: 0, total: rows.length, phase: "Reading file" });

    // Group rows by the collection named in the file so each one becomes a real
    // collection with its own purchase total.
    const collectionTotals = {};
    const prepared = rows.map((row, i) => {
      const name = val(row, "name");
      const setCode = val(row, "set").toLowerCase();
      const qty = Number(val(row, "quantity")) || 1;
      const money = (field) => {
        const raw = val(row, field).replace(/[^0-9.,-]/g, "").replace(",", ".");
        if (raw === "") return null;
        const n = Number(raw);
        return isNaN(n) ? null : n;
      };
      const rate =
        fileCurrency === "USD" ? 1 : fileCurrency === "EUR" ? CUR.eurRate : CUR.czkRate;
      const inUsd = (v) => (v === null ? null : rate ? v / rate : v);
      const price = inUsd(money("purchasePrice"));
      const value = inUsd(money("currentValue"));
      const colName = val(row, "collection");
      if (colName && price !== null) {
        collectionTotals[colName] = (collectionTotals[colName] || 0) + price * qty;
      }
      const cn = val(row, "collectorNumber");
      const sid = val(row, "scryfallId");
      let identifier;
      if (sid) identifier = { id: sid };
      else if (setCode && cn) identifier = { set: setCode, collector_number: cn };
      else if (setCode && name) identifier = { name, set: setCode };
      else identifier = { name };
      return { i, row, name, setCode, cn, sid, qty, price, value, colName, identifier, card: null };
    });

    // Optional enrichment: resolve each row against Scryfall for prices and art.
    if (lookupPrices) {
      const withNames = prepared.filter((p) => p.name || p.sid);
      const index = { byId: {}, bySetCn: {}, byName: {} };
      let anySuccess = false;
      let lastError = "";

      for (let start = 0; start < withNames.length; start += 75) {
        const chunk = withNames.slice(start, start + 75);
        try {
          const data = await scryfallCollection(chunk.map((p) => p.identifier));
          (data.data || []).forEach((raw) => {
            const card = normalizeCard(raw);
            index.byId[raw.id] = card;
            index.bySetCn[`${raw.set}|${raw.collector_number}`] = card;
            const key = raw.name.toLowerCase();
            if (!index.byName[key]) index.byName[key] = card;
            const front = raw.name.split("//")[0].trim().toLowerCase();
            if (!index.byName[front]) index.byName[front] = card;
            anySuccess = true;
          });
        } catch (e) {
          lastError = e.message;
        }
        setProgress({
          done: Math.min(start + 75, withNames.length),
          total: withNames.length,
          phase: "Matching cards",
        });
        await sleep(RATE_MS);
      }

      if (!anySuccess && withNames.length > 0) {
        setProgress(null);
        setFatalError(
          `Couldn't reach Scryfall${lastError ? ` — ${lastError}` : ""}. ` +
            `Untick "Look up prices and art" to import the file as-is, or check your connection.`
        );
        return;
      }

      prepared.forEach((p) => {
        p.card =
          (p.sid && index.byId[p.sid]) ||
          (p.setCode && p.cn && index.bySetCn[`${p.setCode}|${p.cn}`]) ||
          (p.name && index.byName[p.name.toLowerCase()]) ||
          null;
      });

      // One fuzzy retry for anything the batch missed.
      const leftovers = prepared.filter((p) => !p.card && p.name);
      for (let i = 0; i < leftovers.length; i++) {
        try {
          leftovers[i].card = await scryfallLookup(leftovers[i].name);
        } catch (e) {
          // stays unmatched
        }
        setProgress({ done: i + 1, total: leftovers.length, phase: "Retrying near misses" });
        await sleep(RATE_MS);
      }
    }

    // Create a collection for every distinct name found in the file.
    const nameToId = {};
    collections.forEach((c) => {
      nameToId[c.name.toLowerCase()] = c.id;
    });
    Object.keys(collectionTotals).forEach((cn) => {
      if (!nameToId[cn.toLowerCase()]) {
        nameToId[cn.toLowerCase()] = onCreateCollection({
          name: cn,
          purchasePrice: Number(collectionTotals[cn].toFixed(2)),
          purchaseDate: new Date().toISOString().slice(0, 10),
          note: `Imported from ${file?.name || "CSV"}`,
        });
      }
    });
    // Rows landing in a collection that already exists: in allocate mode their
    // spend is added to that collection's total, so importing more cards never
    // dilutes what the earlier ones were allocated.
    if (costMode === "allocate") {
      Object.keys(collectionTotals).forEach((cn) => {
        const existing = collections.find((c) => c.name.toLowerCase() === cn.toLowerCase());
        if (existing && collectionTotals[cn] > 0) {
          onAddToCollectionTotal(existing.id, Number(collectionTotals[cn].toFixed(2)));
        }
      });
    }

    prepared.forEach((p) => {
      if (p.colName && !nameToId[p.colName.toLowerCase()]) {
        nameToId[p.colName.toLowerCase()] = onCreateCollection({
          name: p.colName,
          purchasePrice: 0,
          purchaseDate: new Date().toISOString().slice(0, 10),
          note: `Imported from ${file?.name || "CSV"}`,
        });
      }
    });

    const built = [];
    const failed = [];
    prepared.forEach((p) => {
      if (!p.name && !p.card) return;
      const c = p.card;
      if (!c && lookupPrices) failed.push(p.name || `row ${p.i + 2}`);
      // The column may say "foil"/"etched"/"normal" (our own export) or a
      // yes/no flag (most other tools). Read both.
      const finishRaw = val(p.row, "foil").trim().toLowerCase();
      const finish = /etch/.test(finishRaw)
        ? "etched"
        : /^(foil|yes|true|1|y)$/.test(finishRaw) || (finishRaw && /foil/.test(finishRaw))
        ? "foil"
        : "nonfoil";
      const foil = finish === "foil";
      built.push({
        id: uid(),
        added: Date.now() + p.i,
        name: c ? c.name : p.name,
        set: c ? c.set : p.setCode,
        setName: c ? c.setName : val(p.row, "setName"),
        collectorNumber: c ? c.collectorNumber : p.cn || "",
        scryfallId: c ? c.scryfallId : p.sid || null,
        imageUrl: c ? c.imageUrl : null,
        imageUrlLarge: c ? c.imageUrlLarge : null,
        imageUrlBack: c ? c.imageUrlBack : null,
        imageUrlBackLarge: c ? c.imageUrlBackLarge : null,
        scryfallUri: c ? c.scryfallUri : null,
        quantity: p.qty,
        finish,
        foil,
        condition: val(p.row, "condition") || "NM",
        collectionId: p.colName
          ? nameToId[p.colName.toLowerCase()]
          : fallbackCollection,
        location: val(p.row, "location"),
        proxy: truthy(val(p.row, "proxy")),
        wanted: truthy(val(p.row, "wanted")),
        forTrade: truthy(val(p.row, "forTrade")),
        tradeNote: truthy(val(p.row, "forTrade")) ? String(val(p.row, "tradeNote") || "").trim() : "",
        // Semicolon-separated, which is what the Binderwyrm export writes and
        // what most spreadsheets survive.
        tags: String(val(p.row, "tags") || "")
          .split(/[;|]/)
          .map((t) => t.trim())
          .filter(Boolean),
        // In allocate mode the money lives on the collection, so cards carry no
        // individual price and share the total evenly.
        costOverride:
          costMode === "perCard" && p.price !== null ? p.price * p.qty : null,
        valueOverride: p.value !== null && !c ? p.value : null,
        usd: c ? c.usd : p.value,
        usdFoil: c ? c.usdFoil : null,
        usdEtched: c ? c.usdEtched ?? null : null,
        eur: c ? c.eur ?? null : null,
        eurFoil: c ? c.eurFoil ?? null : null,
        eurEtched: c ? c.eurEtched ?? null : null,
        prevUsd: null,
        prevUsdFoil: null,
        cmc: c ? c.cmc : 0,
        typeLine: c ? c.typeLine : "",
        colors: c ? c.colors : [],
        rarity: c ? c.rarity : "",
      });
    });

    onImportCards(built);
    setProgress(null);
    setReport({
      total: built.length,
      failed,
      collections: Object.keys(collectionTotals).length,
    });
  }

  const mappingRows = [
    ["name", "Card name", true],
    ["set", "Set code"],
    ["collectorNumber", "Collector number"],
    ["currentValue", "Current value"],
    ["scryfallId", "Scryfall ID"],
    ["quantity", "Quantity"],
    ["foil", "Foil"],
    ["purchasePrice", "Purchase price"],
    ["condition", "Condition"],
    ["collection", "Collection / binder"],
    ["location", "Location"],
    ["proxy", "Proxy"],
    ["wanted", "Wishlist"],
    ["tags", "Tags"],
    ["forTrade", "For trade"],
    ["tradeNote", "Trade note"],
  ];

  return (
    <ModalShell title={mode === "file" ? "Import from CSV" : mode === "precon" ? "Add a precon deck" : "Import a pasted list"} onClose={onClose} width={560}>
      {!progress && !report && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <TabButton active={mode === "file"} onClick={() => setMode("file")}>
              CSV file
            </TabButton>
            <TabButton active={mode === "paste"} onClick={() => setMode("paste")}>
              Paste a list
            </TabButton>
            <TabButton active={mode === "precon"} onClick={openPreconTab}>
              Precon deck
            </TabButton>
          </div>

          {mode === "file" && (
          <>
          <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
            Works with ManaBox, Moxfield, Deckbox and TCGplayer exports. Columns are matched
            automatically — check them below and adjust anything that looks wrong.
          </p>

          <div
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            aria-label={file ? `Chosen file: ${file.name}. Click to choose a different CSV file.` : "Click to choose a CSV file"}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInput.current?.click();
              }
            }}
            style={{
              border: `1px dashed ${C.border}`,
              borderRadius: 8,
              padding: 22,
              textAlign: "center",
              cursor: "pointer",
              marginBottom: 16,
              color: C.parchmentDim,
            }}
          >
            <Upload size={20} style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 13 }}>{file ? file.name : "Click to choose a CSV file"}</div>
            {rows && (
              <div style={{ fontSize: 12, marginTop: 4, color: C.goldBright }}>
                {rows.length} rows · {headers.length} columns
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              aria-hidden="true"
              tabIndex={-1}
              style={{ display: "none" }}
              onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
            />
          </div>

          {parseError && (
            <div
              style={{
                color: C.redBright,
                fontSize: 12.5,
                marginBottom: 14,
                display: "flex",
                gap: 6,
              }}
            >
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              {parseError}
            </div>
          )}

          {rows && (
            <>
              <div
                style={{
                  fontSize: 12,
                  color: C.parchmentDim,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                Column mapping
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px 12px",
                  marginBottom: 18,
                }}
              >
                {mappingRows.map(([field, label, required]) => (
                  <div key={field}>
                    <label
                      htmlFor={`im-map-${field}`}
                      style={{
                        display: "block",
                        fontSize: 11.5,
                        color: required && !mapping[field] ? C.redBright : C.parchmentDim,
                        marginBottom: 3,
                      }}
                    >
                      {label}
                      {required ? " *" : ""}
                    </label>
                    <select
                      id={`im-map-${field}`}
                      style={{ ...inputStyle, padding: "7px 8px", fontSize: 12 }}
                      value={mapping[field] || ""}
                      onChange={(e) =>
                        setMapping({ ...mapping, [field]: e.target.value || undefined })
                      }
                    >
                      <option value="">Not in file</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <Field label="Prices in this file are in" htmlFor="im-currency">
                <select
                  id="im-currency"
                  style={inputStyle}
                  value={fileCurrency}
                  onChange={(e) => setFileCurrency(e.target.value)}
                >
                  {Object.entries(CURRENCIES).map(([code, meta]) => (
                    <option key={code} value={code}>
                      {code} — {meta.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Collection for rows with no collection named in the file" htmlFor="im-fallback-collection">
                <select
                  id="im-fallback-collection"
                  style={inputStyle}
                  value={fallbackCollection}
                  onChange={(e) => setFallbackCollection(e.target.value)}
                >
                  <option value={UNCATEGORIZED}>Uncategorized</option>
                  {collectionOptions(collections).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>

              {mapping.collection && (
                <p style={{ fontSize: 12, color: C.parchmentDim, marginTop: -4 }}>
                  Each distinct value in <b>{mapping.collection}</b> becomes its own collection.
                  {mapping.purchasePrice
                    ? " Purchase prices are summed per collection automatically."
                    : ""}
                </p>
              )}
            </>
          )}

          {rows && (
            <label
              style={{
                display: "flex",
                gap: 9,
                alignItems: "flex-start",
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "11px 12px",
                marginBottom: 14,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={lookupPrices}
                onChange={(e) => setLookupPrices(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span style={{ fontSize: 12.5, color: C.parchmentDim }}>
                <b style={{ color: C.parchment }}>Look up prices and art</b> — matches every row
                against Scryfall to pull card images, current market prices, colors, rarity and
                mana value. Resolves 75 cards per request, so even large collections take only a
                few seconds. Leave this off to import using only what's in your file.
              </span>
            </label>
          )}

          {rows && (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "11px 13px",
                marginBottom: 14,
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 9.5,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  color: C.parchmentDim,
                  marginBottom: 8,
                }}
              >
                Purchase prices in this file
              </div>
              <label style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 9, cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={costMode === "allocate"}
                  onChange={() => setCostMode("allocate")}
                  style={{ marginTop: 3 }}
                />
                <span style={{ fontSize: 12.5, color: C.parchmentDim }}>
                  <b style={{ color: C.parchment }}>Add to the collection's total</b> — prices are
                  summed into what you paid for the collection and split evenly across its cards.
                  Right for boosters, bundles and precons.
                </span>
              </label>
              <label style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={costMode === "perCard"}
                  onChange={() => setCostMode("perCard")}
                  style={{ marginTop: 3 }}
                />
                <span style={{ fontSize: 12.5, color: C.parchmentDim }}>
                  <b style={{ color: C.parchment }}>Keep each card's own price</b> — every row keeps
                  its individual purchase price. Right for singles you bought one at a time.
                </span>
              </label>
            </div>
          )}

          <button
            onClick={runImport}
            disabled={!rows}
            style={{
              width: "100%",
              background: rows ? STOCK_BG : C.border,
              color: rows ? C.stockInk : C.parchmentDim,
              border: "none",
              borderRadius: 6,
              padding: "11px",
              fontWeight: 700,
              fontSize: 14,
              cursor: rows ? "pointer" : "default",
              marginTop: 6,
            }}
          >
            Import {rows ? `${rows.length} cards` : ""}
          </button>
          </>
          )}

          {mode === "precon" && (
          <>
          <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0, lineHeight: 1.6 }}>
            Just bought a boxed deck? Pick it and every card goes in as the exact printing that
            comes in the box — right set, right collector number, right art, foils as printed.
          </p>
          {!precon && (
            <>
              <input
                value={preconQuery}
                onChange={(e) => setPreconQuery(e.target.value)}
                placeholder="Search — e.g. food and fellowship, LTC, commander deck"
                aria-label="Search precon decks"
                style={{ ...inputStyle, marginBottom: 10 }}
              />
              {!preconList && !preconError && (
                <div style={{ fontSize: 12.5, color: C.parchmentDim }}>Loading decks…</div>
              )}
              {preconList && (
                <div
                  role="listbox"
                  aria-label="Precon decks"
                  style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}
                >
                  {filterPrecons(preconList, preconQuery).slice(0, 80).map((d) => (
                    <button
                      key={d.fileName}
                      role="option"
                      aria-selected="false"
                      onClick={() => pickPrecon(d)}
                      disabled={preconLoading}
                      style={{
                        display: "flex",
                        width: "100%",
                        justifyContent: "space-between",
                        gap: 10,
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${C.border}`,
                        color: C.parchment,
                        padding: "9px 12px",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      <span>{d.name}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, whiteSpace: "nowrap" }}>
                        {d.code} · {d.type} · {d.releaseDate.slice(0, 4)}
                      </span>
                    </button>
                  ))}
                  {filterPrecons(preconList, preconQuery).length === 0 && (
                    <div style={{ padding: 12, fontSize: 12.5, color: C.parchmentDim }}>No deck matches that.</div>
                  )}
                </div>
              )}
            </>
          )}
          {precon && (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.parchment }}>{precon.name}</div>
              <div className="mono" style={{ fontSize: 11.5, color: C.parchmentDim, margin: "4px 0 12px" }}>
                {precon.code} · {precon.type} · {precon.recs.reduce((n, r) => n + r.qty, 0)} cards
                ({precon.recs.length} different)
              </div>
              <label
                style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: C.parchment, marginBottom: 12, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={preconNewCollection}
                  onChange={(e) => setPreconNewCollection(e.target.checked)}
                  style={{ width: 15, height: 15 }}
                />
                Put them in a new collection called “{precon.name}”
              </label>
              {!preconNewCollection && (
                <Field label="Collection for these cards" htmlFor="im-precon-collection">
                  <select
                    id="im-precon-collection"
                    style={inputStyle}
                    value={pasteCollection}
                    onChange={(e) => setPasteCollection(e.target.value)}
                  >
                    <option value={UNCATEGORIZED}>Uncategorized</option>
                    {collectionOptions(collections).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setPrecon(null)}
                  style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.parchmentDim, borderRadius: 6, padding: "11px 14px", fontSize: 13, cursor: "pointer" }}
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    runPasteImport({
                      recs: precon.recs.map((r) => ({ ...r })),
                      ...(preconNewCollection
                        ? {
                            newCollection: {
                              name: precon.name,
                              purchaseDate: new Date().toISOString().slice(0, 10),
                              note: `${precon.type} · ${precon.code} · added from the precon list`,
                            },
                          }
                        : { collectionId: pasteCollection }),
                    });
                  }}
                  style={{ flex: 1, background: STOCK_BG, color: C.stockInk, border: "none", borderRadius: 6, padding: "11px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
                >
                  Add {precon.recs.reduce((n, r) => n + r.qty, 0)} cards
                </button>
              </div>
            </>
          )}
          {preconError && <div style={{ color: C.redBright, fontSize: 12.5, marginTop: 10 }}>{preconError}</div>}
          </>
          )}
          {mode === "paste" && (
          <>
          <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0 }}>
            One card per line — <span className="mono">1 Sol Ring (LTC) 123123</span> — the same
            format Binderwyrm's own text export writes, and what Archidekt, Moxfield and most
            deckbuilders read. The set and collector number in parentheses pin the exact printing;
            leave them off and the name alone is looked up instead.
          </p>

          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onBlur={() => analysePaste()}
            placeholder={"1 Sol Ring (LTC) 123123\n4 Lightning Bolt\n10 Forest"}
            aria-label="Pasted card list"
            rows={8}
            style={{
              width: "100%",
              background: C.bgPanel2,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "10px 12px",
              color: C.parchment,
              fontSize: 12,
              fontFamily: "'IBM Plex Mono', monospace",
              resize: "vertical",
            }}
          />

          <div style={{ display: "flex", gap: 8, marginTop: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <button
              onClick={() => analysePaste()}
              disabled={!pasteText.trim()}
              style={{
                background: pasteText.trim() ? STOCK_BG : C.border,
                color: pasteText.trim() ? C.stockInk : C.parchmentDim,
                border: "none",
                borderRadius: 6,
                padding: "9px 16px",
                fontWeight: 700,
                fontSize: 13,
                cursor: pasteText.trim() ? "pointer" : "default",
              }}
            >
              Check list
            </button>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.parchmentDim,
                borderRadius: 6,
                padding: "9px 14px",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              Load a file
              <input
                ref={pasteInput}
                type="file"
                accept=".txt,.dec,.dek,text/plain"
                onChange={handlePasteFile}
                style={{ display: "none" }}
              />
            </label>
          </div>

          {parseError && (
            <div style={{ color: C.redBright, fontSize: 12.5, marginBottom: 14 }}>{parseError}</div>
          )}

          {pasteParsed && (
            <>
              <div className="mono" style={{ fontSize: 11.5, color: C.parchmentDim, marginBottom: 10 }}>
                {pasteCount} card{pasteCount === 1 ? "" : "s"} to look up on Scryfall
                {pasteParsed.ignored.length > 0
                  ? ` · ${pasteParsed.ignored.length} line${pasteParsed.ignored.length === 1 ? "" : "s"} not understood`
                  : ""}
              </div>

              {pasteParsed.ignored.length > 0 && (
                <div
                  style={{
                    border: `1px solid rgba(222,115,134,0.35)`,
                    borderRadius: 8,
                    padding: "8px 10px",
                    marginBottom: 14,
                    maxHeight: 100,
                    overflowY: "auto",
                  }}
                >
                  {pasteParsed.ignored.map((line, i) => (
                    <div key={i} className="mono" style={{ fontSize: 11, color: C.parchmentDim }}>
                      {line}
                    </div>
                  ))}
                </div>
              )}

              <Field label="Collection for these cards" htmlFor="im-paste-collection">
                <select
                  id="im-paste-collection"
                  style={inputStyle}
                  value={pasteCollection}
                  onChange={(e) => setPasteCollection(e.target.value)}
                >
                  <option value={UNCATEGORIZED}>Uncategorized</option>
                  {collectionOptions(collections).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>

              <button
                onClick={() => runPasteImport()}
                disabled={pasteCount === 0}
                style={{
                  width: "100%",
                  background: pasteCount > 0 ? STOCK_BG : C.border,
                  color: pasteCount > 0 ? C.stockInk : C.parchmentDim,
                  border: "none",
                  borderRadius: 6,
                  padding: "11px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: pasteCount > 0 ? "pointer" : "default",
                  marginTop: 6,
                }}
              >
                Import {pasteCount} card{pasteCount === 1 ? "" : "s"}
              </button>
            </>
          )}
          </>
          )}
        </>
      )}

      {progress && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <Loader2
            size={24}
            color={C.gold}
            style={{ animation: "spin 1s linear infinite", marginBottom: 10 }}
          />
          <div style={{ fontSize: 13, color: C.parchmentDim }}>
            {progress.phase} — {progress.done}/{progress.total}
          </div>
          <div
            style={{
              height: 6,
              background: C.bgPanel2,
              borderRadius: 3,
              marginTop: 10,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`,
                background: C.gold,
                transition: "width 0.2s ease",
              }}
            />
          </div>
        </div>
      )}

      {fatalError && !progress && (
        <div
          style={{
            color: C.redBright,
            fontSize: 12.5,
            marginTop: 14,
            display: "flex",
            gap: 6,
          }}
        >
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          {fatalError}
        </div>
      )}

      {report && (
        <div style={{ padding: "6px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Check size={18} color={C.greenBright} />
            <span style={{ fontSize: 14, color: C.parchment, fontWeight: 600 }}>
              {report.total} cards added
            </span>
          </div>
          {report.collections > 0 && (
            <div style={{ fontSize: 12.5, color: C.parchmentDim, marginBottom: 8 }}>
              {report.collections} collection{report.collections === 1 ? "" : "s"} created from
              the file, with purchase totals filled in.
            </div>
          )}
          {report.failed.length > 0 && (
            <div style={{ fontSize: 12.5, color: C.redBright, marginBottom: 12 }}>
              {report.failed.length} card{report.failed.length === 1 ? "" : "s"} couldn't be
              matched and were added without prices or images:{" "}
              {report.failed.slice(0, 12).join(", ")}
              {report.failed.length > 12 ? `, +${report.failed.length - 12} more` : ""}
            </div>
          )}
          <button
            onClick={onClose}
            style={{
              width: "100%",
              background: STOCK_BG,
              color: C.stockInk,
              border: "none",
              borderRadius: 6,
              padding: "11px",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      )}
    </ModalShell>
  );
}

