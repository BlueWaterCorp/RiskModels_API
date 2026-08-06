/**
 * G.100 — the filer enricher recovers share-class misses through the
 * company-map projection, resolved at the snapshot's report_date, and
 * discloses the substitution. A directly-modelled holding is untouched by
 * the patch path; an unmapped miss stays blank (blank is the truth).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { enrichFilerHoldingsWithL3 } from "@/lib/13f/enrich-filer-holdings";
import { fetchBatchLatestSummary } from "@/lib/dal/risk-engine-v3";
import { resolveDisplayLabels } from "@/lib/dal/symbols-batch";
import { buildShareClassPatches } from "@/lib/holdings/share-class-projection";
import type { FilerHoldingsSnapshot } from "@/lib/dal/funds-zarr-reader";

vi.mock("@/lib/dal/risk-engine-v3", () => ({
  fetchBatchLatestSummary: vi.fn(),
}));
vi.mock("@/lib/dal/symbols-batch", () => ({
  resolveDisplayLabels: vi.fn(),
}));
vi.mock("@/lib/holdings/share-class-projection", () => ({
  buildShareClassPatches: vi.fn(),
}));

const AAPL = "BW-AAPL";
const GOOGL_A = "BW-BBG009S39JX6";
const MYSTERY = "BW-MYSTERY";

function snapshot(): FilerHoldingsSnapshot {
  return {
    teo: "2026-03-31",
    report_date: "2026-03-31",
    filing_date: "2026-05-15",
    as_of_basis: "filing_date",
    accession_number: null,
    filing_type: null,
    amendment_type: null,
    total_aum_usd: null,
    aum_in_erm3: null,
    n_holdings_returned: 3,
    n_total_holdings: 3,
    holdings: [
      { security_id: AAPL, adj_mv: 100, weight: 0.5 },
      { security_id: GOOGL_A, adj_mv: 60, weight: 0.3 },
      { security_id: MYSTERY, adj_mv: 40, weight: 0.2 },
    ],
  };
}

beforeEach(() => {
  vi.mocked(fetchBatchLatestSummary).mockResolvedValue(
    new Map([
      [
        AAPL,
        {
          symbol: AAPL,
          teo: "2026-08-05",
          metrics: {
            l3_mkt_er: 0.2,
            l3_sec_er: 0.01,
            l3_sub_er: 0.005,
            l3_res_er: 0.78,
          },
        },
      ],
    ]) as never,
  );
  vi.mocked(resolveDisplayLabels).mockResolvedValue(
    new Map([[AAPL, { ticker: "AAPL", name: "APPLE INC" }]]) as never,
  );
  vi.mocked(buildShareClassPatches).mockResolvedValue(
    new Map([
      [
        GOOGL_A,
        {
          ticker: "GOOGL",
          name: "ALPHABET INC-CL A",
          l3: {
            l3_market_er: 0.3,
            l3_sector_er: 0.02,
            l3_subsector_er: 0.01,
            l3_residual_er: 0.6,
          },
          modelled_as: {
            security_id: "BW-BBG009S3NB30",
            ticker: "GOOG",
            requested_class: "A",
            modelled_class: "C",
          },
        },
      ],
    ]),
  );
});

describe("enrichFilerHoldingsWithL3 — share-class projection", () => {
  it("resolves misses at the snapshot's report_date (the PIT constraint)", async () => {
    await enrichFilerHoldingsWithL3(snapshot());
    expect(buildShareClassPatches).toHaveBeenCalledWith(
      expect.arrayContaining([GOOGL_A, MYSTERY]),
      "2026-03-31",
    );
    const askedIds = vi.mocked(buildShareClassPatches).mock.calls[0]![0];
    expect(askedIds).not.toContain(AAPL);
  });

  it("patches the projected holding: own identity, sibling L3, disclosure", async () => {
    const out = await enrichFilerHoldingsWithL3(snapshot());
    const googl = out!.holdings.find((h) => h.security_id === GOOGL_A)!;
    expect(googl.ticker).toBe("GOOGL");
    expect(googl.name).toBe("ALPHABET INC-CL A");
    expect(googl.l3_residual_er).toBe(0.6);
    expect(googl.modelled_as).toEqual({
      security_id: "BW-BBG009S3NB30",
      ticker: "GOOG",
      requested_class: "A",
      modelled_class: "C",
    });
  });

  it("leaves a directly-modelled holding untouched by the patch path", async () => {
    const out = await enrichFilerHoldingsWithL3(snapshot());
    const aapl = out!.holdings.find((h) => h.security_id === AAPL)!;
    expect(aapl.ticker).toBe("AAPL");
    expect(aapl.l3_residual_er).toBe(0.78);
    expect(aapl.modelled_as).toBeUndefined();
  });

  it("leaves an unmapped miss blank — blank is the truth", async () => {
    const out = await enrichFilerHoldingsWithL3(snapshot());
    const mystery = out!.holdings.find((h) => h.security_id === MYSTERY)!;
    expect(mystery.ticker).toBeUndefined();
    expect(mystery.l3_residual_er).toBeUndefined();
    expect(mystery.modelled_as).toBeUndefined();
  });
});
