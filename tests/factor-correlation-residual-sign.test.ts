import { describe, expect, it } from "vitest";
import { computeDailyStockReturns } from "@/lib/risk/factor-correlation-service";

/**
 * An ERM3 hedge ratio is the ETF dollar position per $1 long stock
 * (`l1_mkt_hr ≈ -beta`), so the residual is r + hr·r_etf. The service used
 * r - hr·r_etf, which added the market back instead of removing it.
 */
type Row = Record<string, number>;
const days = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"];
const spyR = [0.01, -0.02, 0.015, -0.005];
const secR = [0.012, -0.018, 0.02, 0.001];
const subR = [0.02, -0.03, 0.01, 0.004];
const eps = [0.001, -0.002, 0.0005, 0.0015];

function series(values: number[], extra: (i: number) => Row = () => ({})) {
  return new Map(days.map((d, i) => [d, { teo: d, returns_gross: values[i], ...extra(i) }])) as never;
}

describe("computeDailyStockReturns residual sign", () => {
  it("L1 residual removes beta times the market (hr = -beta)", () => {
    const beta = 1.8;
    const stock = series(
      days.map((_, i) => beta * spyR[i] + eps[i]),
      () => ({ l1_mkt_hr: -beta }),
    );
    const out = computeDailyStockReturns("l1", stock, series(spyR), null, null);
    out.forEach((p, i) => expect(p.r).toBeCloseTo(eps[i], 12));
  });

  it("L3 residual removes every hedge leg", () => {
    const hr = { l3_mkt_hr: -0.9, l3_sec_hr: -0.5, l3_sub_hr: -0.4 };
    const stock = series(
      days.map((_, i) => 0.9 * spyR[i] + 0.5 * secR[i] + 0.4 * subR[i] + eps[i]),
      () => hr,
    );
    const out = computeDailyStockReturns("l3_residual", stock, series(spyR), series(secR), series(subR));
    expect(out).toHaveLength(days.length);
    out.forEach((p, i) => expect(p.r).toBeCloseTo(eps[i], 12));
  });

  it("L2 residual removes the market and sector legs", () => {
    const stock = series(
      days.map((_, i) => 1.1 * spyR[i] + 0.3 * secR[i] + eps[i]),
      () => ({ l2_mkt_hr: -1.1, l2_sec_hr: -0.3 }),
    );
    const out = computeDailyStockReturns("l2", stock, series(spyR), series(secR), null);
    out.forEach((p, i) => expect(p.r).toBeCloseTo(eps[i], 12));
  });
});
