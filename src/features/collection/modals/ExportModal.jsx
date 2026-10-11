import React, { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { ModalShell } from "../../../components/ui/ModalShell";
import { downloadFile } from "../../../lib/downloads";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH, NOTCH_SM } from "../../../lib/tokens";
import { EXPORT_FORMATS, buildExport, selectCards } from "../exportFormats";

// Pick who the file is for, see what it'll look like, take it. The formats are
// buttons rather than a menu because there are five of them and the choice is
// the whole point of the dialog.
export function ExportModal({ cards, ctx, onClose }) {
  const [formatKey, setFormatKey] = useState("binderwyrm");
  const format = EXPORT_FORMATS.find((f) => f.key === formatKey) || EXPORT_FORMATS[0];
  const [includeSold, setIncludeSold] = useState(false);
  const [proxyChoice, setProxyChoice] = useState(null); // null = follow the format's default
  const includeProxies = proxyChoice === null ? format.proxiesByDefault : proxyChoice;
  const [busy, setBusy] = useState(false);

  const proxyCount = useMemo(() => cards.filter((c) => c.proxy && !c.sold).length, [cards]);
  const soldCount = useMemo(() => cards.filter((c) => c.sold).length, [cards]);
  const selected = useMemo(
    () => selectCards(cards, { includeSold, includeProxies }),
    [cards, includeSold, includeProxies]
  );

  // The first couple of lines of the real thing, built from the real cards.
  const preview = useMemo(() => {
    const built = buildExport(formatKey, selected.slice(0, 2), { ...ctx, includeSold: true, includeProxies: true });
    if (built.kind === "text") return built.content || "(nothing to export)";
    const cell = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [built.columns.join(","), ...built.rows.map((r) => built.columns.map((k) => cell(r[k])).join(","))].join("\n");
  }, [formatKey, selected, ctx]);

  async function run() {
    setBusy(true);
    try {
      const built = buildExport(formatKey, cards, { ...ctx, includeSold, includeProxies });
      if (built.kind === "text") {
        downloadFile(built.filename, built.content, "text/plain;charset=utf-8");
      } else {
        const { default: Papa } = await import("papaparse");
        downloadFile(built.filename, Papa.unparse({ fields: built.columns, data: built.rows }), "text/csv;charset=utf-8");
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Export collection" onClose={onClose} width={560}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.parchmentDim, marginBottom: 8 }}>
        Who's it for
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {EXPORT_FORMATS.map((f) => {
          const on = f.key === formatKey;
          return (
            <button
              key={f.key}
              onClick={() => setFormatKey(f.key)}
              aria-pressed={on}
              style={{
                background: on ? C.accentFill : "transparent",
                color: on ? C.goldBright : C.parchmentDim,
                border: `1px solid ${on ? C.accent : C.border}`,
                borderRadius: 0,
                clipPath: NOTCH_SM,
                padding: "7px 13px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <p style={{ fontSize: 12.5, color: C.parchmentDim, lineHeight: 1.55, marginTop: 0, marginBottom: 14 }}>
        {format.blurb}
        {format.key !== "binderwyrm" && (
          <>
            {" "}
            Prices go out in <strong style={{ color: C.parchment }}>US dollars</strong>, because that's what these
            importers assume.
          </>
        )}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: C.parchment, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={includeProxies}
            onChange={(e) => setProxyChoice(e.target.checked)}
            style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
          />
          <span>
            Include proxies{proxyCount ? ` (${proxyCount})` : ""}
            <span style={{ display: "block", fontSize: 11.5, color: C.parchmentDim, marginTop: 2 }}>
              {format.key === "moxfield"
                ? "Moxfield keeps them flagged as proxies."
                : format.key === "binderwyrm"
                ? "Kept, with the proxy flag, so a re-import is a faithful copy."
                : "Off by default — the other site has no idea they're proxies and would count them as cards you own."}
            </span>
          </span>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: C.parchment, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={includeSold}
            onChange={(e) => setIncludeSold(e.target.checked)}
            style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
          />
          <span>
            Include sold cards{soldCount ? ` (${soldCount})` : ""}
            <span style={{ display: "block", fontSize: 11.5, color: C.parchmentDim, marginTop: 2 }}>
              You don't own these any more; only the Binderwyrm format records that they were sold.
            </span>
          </span>
        </label>
      </div>

      <div className="mono" style={{ fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.parchmentDim, marginBottom: 6 }}>
        First lines of the file
      </div>
      <pre
        data-role="export-preview"
        className="mono"
        style={{
          margin: "0 0 14px",
          padding: "10px 12px",
          background: C.bgPanel2,
          border: `1px solid ${C.border}`,
          fontSize: 10.5,
          lineHeight: 1.6,
          color: C.parchment,
          overflowX: "auto",
          whiteSpace: "pre",
          maxHeight: 140,
        }}
      >
        {preview}
      </pre>

      <button
        onClick={run}
        disabled={busy || selected.length === 0}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          background: STOCK_BG,
          color: C.stockInk,
          border: "none",
          borderRadius: 0,
          clipPath: NOTCH,
          padding: "11px",
          fontWeight: 700,
          fontSize: 13.5,
          cursor: selected.length === 0 ? "default" : "pointer",
          opacity: selected.length === 0 ? 0.5 : 1,
          boxShadow: STOCK_SHADOW,
        }}
      >
        <Download size={15} />
        Download {selected.length} card{selected.length === 1 ? "" : "s"} as .{format.ext}
      </button>
    </ModalShell>
  );
}
