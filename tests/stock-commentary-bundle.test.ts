/**
 * Stock commentary bundle — pure helpers and response contract.
 *
 * The full getStockCommentaryBundle path hits zarr/Supabase; these tests lock
 * the return-record summary rules the consumer already depends on (sum not
 * compound; refuse short / non-additive windows).
 */

import { describe, expect, it } from "vitest";
import { summarizeReturnRecord } from "@/lib/risk/stock-commentary-bundle-service";

function dates(n: number, end = "2026-08-07"): string[] {
  const out: string[] = [];
  const d = new Date(`${end}T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    const cur = new Date(d);
    cur.setUTCDate(d.getUTCDate() - (n - 1 - i));
    out.push(cur.toISOString().slice(0, 10));
  }
  return out;
}

describe("summarizeReturnRecord", () => {
  it("sums daily legs and keeps compound separate", () => {
    const n = 150;
    const d = dates(n);
    const gross = Array.from({ length: n }, () => 0.001);
    const factor = Array.from({ length: n }, () => 0.0006);
    const specific = Array.from({ length: n }, () => 0.0004);
    const rec = summarizeReturnRecord(d, gross, factor, specific, "252d", 252);
    expect(rec).not.toBeNull();
    expect(rec && "obs" in rec && !("insufficient" in rec)).toBe(true);
    if (!rec || "insufficient" in rec || "non_additive" in rec) return;
    expect(rec.obs).toBe(n);
    expect(rec.gross_arith).toBeCloseTo(0.15, 6);
    expect(rec.factor_arith + rec.specific_arith).toBeCloseTo(rec.gross_arith, 10);
    expect(rec.gross_compound).not.toBeCloseTo(rec.gross_arith, 4);
    expect(rec.drawdown.max_drawdown).toBeLessThanOrEqual(0);
  });

  it("refuses a short window rather than summarizing a stub", () => {
    const d = dates(40);
    const zeros = Array.from({ length: 40 }, () => 0);
    const rec = summarizeReturnRecord(d, zeros, zeros, zeros, "252d", 252);
    expect(rec).toEqual({ insufficient: true, obs: 40 });
  });

  it("refuses when factor + residual do not sum to gross", () => {
    const n = 150;
    const d = dates(n);
    const gross = Array.from({ length: n }, () => 0.001);
    const factor = Array.from({ length: n }, () => 0.001);
    const specific = Array.from({ length: n }, () => 0.001);
    const rec = summarizeReturnRecord(d, gross, factor, specific, "252d", 252);
    expect(rec && "non_additive" in rec).toBe(true);
  });

  it("uses only the trailing windowDays of a longer series", () => {
    const n = 400;
    const d = dates(n);
    const gross = Array.from({ length: n }, (_, i) => (i < 148 ? 0.01 : 0.001));
    const factor = Array.from({ length: n }, (_, i) => (i < 148 ? 0.006 : 0.0006));
    const specific = Array.from({ length: n }, (_, i) => (i < 148 ? 0.004 : 0.0004));
    const rec = summarizeReturnRecord(d, gross, factor, specific, "252d", 252);
    if (!rec || "insufficient" in rec || "non_additive" in rec) {
      throw new Error("expected a full summary");
    }
    expect(rec.obs).toBe(252);
    // Trailing 252 are the small returns — sum ≈ 0.252
    expect(rec.gross_arith).toBeCloseTo(0.252, 5);
  });
});
