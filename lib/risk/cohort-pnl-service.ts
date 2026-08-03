/**
 * Selection vs drift — decomposing realized residual P&L (ERM3 H.146 §D2).
 *
 * The question this answers is one every equity PM has and few can answer:
 * **was I paid for picking stocks, or for being net long (or short) the average
 * stock?** Those are different skills with different capacities, and a residual
 * P&L number alone cannot tell them apart.
 *
 * It is answerable now because ERM3 fits residuals without an intercept — each
 * stock keeps its alpha, so the cross-sectional mean residual is not zero, and
 * the cohort store finally exposes that mean. Being net long a cohort earns its
 * mean residual whether or not you picked anything well.
 *
 * The identity
 * ------------
 * For a book of constant weights `w_i` over the window, daily residual return is
 *
 *     R_t = Σ_i w_i · ε_i,t
 *
 * Adding and subtracting each name's cohort mean `μ_c,t` splits it exactly:
 *
 *     R_t = Σ_i w_i · (ε_i,t − μ_c(i),t)   +   Σ_c W_c · μ_c,t
 *           └──── selection ────┘              └──── drift ────┘
 *
 * where `W_c = Σ_{i∈c} w_i` is net weight in cohort c. **Selection** is what you
 * earned by holding better-than-cohort-average names; **drift** is what you
 * earned by net exposure to the cohort's average residual, independent of any
 * selection skill. The two sum to the total by construction, not by fit — there
 * is no residual-of-the-residual term and no regression involved.
 *
 * Levels must match: a stock's sector-level residual demeans against its sector
 * cohort's mean, because that cohort's `residual_mean` is precisely the mean of
 * its members' residuals at that level.
 *
 * This is realized historical attribution of a stated weight vector. It is not a
 * forecast, a backtest of a strategy, or a recommendation.
 */

import { readCohortSeries } from "@/lib/dal/cohort-zarr-reader";
import { readHistorySlice } from "@/lib/dal/zarr-reader";
import { resolveSymbolsByTickers } from "@/lib/dal/risk-engine-v3";
import type { V3MetricKey } from "@/lib/dal/risk-engine-v3";
import { isPublicCohort } from "@/lib/risk/cohort-service";
import { readCohortStoreMeta } from "@/lib/dal/cohort-zarr-reader";

/** Which cascade level the decomposition runs at. */
export type PnlLevel = "market" | "sector";

/** Stock residual key and the cohort level it must be demeaned against. */
const LEVEL_CONFIG: Record<
  PnlLevel,
  { residualKey: V3MetricKey; cohortLevel: 1 | 2; label: string }
> = {
  market: {
    residualKey: "l1_rr",
    cohortLevel: 1,
    label: "market-level residual, demeaned against the market cohort",
  },
  sector: {
    residualKey: "l2_rr",
    cohortLevel: 2,
    label: "sector-level residual, demeaned against each name's sector cohort",
  },
};

export interface PnlPosition {
  ticker: string;
  weight: number;
}

export interface PnlCohortRow {
  cohort: string;
  net_weight: number;
  n_positions: number;
  /** Cumulative drift earned on this cohort's net weight. */
  drift: number;
  /** Cumulative selection earned within this cohort. */
  selection: number;
}

export interface PnlSeriesPoint {
  date: string;
  selection: number;
  drift: number;
  residual: number;
}

export interface PnlCoverage {
  requested: number;
  included: number;
  /** Tickers dropped, with the reason — never silently omitted. */
  dropped: Array<{ ticker: string; reason: string }>;
}

export interface CohortPnlResult {
  level: PnlLevel;
  basis: string;
  range: [string, string] | null;
  n_days: number;
  coverage: PnlCoverage;
  totals: {
    residual: number;
    selection: number;
    drift: number;
    /** Share of |selection| in |selection| + |drift|. Null when both are ~0. */
    selection_share: number | null;
  };
  by_cohort: PnlCohortRow[];
  series: PnlSeriesPoint[];
  net_weight: number;
  gross_weight: number;
  store_build: string | null;
  disclosures: {
    interpretation: string;
    no_intercept_contract: string | null;
    constant_weights: string;
    not_advice: string;
  };
}

export class UnsupportedPnlCohortError extends Error {
  constructor(public readonly ticker: string, public readonly cohort: string) {
    super(`Position '${ticker}' maps to a cohort outside the addressable set`);
    this.name = "UnsupportedPnlCohortError";
  }
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export class CohortPnlService {
  /**
   * Decompose a constant-weight book's realized residual return into selection
   * and drift over [startDate, endDate].
   *
   * Positions whose ticker does not resolve, or which have no sector mapping,
   * are dropped and reported in `coverage.dropped` — a partial answer that says
   * what it left out beats a confident answer over a silently smaller book.
   */
  async decompose(
    positions: PnlPosition[],
    options: {
      level?: PnlLevel;
      startDate?: string;
      endDate?: string;
      minNames?: number;
    } = {},
  ): Promise<CohortPnlResult | null> {
    const level = options.level ?? "sector";
    const cfg = LEVEL_CONFIG[level];

    const cleaned = positions
      .map((p) => ({ ticker: p.ticker.trim().toUpperCase(), weight: Number(p.weight) }))
      .filter((p) => p.ticker && finite(p.weight));

    const dropped: PnlCoverage["dropped"] = [];
    const symbolMap = await resolveSymbolsByTickers(cleaned.map((p) => p.ticker));

    // ── Map each position to its cohort ───────────────────────────────────
    interface Resolved extends PnlPosition {
      symbol: string;
      cohort: string;
    }
    const resolved: Resolved[] = [];
    for (const p of cleaned) {
      const row = symbolMap.get(p.ticker);
      if (!row) {
        dropped.push({ ticker: p.ticker, reason: "ticker not found" });
        continue;
      }
      const cohort = level === "market" ? "SPY" : (row.sector_etf ?? "").toUpperCase();
      if (!cohort) {
        dropped.push({ ticker: p.ticker, reason: "no sector cohort mapping" });
        continue;
      }
      if (!isPublicCohort(cohort)) {
        // A name mapped to a non-addressable cohort cannot be demeaned here.
        // Surfacing it as a coverage gap is honest; failing the whole request
        // would make one unusual name unusable for the other forty-nine.
        dropped.push({ ticker: p.ticker, reason: "cohort outside addressable set" });
        continue;
      }
      resolved.push({ ...p, symbol: row.symbol, cohort });
    }

    if (!resolved.length) {
      return {
        level,
        basis: cfg.label,
        range: null,
        n_days: 0,
        coverage: { requested: positions.length, included: 0, dropped },
        totals: { residual: 0, selection: 0, drift: 0, selection_share: null },
        by_cohort: [],
        series: [],
        net_weight: 0,
        gross_weight: 0,
        store_build: null,
        disclosures: this.disclosures(null, level),
      };
    }

    // ── Fetch stock residuals and cohort means over the same window ───────
    const cohorts = Array.from(new Set(resolved.map((r) => r.cohort)));
    const [history, cohortSeries, meta] = await Promise.all([
      readHistorySlice({
        symbols: resolved.map((r) => r.symbol),
        keys: [cfg.residualKey],
        periodicity: "daily",
        startDate: options.startDate,
        endDate: options.endDate,
        orderBy: "asc",
      }),
      readCohortSeries({
        tickers: cohorts,
        variables: ["residual_mean"],
        startDate: options.startDate,
        endDate: options.endDate,
        minNames: options.minNames,
      }),
      readCohortStoreMeta(),
    ]);

    // μ[cohort][date]
    const mu = new Map<string, Map<string, number>>();
    for (const c of cohortSeries ?? []) {
      const byDate = new Map<string, number>();
      for (const p of c.points) {
        const v = p.values.residual_mean;
        if (finite(v)) byDate.set(p.date, v);
      }
      mu.set(c.ticker, byDate);
    }

    // ε[symbol][date]
    const eps = new Map<string, Map<string, number>>();
    for (const row of history.rows) {
      if (row.metric_key !== cfg.residualKey) continue;
      const v = Number(row.metric_value);
      if (!finite(v)) continue;
      let byDate = eps.get(row.symbol);
      if (!byDate) {
        byDate = new Map<string, number>();
        eps.set(row.symbol, byDate);
      }
      byDate.set(row.teo, v);
    }

    // ── Accumulate the identity, day by day ───────────────────────────────
    const netWeightByCohort = new Map<string, number>();
    const countByCohort = new Map<string, number>();
    for (const r of resolved) {
      netWeightByCohort.set(r.cohort, (netWeightByCohort.get(r.cohort) ?? 0) + r.weight);
      countByCohort.set(r.cohort, (countByCohort.get(r.cohort) ?? 0) + 1);
    }

    const dates = Array.from(
      new Set(Array.from(eps.values()).flatMap((m) => Array.from(m.keys()))),
    ).sort();

    const series: PnlSeriesPoint[] = [];
    const driftByCohort = new Map<string, number>();
    const selectionByCohort = new Map<string, number>();
    let totalSelection = 0;
    let totalDrift = 0;

    for (const date of dates) {
      let daySelection = 0;
      let dayDrift = 0;
      let contributed = false;

      for (const r of resolved) {
        const e = eps.get(r.symbol)?.get(date);
        const m = mu.get(r.cohort)?.get(date);
        if (!finite(e) || !finite(m)) continue;
        const sel = r.weight * (e - m);
        daySelection += sel;
        selectionByCohort.set(r.cohort, (selectionByCohort.get(r.cohort) ?? 0) + sel);
        contributed = true;
      }

      // Drift accrues on net cohort weight, and only on days that cohort has a
      // usable mean — a day dropped by min_names must not silently score zero.
      for (const [cohort, w] of netWeightByCohort) {
        const m = mu.get(cohort)?.get(date);
        if (!finite(m)) continue;
        const d = w * m;
        dayDrift += d;
        driftByCohort.set(cohort, (driftByCohort.get(cohort) ?? 0) + d);
        contributed = true;
      }

      if (!contributed) continue;
      totalSelection += daySelection;
      totalDrift += dayDrift;
      series.push({
        date,
        selection: daySelection,
        drift: dayDrift,
        residual: daySelection + dayDrift,
      });
    }

    const absSum = Math.abs(totalSelection) + Math.abs(totalDrift);
    const netWeight = resolved.reduce((a, r) => a + r.weight, 0);
    const grossWeight = resolved.reduce((a, r) => a + Math.abs(r.weight), 0);

    const byCohort: PnlCohortRow[] = Array.from(netWeightByCohort.keys())
      .map((cohort) => ({
        cohort,
        net_weight: netWeightByCohort.get(cohort) ?? 0,
        n_positions: countByCohort.get(cohort) ?? 0,
        drift: driftByCohort.get(cohort) ?? 0,
        selection: selectionByCohort.get(cohort) ?? 0,
      }))
      .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

    return {
      level,
      basis: cfg.label,
      range: series.length
        ? [series[0]!.date, series[series.length - 1]!.date]
        : null,
      n_days: series.length,
      coverage: { requested: positions.length, included: resolved.length, dropped },
      totals: {
        residual: totalSelection + totalDrift,
        selection: totalSelection,
        drift: totalDrift,
        selection_share: absSum > 1e-12 ? Math.abs(totalSelection) / absSum : null,
      },
      by_cohort: byCohort,
      series,
      net_weight: netWeight,
      gross_weight: grossWeight,
      store_build: meta?.build_timestamp ?? null,
      disclosures: this.disclosures(meta?.no_intercept_contract ?? null, level),
    };
  }

  private disclosures(contract: string | null, level: PnlLevel) {
    return {
      interpretation:
        "Selection is what the book earned by holding names that beat their cohort's average residual. Drift is what it earned from net exposure to that average, which accrues on net weight regardless of selection skill. The two sum to the total residual return exactly — this is an identity, not a fitted attribution.",
      no_intercept_contract: contract,
      constant_weights:
        "Weights are treated as constant across the window. This attributes the realized residual returns of the names you name, at the weights you state; it is not a replay of an actual trading history and does not account for intra-window rebalancing, entries, or exits.",
      not_advice: `Realized historical attribution at the ${level} level only. Not a forecast, not a backtest of a strategy, and not a recommendation regarding any security.`,
    };
  }
}

let _service: CohortPnlService | null = null;

export function getCohortPnlService(): CohortPnlService {
  if (!_service) _service = new CohortPnlService();
  return _service;
}
