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

// Artifact-Light palette + LOCKED factor legend (see BWMACRO/DESIGN.md §Color).
const hex = (h: string) => {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const COL = {
  market: hex("#002a5e"),
  sector: hex("#006f8e"),
  subsector: hex("#6d28d9"),
  residual: hex("#00AA00"),
  ink: hex("#1a1a2e"),
  inkMuted: hex("#475569"),
  inkFaint: hex("#94a3b8"),
  border: hex("#cbd5e1"),
  fig: hex("#f5f7fb"),
  white: hex("#ffffff"),
};

const num = (x: unknown, d = 3): string =>
  x == null || Number.isNaN(Number(x)) ? "—" : Number(x).toFixed(d);
const pctOrDash = (x: unknown): string =>
  x == null || Number.isNaN(Number(x)) ? "—" : `${(Number(x) * 100).toFixed(1)}%`;
const usd = (x: unknown): string =>
  x == null || Number.isNaN(Number(x))
    ? "—"
    : `$${Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type PeerVarianceBar = {
  /** e.g. "XLC subsector peers · 48 names · equal-weighted" */
  label: string;
  /** Ten largest tickers, e.g. "MSFT · ORCL · NOW · ..." */
  membersLine?: string;
  market: number;
  sector: number;
  subsector: number;
  residual: number;
};

/**
 * One-page Artifact-Light risk snapshot (pdf-lib, serverless-safe).
 *
 * Hero is the L3 variance decomposition (stacked bar + legend) in the locked
 * factor colors; followed by hedge layering (single-name) and a positions
 * table (fills for portfolios). Standard PDF fonts proxy the design stack:
 * Times≈Newsreader (titles), Helvetica≈Inter (body), Courier≈IBM Plex Mono
 * (numbers). Every nullable field guards to "—" — no fabricated values.
 *
 * Single-name pages may pass `peerBar` — the equal-weighted mean of the same
 * four L3 shares across the name's subsector (else sector) cohort, same
 * construction as riskmodels.net /stocks/[ticker]. Absent when the cohort is
 * missing or too thin; the PDF still renders.
 */
export async function buildRiskSnapshotPdfBytes(params: {
  title: string;
  asOfLabel: string;
  data: PortfolioRiskComputationOk;
  peerBar?: PeerVarianceBar | null;
}): Promise<Uint8Array> {
  const { asOfLabel, data, peerBar } = params;
  const doc = await PDFDocument.create();
  const M = 48;

  const tickers = Object.keys(data.perTicker).sort();
  const isSingle = tickers.length === 1;
  const headLabel = isSingle ? tickers[0] : "Portfolio";
  const headRow = (isSingle ? data.perTicker[tickers[0]] : {}) as Record<string, unknown>;

  // Size the page to the content so it fills the widget instead of leaving a
  // half-empty letter sheet. Header + hero ≈ 300, hedge block (single) ≈ 116,
  // one row ≈ 16 (capped), footer zone ≈ 96.
  const nRows = Math.min(tickers.length, 20);
  const peerMembers = isSingle && peerBar?.membersLine ? 22 : 0;
  const peerExtra = isSingle && peerBar ? 58 + peerMembers : 0;
  const height = 300 + peerExtra + (isSingle ? 116 : 0) + nRows * 16 + 96;
  const width = 612;
  const page = doc.addPage([width, height]);
  const CW = width - M * 2;

  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const monoBold = await doc.embedFont(StandardFonts.CourierBold);

  type Font = typeof sans;
  const wOf = (s: string, size: number, font: Font) => font.widthOfTextAtSize(s, size);
  const text = (s: string, x: number, y: number, size: number, font: Font, color = COL.ink) =>
    page.drawText(s, { x, y, size, font, color });
  const right = (s: string, xr: number, y: number, size: number, font: Font, color = COL.ink) =>
    text(s, xr - wOf(s, size, font), y, size, font, color);
  const rule = (y: number, color = COL.border) =>
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.75, color });

  // ---- Header --------------------------------------------------------------
  let y = height - M - 4;
  text("RISKMODELS  ·  RISK SNAPSHOT", M, y, 8, mono, COL.inkFaint);
  right(`As of ${asOfLabel}`, width - M, y, 9, sans, COL.inkMuted);
  y -= 30;
  text(headLabel, M, y, 28, serifBold, COL.ink);
  if (isSingle) {
    right(usd(headRow.price_close), width - M, y + 6, 15, monoBold, COL.ink);
    right("last close", width - M, y - 6, 8, sans, COL.inkFaint);
  }
  y -= 16;
  text(
    isSingle
      ? "Single-name risk snapshot · ERM3 L3 decomposition"
      : `Portfolio risk snapshot · ${tickers.length} positions · ERM3 L3 decomposition`,
    M,
    y,
    10,
    sans,
    COL.inkMuted,
  );
  y -= 14;
  rule(y);
  y -= 26;

  // ---- L3 explained risk (hero) -------------------------------------------
  const vd = data.portfolioER;
  text("L3 explained risk", M, y, 14, serifBold, COL.ink);
  text(
    "variance fractions" + (isSingle ? "" : ", portfolio-weighted"),
    M + wOf("L3 explained risk", 14, serifBold) + 8,
    y,
    9,
    sans,
    COL.inkFaint,
  );
  y -= 16;

  const segs = [
    { label: "Market", frac: vd.market, color: COL.market },
    { label: "Sector", frac: vd.sector, color: COL.sector },
    { label: "Subsector", frac: vd.subsector, color: COL.subsector },
    { label: "Residual", frac: vd.residual, color: COL.residual },
  ];

  const drawBar = (
    fracs: number[],
    barY: number,
    barH: number,
    labelPct: boolean,
  ) => {
    const widths = fracs.map((f) => Math.max(0, f));
    const wsum = widths.reduce((a, b) => a + b, 0) || 1;
    let cx = M;
    segs.forEach((s, i) => {
      const frac = fracs[i] ?? 0;
      const w = ((widths[i] ?? 0) / wsum) * CW;
      if (w > 0.5) {
        page.drawRectangle({ x: cx, y: barY, width: w, height: barH, color: s.color });
        if (labelPct) {
          const lbl = `${(frac * 100).toFixed(0)}%`;
          if (w > wOf(lbl, 9, monoBold) + 8) {
            text(
              lbl,
              cx + w / 2 - wOf(lbl, 9, monoBold) / 2,
              barY + barH / 2 - 4,
              9,
              monoBold,
              COL.white,
            );
          }
        }
      }
      cx += w;
    });
    page.drawRectangle({
      x: M,
      y: barY,
      width: CW,
      height: barH,
      borderColor: COL.border,
      borderWidth: 0.5,
    });
  };

  if (peerBar) {
    text(isSingle ? headLabel : "This book", M, y, 8, sans, COL.inkFaint);
    y -= 4;
  }
  const barH = 30;
  const barY = y - barH;
  drawBar(
    segs.map((s) => s.frac),
    barY,
    barH,
    true,
  );
  y = barY - 14;

  if (peerBar) {
    text(peerBar.label, M, y, 8, sans, COL.inkFaint);
    y -= 4;
    const peerH = 14;
    const peerY = y - peerH;
    drawBar(
      [peerBar.market, peerBar.sector, peerBar.subsector, peerBar.residual],
      peerY,
      peerH,
      false,
    );
    y = peerY - 12;
    if (peerBar.membersLine) {
      const capSize = 8;
      const prefix = "largest  ";
      const maxW = CW - wOf(prefix, capSize, sans);
      const wrap = (s: string): string[] => {
        if (wOf(s, capSize, mono) <= maxW) return [s];
        const parts = s.split(" · ");
        const lines: string[] = [];
        let cur = "";
        for (const p of parts) {
          const next = cur ? `${cur} · ${p}` : p;
          if (wOf(next, capSize, mono) <= maxW) {
            cur = next;
          } else {
            if (cur) lines.push(cur);
            cur = p;
          }
        }
        if (cur) lines.push(cur);
        return lines;
      };
      wrap(peerBar.membersLine).forEach((line, i) => {
        if (i === 0) text(prefix, M, y, capSize, sans, COL.inkFaint);
        text(line, M + wOf(prefix, capSize, sans), y, capSize, mono, COL.inkMuted);
        y -= 11;
      });
      y -= 4;
    } else {
      y -= 4;
    }
  }

  // Legend (true signed %, even where the bar clamped a negative to zero width)
  let lx = M;
  segs.forEach((s) => {
    page.drawRectangle({ x: lx, y: y, width: 9, height: 9, color: s.color });
    const t = `${s.label}  ${pctOrDash(s.frac)}`;
    text(t, lx + 13, y + 1, 9, sans, COL.inkMuted);
    lx += 13 + wOf(t, 9, sans) + 20;
  });
  y -= 18;
  text(`Systematic (market + sector + subsector): ${pctOrDash(data.systematic)}`, M, y, 10, sans, COL.ink);
  if (peerBar) {
    y -= 14;
    const nameRes = pctOrDash(vd.residual);
    const peerRes = pctOrDash(peerBar.residual);
    text(
      `${headLabel} residual ${nameRes} vs equal-weighted peer average ${peerRes}`,
      M,
      y,
      9,
      sans,
      COL.inkMuted,
    );
  }
  y -= 28;

  // ---- Hedge layering (single-name) ---------------------------------------
  if (isSingle) {
    text("Recommended hedge ratios — L3", M, y, 12, serifBold, COL.ink);
    y -= 18;
    const legs = [
      { label: "Market leg", val: headRow.l3_mkt_hr, color: COL.market },
      { label: "Sector leg", val: headRow.l3_sec_hr, color: COL.sector },
      { label: "Subsector leg", val: headRow.l3_sub_hr, color: COL.subsector },
    ];
    const colW = CW / 3;
    legs.forEach((leg, i) => {
      const bx = M + i * colW;
      page.drawRectangle({ x: bx, y: y - 34, width: colW - 12, height: 40, color: COL.fig });
      page.drawRectangle({ x: bx, y: y - 34, width: 3, height: 40, color: leg.color });
      text(leg.label, bx + 12, y - 6, 9, sans, COL.inkMuted);
      text(num(leg.val), bx + 12, y - 26, 16, monoBold, COL.ink);
    });
    y -= 48;
    text("Holdings-weighted L3 hedge ratios. Negative = short the factor leg to neutralise it.", M, y, 8, sans, COL.inkFaint);
    y -= 26;
  }

  // ---- Positions table -----------------------------------------------------
  text(`Positions (${tickers.length})`, M, y, 12, serifBold, COL.ink);
  y -= 16;
  const cols = [
    { h: "Ticker", x: M, w: 70, align: "l" as const },
    { h: "Weight", x: M + 90, w: 60, align: "r" as const },
    { h: "Last", x: M + 170, w: 70, align: "r" as const },
    { h: "Vol 23d", x: M + 250, w: 60, align: "r" as const },
    { h: "Mkt HR", x: M + 330, w: 55, align: "r" as const },
    { h: "Sec HR", x: M + 405, w: 55, align: "r" as const },
    { h: "Sub HR", x: M + 461, w: 55, align: "r" as const },
  ];
  page.drawRectangle({ x: M, y: y - 4, width: CW, height: 16, color: COL.fig });
  cols.forEach((c) => {
    if (c.align === "r") right(c.h, c.x + c.w, y, 8, sans, COL.inkMuted);
    else text(c.h, c.x, y, 8, sans, COL.inkMuted);
  });
  y -= 18;
  for (const t of tickers) {
    if (y < 96) {
      text(`… ${tickers.length - tickers.indexOf(t)} more positions`, M, y, 8, sans, COL.inkFaint);
      break;
    }
    const r = data.perTicker[t] as Record<string, unknown>;
    const cells: [string, (typeof cols)[number], boolean][] = [
      [t, cols[0], false],
      [pctOrDash(r.weight), cols[1], true],
      [usd(r.price_close), cols[2], true],
      [pctOrDash(r.vol_23d), cols[3], true],
      [num(r.l3_mkt_hr), cols[4], true],
      [num(r.l3_sec_hr), cols[5], true],
      [num(r.l3_sub_hr), cols[6], true],
    ];
    cells.forEach(([v, c, isNum]) => {
      const font = isNum ? mono : sans;
      if (c.align === "r") right(v, c.x + c.w, y, 9, font, COL.ink);
      else text(v, c.x, y, 9, font, COL.ink);
    });
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: width - M, y: y - 5 }, thickness: 0.4, color: COL.fig });
    y -= 16;
  }

  // ---- Footer --------------------------------------------------------------
  rule(64);
  text("Methodology · riskmodels.app/docs/methodology", M, 52, 8, sans, COL.inkFaint);
  right("Powered by RiskModels", width - M, 52, 8, sans, COL.inkFaint);
  text(
    "Data: ERM3 V3 security_history · residual is stock-specific risk after market/sector/subsector.",
    M,
    40,
    7,
    sans,
    COL.inkFaint,
  );

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
  peerBar?: PeerVarianceBar | null;
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
