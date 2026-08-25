import React from "react";
import { BarChart3, Download, Layers, Loader2, Plus, RefreshCw, Settings, Upload, Users } from "lucide-react";
import { IconButton } from "../../components/ui/IconButton";
import { StatPlaque } from "../../components/ui/StatPlaque";
import { CUR, fmt } from "../../lib/format";
import { C, STOCK_BG, STOCK_SHADOW, NOTCH, NOTCH_SM } from "../../lib/tokens";

export function Header({
  totals,
  gainPct,
  onAddCard,
  onManageCollections,
  onImport,
  onExport,
  onRefresh,
  refreshing,
  saveError,
  showCharts,
  onToggleCharts,
  onSettings,
  // Who's signed in, and how to switch -- surfaced directly in the header
  // rather than buried behind the currency/Settings button, which nothing
  // about visually suggests "this is where profiles live."
  profileName,
  onSwitchProfile,
}) {
  return (
    <header
      style={{
        padding: "26px clamp(14px, 4vw, 30px) 6px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 18,
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            aria-hidden="true"
            style={{
              width: 22,
              height: 22,
              flexShrink: 0,
              background: C.accent,
              clipPath: NOTCH_SM,
            }}
          />
          <h1
            className="display"
            style={{
              fontSize: "clamp(21px, 6vw, 28px)",
              margin: 0,
              fontWeight: 700,
              letterSpacing: 1.5,
              color: C.goldBright,
            }}
          >
            HOARDKEEPER
          </h1>
        </div>
        <div
          className="mono"
          role="status"
          aria-live="polite"
          style={{
            fontSize: 10.5,
            letterSpacing: 2.4,
            textTransform: "uppercase",
            color: C.parchmentDim,
            marginTop: 7,
          }}
        >
          {saveError ? (
            <span style={{ color: C.redBright }}>changes aren't saving</span>
          ) : (
            "a running appraisal of the collection"
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <StatPlaque label="Worth" value={fmt(totals.value)} />
        <StatPlaque label="Invested" value={fmt(totals.cost)} />
        <StatPlaque
          label="Unrealized"
          value={`${totals.delta >= 0 ? "+" : "−"}${fmt(Math.abs(totals.delta))}`}
          tone={totals.delta >= 0 ? "up" : "down"}
          sub={gainPct !== null ? `${totals.delta >= 0 ? "+" : "−"}${Math.abs(gainPct).toFixed(1)}%` : null}
        />
        {totals.realized > 0 && (
          <StatPlaque
            label="Realized"
            value={`${totals.realizedDelta >= 0 ? "+" : "−"}${fmt(Math.abs(totals.realizedDelta))}`}
            tone={totals.realizedDelta >= 0 ? "up" : "down"}
          />
        )}
      </div>

      <div style={{ width: "100%", display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
        {profileName && (
          <IconButton
            onClick={onSwitchProfile}
            label={`${profileName} · switch`}
            icon={<Users size={15} />}
            title="Switch to a different profile"
          />
        )}
        <IconButton onClick={onToggleCharts} label={showCharts ? "Hide charts" : "Charts"} icon={<BarChart3 size={15} />} active={showCharts} />
        <IconButton onClick={onSettings} label="Settings" icon={<Settings size={15} />} title={`Currency: ${CUR.code}`} />
        <IconButton onClick={onImport} label="Import CSV" icon={<Upload size={15} />} />
        <IconButton onClick={onExport} label="Export" icon={<Download size={15} />} />
        <IconButton
          onClick={onRefresh}
          label={
            refreshing
              ? refreshing.label || `Updating ${refreshing.done}/${refreshing.total}`
              : "Refresh prices & art"
          }
          icon={refreshing ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={15} />}
          disabled={!!refreshing}
        />
        <IconButton onClick={onManageCollections} label="Collections" icon={<Layers size={15} />} />
        <div style={{ flex: 1 }} />
        <button
          onClick={onAddCard}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: STOCK_BG,
            color: C.stockInk,
            border: "none",
            borderRadius: 0,
            clipPath: NOTCH,
            padding: "9px 18px",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            boxShadow: STOCK_SHADOW,
          }}
        >
          <Plus size={16} /> Add card
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </header>
  );
}

