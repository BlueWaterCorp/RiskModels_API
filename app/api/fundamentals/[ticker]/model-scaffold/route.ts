import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getFundamentalsForTicker } from "@/lib/dal/fundamentals-zarr-reader";
import { sanitizeFundamentalsRow } from "@/lib/api/fundamentals-contract";
import { FundamentalsRequestSchema } from "@/lib/api/schemas";

/**
 * GET /api/fundamentals/{ticker}/model-scaffold — a valuation-model scaffold as
 * a downloadable .xlsx: the HISTORICAL income/cash-flow block + a CAPM WACC build,
 * filled from the same PIT fundamentals the JSON endpoint serves. This is the block
 * an Excel model-builder pulls from a licensed terminal; here it is SEC-sourced and
 * $0.005/call. Forward projections are intentionally left blank — RiskModels serves
 * realized data only (no forecasts). Same licensing gate as the JSON endpoint
 * (`sanitizeFundamentalsRow`): raw line items appear only where the serving cell is
 * SEC XBRL. Node runtime (exceljs).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NAVY = "FF1F4E79";
const BLACK = "FF000000";
const GREEN = "FF1E7A46";
const GREY = "FF666666";
const M = 1e6;
const MFMT = "#,##0;(#,##0)";
const PFMT = "0.0%";

type Cell = { value?: number | null; source?: string };
type Row = Record<string, unknown> & {
  period_end_date?: string;
  sec_facts?: Record<string, Cell>;
  rf_rate?: number | null;
  beta_market?: number | null;
  cost_of_equity?: number | null;
  cost_of_debt?: number | null;
  wacc?: number | null;
};

function secVal(row: Row, concept: string): number | null {
  const f = row.sec_facts?.[concept];
  return f && typeof f.value === "number" && Number.isFinite(f.value) ? f.value : null;
}

function buildWorkbook(
  ticker: string,
  rows: Row[],
  asOf: string,
  erp: number,
  taxRate: number,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RiskModels (riskmodels.app)";

  // ---- Sheet 1: Historicals ----
  const ws = wb.addWorksheet("Historicals ($M)");
  ws.getCell("A1").value = `${ticker} — Historical block (RiskModels, SEC-sourced, PIT)`;
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value =
    "Filled from GET /api/fundamentals/{ticker} — the historical block an Excel model pulls from a licensed terminal. $0.005/call. Forward projections = your assumptions.";
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: GREY } };

  const nQ = rows.length;
  const header = ["Line item ($M)", ...rows.map((r) => r.period_end_date ?? "")];
  const r0 = 4;
  header.forEach((h, j) => {
    const c = ws.getCell(r0, j + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { horizontal: j === 0 ? "left" : "center" };
  });

  let r = r0 + 1;
  const lineRow = (label: string, concept: string): number => {
    ws.getCell(r, 1).value = label;
    rows.forEach((row, j) => {
      const v = secVal(row, concept);
      const c = ws.getCell(r, j + 2);
      if (v !== null) c.value = v / M;
      c.numFmt = MFMT;
      c.font = { color: { argb: BLACK } };
    });
    return r++;
  };
  const formulaRow = (
    label: string,
    fmt: string,
    make: (col: string) => string,
  ): number => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: true };
    for (let j = 0; j < nQ; j++) {
      const col = ws.getColumn(j + 2).letter;
      const c = ws.getCell(r, j + 2);
      c.value = { formula: make(col) };
      c.numFmt = fmt;
      c.font = { color: { argb: GREEN } };
    }
    return r++;
  };

  const rev = lineRow("Revenue", "revenue");
  const ebit = lineRow("Operating income (EBIT)", "operating_income");
  formulaRow("  EBIT margin", PFMT, (c) => `${c}${ebit}/${c}${rev}`);
  lineRow("Pretax income", "pretax_income");
  lineRow("Income tax", "income_tax_expense");
  lineRow("Net income", "net_income");
  const cfo = lineRow("Cash from operations", "cash_from_operations");
  const capex = lineRow("Capital expenditures", "capital_expenditures");
  const fcf = formulaRow("Free cash flow (CFO − capex)", MFMT, (c) => `${c}${cfo}-${c}${capex}`);
  formulaRow("  FCF margin", PFMT, (c) => `${c}${fcf}/${c}${rev}`);

  ws.getCell(r + 1, 1).value =
    "Black = pulled from RiskModels (SEC us_gaap). Green = formula. Blank = cell not SEC-sourced. As-originally-reported, point-in-time.";
  ws.getCell(r + 1, 1).font = { italic: true, size: 9, color: { argb: GREY } };
  ws.getColumn(1).width = 30;
  for (let j = 2; j <= nQ + 1; j++) ws.getColumn(j).width = 12;

  // ---- Sheet 2: WACC build ----
  const latest = rows[rows.length - 1] ?? {};
  const w2 = wb.addWorksheet("WACC build");
  w2.getCell("A1").value = `${ticker} — WACC build (RiskModels cost-of-capital layer)`;
  w2.getCell("A1").font = { bold: true, size: 13 };
  w2.getCell("A2").value =
    "CAPM cost of equity; ERP & tax are YOUR inputs (blue). Cost of equity is a live formula.";
  w2.getCell("A2").font = { italic: true, size: 9, color: { argb: GREY } };

  const kv = (
    row: number,
    label: string,
    value: number | null | undefined,
    fmt: string,
    kind: "pulled" | "input" | "formula",
    formula?: string,
  ) => {
    w2.getCell(row, 1).value = label;
    w2.getCell(row, 1).font = { bold: true };
    const c = w2.getCell(row, 2);
    if (formula) {
      c.value = { formula };
      c.font = { color: { argb: GREEN } };
    } else {
      c.value = value ?? null;
      c.font = { bold: kind === "input", color: { argb: kind === "input" ? NAVY : BLACK } };
    }
    c.numFmt = fmt;
  };

  kv(4, "Risk-free rate (10y CMT)", latest.rf_rate, PFMT, "pulled");
  kv(5, "Market beta (ERM3 conditional)", latest.beta_market, "0.00", "pulled");
  kv(6, "Equity risk premium (your input)", erp, PFMT, "input");
  kv(7, "Cost of equity = rf + β·ERP", null, PFMT, "formula", "B4+B5*B6");
  kv(8, "Cost of debt (pretax)", latest.cost_of_debt, PFMT, "pulled");
  kv(9, "Tax rate (your input)", taxRate, PFMT, "input");
  kv(10, "After-tax cost of debt", null, PFMT, "formula", "B8*(1-B9)");
  kv(12, "WACC (book weights, RiskModels)", latest.wacc, PFMT, "pulled");
  w2.getCell(14, 1).value =
    "Cost of equity recomputes live if you change the ERP (B6). WACC as-served uses book weights — supply market weights for the textbook convention. Forward projections = your assumptions (RiskModels is realized-only). as_of " +
    asOf;
  w2.getCell(14, 1).font = { italic: true, size: 9, color: { argb: GREY } };
  w2.getColumn(1).width = 34;
  w2.getColumn(2).width = 16;

  return wb;
}

export const GET = withBilling(async (request: NextRequest, _context: BillingContext) => {
  const origin = request.headers.get("origin");
  const rawTicker = request.nextUrl.pathname.split("/").slice(-2)[0]; // .../{ticker}/model-scaffold
  const sp = request.nextUrl.searchParams;

  const validation = FundamentalsRequestSchema.safeParse({
    ticker: rawTicker,
    as_of: sp.get("as_of") ?? undefined,
    periods: sp.get("periods") ?? undefined,
    erp: sp.get("erp") ?? undefined,
    tax_rate: sp.get("tax_rate") ?? undefined,
    rf_tenor: sp.get("rf_tenor") ?? undefined,
  });
  if (!validation.success) {
    return NextResponse.json(
      { error: "Malformed request", message: validation.error.issues[0].message },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const { ticker, erp, tax_rate, rf_tenor } = validation.data;
  const periods = validation.data.periods ?? 8;
  const asOf = validation.data.as_of ?? new Date().toISOString().slice(0, 10);
  const erpUsed = erp ?? 0.05;
  const taxUsed = tax_rate ?? 0.21;

  try {
    const result = await getFundamentalsForTicker(ticker, {
      asOf,
      periods,
      erp: erpUsed,
      taxRate: taxUsed,
      rfTenor: rf_tenor,
    });
    if (!result || !result.rows?.length) {
      return NextResponse.json(
        { error: "Symbol not found or no PIT-visible fundamentals" },
        { status: 404, headers: getCorsHeaders(origin) },
      );
    }

    // Same licensing gate as the JSON endpoint: raw line items only where SEC-sourced.
    const rows = result.rows.map((row) =>
      sanitizeFundamentalsRow(row as unknown as Record<string, unknown>),
    ) as unknown as Row[];

    const wb = buildWorkbook(result.ticker ?? ticker, rows, asOf, erpUsed, taxUsed);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());

    return new NextResponse(buf, {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${ticker}_model_scaffold.xlsx"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[model-scaffold] build failed", { ticker, err });
    return NextResponse.json(
      { error: "Failed to build model scaffold" },
      { status: 500, headers: getCorsHeaders(origin) },
    );
  }
}, { capabilityId: "fundamentals" });
