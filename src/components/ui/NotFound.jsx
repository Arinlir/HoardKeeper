import React from "react";
import { Ghost } from "lucide-react";
import { C, STOCK_BG, NOTCH } from "../../lib/tokens";

// Shown for any address the app doesn't have a page for (see lib/router.js).
export function NotFound({ path, onHome }) {
  return (
    <main
      role="alert"
      style={{ padding: "48px clamp(14px, 4vw, 30px) 64px", display: "flex", justifyContent: "center" }}
    >
      <div style={{ textAlign: "center", maxWidth: 480 }}>
        <Ghost size={34} color={C.gold} style={{ marginBottom: 10 }} />
        <div className="display" style={{ fontSize: 56, fontWeight: 700, letterSpacing: 4, color: C.goldBright, lineHeight: 1 }}>
          404
        </div>
        <div className="display" style={{ fontSize: 20, color: C.goldBright, margin: "10px 0 8px" }}>
          This page isn't in the binder
        </div>
        <div style={{ fontSize: 13.5, color: C.parchmentDim, marginBottom: 6 }}>
          Nothing lives at
        </div>
        <code
          className="mono"
          style={{ display: "inline-block", maxWidth: "100%", overflowWrap: "anywhere", fontSize: 12.5, color: C.parchmentDim, marginBottom: 22 }}
        >
          {path}
        </code>
        <div>
          <a
            href="/"
            onClick={(e) => {
              if (!onHome || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
              e.preventDefault();
              onHome();
            }}
            className="display"
            style={{
              display: "inline-block",
              background: STOCK_BG,
              color: C.stockInk,
              clipPath: NOTCH,
              padding: "10px 22px",
              fontWeight: 700,
              fontSize: 13.5,
              letterSpacing: 1.2,
              textDecoration: "none",
            }}
          >
            Back to my collection
          </a>
        </div>
      </div>
    </main>
  );
}
