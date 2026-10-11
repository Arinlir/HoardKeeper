import React from "react";
import { X } from "lucide-react";
import { C } from "./tokens";

export const MANA = {
  W: "#F1E6B6",
  U: "#3E9CE0",
  B: "#8B7FB0",
  R: "#E0563C",
  G: "#3FA35C",
};

// Turns raw Scryfall rules text ("{T}: Add {B}.") into small colored mana
// badges instead of literal curly-brace codes — the same color language
// already used for the mana-color filter dots elsewhere in the app, so a
// black pip here looks like the black pip everywhere else.
export function renderManaSymbols(text, keyPrefix = "m") {
  if (!text) return text;
  const parts = String(text).split(/(\{[^}]+\})/g);
  return parts.map((part, i) => {
    const m = part.match(/^\{([^}]+)\}$/);
    if (!m) return part; // plain text (and any \n stays a real newline for pre-line)
    const code = m[1].toUpperCase();
    const badge = (label, bg, fg) => (
      <span
        key={`${keyPrefix}-${i}`}
        className="mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: bg,
          color: fg,
          fontSize: 9.5,
          fontWeight: 700,
          lineHeight: 1,
          verticalAlign: "-3px",
          margin: "0 1px",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
    );
    if (MANA[code]) return badge(code, MANA[code], "#14161A");
    if (code === "C") return badge("C", "#9AA1AA", "#14161A");
    if (code === "T") return badge("⟳", "#14161A", "#E8ECF1");
    if (code === "Q") return badge("⟲", "#14161A", "#E8ECF1");
    if (code === "S") return badge("❄", "#B9DCEE", "#14161A");
    if (code === "E") return badge("⚡", "#F1E6B6", "#14161A");
    if (code === "X" || code === "Y" || code === "Z") return badge(code, "#9AA1AA", "#14161A");
    if (/^\d+$/.test(code)) return badge(code, "#9AA1AA", "#14161A");
    // hybrid / Phyrexian / anything else — show as-is, still visually set
    // apart from body text rather than a raw {W/U}-style code
    return (
      <span
        key={`${keyPrefix}-${i}`}
        className="mono"
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          padding: "0 3px",
          borderRadius: 4,
          background: "#9AA1AA",
          color: "#14161A",
          verticalAlign: "1px",
          margin: "0 1px",
        }}
      >
        {code}
      </span>
    );
  });
}

