import React, { useState } from "react";
import { Plus, X } from "lucide-react";
import { addTag, normalizeTag, removeTag } from "../../lib/tags";
import { C, NOTCH_SM } from "../../lib/tokens";

/*
 * Tag chips plus a box to type a new one. Suggestions are the tags already in
 * use, offered as buttons rather than a dropdown — one tap on the phone, and
 * you can see what you've been calling things.
 */
export function TagEditor({ tags = [], suggestions = [], onChange, label = "Tags" }) {
  const [draft, setDraft] = useState("");
  const has = (t) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const unused = suggestions.filter((s) => !has(s.tag)).slice(0, 8);

  function commit(value) {
    const t = normalizeTag(value);
    if (!t) return;
    onChange(addTag(tags, t));
    setDraft("");
  }

  return (
    <div>
      <div
        className="mono"
        style={{ fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.parchmentDim, marginBottom: 6 }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 7 }}>
        {tags.map((t) => (
          <span
            key={t}
            className="mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 10.5,
              padding: "3px 7px",
              color: C.goldBright,
              background: C.accentFill,
              border: `1px solid ${C.accent}`,
              clipPath: NOTCH_SM,
            }}
          >
            {t}
            <button
              onClick={() => onChange(removeTag(tags, t))}
              aria-label={`Remove tag ${t}`}
              style={{ background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer", display: "flex" }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {tags.length === 0 && (
          <span style={{ fontSize: 11.5, color: C.parchmentDim, fontStyle: "italic" }}>
            None yet — try "trade", "sleeved", "sentimental".
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            }
          }}
          placeholder="Add a tag…"
          aria-label="Add a tag"
          style={{
            flex: 1,
            minWidth: 0,
            background: C.bgPanel2,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "7px 10px",
            color: C.parchment,
            fontSize: 12.5,
          }}
        />
        <button
          onClick={() => commit(draft)}
          disabled={!draft.trim()}
          aria-label="Add tag"
          style={{
            background: "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            color: draft.trim() ? C.goldBright : C.parchmentDim,
            cursor: draft.trim() ? "pointer" : "default",
            padding: "0 10px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      {unused.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
          {unused.map((s) => (
            <button
              key={s.tag}
              onClick={() => commit(s.tag)}
              className="mono"
              title={`Used on ${s.count} card${s.count === 1 ? "" : "s"}`}
              style={{
                fontSize: 10,
                padding: "3px 7px",
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.parchmentDim,
                clipPath: NOTCH_SM,
                cursor: "pointer",
              }}
            >
              + {s.tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
