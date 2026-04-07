/**
 * One-page portfolio risk snapshot PDF (ERM3 L3 decomposition + hedge ratios).
 *
 * Dispatcher: when PLAYWRIGHT_PDF_ENABLED is set, renders via headless Chromium
 * using the /render-snapshot React template. Otherwise falls back to the
 * programmatic pdf-lib path (safe for Vercel serverless).
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PortfolioRiskComputationOk } from "@/lib/portfolio/portfolio-risk-core";
import type { SnapshotReportData, SnapshotTickerRow } from "./snapshot-report-types";

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export async function buildRiskSnapshotPdfBytes(params: {
  title: string;
  asOfLabel: string;
  data: PortfolioRiskComputationOk;
}): Promise<Uint8Array> {
  const { title, asOfLabel, data } = params;
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const { width, height } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  let y = height - margin;

  const draw = (text: string, size: number, bold = false, color = rgb(0.1, 0.1, 0.12)) => {
    page.drawText(text, {
      x: margin,
      y,
      size,
      font: bold ? fontBold : font,
      color,
      maxWidth: width - margin * 2,
    });
    y -= size + 6;
  };

  draw("RiskModels — Portfolio risk snapshot", 10, false, rgb(0.35, 0.4, 0.45));
  draw(title, 18, true);
  draw(`As of: ${asOfLabel}`, 11);
  y -= 8;

  const vd = data.portfolioER;
  draw("L3 explained risk (variance fractions, portfolio-weighted)", 12, true);
  draw(`Market: ${pct(vd.market)}  |  Sector: ${pct(vd.sector)}  |  Subsector: ${pct(vd.subsector)}  |  Residual: ${pct(vd.residual)}`, 10);
  draw(`Systematic (mkt+sec+sub): ${pct(data.systematic)}`, 10);
  if (data.portfolioVol != null) {
    draw(`Portfolio vol (23d, weighted avg): ${(data.portfolioVol * 100).toFixed(2)}%`, 10);
  }
  y -= 6;

  draw("Positions", 12, true);
  for (const t of Object.keys(data.perTicker).sort()) {
    const row = data.perTicker[t] as Record<string, unknown>;
    const w = row.weight != null ? Number(row.weight).toFixed(4) : "?";
    const mhr = row.l3_mkt_hr != null ? Number(row.l3_mkt_hr).toFixed(3) : "—";
    const shr = row.l3_sec_hr != null ? Number(row.l3_sec_hr).toFixed(3) : "—";
    const uhr = row.l3_sub_hr != null ? Number(row.l3_sub_hr).toFixed(3) : "—";
    draw(`${t}  weight=${w}  |  L3 HR (mkt/sec/sub): ${mhr} / ${shr} / ${uhr}`, 9);
    if (y < 120) break;
  }

  y = Math.min(y, 140);
  draw("Methodology: https://riskmodels.app/docs/methodology", 8, false, rgb(0.4, 0.42, 0.45));
  draw("Powered by RiskModels — data from ERM3 V3 security_history", 8, false, rgb(0.4, 0.42, 0.45));

  return doc.save();
}

/**
 * Build the SnapshotReportData contract from a PortfolioRiskComputationOk result.
 */
export function toReportData(params: {
  title: string;
  asOfLabel: string;
  data: PortfolioRiskComputationOk;
}): SnapshotReportData {
  const { title, asOfLabel, data } = params;

  const perTicker: SnapshotTickerRow[] = Object.entries(data.perTicker)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ticker, row]) => {
      const r = row as Record<string, unknown>;
      return {
        ticker,
        weight: Number(r.weight ?? 0),
        l3_mkt_er: r.l3_mkt_er != null ? Number(r.l3_mkt_er) : null,
        l3_sec_er: r.l3_sec_er != null ? Number(r.l3_sec_er) : null,
        l3_sub_er: r.l3_sub_er != null ? Number(r.l3_sub_er) : null,
        l3_res_er: r.l3_res_er != null ? Number(r.l3_res_er) : null,
        l3_mkt_hr: r.l3_mkt_hr != null ? Number(r.l3_mkt_hr) : null,
        l3_sec_hr: r.l3_sec_hr != null ? Number(r.l3_sec_hr) : null,
        l3_sub_hr: r.l3_sub_hr != null ? Number(r.l3_sub_hr) : null,
        vol_23d: r.vol_23d != null ? Number(r.vol_23d) : null,
        price_close: r.price_close != null ? Number(r.price_close) : null,
      };
    });

  return {
    title,
    as_of: asOfLabel,
    portfolio_risk_index: {
      variance_decomposition: {
        market: data.portfolioER.market,
        sector: data.portfolioER.sector,
        subsector: data.portfolioER.subsector,
        residual: data.portfolioER.residual,
        systematic: data.systematic,
      },
      portfolio_volatility_23d: data.portfolioVol,
      position_count: data.summary.resolved,
    },
    per_ticker: perTicker,
    _metadata: {
      generated_at: new Date().toISOString(),
      lineage: "ERM3 V3 security_history",
      billing_code: "risk_snapshot_pdf_v1",
    },
  };
}

/**
 * Dispatcher: builds a one-page PDF using Playwright/React (when enabled)
 * or the programmatic pdf-lib fallback.
 */
export async function buildRiskSnapshotPdf(params: {
  title: string;
  asOfLabel: string;
  data: PortfolioRiskComputationOk;
}): Promise<Uint8Array> {
  if (process.env.PLAYWRIGHT_PDF_ENABLED === "true") {
    const { renderSnapshotPdf } = await import("./playwright-pdf-worker");
    const reportData = toReportData(params);
    const baseUrl =
      process.env.PLAYWRIGHT_BASE_URL ??
      `http://localhost:${process.env.PORT ?? 3000}`;
    return renderSnapshotPdf(reportData, baseUrl);
  }

  return buildRiskSnapshotPdfBytes(params);
}
