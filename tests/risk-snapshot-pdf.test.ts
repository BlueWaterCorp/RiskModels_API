import { inflateSync } from "zlib";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildRiskSnapshotPdfBytes } from "@/lib/portfolio/risk-snapshot-pdf";
import type { PortfolioRiskComputationOk } from "@/lib/portfolio/portfolio-risk-core";

/** pdf-lib Flate-compresses page content and hex-encodes WinAnsi strings. */
function inflatedPdfText(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes).toString("latin1");
  const chunks: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    try {
      chunks.push(inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"));
    } catch {
      /* not a zlib stream */
    }
  }
  return chunks
    .join("\n")
    .replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
}

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
  it("draws a cohort bar under the name when peerBar is provided", async () => {
    const bytes = await buildRiskSnapshotPdfBytes({
      title: "NFLX — risk snapshot",
      asOfLabel: "2026-08-18",
      data: mockComputationOk("NFLX"),
      peerBar: {
        label: "XLC subsector peers · 48 names · equal-weighted",
        membersLine: "NFLX · DIS · CMCSA · T · VZ · CHTR · EA · TTWO · LYV · FOXA · ...",
        market: 0.08,
        sector: 0.12,
        subsector: 0.19,
        residual: 0.61,
      },
    });
    const raw = inflatedPdfText(bytes);
    expect(raw).toContain("XLC subsector peers");
    expect(raw).toContain("equal-weighted");
    expect(raw).toContain("NFLX");
    expect(raw).toContain("...");
    expect(raw).toContain("peer average");
  });

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
