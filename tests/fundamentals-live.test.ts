import { describe, expect, it } from "vitest";
import {
  costOfEquity,
  DEFAULT_ERP_GRID,
  getFundamentalsForTicker,
  getFundamentalsSensitivityGrid,
  RF_TENORS,
} from "@/lib/dal/fundamentals-zarr-reader";

/**
 * Live-GCS integration test against the production fundamentals panel.
 * Opt-in (network + GCS credentials required):
 *
 *   FUNDAMENTALS_LIVE_TEST=1 npx vitest run tests/fundamentals-live.test.ts
 *
 * Credentials resolve exactly like production: GCP_SERVICE_ACCOUNT_JSON →
 * RISKMODELS_GCS_KEYFILE → application-default credentials.
 *
 * Known store state (2026-07-06 rebuild): the per-cell rf_rate plane was
 * REPLACED by the six-tenor 1-D CMT strip (rf_3m..rf_30y), populated from live
 * FRED back to 1969. rf/cost_of_equity/wacc are therefore expected NON-NULL
 * for AAPL (default tenor 10y). AAPL's newest quarter also moved forward:
 * period_end 2026-03-31 (filed ~2026-05-01) entered on the rebuild.
 */
const LIVE = !!process.env.FUNDAMENTALS_LIVE_TEST;

describe.skipIf(!LIVE)("live GCS fundamentals panel — AAPL", () => {
  const OPTS = { asOf: "2026-07-03", periods: 8, erp: 0.05, taxRate: 0.21 };

  it(
    "returns 8 PIT-visible quarters with plausible derived ratios",
    { timeout: 300_000 },
    async () => {
      const result = await getFundamentalsForTicker("AAPL", OPTS);
      expect(result).not.toBeNull();
      const rows = result!.rows;
      expect(rows).toHaveLength(8);

      const last = rows[rows.length - 1]!;
      // Newest PIT-visible quarter at 2026-07-03 — 2026-03-31 (filed ~2026-05-01)
      // since the 2026-07-06 rebuild; assert >= so future refreshes don't break this.
      expect(last.period_end_date >= "2026-03-31").toBe(true);
      expect(last.filed_date_source).toBe("exact");

      // Margins/ratios plausible for AAPL
      expect(last.roe_ttm).toBeGreaterThan(0.2);
      expect(last.roe_ttm).toBeLessThan(5);
      expect(last.roa_ttm).toBeGreaterThan(0.05);
      expect(last.roa_ttm).toBeLessThan(1);
      expect(last.fcf_margin).toBeGreaterThan(0.05);
      expect(last.fcf_margin).toBeLessThan(0.6);
      expect(last.leverage_ratio).toBeGreaterThan(0.1);
      expect(last.leverage_ratio).toBeLessThan(5);
      expect(last.beta_market).toBeGreaterThan(0.3);
      expect(last.beta_market).toBeLessThan(2.5);
      expect(last.beta_source).toBe("in-universe");

      // rf strip is live since the 2026-07-06 rebuild: default 10y tenor must be
      // populated (~4.4% mid-2026) and cost of equity in the nominal 4-14% band.
      expect(last.rf_rate).not.toBeNull();
      expect(last.rf_rate!).toBeGreaterThan(0.02);
      expect(last.rf_rate!).toBeLessThan(0.08);
      expect(last.cost_of_equity).toBeGreaterThan(0.04);
      expect(last.cost_of_equity).toBeLessThan(0.14);
      expect(last.wacc).not.toBeNull();
      // formula cross-check on the same inputs
      expect(last.cost_of_equity!).toBeCloseTo(
        costOfEquity(last.rf_rate!, last.beta_market!, 0.05),
        10,
      );
    },
  );

  it(
    "rf_tenor=3m selects the short strip (lower rf than 10y in mid-2026)",
    { timeout: 300_000 },
    async () => {
      const [d10y, d3m] = await Promise.all([
        getFundamentalsForTicker("AAPL", OPTS),
        getFundamentalsForTicker("AAPL", { ...OPTS, rfTenor: "3m" }),
      ]);
      const r10 = d10y!.rows[d10y!.rows.length - 1]!;
      const r3 = d3m!.rows[d3m!.rows.length - 1]!;
      expect(r3.rf_rate).not.toBeNull();
      expect(r3.rf_rate!).toBeLessThan(r10.rf_rate!); // upward curve segment mid-2026
    },
  );

  it(
    "PIT: the 2025-12-31 quarter (filed 2026-01-30) is invisible at as_of=2026-01-15",
    { timeout: 300_000 },
    async () => {
      const result = await getFundamentalsForTicker("AAPL", {
        ...OPTS,
        asOf: "2026-01-15",
      });
      expect(result).not.toBeNull();
      const periodEnds = result!.rows.map((r) => r.period_end_date);
      expect(periodEnds).not.toContain("2025-12-31");
      expect(periodEnds[periodEnds.length - 1]).toBe("2025-09-30");
    },
  );

  it(
    "unknown ticker resolves to null (route 404 path)",
    { timeout: 300_000 },
    async () => {
      const result = await getFundamentalsForTicker("ZZZZNOTREAL", OPTS);
      expect(result).toBeNull();
    },
  );

  it(
    "H.89.6: sensitivity grid — real rf strip x real beta_market, monotonic in erp and tenor",
    { timeout: 300_000 },
    async () => {
      const grid = await getFundamentalsSensitivityGrid("AAPL", {
        asOf: "2026-07-03",
        erpGrid: DEFAULT_ERP_GRID,
        rfTenorGrid: RF_TENORS,
        taxRate: 0.21,
      });
      expect(grid).not.toBeNull();
      expect(grid!.erp_values).toEqual([...DEFAULT_ERP_GRID]);
      expect(grid!.rf_tenor_values).toEqual([...RF_TENORS]);
      expect(grid!.cells).toHaveLength(DEFAULT_ERP_GRID.length);

      // Anchored on the same latest PIT-visible period as getFundamentalsForTicker.
      const rows = (await getFundamentalsForTicker("AAPL", { ...OPTS, periods: 1 }))!.rows;
      expect(grid!.period_end_date).toBe(rows[rows.length - 1]!.period_end_date);

      // Monotonic in erp at a fixed tenor (10y column): higher erp -> higher cost_of_equity
      // (beta_market is positive for AAPL, per the plausibility assertions above).
      const tenIdx = grid!.rf_tenor_values.indexOf("10y");
      const coeAcrossErp = grid!.cells.map((row) => row[tenIdx]!.cost_of_equity!);
      for (let i = 1; i < coeAcrossErp.length; i++) {
        expect(coeAcrossErp[i]).toBeGreaterThan(coeAcrossErp[i - 1]!);
      }

      // Every populated tenor strip is real (non-null) since the 2026-07-06 rebuild.
      const erpIdx = grid!.erp_values.indexOf(0.05);
      for (const cell of grid!.cells[erpIdx]!) {
        expect(cell.cost_of_equity).not.toBeNull();
        expect(cell.wacc).not.toBeNull();
      }

      // Cross-check the 0.05/10y cell against the scalar endpoint for the same as_of.
      const scalar = rows[rows.length - 1]!;
      expect(grid!.cells[erpIdx]![tenIdx]!.cost_of_equity).toBeCloseTo(
        scalar.cost_of_equity!,
        10,
      );
    },
  );
});
