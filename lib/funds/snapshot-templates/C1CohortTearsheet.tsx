/**
 * C1 cohort tearsheet — Letter landscape PDF template for a 9-box style cell.
 * Stage D.2.c per docs/FUNDS_API_BUILD_STATUS.md.
 *
 * The "differentiated wedge" view: pre-bundles per-cell aggregate stats
 * (EW + MV), 12-month cumulative cohort returns, top funds in cell, top
 * symbols in cell, and the cohort top-N holdings — content Morningstar
 * does not present at this granularity.
 *
 * Mirrors `F1FundTearsheet` layout primitives (PALETTE, SPACING, PAGE,
 * SectionTitle) so the two tearsheets feel like siblings.
 */

import type { CohortSnapshot } from "@/lib/funds/snapshot-composer";
import { PALETTE } from "./_theme";

// ─────────────────────────────────────────────────────────────────────
// Layout tokens (match F1)
// ─────────────────────────────────────────────────────────────────────

const PAGE = {
  width: "11in",
  height: "8.5in",
  margin: "0.4in",
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function formatPct(v: number | null | undefined, dp = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(dp)}%`;
}

function formatNum(
  v: number | null | undefined,
  dp = 0,
  unit = "",
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(dp)}${unit}`;
}

function compoundFromSteps(stepReturns: number[]): number {
  let w = 1;
  for (const r of stepReturns) {
    if (Number.isFinite(r)) w *= 1 + r;
  }
  return w - 1;
}

// ─────────────────────────────────────────────────────────────────────
// Section title (mirrors F1)
// ─────────────────────────────────────────────────────────────────────

function SectionTitle({
  index,
  label,
}: {
  index: string;
  label: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        paddingBottom: 4,
        marginBottom: SPACING.xs,
        borderBottom: `1px solid ${PALETTE.border}`,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: PALETTE.teal,
          fontWeight: 700,
          letterSpacing: 0.4,
        }}
      >
        {index}.
      </span>
      <span
        style={{
          fontSize: 11,
          color: PALETTE.navy,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Identity rail — cell metrics summary (EW vs MV)
// ─────────────────────────────────────────────────────────────────────

function IdentityRail({ snap }: { snap: CohortSnapshot }) {
  const weightings = snap.metrics.weightings as Record<
    string,
    Record<string, number | null> | undefined
  >;
  const ew = weightings.ew ?? {};
  const mv = weightings.mv ?? {};

  const Row = ({
    label,
    ewVal,
    mvVal,
    isPct = true,
  }: {
    label: string;
    ewVal: number | null | undefined;
    mvVal: number | null | undefined;
    isPct?: boolean;
  }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 0.5fr 0.5fr",
        fontSize: 9,
        padding: "3px 0",
        borderBottom: `1px solid ${PALETTE.axisLine}`,
        color: PALETTE.textDark,
      }}
    >
      <span style={{ color: PALETTE.textMid }}>{label}</span>
      <span style={{ textAlign: "right" }}>
        {isPct ? formatPct(ewVal, 2) : formatNum(ewVal, 1)}
      </span>
      <span style={{ textAlign: "right" }}>
        {isPct ? formatPct(mvVal, 2) : formatNum(mvVal, 1)}
      </span>
    </div>
  );

  return (
    <div style={{ minWidth: 0 }}>
      <SectionTitle index="I" label="Cell Statistics" />
      <div
        style={{
          background: PALETTE.bgPanel,
          padding: SPACING.sm,
          borderRadius: 4,
          marginBottom: SPACING.sm,
        }}
      >
        <div style={{ fontSize: 8, color: PALETTE.textLight, letterSpacing: 0.4 }}>
          9-BOX CELL
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: PALETTE.navy,
            marginTop: 1,
            lineHeight: 1.15,
          }}
        >
          {snap.equity_style_9box}
        </div>
        <div style={{ fontSize: 9, color: PALETTE.textMid, marginTop: 4 }}>
          {snap.n_funds_in_cell ?? "—"} funds · as of {snap.report_date}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 0.5fr 0.5fr",
          fontSize: 8,
          color: PALETTE.textLight,
          letterSpacing: 0.4,
          padding: "3px 0",
          borderBottom: `2px solid ${PALETTE.navy}`,
        }}
      >
        <span></span>
        <span style={{ textAlign: "right" }}>EW</span>
        <span style={{ textAlign: "right" }}>MV</span>
      </div>
      <Row
        label="Gross return"
        ewVal={ew.portfolio_gross_return as number | null}
        mvVal={mv.portfolio_gross_return as number | null}
      />
      <Row
        label="Market"
        ewVal={ew.portfolio_market_return as number | null}
        mvVal={mv.portfolio_market_return as number | null}
      />
      <Row
        label="Sector"
        ewVal={ew.portfolio_sector_return as number | null}
        mvVal={mv.portfolio_sector_return as number | null}
      />
      <Row
        label="Subsector"
        ewVal={ew.portfolio_subsector_return as number | null}
        mvVal={mv.portfolio_subsector_return as number | null}
      />
      <Row
        label="Idiosyncratic"
        ewVal={ew.portfolio_idiosyncratic_return as number | null}
        mvVal={mv.portfolio_idiosyncratic_return as number | null}
      />
      <Row
        label="Top-10 weight"
        ewVal={ew.top10_weight_sum as number | null}
        mvVal={mv.top10_weight_sum as number | null}
      />
      <Row
        label="Effective N"
        ewVal={ew.effective_n as number | null}
        mvVal={mv.effective_n as number | null}
        isPct={false}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cumulative chart (12-month EW + MV)
// ─────────────────────────────────────────────────────────────────────

function CumulativeChart({ snap }: { snap: CohortSnapshot }) {
  // CohortPortfolioRow shape: { teo, ew: { portfolio_gross_return, ... } | null, mv: { ... } | null }
  const rows = [...snap.portfolio_history.rows].sort((a, b) =>
    a.teo < b.teo ? -1 : a.teo > b.teo ? 1 : 0,
  );
  type Pt = { date: string; cum: number };
  const ewPath: Pt[] = [];
  const mvPath: Pt[] = [];

  let ewW = 1;
  let mvW = 1;
  for (const r of rows) {
    const ewRet = r.ew?.portfolio_gross_return;
    const mvRet = r.mv?.portfolio_gross_return;
    if (ewRet != null && Number.isFinite(ewRet)) ewW *= 1 + ewRet;
    if (mvRet != null && Number.isFinite(mvRet)) mvW *= 1 + mvRet;
    ewPath.push({ date: r.teo, cum: ewW - 1 });
    mvPath.push({ date: r.teo, cum: mvW - 1 });
  }
  const dates = ewPath.map((p) => p.date);

  // Inline SVG line chart — fixed 600x180 viewport.
  const W = 600;
  const H = 180;
  const padL = 40;
  const padR = 8;
  const padT = 8;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const xs = dates.length;
  if (xs === 0) {
    return (
      <div
        style={{
          padding: SPACING.md,
          color: PALETTE.textLight,
          fontSize: 10,
          fontStyle: "italic",
        }}
      >
        No cumulative history available.
      </div>
    );
  }

  const allVals = ewPath.concat(mvPath).map((p) => p.cum);
  const yMin = Math.min(0, ...allVals);
  const yMax = Math.max(0, ...allVals);
  const yRange = yMax - yMin || 1;

  const xAt = (i: number) => padL + (innerW * i) / Math.max(1, xs - 1);
  const yAt = (v: number) => padT + innerH - ((v - yMin) / yRange) * innerH;
  const path = (pts: Pt[]) =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)} ${yAt(p.cum).toFixed(1)}`)
      .join(" ");

  const ewEnd = ewPath[ewPath.length - 1]?.cum ?? 0;
  const mvEnd = mvPath[mvPath.length - 1]?.cum ?? 0;

  return (
    <div>
      <SectionTitle index="II" label="Cumulative Cohort Return (12m)" />
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", maxHeight: 200 }}
      >
        {/* zero baseline */}
        <line
          x1={padL}
          x2={W - padR}
          y1={yAt(0)}
          y2={yAt(0)}
          stroke={PALETTE.axisLine}
          strokeDasharray="3 2"
        />
        {/* y axis */}
        <line
          x1={padL}
          x2={padL}
          y1={padT}
          y2={H - padB}
          stroke={PALETTE.axisLine}
        />
        {/* x axis */}
        <line
          x1={padL}
          x2={W - padR}
          y1={H - padB}
          y2={H - padB}
          stroke={PALETTE.axisLine}
        />
        {/* axis labels (3 ticks: min/0/max) */}
        {[yMax, 0, yMin].map((v, i) => (
          <text
            key={i}
            x={padL - 4}
            y={yAt(v) + 3}
            textAnchor="end"
            fontSize="8"
            fill={PALETTE.textLight}
            fontFamily="Inter, sans-serif"
          >
            {(v * 100).toFixed(0)}%
          </text>
        ))}
        <text
          x={padL}
          y={H - 6}
          fontSize="8"
          fill={PALETTE.textLight}
          fontFamily="Inter, sans-serif"
        >
          {dates[0]}
        </text>
        <text
          x={W - padR}
          y={H - 6}
          textAnchor="end"
          fontSize="8"
          fill={PALETTE.textLight}
          fontFamily="Inter, sans-serif"
        >
          {dates[dates.length - 1]}
        </text>

        {/* lines */}
        <path
          d={path(ewPath)}
          stroke={PALETTE.teal}
          strokeWidth="1.5"
          fill="none"
        />
        <path
          d={path(mvPath)}
          stroke={PALETTE.navy}
          strokeWidth="1.5"
          fill="none"
        />

        {/* end labels */}
        <text
          x={W - padR - 2}
          y={yAt(mvEnd) - 4}
          textAnchor="end"
          fontSize="8"
          fill={PALETTE.navy}
          fontFamily="Inter, sans-serif"
          fontWeight="600"
        >
          MV {(mvEnd * 100).toFixed(1)}%
        </text>
        <text
          x={W - padR - 2}
          y={yAt(ewEnd) + 10}
          textAnchor="end"
          fontSize="8"
          fill={PALETTE.teal}
          fontFamily="Inter, sans-serif"
          fontWeight="600"
        >
          EW {(ewEnd * 100).toFixed(1)}%
        </text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Compact ranking table (top funds / top symbols)
// ─────────────────────────────────────────────────────────────────────

function RankingTable({
  index,
  label,
  rows,
  valueLabel,
  isPctValue = true,
  topN = 10,
}: {
  index: string;
  label: string;
  rows: CohortSnapshot["top_funds"] extends infer _ ? Array<{ rank: number; entity_id: string; value: number | null }> : never;
  valueLabel: string;
  isPctValue?: boolean;
  topN?: number;
}) {
  const trimmed = rows.slice(0, topN);
  return (
    <div>
      <SectionTitle index={index} label={label} />
      <div style={{ fontSize: 9, fontFamily: "Inter, sans-serif" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "20px 1fr 0.55fr",
            fontSize: 8,
            color: PALETTE.textLight,
            letterSpacing: 0.4,
            padding: "3px 0",
            borderBottom: `2px solid ${PALETTE.navy}`,
          }}
        >
          <span>#</span>
          <span>{label.toUpperCase().includes("FUND") ? "FUND" : "SYMBOL"}</span>
          <span style={{ textAlign: "right" }}>
            {valueLabel.toUpperCase()}
          </span>
        </div>
        {trimmed.map((r) => (
          <div
            key={`${r.rank}-${r.entity_id}`}
            style={{
              display: "grid",
              gridTemplateColumns: "20px 1fr 0.55fr",
              padding: "2px 0",
              borderBottom: `1px solid ${PALETTE.axisLine}`,
              color: PALETTE.textDark,
            }}
          >
            <span style={{ color: PALETTE.textMid }}>{r.rank}</span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.entity_id}
            </span>
            <span style={{ textAlign: "right" }}>
              {isPctValue ? formatPct(r.value) : formatNum(r.value, 2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cohort holdings table (top-N MV)
// ─────────────────────────────────────────────────────────────────────

function HoldingsTable({ snap }: { snap: CohortSnapshot }) {
  const holdings = snap.holdings?.top ?? [];
  const trimmed = holdings.slice(0, 10);
  return (
    <div>
      <SectionTitle
        index="V"
        label={`Top Cohort Holdings (${snap.holdings?.weighting?.toUpperCase() ?? "MV"})`}
      />
      <div style={{ fontSize: 9, fontFamily: "Inter, sans-serif" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 0.5fr 0.5fr",
            fontSize: 8,
            color: PALETTE.textLight,
            letterSpacing: 0.4,
            padding: "3px 0",
            borderBottom: `2px solid ${PALETTE.navy}`,
          }}
        >
          <span>BW_SYM_ID</span>
          <span style={{ textAlign: "right" }}>WEIGHT</span>
          <span style={{ textAlign: "right" }}>FUNDS</span>
        </div>
        {trimmed.map((h, i) => (
          <div
            key={`${h.bw_sym_id ?? i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 0.5fr 0.5fr",
              padding: "2px 0",
              borderBottom: `1px solid ${PALETTE.axisLine}`,
              color: PALETTE.textDark,
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {h.bw_sym_id ?? "—"}
            </span>
            <span style={{ textAlign: "right" }}>{formatPct(h.weight)}</span>
            <span style={{ textAlign: "right", color: PALETTE.textMid }}>
              {h.n_funds_holding ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main composition
// ─────────────────────────────────────────────────────────────────────

export function C1CohortTearsheet({ snap }: { snap: CohortSnapshot }) {
  const grossEw =
    (snap.metrics.weightings as Record<string, Record<string, number | null>>).ew
      ?.portfolio_gross_return ?? 0;
  const grossMv =
    (snap.metrics.weightings as Record<string, Record<string, number | null>>).mv
      ?.portfolio_gross_return ?? 0;

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
            RiskModels — Cohort Tearsheet
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: PALETTE.navy,
              lineHeight: 1.05,
            }}
          >
            {snap.equity_style_9box}
          </h1>
        </div>
        <div
          style={{
            textAlign: "right",
            fontSize: 9,
            color: PALETTE.textMid,
            lineHeight: 1.5,
          }}
        >
          <div>C1 · Cohort Profile</div>
          <div>As of {snap.report_date}</div>
          {snap.n_funds_in_cell != null && (
            <div>{snap.n_funds_in_cell} funds in cell</div>
          )}
        </div>
      </div>

      {/* ── Two-column body ─────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1.85in 1fr",
          gap: SPACING.md,
          marginTop: SPACING.md,
          minHeight: 0,
        }}
      >
        <IdentityRail snap={snap} />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: SPACING.md,
            minWidth: 0,
          }}
        >
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
            <strong style={{ color: PALETTE.navy }}>Cell summary.</strong>{" "}
            {snap.equity_style_9box} cohort returned{" "}
            <strong>{formatPct(grossEw)}</strong> equal-weighted and{" "}
            <strong>{formatPct(grossMv)}</strong> market-cap-weighted at the
            latest report. Top concentration:{" "}
            {snap.top_funds?.rows[0]?.entity_id ?? "—"} (highest 12m gross),{" "}
            {snap.top_symbols?.rows[0]?.entity_id ?? "—"} (heaviest holding by
            cohort weight).
          </div>

          {/* II. Cumulative chart */}
          <CumulativeChart snap={snap} />

          {/* Three-column: top funds + top symbols + top holdings */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1.1fr",
              gap: SPACING.md,
              minWidth: 0,
            }}
          >
            <RankingTable
              index="III"
              label="Top Funds (12m gross)"
              rows={(snap.top_funds?.rows ?? []) as Array<{
                rank: number;
                entity_id: string;
                value: number | null;
              }>}
              valueLabel="Return"
              isPctValue
              topN={10}
            />
            <RankingTable
              index="IV"
              label="Top Symbols (MV weight)"
              rows={(snap.top_symbols?.rows ?? []) as Array<{
                rank: number;
                entity_id: string;
                value: number | null;
              }>}
              valueLabel="Weight"
              isPctValue
              topN={10}
            />
            <HoldingsTable snap={snap} />
          </div>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div
        style={{
          borderTop: `1px solid ${PALETTE.border}`,
          paddingTop: 4,
          marginTop: SPACING.sm,
          fontSize: 7,
          color: PALETTE.textLight,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          riskmodels.app · {snap._metadata.model_version ?? "ERM3-L3"}
        </span>
        <span>
          C1 cohort tearsheet · cumulative compounded from monthly cohort
          returns
        </span>
      </div>
    </div>
  );
}
