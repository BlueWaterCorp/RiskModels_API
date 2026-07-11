/**
 * Row-mapping tests for the fundamentals widget data routes: sec_facts gating
 * ("—" when a cell is not SEC-served, never zero), newest-first ordering,
 * ratio percent scaling with null passthrough, and grid measure selection.
 * Upstream is mocked — the live endpoint's own contract tests cover the rest.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/openbb/_lib/upstream", () => ({
  bearerFromRequest: vi.fn(() => "rm_agent_live_test"),
  upstreamGet: vi.fn(),
}));

import { upstreamGet } from "@/app/openbb/_lib/upstream";
import { GET as historyGET } from "@/app/openbb/widgets/fundamentals-history/route";
import { GET as ratiosGET } from "@/app/openbb/widgets/fundamentals-ratios/route";
import { GET as gridGET } from "@/app/openbb/widgets/wacc-grid/route";

const mockUpstream = vi.mocked(upstreamGet);

describe("fundamentals-history mapping", () => {
  it("maps sec_facts per cell, '—' when absent, newest first", async () => {
    mockUpstream.mockResolvedValueOnce({
      status: 200,
      body: {
        rows: [
          {
            period_end_date: "2025-12-31",
            filed_date: "2026-02-01",
            filed_date_source: "exact",
            sec_facts: {
              revenue: { value: 111_184_000_000, source: "us_gaap" },
              net_income: { value: 30_000_000_000, source: "us_gaap" },
            },
            roe_ttm: 0.5,
            fcf_margin: null,
            leverage_ratio: 1.25,
          },
          {
            period_end_date: "2026-03-31",
            filed_date: "2026-05-01",
            filed_date_source: "approx",
            sec_facts: {},
            roe_ttm: null,
            fcf_margin: 0.211,
            leverage_ratio: null,
          },
        ],
      },
    });
    const res = await historyGET(
      new NextRequest(
        "http://localhost/openbb/widgets/fundamentals-history?ticker=AAPL&periods=2",
      ),
    );
    const rows = await res.json();
    // Upstream ascending → widget newest-first.
    expect(rows[0].period_end).toBe("2026-03-31");
    expect(rows[0].filed).toBe("2026-05-01 (approx)");
    expect(rows[0].revenue_sec).toBe("—"); // not SEC-served ≠ zero
    expect(rows[0].fcf_margin).toBe("21.1%");
    expect(rows[0].sec_facts_served).toBe(0);
    expect(rows[1].revenue_sec).toBe("$111.18B");
    expect(rows[1].net_income_sec).toBe("$30.00B");
    expect(rows[1].roe_ttm).toBe("50.0%");
    expect(rows[1].sec_facts_served).toBe(2);
    // as_of only forwarded when supplied.
    expect(mockUpstream.mock.calls[0][0]).toBe("/fundamentals/AAPL?periods=2");
  });
});

describe("fundamentals-ratios mapping", () => {
  it("scales ratios to percent and passes null through (chart skips, never zero)", async () => {
    mockUpstream.mockResolvedValueOnce({
      status: 200,
      body: {
        rows: [
          {
            period_end_date: "2025-12-31",
            payout_ratio: 0.156,
            retention_ratio: 0.844,
            buyback_ratio: 0.61,
            total_payout_ratio: 0.766,
            sustainable_growth: null,
          },
        ],
      },
    });
    const res = await ratiosGET(
      new NextRequest(
        "http://localhost/openbb/widgets/fundamentals-ratios?ticker=AAPL",
      ),
    );
    const rows = await res.json();
    expect(rows[0].Payout).toBe(15.6);
    expect(rows[0].Retention).toBe(84.4);
    expect(rows[0]["Total payout"]).toBe(76.6);
    expect(rows[0]["Sustainable growth"]).toBeNull();
  });
});

describe("wacc-grid mapping", () => {
  const grid = {
    period_end_date: "2025-12-31",
    erp_values: [0.04, 0.05],
    rf_tenor_values: ["3m", "10y"],
    cells: [
      [
        { wacc: 0.061, cost_of_equity: 0.07, economic_profit: 2.5e9 },
        { wacc: 0.0688, cost_of_equity: 0.08, economic_profit: 1.9e9 },
      ],
      [
        { wacc: 0.07, cost_of_equity: 0.082, economic_profit: null },
        { wacc: 0.078, cost_of_equity: 0.092, economic_profit: 1.1e9 },
      ],
    ],
  };

  it("selects the measure, percent-scales rates, nulls missing tenors", async () => {
    mockUpstream.mockResolvedValueOnce({
      status: 200,
      body: { sensitivity_grid: grid },
    });
    const res = await gridGET(
      new NextRequest(
        "http://localhost/openbb/widgets/wacc-grid?ticker=AAPL&measure=wacc",
      ),
    );
    const rows = await res.json();
    expect(rows).toHaveLength(2);
    expect(rows[0].erp).toBe("4.0%");
    expect(rows[0]["3m"]).toBe(6.1);
    expect(rows[0]["10y"]).toBe(6.88);
    expect(rows[0]["1y"]).toBeNull(); // tenor absent from upstream grid
  });

  it("renders economic profit in $B and falls back to wacc on a bad measure", async () => {
    mockUpstream.mockResolvedValueOnce({
      status: 200,
      body: { sensitivity_grid: grid },
    });
    const res = await gridGET(
      new NextRequest(
        "http://localhost/openbb/widgets/wacc-grid?ticker=AAPL&measure=economic_profit",
      ),
    );
    const rows = await res.json();
    expect(rows[0]["3m"]).toBe(2.5);
    expect(rows[1]["3m"]).toBeNull();

    mockUpstream.mockResolvedValueOnce({
      status: 200,
      body: { sensitivity_grid: grid },
    });
    const res2 = await gridGET(
      new NextRequest(
        "http://localhost/openbb/widgets/wacc-grid?ticker=AAPL&measure=drop_table",
      ),
    );
    const rows2 = await res2.json();
    expect(rows2[0]["3m"]).toBe(6.1); // fell back to wacc
  });
});
