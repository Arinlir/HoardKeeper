import React from "react";
import { C } from "../../lib/tokens";

export function Field({ label, children, htmlFor }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        htmlFor={htmlFor}
        style={{ display: "block", fontSize: 12, color: C.parchmentDim, marginBottom: 5 }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export const inputStyle = {
  width: "100%",
  background: C.bgPanel2,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "9px 10px",
  color: C.parchment,
  fontSize: 13,
};

// Money is stored in USD but always typed and shown in the display currency.
