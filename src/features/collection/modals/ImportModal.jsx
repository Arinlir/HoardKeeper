import React, { useState, useRef } from "react";
import { AlertCircle, Check, Loader2, Upload } from "lucide-react";
import Papa from "papaparse";
import { Field, inputStyle } from "../../../components/ui/Field";
import { ModalShell } from "../../../components/ui/ModalShell";
import { CUR, CURRENCIES } from "../../../lib/format";
import { RATE_MS, UNCATEGORIZED, normalizeCard, scryfallCollection, scryfallLookup, sleep } from "../../../lib/scryfall";
import { uid } from "../../../lib/store";
import { C, STOCK_BG } from "../../../lib/tokens";

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
        scryfallUri: c ? c.scryfallUri : null,
        quantity: p.qty,
        finish,
        foil,
        condition: val(p.row, "condition") || "NM",
        collectionId: p.colName
          ? nameToId[p.colName.toLowerCase()]
          : fallbackCollection,
        location: val(p.row, "location"),
        // In allocate mode the money lives on the collection, so cards carry no
        // individual price and share the total evenly.
        costOverride:
          costMode === "perCard" && p.price !== null ? p.price * p.qty : null,
        valueOverride: p.value !== null && !c ? p.value : null,
        usd: c ? c.usd : p.value,
        usdFoil: c ? c.usdFoil : null,
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
  ];

  return (
    <ModalShell title="Import from CSV" onClose={onClose} width={560}>
      {!progress && !report && (
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
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
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

