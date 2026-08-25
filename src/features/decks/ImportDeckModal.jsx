import React, { useState } from "react";
import { Check } from "lucide-react";
import { Field } from "../../components/ui/Field";
import { ModalShell } from "../../components/ui/ModalShell";
import { C, STOCK_BG, STOCK_SHADOW } from "../../lib/tokens";
import { jsonToParsed, matchDecklist, parseDecklist } from "./deckIO";

export function ImportDeckModal({ cards, committed, onClose, onImport }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState("");

  function analyse(source, fileName) {
    setError("");
    const raw = source.trim();
    if (!raw) return;
    let parsed;
    let m = null;
    try {
      if (raw.startsWith("{")) {
        const j = jsonToParsed(raw);
        parsed = j;
        m = j.meta;
      } else {
        parsed = parseDecklist(raw);
      }
    } catch (e) {
      setError(e.message || "Couldn't read that list.");
      return;
    }
    const matched = matchDecklist(parsed, cards, committed);
    setMeta(m);
    setPreview({ ...matched, parsed });
    if (!name) {
      setName(
        m?.name ||
          (fileName ? fileName.replace(/\.(txt|json|dec|dek)$/i, "") : "") ||
          "Imported deck"
      );
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || "");
      setText(content);
      analyse(content, file.name);
    };
    reader.readAsText(file);
  }

  const totalWanted =
    preview?.parsed.entries.reduce((n, e) => n + e.qty, 0) +
    Object.values(preview?.parsed.basics || {}).reduce((n, v) => n + v, 0) +
    (preview?.parsed.commander ? 1 : 0);
  const totalMatched =
    (preview?.entries.reduce((n, e) => n + e.qty, 0) || 0) +
    Object.values(preview?.basics || {}).reduce((n, v) => n + v, 0) +
    (preview?.commanderId ? 1 : 0);

  const inputS = {
    width: "100%",
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "10px 12px",
    color: C.parchment,
    fontSize: 13,
  };

  return (
    <ModalShell title="Import a deck" onClose={onClose} width={620}>
      <p style={{ fontSize: 12.5, color: C.parchmentDim, marginTop: 0, lineHeight: 1.6 }}>
        Paste a decklist from Moxfield, Archidekt, Arena or anywhere else — or load a{" "}
        <span className="mono">.txt</span> / HoardKeeper <span className="mono">.json</span> file.
        Cards are matched against what you own; anything missing is listed rather than invented.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && analyse(text)}
        placeholder={"1 Sol Ring (LTC) 59\n4 Lightning Bolt\n10 Forest"}
        aria-label="Decklist text"
        rows={8}
        style={{ ...inputS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, resize: "vertical" }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => analyse(text)}
          disabled={!text.trim()}
          style={{
            background: text.trim() ? STOCK_BG : C.border,
            color: text.trim() ? C.stockInk : C.parchmentDim,
            border: "none",
            borderRadius: 6,
            padding: "9px 16px",
            fontWeight: 700,
            fontSize: 13,
            cursor: text.trim() ? "pointer" : "default",
            boxShadow: text.trim() ? STOCK_SHADOW : "none",
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
          <input type="file" accept=".txt,.json,.dec,.dek,text/plain,application/json" onChange={handleFile} style={{ display: "none" }} />
        </label>
      </div>

      {error && <div style={{ color: C.redBright, fontSize: 12.5, marginTop: 10 }}>{error}</div>}

      {preview && (
        <div style={{ marginTop: 16 }}>
          <Field label="Deck name" htmlFor="idm-name">
            <input id="idm-name" style={inputS} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div
            className="mono"
            style={{
              fontSize: 11.5,
              color: totalMatched === totalWanted ? C.greenBright : C.goldBright,
              marginBottom: 10,
            }}
          >
            {totalMatched} of {totalWanted} cards matched from your collection
            {preview.commanderId ? " · commander found" : preview.parsed.commander ? " · commander missing" : ""}
          </div>

          {(preview.missing.length > 0 || preview.partial.length > 0) && (
            <div
              style={{
                border: `1px solid rgba(222,115,134,0.35)`,
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 12,
                maxHeight: 170,
                overflowY: "auto",
              }}
            >
              <div
                className="mono"
                style={{ fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.redBright, marginBottom: 6 }}
              >
                Not added — you don't own these (or they're in another deck)
              </div>
              {preview.missing.map((m, i) => (
                <div key={`m${i}`} className="mono" style={{ fontSize: 11, color: C.parchmentDim, padding: "1px 0" }}>
                  {m.qty}× {m.name}
                  {m.isCommander ? " (commander)" : ""}
                </div>
              ))}
              {preview.partial.map((p, i) => (
                <div key={`p${i}`} className="mono" style={{ fontSize: 11, color: C.parchmentDim, padding: "1px 0" }}>
                  {p.name} — only {p.have} of {p.qty} available
                </div>
              ))}
            </div>
          )}

          {preview.parsed.sideboard?.length > 0 && (
            <div className="mono" style={{ fontSize: 10.5, color: C.parchmentDim, marginBottom: 10 }}>
              {preview.parsed.sideboard.length} sideboard line
              {preview.parsed.sideboard.length === 1 ? "" : "s"} ignored — HoardKeeper decks don't
              track sideboards.
            </div>
          )}

          <button
            onClick={() =>
              onImport({
                name: name.trim() || "Imported deck",
                format:
                  meta?.format ||
                  (preview.commanderId || preview.parsed.commander ? "commander" : "standard"),
                colors: meta?.colors || null,
                commanderId: preview.commanderId,
                entries: preview.entries,
                basics: preview.basics,
                tokenCounts: meta?.tokenCounts || {},
                extraTokens: meta?.extraTokens || [],
              })
            }
            disabled={preview.entries.length === 0 && !preview.commanderId}
            style={{
              width: "100%",
              background: STOCK_BG,
              color: C.stockInk,
              border: "none",
              borderRadius: 6,
              padding: "12px",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              boxShadow: STOCK_SHADOW,
            }}
          >
            Create deck with {totalMatched} card{totalMatched === 1 ? "" : "s"}
          </button>
        </div>
      )}
    </ModalShell>
  );
}

