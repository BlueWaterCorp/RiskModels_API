import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildRiskSnapshotPdfBytes } from "@/lib/portfolio/risk-snapshot-pdf";
import type { PortfolioRiskComputationOk } from "@/lib/portfolio/portfolio-risk-core";

function mockComputationOk(titleTicker = "NVDA"): PortfolioRiskComputationOk {
  return {
    status: "ok",
    fetchLatencyMs: 12,
    portfolioER: {
      market: 0.25,
      sector: 0.2,
      subsector: 0.15,
      residual: 0.4,
    },
    systematic: 0.6,
    portfolioVol: 0.22,
    perTicker: {
      [titleTicker]: {
        weight: 1,
        l3_mkt_hr: -0.95,
        l3_sec_hr: 0.12,
        l3_sub_hr: 0.03,
      },
    },
    summary: { total_positions: 1, resolved: 1, errors: 0 },
    errorsList: [],
  };
}

describe("buildRiskSnapshotPdfBytes", () => {
  it("produces a one-page PDF that loads with pdf-lib", async () => {
    const bytes = await buildRiskSnapshotPdfBytes({
      title: "Unit Test Portfolio",
      asOfLabel: "2026-04-02",
      data: mockComputationOk(),
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("writes a valid PDF header and includes ticker rows for multiple names", async () => {
    const bytes = await buildRiskSnapshotPdfBytes({
      title: "Multi",
      asOfLabel: "2026-04-02",
      data: {
        ...mockComputationOk("ZZZ"),
        perTicker: {
          MSFT: { weight: 0.5, l3_mkt_hr: 1, l3_sec_hr: 0, l3_sub_hr: 0 },
          AAPL: { weight: 0.5, l3_mkt_hr: 1, l3_sec_hr: 0, l3_sub_hr: 0 },
        },
        summary: { total_positions: 2, resolved: 2, errors: 0 },
      },
    });
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 5));
    expect(head).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
