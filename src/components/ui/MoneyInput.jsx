import React, { useState, useEffect } from "react";
import { CUR, convert, unconvert } from "../../lib/format";
import { C } from "../../lib/tokens";
import { inputStyle } from "./Field";

export function MoneyInput({ valueUsd, onChange, placeholder, autoFocus, step = "0.01", id }) {
  const toText = (v) =>
    v === null || v === undefined || v === "" || isNaN(v)
      ? ""
      : String(Math.round(convert(v) * 100) / 100);

  const [text, setText] = useState(() => toText(valueUsd));
  const [focused, setFocused] = useState(false);

  // Resync when the value or currency changes underneath us, but never while
  // the user is mid-keystroke.
  useEffect(() => {
    if (!focused) setText(toText(valueUsd));
  }, [valueUsd, focused, CUR.code, CUR.czkRate, CUR.eurRate]);

  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        autoComplete="off"
        step={step}
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value === "" ? null : unconvert(Number(e.target.value)));
        }}
        style={{ ...inputStyle, paddingRight: 46 }}
      />
      <span
        className="mono"
        style={{
          position: "absolute",
          right: 26,
          top: 10,
          fontSize: 11,
          color: C.parchmentDim,
          pointerEvents: "none",
        }}
      >
        {CUR.code}
      </span>
    </div>
  );
}

