/**
 * RMAPI-30 — POST /batch/analyze `returns` arrays keep nulls.
 *
 * The route used to write `?? 0` into every history array, so a masked session
 * showed as a real zero hedge. Fixture cells are real values for IEP from the
 * 2026-11-05 release: `L3_market_HR` / `L3_sector_HR` / `L3_subsector_HR` from
 * ds_erm3_hedge_weights_SPY_uni_mc_3000.zarr (masked — NaN — on 2026-08-17) and
 * `return` from ds_daily.zarr. A masked hedge-ratio session has no
 * security_history row for that key, so the pivoted row lacks it.
 */
import { describe, expect, it } from "vitest";

import { batchReturnsFromPivoted } from "@/lib/api/batch-returns";
import type { PivotedHistoryRow } from "@/lib/dal/risk-engine-v3";

const IEP_ROWS: PivotedHistoryRow[] = [
  {
    teo: "2026-08-14",
    returns_gross: -0.01066537,
    l3_mkt_hr: -0.39608508,
    l3_sec_hr: -0.17521368,
    l3_sub_hr: -0.10401509,
  },
  // Masked hedge-ratio session: only the return is present.
  { teo: "2026-08-17", returns_gross: 0.02745665 },
  {
    teo: "2026-08-18",
    returns_gross: -0.03938115,
    l3_mkt_hr: -0.37989295,
    l3_sec_hr: -0.21547057,
    l3_sub_hr: -0.00165738,
  },
];

describe("batchReturnsFromPivoted", () => {
  it("a masked hedge-ratio session is null in every HR array, not 0", () => {
    const r = batchReturnsFromPivoted(IEP_ROWS);
    expect(r.dates).toEqual(["2026-08-14", "2026-08-17", "2026-08-18"]);
    for (const arr of [r.l1, r.l2, r.l3, r.l3_market_hr, r.l3_sector_hr, r.l3_subsector_hr]) {
      expect(arr[1]).toBeNull();
      expect(arr).toHaveLength(3);
    }
    expect(r.l3_market_hr[0]).toBeCloseTo(-0.39608508, 8);
    expect(r.l3_subsector_hr[2]).toBeCloseTo(-0.00165738, 8);
  });

  it("returns are carried through unchanged, including on the masked HR session", () => {
    const r = batchReturnsFromPivoted(IEP_ROWS);
    expect(r.values).toEqual([-0.01066537, 0.02745665, -0.03938115]);
  });

  it("legacy l1/l2/l3 mirror the explicit l3_*_hr arrays", () => {
    const r = batchReturnsFromPivoted(IEP_ROWS);
    expect(r.l1).toEqual(r.l3_market_hr);
    expect(r.l2).toEqual(r.l3_sector_hr);
    expect(r.l3).toEqual(r.l3_subsector_hr);
  });
});
