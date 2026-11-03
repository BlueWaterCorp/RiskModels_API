import { beforeEach, describe, expect, it, vi } from "vitest";
import { enrichFundHoldingsWithL3 } from "@/lib/funds/enrich-fund-holdings";
import { fetchBatchLatestSummary } from "@/lib/dal/risk-engine-v3";
import { resolveDisplayLabels } from "@/lib/dal/symbols-batch";
import { buildShareClassPatches } from "@/lib/holdings/share-class-projection";

vi.mock("@/lib/dal/risk-engine-v3", () => ({ fetchBatchLatestSummary: vi.fn() }));
vi.mock("@/lib/dal/symbols-batch", () => ({ resolveDisplayLabels: vi.fn() }));
vi.mock("@/lib/holdings/share-class-projection", () => ({ buildShareClassPatches: vi.fn() }));

beforeEach(() => {
  vi.mocked(fetchBatchLatestSummary).mockResolvedValue(
    new Map([
      ["BW-A", { teo: "2026-10-30", metrics: { l3_mkt_er: 0.2, l3_sec_er: 0.1, l3_sub_er: 0.05, l3_res_er: 0.65 } }],
    ]) as never,
  );
  vi.mocked(resolveDisplayLabels).mockResolvedValue(
    new Map([
      ["BW-A", { ticker: "A", name: "A Inc", sector_etf: "XLK", subsector_etf: "RSPT" }],
    ]),
  );
  vi.mocked(buildShareClassPatches).mockResolvedValue(new Map());
});

describe("fund holding factor identities", () => {
  it("ships the sector and subsector ETF identities with the enriched holding", async () => {
    const out = await enrichFundHoldingsWithL3({
      teo: "2026-09-30",
      aum_reported: 100,
      aum_erm3: 100,
      n_holdings_returned: 1,
      n_total_holdings: 1,
      holdings: [{ bw_sym_id: "BW-A", adj_mv: 100, weight: 1 }],
    });
    expect(out?.holdings[0]).toMatchObject({
      ticker: "A",
      sector_etf: "XLK",
      subsector_etf: "RSPT",
      l3_sector_er: 0.1,
    });
  });
});
