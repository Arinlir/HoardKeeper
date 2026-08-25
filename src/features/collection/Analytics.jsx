import React, { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt, shortDate } from "../../lib/format";
import { MANA } from "../../lib/mana";
import { COLOR_BUCKETS, bucketOf, finishOf } from "../../lib/scryfall";
import { C, RARITY_COLORS, STOCK_BG, STOCK_SHADOW } from "../../lib/tokens";
import { MoversPanel } from "./MoversPanel";

export function ChartTooltip({ active, payload, label, valueKeys }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: C.bgPanel2,
        border: `1px solid ${C.borderLight}`,
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 12,
      }}
    >
      <div style={{ color: C.parchment, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="mono" style={{ color: p.color || C.goldBright }}>
          {p.name}: {fmt(p.value)}
        </div>
      ))}
    </div>
  );
}

export function ChartPanel({ title, subtitle, children, height = 240 }) {
  return (
    <div
      role="figure"
      aria-label={subtitle ? `${title} — ${subtitle}` : title}
      style={{
        background: "rgba(255,255,255,0.045)",
        border: `1px solid rgba(185,191,199,0.18)`,
        borderRadius: 10,
        padding: "14px 16px 8px",
      }}
    >
      <div style={{ marginBottom: 12, display: "flex", alignItems: "baseline", gap: 10 }}>
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            background: STOCK_BG,
            color: C.stockInk,
            fontWeight: 600,
            padding: "4px 9px",
            borderRadius: 3,
            boxShadow: STOCK_SHADOW,
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>{subtitle}</span>
        )}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function Analytics({ rows, history }) {
  const colorData = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      const b = bucketOf(r.card);
      if (!m[b]) m[b] = { value: 0, count: 0 };
      m[b].value += r.value;
      m[b].count += r.card.quantity || 1;
    });
    return COLOR_BUCKETS.filter((b) => m[b.key]).map((b) => ({
      name: b.label,
      fill: b.fill,
      value: Number(m[b.key].value.toFixed(2)),
      count: m[b.key].count,
    }));
  }, [rows]);

  const topCards = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((r) => ({
          name: r.card.name.length > 20 ? r.card.name.slice(0, 19) + "…" : r.card.name,
          value: Number(r.value.toFixed(2)),
          fill: COLOR_BUCKETS.find((b) => b.key === bucketOf(r.card))?.fill || C.gold,
        }))
        .reverse(),
    [rows]
  );

  const collectionData = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      if (!m[r.collection]) m[r.collection] = { value: 0, cost: 0 };
      m[r.collection].value += r.value;
      m[r.collection].cost += r.cost;
    });
    return Object.entries(m)
      .map(([name, v]) => ({
        name: name.length > 18 ? name.slice(0, 17) + "…" : name,
        Value: Number(v.value.toFixed(2)),
        Paid: Number(v.cost.toFixed(2)),
      }))
      .sort((a, b) => b.Value - a.Value);
  }, [rows]);

  const curveData = useMemo(() => {
    const buckets = {};
    rows.forEach((r) => {
      const t = (r.card.typeLine || "").toLowerCase();
      if (t.includes("land")) return;
      const cmc = Math.min(Math.round(r.card.cmc ?? 0), 7);
      const key = cmc === 7 ? "7+" : String(cmc);
      buckets[key] = (buckets[key] || 0) + (r.card.quantity || 1);
    });
    return ["0", "1", "2", "3", "4", "5", "6", "7+"].map((k) => ({
      name: k,
      Cards: buckets[k] || 0,
    }));
  }, [rows]);

  const rarityData = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      const rar = r.card.rarity || "unknown";
      if (!m[rar]) m[rar] = { value: 0, count: 0 };
      m[rar].value += r.value;
      m[rar].count += r.card.quantity || 1;
    });
    const order = ["common", "uncommon", "rare", "mythic", "special", "bonus", "unknown"];
    return order
      .filter((k) => m[k])
      .map((k) => ({
        name: k.charAt(0).toUpperCase() + k.slice(1),
        value: Number(m[k].value.toFixed(2)),
        count: m[k].count,
        fill: RARITY_COLORS[k] || "#7A7263",
      }));
  }, [rows]);

  const historyData = useMemo(
    () =>
      (history || []).map((h) => ({
        name: shortDate(h.t),
        Value: Number(h.value.toFixed(2)),
        Paid: Number(h.cost.toFixed(2)),
      })),
    [history]
  );

  const movers = useMemo(() => {
    return rows
      .map((r) => {
        const c = r.card;
        const shiny = finishOf(c) !== "nonfoil";
        const prev = shiny ? c.prevUsdFoil : c.prevUsd;
        const now = shiny ? c.usdFoil : c.usd;
        if (prev === null || prev === undefined || !now || prev === 0) return null;
        const qty = c.quantity || 1;
        return {
          name: c.name,
          delta: (now - prev) * qty,
          pct: ((now - prev) / prev) * 100,
        };
      })
      .filter((m) => m && Math.abs(m.pct) >= 0.5)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 8);
  }, [rows]);

  const totalColorValue = colorData.reduce((s, d) => s + d.value, 0);

  const axisStyle = { fill: C.parchmentDim, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 16,
        marginTop: 20,
      }}
    >
      <ChartPanel
        title="COLOR IDENTITY"
        subtitle={`${fmt(totalColorValue)} across ${colorData.length} color groups`}
      >
        <PieChart>
          <Pie
            data={colorData}
            dataKey="value"
            nameKey="name"
            innerRadius={52}
            outerRadius={85}
            paddingAngle={2}
            stroke={C.bg}
            strokeWidth={2}
          >
            {colorData.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, color: C.parchmentDim }}
            iconType="circle"
            iconSize={8}
          />
        </PieChart>
      </ChartPanel>

      <ChartPanel title="MOST VALUABLE CARDS" subtitle="Top 10 by total holding value">
        <BarChart data={topCards} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid horizontal={false} stroke={C.border} />
          <XAxis type="number" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            tick={{ ...axisStyle, fontSize: 10.5 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(201,162,39,0.08)" }} />
          <Bar dataKey="value" name="Value" radius={[0, 3, 3, 0]}>
            {topCards.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ChartPanel>

      <ChartPanel title="PAID vs WORTH" subtitle="By collection">
        <BarChart data={collectionData} margin={{ left: 0, right: 8 }}>
          <CartesianGrid vertical={false} stroke={C.border} />
          <XAxis
            dataKey="name"
            tick={{ ...axisStyle, fontSize: 10 }}
            axisLine={{ stroke: C.border }}
            tickLine={false}
            interval={0}
            angle={-15}
            textAnchor="end"
            height={50}
          />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={50} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(201,162,39,0.08)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="square" iconSize={8} />
          <Bar dataKey="Paid" fill={C.borderLight} radius={[3, 3, 0, 0]} />
          <Bar dataKey="Value" fill={C.gold} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartPanel>

      <ChartPanel
        title="VALUE OVER TIME"
        subtitle={
          historyData.length < 2
            ? "Refresh prices on separate days to build the line"
            : `${historyData.length} snapshots`
        }
      >
        <AreaChart data={historyData} margin={{ left: 0, right: 8 }}>
          <defs>
            <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.gold} stopOpacity={0.45} />
              <stop offset="100%" stopColor={C.gold} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={C.border} />
          <XAxis dataKey="name" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={50} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="Value"
            stroke={C.gold}
            strokeWidth={2}
            fill="url(#valueFill)"
          />
          <Line type="monotone" dataKey="Paid" stroke={C.borderLight} strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ChartPanel>

      <ChartPanel title="MANA CURVE" subtitle="Nonland cards by mana value">
        <BarChart data={curveData} margin={{ left: 0, right: 8 }}>
          <CartesianGrid vertical={false} stroke={C.border} />
          <XAxis dataKey="name" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "rgba(201,162,39,0.08)" }}
            contentStyle={{
              background: C.bgPanel2,
              border: `1px solid ${C.borderLight}`,
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: C.parchment }}
            itemStyle={{ color: C.goldBright }}
          />
          <Bar dataKey="Cards" fill={C.gold} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartPanel>

      <ChartPanel title="RARITY" subtitle="Value held by rarity tier">
        <BarChart data={rarityData} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid horizontal={false} stroke={C.border} />
          <XAxis type="number" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={82}
            tick={{ ...axisStyle, fontSize: 10.5 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(201,162,39,0.08)" }} />
          <Bar dataKey="value" name="Value" radius={[0, 3, 3, 0]}>
            {rarityData.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ChartPanel>

      <MoversPanel movers={movers} />
    </div>
  );
}

