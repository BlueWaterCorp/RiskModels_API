/**
 * F1 — Fund Tearsheet (Letter landscape, server-rendered via Playwright).
 *
 * Single-page institutional tearsheet for one mutual fund. Consumes the
 * composed FundSnapshot JSON shipped by `/api/funds/snapshot/{bw_fund_id}`
 * (Stage D.1 + B.2.d nav_history) and lays out four analytical zones plus
 * an identity rail:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Header (fund name + ticker chip + as-of)                    │
 *   ├──────────────┬───────────────────────────────────────────────┤
 *   │ Identity     │ AI summary lead                                │
 *   │  rail        ├───────────────────────────────────────────────┤
 *   │  (24%)       │ I. Cumulative Returns (line + waterfall)      │
 *   │              ├───────────────────────────────────────────────┤
 *   │              │ II. Cohort Rank Card                          │
 *   │              ├───────────────────────────────────────────────┤
 *   │              │ III. Top Holdings                             │
 *   ├──────────────┴───────────────────────────────────────────────┤
 *   │ Footer (lineage + confidentiality)                           │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * No external chart library — all charts are pure SVG. Inline styles only;
 * no Tailwind on this template so the print/CSS budget stays small and
 * Playwright doesn't fight cascade resolution during PDF generation.
 */

import React from "react";

import type { FundSnapshot } from "@/lib/funds/snapshot-composer";

import { LAYER_COLORS, PAGE, PALETTE, SPACING } from "./_theme";
import { buildWaterfall, computeCumulativeSeries } from "./cumulative-math";
import { CumulativeChart } from "./components/CumulativeChart";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function fmtPct(x: number | null, decimals = 1, signed = true): string {
  if (x == null) return "—";
  const v = x * 100;
  return signed ? `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%` : `${v.toFixed(decimals)}%`;
}

function fmtNum(x: number | null, decimals = 2): string {
  if (x == null) return "—";
  return x.toFixed(decimals);
}

function fmtCount(x: number | null): string {
  if (x == null) return "—";
  return x.toLocaleString();
}

function pctColor(x: number | null): string {
  if (x == null) return PALETTE.textMid;
  return x >= 0 ? PALETTE.green : PALETTE.orange;
}

/**
 * Lead-sentence narrative summary derived directly from the snapshot data.
 * Real model-generated insights land in a follow-up; this version surfaces
 * the dominant risk driver + selection α + cohort rank highlight.
 */
function buildAiSummary(snap: FundSnapshot, navEndpoint: number | null, grossEndpoint: number): string {
  const m = snap.metrics.returns;
  const factors = {
    market: Math.abs(m.market ?? 0),
    sector: Math.abs(m.sector ?? 0),
    subsector: Math.abs(m.subsector ?? 0),
    residual: Math.abs(m.idiosyncratic ?? 0),
  };
  const total = factors.market + factors.sector + factors.subsector + factors.residual || 1e-9;
  const dominant = (Object.entries(factors).sort(([, a], [, b]) => b - a)[0] ?? ["market", 0])[0];
  const dominantPct = (factors[dominant as keyof typeof factors] / total) * 100;

  const bestRank = snap.cohort_context?.ranks.reduce<{ metric: string; rank: number; size: number | null } | null>(
    (acc, r) => {
      if (r.cohort_size == null || r.cohort_size === 0) return acc;
      const pct = r.rank / r.cohort_size;
      if (acc == null || pct < acc.rank / (acc.size ?? r.cohort_size)) {
        return { metric: r.metric, rank: r.rank, size: r.cohort_size };
      }
      return acc;
    },
    null,
  );

  const lead = `${dominant.charAt(0).toUpperCase() + dominant.slice(1)} is the dominant return driver (${dominantPct.toFixed(0)}% of attribution); residual α of ${fmtPct(m.idiosyncratic)} reflects stock selection.`;
  const bits: string[] = [];
  if (navEndpoint != null) {
    const gap = navEndpoint - grossEndpoint;
    bits.push(
      `Realised NAV ${fmtPct(navEndpoint)} ${gap >= 0 ? "outpaces" : "trails"} the 13F-derived gross by ${fmtPct(Math.abs(gap), 1, false)} — gap captures intra-quarter trading + fees`,
    );
  }
  if (bestRank) {
    bits.push(`ranks ${bestRank.rank} of ${bestRank.size} in ${snap.equity_style_9box ?? "cohort"} on ${bestRank.metric.replace(/_/g, " ")}`);
  }
  return bits.length > 0 ? `${lead} ${bits.join("; ")}.` : lead;
}

// ─────────────────────────────────────────────────────────────────────
// Identity rail
// ─────────────────────────────────────────────────────────────────────

function IdentityRail({ snap }: { snap: FundSnapshot }) {
  const m = snap.metrics;
  const nFundsInCell = snap.cohort_context?.n_funds_in_cell ?? null;

  const Row = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 10 }}>
      <span style={{ color: PALETTE.textMid }}>{label}</span>
      <span style={{ fontWeight: 600, color: valueColor ?? PALETTE.textDark }}>{value}</span>
    </div>
  );
  const SectionHead = ({ children }: { children: string }) => (
    <div
      style={{
        marginTop: SPACING.md,
        marginBottom: 4,
        fontSize: 9,
        fontWeight: 600,
        color: PALETTE.textLight,
        letterSpacing: 0.6,
        borderBottom: `1px solid ${PALETTE.axisLine}`,
        paddingBottom: 2,
      }}
    >
      {children}
    </div>
  );

  return (
    <div
      style={{
        background: PALETTE.bgLight,
        border: `1px solid ${PALETTE.axisLine}`,
        borderRadius: 4,
        padding: SPACING.md,
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: PALETTE.navy, lineHeight: 1.15 }}>
        {snap.fund_name ?? snap.bw_fund_id}
      </div>
      <div style={{ fontSize: 10, color: PALETTE.textMid, marginTop: 3 }}>
        {snap.ticker ?? snap.bw_fund_id} · {snap.report_date}
      </div>

      <SectionHead>IDENTITY</SectionHead>
      <Row label="bw_fund_id" value={snap.bw_fund_id} />
      <Row label="9-box cell" value={snap.equity_style_9box ?? "—"} />
      <Row label="Funds in cell" value={fmtCount(nFundsInCell)} />
      <Row label="Holdings" value={fmtCount(m.diagnostics.n_holdings_active)} />
      <Row label="Effective N" value={fmtNum(m.diagnostics.effective_n, 1)} />

      <SectionHead>TRAILING RETURN (PORTFOLIO)</SectionHead>
      <Row label="Gross" value={fmtPct(m.returns.gross)} valueColor={pctColor(m.returns.gross)} />
      <Row label="Market (L1)" value={fmtPct(m.returns.market)} valueColor={pctColor(m.returns.market)} />
      <Row label="Sector (L2)" value={fmtPct(m.returns.sector)} valueColor={pctColor(m.returns.sector)} />
      <Row label="Subsector (L3)" value={fmtPct(m.returns.subsector)} valueColor={pctColor(m.returns.subsector)} />
      <Row label="Residual α" value={fmtPct(m.returns.idiosyncratic)} valueColor={pctColor(m.returns.idiosyncratic)} />

      <SectionHead>CONCENTRATION</SectionHead>
      <Row label="Top-10 weight" value={fmtPct(m.diagnostics.top10_weight_sum, 1, false)} />
      <Row label="Weight sum" value={fmtPct(m.diagnostics.weight_sum, 1, false)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cohort rank card (II)
// ─────────────────────────────────────────────────────────────────────

function CohortRankCard({ snap }: { snap: FundSnapshot }) {
  const ranks = snap.cohort_context?.ranks ?? [];
  if (ranks.length === 0) {
    return (
      <div style={{ fontSize: 10, color: PALETTE.textMid, fontStyle: "italic" }}>
        No cohort rankings available for this fund.
      </div>
    );
  }
  // Take a representative subset — first 6 distinct (metric, period_window) entries.
  const sorted = [...ranks]
    .filter((r) => r.cohort_size != null && r.cohort_size > 0)
    .slice(0, 6);
  const cellName = snap.cohort_context?.equity_style_9box ?? "cohort";

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr style={{ color: PALETTE.textMid, borderBottom: `1px solid ${PALETTE.axisLine}` }}>
            <th style={{ textAlign: "left", padding: "3px 6px", fontWeight: 600 }}>Metric</th>
            <th style={{ textAlign: "left", padding: "3px 6px", fontWeight: 600 }}>Window</th>
            <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>Rank</th>
            <th style={{ width: "40%", padding: "3px 6px" }}>Percentile in {cellName}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const pct = r.cohort_size ? (1 - r.rank / r.cohort_size) * 100 : null;
            const tone = pct == null ? PALETTE.textMid : pct >= 50 ? PALETTE.green : PALETTE.orange;
            return (
              <tr key={`${r.metric}-${r.period_window}-${i}`} style={{ borderBottom: `1px solid ${PALETTE.axisLine}` }}>
                <td style={{ padding: "3px 6px", color: PALETTE.textDark }}>
                  {r.metric.replace(/_/g, " ")}
                </td>
                <td style={{ padding: "3px 6px", color: PALETTE.textMid }}>{r.period_window}</td>
                <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: 600 }}>
                  {r.rank} / {r.cohort_size}
                </td>
                <td style={{ padding: "3px 6px" }}>
                  <div
                    style={{
                      position: "relative",
                      height: 10,
                      background: PALETTE.axisLine,
                      borderRadius: 1,
                    }}
                  >
                    {pct != null && (
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          height: "100%",
                          width: `${pct}%`,
                          background: tone,
                          borderRadius: 1,
                        }}
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Holdings table (III)
// ─────────────────────────────────────────────────────────────────────

function HoldingsTable({ snap }: { snap: FundSnapshot }) {
  const top = snap.holdings?.top ?? [];
  if (top.length === 0) {
    return (
      <div style={{ fontSize: 10, color: PALETTE.textMid, fontStyle: "italic" }}>
        No holdings available.
      </div>
    );
  }
  const rows = top.slice(0, 10);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
      <thead>
        <tr style={{ color: PALETTE.textMid, borderBottom: `1px solid ${PALETTE.axisLine}` }}>
          <th style={{ textAlign: "left", padding: "3px 6px", fontWeight: 600 }}>Symbol</th>
          <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>Adj MV</th>
          <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>Weight</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((h) => (
          <tr key={h.bw_sym_id} style={{ borderBottom: `1px solid ${PALETTE.axisLine}` }}>
            <td style={{ padding: "3px 6px", color: PALETTE.textDark, fontFamily: "monospace" }}>
              {h.bw_sym_id}
            </td>
            <td style={{ padding: "3px 6px", textAlign: "right" }}>
              {h.adj_mv ? `$${(h.adj_mv / 1_000_000).toFixed(1)}M` : "—"}
            </td>
            <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: 600 }}>
              {h.weight != null ? fmtPct(h.weight, 2, false) : "—"}
            </td>
          </tr>
        ))}
        {snap.holdings && snap.holdings.n_total_holdings > rows.length && (
          <tr>
            <td colSpan={3} style={{ padding: "3px 6px", fontSize: 9, color: PALETTE.textLight, fontStyle: "italic" }}>
              + {snap.holdings.n_total_holdings - rows.length} smaller positions not shown
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section header helper
// ─────────────────────────────────────────────────────────────────────

function SectionTitle({ index, title, blurb }: { index: string; title: string; blurb?: string }) {
  return (
    <div style={{ marginBottom: SPACING.xs }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: SPACING.sm }}>
        <span style={{ color: PALETTE.navy, fontSize: 12, fontWeight: 700 }}>{index}.</span>
        <span style={{ color: PALETTE.navy, fontSize: 12, fontWeight: 600 }}>{title}</span>
      </div>
      {blurb && (
        <div style={{ color: PALETTE.teal, fontSize: 9, fontStyle: "italic", marginTop: 1 }}>
          {blurb}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main composition
// ─────────────────────────────────────────────────────────────────────

export function F1FundTearsheet({ snap }: { snap: FundSnapshot }) {
  const series = computeCumulativeSeries(
    snap.portfolio_history.rows,
    snap.nav_history?.rows ?? [],
  );
  const waterfall = buildWaterfall(series);
  const grossEnd = waterfall.gross;
  const navEnd = waterfall.nav;
  const summary = buildAiSummary(snap, navEnd, grossEnd);

  return (
    <div
      data-report-ready="true"
      style={{
        width: PAGE.width,
        height: PAGE.height,
        padding: PAGE.margin,
        boxSizing: "border-box",
        background: PALETTE.white,
        color: PALETTE.textDark,
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          paddingBottom: SPACING.sm,
          borderBottom: `2px solid ${PALETTE.navy}`,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 8,
              letterSpacing: 0.6,
              color: PALETTE.textLight,
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            RiskModels — Fund Tearsheet
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: PALETTE.navy, lineHeight: 1.05 }}>
            {snap.fund_name ?? snap.bw_fund_id}
            {snap.ticker && (
              <span style={{ fontSize: 13, fontWeight: 500, color: PALETTE.teal, marginLeft: 8 }}>
                ({snap.ticker})
              </span>
            )}
          </h1>
        </div>
        <div style={{ textAlign: "right", fontSize: 9, color: PALETTE.textMid, lineHeight: 1.5 }}>
          <div>F1 · Factor & NAV Profile</div>
          <div>As of {snap.report_date}</div>
          {snap.equity_style_9box && <div>{snap.equity_style_9box}</div>}
        </div>
      </div>

      {/* ── Two-column body ─────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1.55in 1fr",
          gap: SPACING.md,
          marginTop: SPACING.md,
          minHeight: 0,
        }}
      >
        <IdentityRail snap={snap} />

        <div style={{ display: "flex", flexDirection: "column", gap: SPACING.md, minWidth: 0 }}>
          {/* AI summary */}
          <div
            style={{
              background: PALETTE.bgPanel,
              padding: SPACING.sm,
              borderRadius: 4,
              fontSize: 10,
              lineHeight: 1.4,
              color: PALETTE.textDark,
            }}
          >
            <strong style={{ color: PALETTE.navy }}>Summary.</strong> {summary}
          </div>

          {/* I. Cumulative Returns */}
          <div>
            <SectionTitle
              index="I"
              title="Cumulative Returns"
              blurb={`Trailing ${snap.portfolio_history.lookback_months} months — gross-fund and L*-layer paths from the per-fund Slice 8 zarr; realised NAV (yfinance) overlaid in green where available`}
            />
            <CumulativeChart series={series} waterfall={waterfall} width={760} height={210} />
          </div>

          {/* II + III — side-by-side */}
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: SPACING.md, minHeight: 0 }}>
            <div>
              <SectionTitle
                index="II"
                title="Cohort Rank"
                blurb={`Rank within ${snap.cohort_context?.equity_style_9box ?? "9-box cell"} across every metric × window the rankings table covers`}
              />
              <CohortRankCard snap={snap} />
            </div>
            <div>
              <SectionTitle index="III" title="Top Holdings" />
              <HoldingsTable snap={snap} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: SPACING.sm,
          paddingTop: SPACING.xs,
          borderTop: `1px solid ${PALETTE.axisLine}`,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 8,
          color: PALETTE.textLight,
        }}
      >
        <span>
          ERM3 V3 · {snap._metadata.model_version ?? "—"} · 13F report {snap.report_date} · filed {snap.filing_date}
        </span>
        <span>BW Macro · Confidential · Not investment advice</span>
      </div>

      {/* legend strip */}
      <div
        style={{
          position: "absolute",
          right: PAGE.margin.split(" ")[1] ?? "0.5in",
          bottom: "0.55in",
          display: "flex",
          gap: SPACING.md,
          fontSize: 8,
          color: PALETTE.textLight,
        }}
      >
        {[
          { color: LAYER_COLORS.l1_market, label: "L1 Mkt", dashed: true },
          { color: LAYER_COLORS.l2_sector, label: "L2 Sec", dashed: true },
          { color: LAYER_COLORS.l3_subsector, label: "L3 Sub", dashed: true },
          { color: LAYER_COLORS.residual, label: "Residual" },
          { color: LAYER_COLORS.gross, label: "Gross (13F)" },
          { color: LAYER_COLORS.nav, label: "NAV" },
        ].map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 14,
                height: 0,
                borderTop: `${l.dashed ? "1px dashed" : "2px solid"} ${l.color}`,
                display: "inline-block",
              }}
            />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
