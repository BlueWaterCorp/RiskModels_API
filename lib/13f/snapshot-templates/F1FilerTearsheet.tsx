/**
 * F1 — 13F Filer Tearsheet (Letter landscape, server-rendered via Playwright).
 *
 * Single-page institutional tearsheet for one 13F filer. Consumes the
 * composed FilerSnapshot JSON from `/api/13f/filers/{id}/snapshot`.
 *
 * Differs from the fund F1 tearsheet (BWMACRO/docs/13f_pipeline_plan.md §7.4):
 *   - No NAV section (filers have no NAV time series).
 *   - No cumulative-returns chart in Phase 1 (return components are NULL
 *     until D.8 Phase 2 ships per-filer L3 attribution).
 *   - Cohort axis is filer_type × aum_tier, not equity_style_9box.
 *   - Adds a portfolio-derived 9-box heatmap as the primary visual —
 *     the only 9-box signal on the filer side, derived from weighted
 *     in-ERM3 holdings.
 *   - Always reports coverage_in_erm3 + aum_in_erm3 so consumers don't
 *     conflate low-coverage filers with non-modelable ones.
 *
 * Theme primitives reused from ../../funds/snapshot-templates/_theme.ts.
 */

import React from "react";

import type { FilerSnapshot } from "@/lib/13f/filer-snapshot-composer";
import { PAGE, PALETTE, SPACING } from "@/lib/funds/snapshot-templates/_theme";

const NINE_BOX_CELLS = [
  "Large Value", "Large Blend", "Large Growth",
  "Mid-Cap Value", "Mid-Cap Blend", "Mid-Cap Growth",
  "Small Value", "Small Blend", "Small Growth",
] as const;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function fmtPct(x: number | null, decimals = 1): string {
  if (x == null) return "—";
  return `${(x * 100).toFixed(decimals)}%`;
}

function fmtNum(x: number | null, decimals = 2): string {
  if (x == null) return "—";
  return x.toFixed(decimals);
}

function fmtCount(x: number | null): string {
  if (x == null) return "—";
  return x.toLocaleString();
}

function fmtUsd(x: number | null): string {
  if (x == null) return "—";
  if (x >= 1e12) return `$${(x / 1e12).toFixed(2)}T`;
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  return `$${x.toLocaleString()}`;
}

// ─────────────────────────────────────────────────────────────────────
// Identity rail
// ─────────────────────────────────────────────────────────────────────

function IdentityRail({ snap }: { snap: FilerSnapshot }) {
  const Row = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 10 }}>
      <span style={{ color: PALETTE.textMid }}>{label}</span>
      <span style={{ fontWeight: 600, color: valueColor ?? PALETTE.textDark, textAlign: "right" }}>{value}</span>
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
        {snap.name ?? snap.bw_filer_id}
      </div>
      <div style={{ fontSize: 10, color: PALETTE.textMid, marginTop: 3 }}>
        CIK {snap.cik ?? "—"} · {snap.report_date ?? "no filing"}
      </div>

      <SectionHead>IDENTITY</SectionHead>
      <Row label="bw_filer_id" value={snap.bw_filer_id} />
      <Row label="Type" value={snap.filer_type ?? "—"} />
      <Row label="Subtype" value={snap.filer_subtype ?? "—"} />
      <Row label="AUM tier" value={snap.aum_tier ?? "—"} />
      <Row label="Total AUM" value={fmtUsd(snap.metrics.total_aum_usd)} />
      <Row label="ERM3 AUM" value={fmtUsd(snap.metrics.aum_in_erm3)} />

      <SectionHead>HOLDINGS</SectionHead>
      <Row label="Total positions" value={fmtCount(snap.metrics.n_holdings_active)} />
      <Row label="In ERM3" value={fmtCount(snap.metrics.n_holdings_in_erm3)} />
      <Row label="Effective N (positions)" value={fmtNum(snap.metrics.effective_n_in_erm3, 1)} />
      <Row label="Top-10 weight" value={fmtPct(snap.metrics.top10_weight_sum, 0)} />

      <SectionHead>STYLE</SectionHead>
      <Row
        label="Dominant 9-box"
        value={snap.style_attribution?.dominant_9box ?? "—"}
      />
      <Row
        label="Style HHI"
        value={fmtNum(snap.style_attribution?.portfolio_style_hhi ?? null, 2)}
      />
      <Row
        label="Effective styles"
        value={fmtNum(snap.style_attribution?.effective_n_styles ?? null, 1)}
      />

      <SectionHead>COVERAGE</SectionHead>
      <Row
        label="ERM3 coverage"
        value={fmtPct(snap.coverage.coverage_in_erm3, 0)}
      />
      <Row
        label="Modelable"
        value={snap.is_modelable === true ? "Yes" : snap.is_modelable === false ? "No" : "—"}
        valueColor={snap.is_modelable === true ? PALETTE.green : snap.is_modelable === false ? PALETTE.orange : undefined}
      />
      {snap.metrics.n_funds_managed != null && (
        <Row label="Mutual funds managed" value={fmtCount(snap.metrics.n_funds_managed)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 9-box heatmap (portfolio_9box_distribution)
// ─────────────────────────────────────────────────────────────────────

function NineBoxHeatmap({
  distribution,
  coverage,
}: {
  distribution: Record<string, number> | null | undefined;
  coverage: number | null;
}) {
  if (!distribution) {
    return (
      <div style={{ padding: SPACING.md, color: PALETTE.textMid, fontSize: 11, textAlign: "center" }}>
        Style attribution data unavailable for this filer.
        <div style={{ fontSize: 9, marginTop: 4 }}>
          Awaits CUSIP↔ERM3 bridge migration (D.8.1 → D.8.3 kernel).
        </div>
      </div>
    );
  }

  const cellSize = 64;
  const gap = 4;
  const totalSize = cellSize * 3 + gap * 2;

  const maxWeight = Math.max(...NINE_BOX_CELLS.map((c) => distribution[c] ?? 0));
  const colorScale = (w: number): string => {
    if (maxWeight === 0) return PALETTE.bgLight;
    const t = w / maxWeight;
    // Light → navy gradient
    const h = 220;
    const s = 60;
    const l = 95 - t * 55;
    return `hsl(${h}, ${s}%, ${l}%)`;
  };

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMid, marginBottom: 8, letterSpacing: 0.6 }}>
        PORTFOLIO 9-BOX (renormalized to in-ERM3)
      </div>
      <div style={{ display: "flex", gap: SPACING.lg }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(3, ${cellSize}px)`,
            gridTemplateRows: `repeat(3, ${cellSize}px)`,
            gap: `${gap}px`,
            width: totalSize,
            height: totalSize,
          }}
        >
          {NINE_BOX_CELLS.map((cell) => {
            const w = distribution[cell] ?? 0;
            const isDominant = w === maxWeight && w > 0;
            return (
              <div
                key={cell}
                style={{
                  background: colorScale(w),
                  border: isDominant
                    ? `2px solid ${PALETTE.navy}`
                    : `1px solid ${PALETTE.axisLine}`,
                  borderRadius: 2,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  color: PALETTE.textDark,
                  padding: 2,
                }}
              >
                <div style={{ fontSize: 8, color: PALETTE.textMid, lineHeight: 1.1, textAlign: "center" }}>
                  {cell.replace("Mid-Cap ", "Mid ")}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: PALETTE.navy, marginTop: 2 }}>
                  {(w * 100).toFixed(0)}%
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: PALETTE.textMid, lineHeight: 1.5, maxWidth: 220 }}>
          <div style={{ fontWeight: 600, color: PALETTE.textDark, marginBottom: 4 }}>
            Reading the heatmap
          </div>
          Weights renormalize to 100% over the {fmtPct(coverage, 0)} of AUM
          inside the ERM3 universe. Tail outside ERM3 (foreign listings, ADRs,
          non-equity) is preserved in raw holdings but excluded from style
          attribution.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top holdings table
// ─────────────────────────────────────────────────────────────────────

function HoldingsTable({ snap }: { snap: FilerSnapshot }) {
  const top = snap.holdings?.top.slice(0, 10) ?? [];
  if (top.length === 0) {
    return (
      <div style={{ padding: SPACING.md, color: PALETTE.textMid, fontSize: 11, textAlign: "center" }}>
        No holdings panel available.
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMid, marginBottom: 8, letterSpacing: 0.6 }}>
        TOP {top.length} HOLDINGS
      </div>
      <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${PALETTE.axisLine}` }}>
            <th style={{ textAlign: "left", padding: "4px 6px", color: PALETTE.textMid, fontWeight: 600 }}>#</th>
            <th style={{ textAlign: "left", padding: "4px 6px", color: PALETTE.textMid, fontWeight: 600 }}>Security</th>
            <th style={{ textAlign: "right", padding: "4px 6px", color: PALETTE.textMid, fontWeight: 600 }}>Mkt Value</th>
            <th style={{ textAlign: "right", padding: "4px 6px", color: PALETTE.textMid, fontWeight: 600 }}>Weight</th>
          </tr>
        </thead>
        <tbody>
          {top.map((h, i) => (
            <tr key={h.security_id} style={{ borderBottom: `1px solid ${PALETTE.bgLight}` }}>
              <td style={{ padding: "3px 6px", color: PALETTE.textLight }}>{i + 1}</td>
              <td style={{ padding: "3px 6px", color: PALETTE.textDark, fontFamily: "monospace" }}>
                {h.security_id}
              </td>
              <td style={{ padding: "3px 6px", textAlign: "right", color: PALETTE.textDark }}>
                {fmtUsd(h.adj_mv)}
              </td>
              <td style={{ padding: "3px 6px", textAlign: "right", color: PALETTE.textDark, fontWeight: 600 }}>
                {fmtPct(h.weight, 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cohort rank card
// ─────────────────────────────────────────────────────────────────────

function CohortRankCard({ snap }: { snap: FilerSnapshot }) {
  const ranks = snap.cohort_context?.ranks ?? [];
  if (ranks.length === 0) {
    return (
      <div style={{ padding: SPACING.md, color: PALETTE.textMid, fontSize: 11, textAlign: "center" }}>
        No cohort rankings available.
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: PALETTE.textMid, marginBottom: 8, letterSpacing: 0.6 }}>
        COHORT RANKS
      </div>
      <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${PALETTE.axisLine}` }}>
            <th style={{ textAlign: "left", padding: "4px 6px", color: PALETTE.textMid }}>Partition</th>
            <th style={{ textAlign: "left", padding: "4px 6px", color: PALETTE.textMid }}>Metric</th>
            <th style={{ textAlign: "left", padding: "4px 6px", color: PALETTE.textMid }}>Window</th>
            <th style={{ textAlign: "right", padding: "4px 6px", color: PALETTE.textMid }}>Rank</th>
          </tr>
        </thead>
        <tbody>
          {ranks.slice(0, 8).map((r, i) => (
            <tr key={`${r.partition_type}-${r.metric}-${r.period_window}-${i}`}>
              <td style={{ padding: "3px 6px", color: PALETTE.textDark, fontSize: 9 }}>
                {r.partition_type}: {r.partition_value}
              </td>
              <td style={{ padding: "3px 6px", color: PALETTE.textDark }}>{r.metric.replace(/_/g, " ")}</td>
              <td style={{ padding: "3px 6px", color: PALETTE.textMid }}>{r.period_window}</td>
              <td style={{ padding: "3px 6px", textAlign: "right", color: PALETTE.textDark, fontWeight: 600 }}>
                #{r.rank} {r.cohort_size != null ? `/ ${r.cohort_size}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────

export interface F1FilerTearsheetProps {
  snap: FilerSnapshot;
}

export function F1FilerTearsheet({ snap }: F1FilerTearsheetProps): React.ReactElement {
  return (
    <div
      data-report-ready="true"
      style={{
        width: PAGE.width,
        height: PAGE.height,
        padding: SPACING.xl,
        background: "#fff",
        color: PALETTE.textDark,
        fontFamily: "'Inter', system-ui, sans-serif",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          paddingBottom: SPACING.md,
          borderBottom: `2px solid ${PALETTE.navy}`,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: PALETTE.navy }}>
            {snap.name ?? snap.bw_filer_id}
          </div>
          <div style={{ fontSize: 11, color: PALETTE.textMid, marginTop: 2 }}>
            13F holdings-based view · no NAV · {snap.report_date ?? "no filing on file"}
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 9, color: PALETTE.textLight }}>
          <div>RiskModels.net F1 · 13F filer tearsheet</div>
          <div style={{ marginTop: 2 }}>{snap._metadata.model_version ?? ""}</div>
        </div>
      </div>

      {/* Body — identity rail (24%) + analytical zones (76%) */}
      <div style={{ flex: 1, display: "flex", gap: SPACING.lg, marginTop: SPACING.md }}>
        <div style={{ width: "24%" }}>
          <IdentityRail snap={snap} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: SPACING.lg }}>
          {/* Top: 9-box heatmap */}
          <div
            style={{
              border: `1px solid ${PALETTE.axisLine}`,
              borderRadius: 4,
              padding: SPACING.md,
              background: "#fff",
            }}
          >
            <NineBoxHeatmap
              distribution={snap.style_attribution?.portfolio_9box_distribution}
              coverage={snap.coverage.coverage_in_erm3}
            />
          </div>
          {/* Mid: holdings + ranks side-by-side */}
          <div style={{ display: "flex", gap: SPACING.lg, flex: 1 }}>
            <div
              style={{
                flex: 1,
                border: `1px solid ${PALETTE.axisLine}`,
                borderRadius: 4,
                padding: SPACING.md,
                background: "#fff",
              }}
            >
              <HoldingsTable snap={snap} />
            </div>
            <div
              style={{
                flex: 1,
                border: `1px solid ${PALETTE.axisLine}`,
                borderRadius: 4,
                padding: SPACING.md,
                background: "#fff",
              }}
            >
              <CohortRankCard snap={snap} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: SPACING.md,
          paddingTop: SPACING.sm,
          borderTop: `1px solid ${PALETTE.axisLine}`,
          fontSize: 8,
          color: PALETTE.textLight,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <div>
          Data as of {snap._metadata.data_as_of ?? "—"} · Refreshed {snap._metadata.data_freshness?.slice(0, 10) ?? "—"}
        </div>
        <div>
          BlueWater Capital · Confidential · Sourced from SEC 13F filings + ERM3 risk model
        </div>
      </div>
    </div>
  );
}
