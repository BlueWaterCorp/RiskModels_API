"use client";

import { useEffect, useState } from "react";
import type {
  SnapshotReportData,
  SnapshotTickerRow,
} from "@/lib/portfolio/snapshot-report-types";
import { FACTOR_COLORS } from "@/lib/portfolio/snapshot-report-types";

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtNum(x: number | null, decimals = 3): string {
  if (x == null) return "\u2014";
  return x.toFixed(decimals);
}

/* ── Stacked Bar Chart ───────────────────────────────────────────── */

function VarianceBarChart({
  vd,
}: {
  vd: SnapshotReportData["portfolio_risk_index"]["variance_decomposition"];
}) {
  const total = vd.market + vd.sector + vd.subsector + vd.residual;
  if (total === 0) return null;

  const segments: { key: string; label: string; value: number; color: string }[] = [
    { key: "market", label: "Market", value: vd.market, color: FACTOR_COLORS.market },
    { key: "sector", label: "Sector", value: vd.sector, color: FACTOR_COLORS.sector },
    { key: "subsector", label: "Subsector", value: vd.subsector, color: FACTOR_COLORS.subsector },
    { key: "residual", label: "Residual", value: vd.residual, color: FACTOR_COLORS.residual },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 36,
          borderRadius: 6,
          overflow: "hidden",
          border: "1px solid #e5e7eb",
        }}
      >
        {segments.map((s) => (
          <div
            key={s.key}
            style={{
              width: `${(s.value / total) * 100}%`,
              backgroundColor: s.color,
              minWidth: s.value > 0 ? 2 : 0,
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          gap: 20,
          marginTop: 8,
          fontSize: 11,
          color: "#4b5563",
        }}
      >
        {segments.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: s.color,
                flexShrink: 0,
              }}
            />
            <span>
              {s.label}: {pct(s.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Positions Table ─────────────────────────────────────────────── */

function PositionsTable({ rows }: { rows: SnapshotTickerRow[] }) {
  const sorted = [...rows].sort((a, b) => b.weight - a.weight);

  const th: React.CSSProperties = {
    padding: "6px 10px",
    textAlign: "right",
    fontSize: 10,
    fontWeight: 600,
    color: "#6b7280",
    borderBottom: "2px solid #e5e7eb",
    whiteSpace: "nowrap",
  };

  const td: React.CSSProperties = {
    padding: "5px 10px",
    textAlign: "right",
    fontSize: 10,
    color: "#1f2937",
    borderBottom: "1px solid #f3f4f6",
    whiteSpace: "nowrap",
  };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: "left" }}>Ticker</th>
          <th style={th}>Weight</th>
          <th style={th}>Vol (23d)</th>
          <th style={th}>Price</th>
          <th style={{ ...th, color: FACTOR_COLORS.market }}>Mkt HR</th>
          <th style={{ ...th, color: FACTOR_COLORS.sector }}>Sec HR</th>
          <th style={{ ...th, color: FACTOR_COLORS.subsector }}>Sub HR</th>
          <th style={th}>Mkt ER</th>
          <th style={th}>Sec ER</th>
          <th style={th}>Sub ER</th>
          <th style={th}>Res ER</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.ticker}>
            <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{r.ticker}</td>
            <td style={td}>{(r.weight * 100).toFixed(1)}%</td>
            <td style={td}>{r.vol_23d != null ? `${(r.vol_23d * 100).toFixed(1)}%` : "\u2014"}</td>
            <td style={td}>{r.price_close != null ? `$${r.price_close.toFixed(2)}` : "\u2014"}</td>
            <td style={td}>{fmtNum(r.l3_mkt_hr)}</td>
            <td style={td}>{fmtNum(r.l3_sec_hr)}</td>
            <td style={td}>{fmtNum(r.l3_sub_hr)}</td>
            <td style={td}>{pct(r.l3_mkt_er ?? 0)}</td>
            <td style={td}>{pct(r.l3_sec_er ?? 0)}</td>
            <td style={td}>{pct(r.l3_sub_er ?? 0)}</td>
            <td style={td}>{pct(r.l3_res_er ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── Main Report ─────────────────────────────────────────────────── */

export default function RenderSnapshotPage() {
  const [data, setData] = useState<SnapshotReportData | null>(null);

  useEffect(() => {
    // Check if data was already injected before this effect ran
    if (window.__REPORT_DATA__) {
      setData(window.__REPORT_DATA__);
      return;
    }

    const handler = () => {
      if (window.__REPORT_DATA__) {
        setData(window.__REPORT_DATA__);
      }
    };

    window.addEventListener("report-data-ready", handler);
    return () => window.removeEventListener("report-data-ready", handler);
  }, []);

  if (!data) {
    return (
      <div style={{ padding: 48, color: "#9ca3af", fontSize: 14 }}>
        Waiting for report data...
      </div>
    );
  }

  const { portfolio_risk_index: pri } = data;

  return (
    <div
      data-report-ready="true"
      style={{
        width: "210mm",
        minHeight: "297mm",
        padding: "36px 40px 60px",
        boxSizing: "border-box",
        background: "white",
        color: "#111827",
        fontFamily: "'Inter', sans-serif",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 4,
        }}
      >
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: 0.5 }}>
            RISKMODELS &mdash; PORTFOLIO RISK SNAPSHOT
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0 0", color: "#111827" }}>
            {data.title}
          </h1>
        </div>
        <div style={{ textAlign: "right", fontSize: 11, color: "#6b7280" }}>
          <div>As of: {data.as_of}</div>
          <div style={{ fontSize: 9, marginTop: 2 }}>
            {pri.position_count} position{pri.position_count !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <hr style={{ border: "none", borderTop: "2px solid #2563eb", margin: "12px 0 20px 0" }} />

      {/* Summary Stats */}
      <div
        style={{
          display: "flex",
          gap: 24,
          marginBottom: 20,
        }}
      >
        <StatBox
          label="Systematic Risk"
          value={pct(pri.variance_decomposition.systematic)}
          sub="Market + Sector + Subsector"
        />
        <StatBox
          label="Residual Risk"
          value={pct(pri.variance_decomposition.residual)}
          sub="Idiosyncratic (stock-specific)"
        />
        {pri.portfolio_volatility_23d != null && (
          <StatBox
            label="Portfolio Vol (23d)"
            value={`${(pri.portfolio_volatility_23d * 100).toFixed(2)}%`}
            sub="Weighted average"
          />
        )}
      </div>

      {/* Variance Decomposition Bar */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#374151" }}>
          L3 Explained Risk — Variance Decomposition
        </h2>
        <VarianceBarChart vd={pri.variance_decomposition} />
      </div>

      {/* Positions Table */}
      <div>
        <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#374151" }}>
          Positions — Hedge Ratios & Factor Exposure
        </h2>
        <PositionsTable rows={data.per_ticker} />
      </div>

      {/* Footer */}
      <div
        style={{
          position: "absolute",
          bottom: 28,
          left: 40,
          right: 40,
          borderTop: "1px solid #e5e7eb",
          paddingTop: 8,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 8,
          color: "#9ca3af",
        }}
      >
        <span>Methodology: riskmodels.app/docs/methodology</span>
        <span>
          Powered by RiskModels &mdash; ERM3 V3 &mdash; {data._metadata.generated_at}
        </span>
      </div>
    </div>
  );
}

/* ── Stat Box ────────────────────────────────────────────────────── */

function StatBox({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      style={{
        flex: 1,
        padding: "10px 14px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{value}</div>
      <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 1 }}>{sub}</div>
    </div>
  );
}
