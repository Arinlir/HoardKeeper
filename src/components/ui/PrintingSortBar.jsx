import React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { PRINT_SORTS } from "../../lib/scryfall";
import { C } from "../../lib/tokens";
import { inputStyle } from "./Field";

// The controls above any "pick a printing" list — order by, ascending or
// descending, and a text filter on the set. Shared so the collection's Add
// Card flow, the wishlist, and DetailModal's "fix the printing" panel all
// behave the same way once you're staring at a list of a card's printings.
export function PrintingSortBar({ sortKey, onSortKey, dir, onToggleDir, filterText, onFilterText }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      <input
        style={{ ...inputStyle, flex: "1 1 140px", width: "auto", fontSize: 12.5, padding: "7px 9px" }}
        value={filterText}
        onChange={(e) => onFilterText(e.target.value)}
        placeholder="Search printings…"
        aria-label="Search printings"
      />
      <select
        value={sortKey}
        onChange={(e) => onSortKey(e.target.value)}
        aria-label="Order printings by"
        style={{ ...inputStyle, width: "auto", fontSize: 12.5, padding: "7px 8px" }}
      >
        {PRINT_SORTS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        onClick={onToggleDir}
        aria-label={dir === "asc" ? "Sort ascending" : "Sort descending"}
        title={dir === "asc" ? "Ascending" : "Descending"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          color: C.parchmentDim,
          fontSize: 11,
          padding: "0 10px",
          cursor: "pointer",
        }}
      >
        {dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
        {dir === "asc" ? "Asc" : "Desc"}
      </button>
    </div>
  );
}
