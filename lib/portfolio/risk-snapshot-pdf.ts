/**
 * One-page portfolio risk snapshot PDF (ERM3 L3 decomposition + hedge ratios).
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PortfolioRiskComputationOk } from "@/lib/portfolio/portfolio-risk-core";

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
