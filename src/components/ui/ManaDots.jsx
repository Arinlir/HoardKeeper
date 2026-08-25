import React from "react";
import { MANA } from "../../lib/mana";

const COLOR_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

export function ManaDots({ colors }) {
  if (!colors || colors.length === 0) {
    return (
      <span
        role="img"
        aria-label="Colorless"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#5a5142",
          display: "inline-block",
        }}
      />
    );
  }
  const label = colors.map((c) => COLOR_NAMES[c] || c).join(", ");
  return (
    <div role="img" aria-label={label} style={{ display: "flex", gap: 3 }}>
      {colors.map((c) => (
        <span
          key={c}
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: MANA[c] || "#888",
            display: "inline-block",
          }}
        />
      ))}
    </div>
  );
}

// Falls back to a generated face tinted by color identity when a card has no
// artwork yet (manual entries, or rows imported without a Scryfall match).
