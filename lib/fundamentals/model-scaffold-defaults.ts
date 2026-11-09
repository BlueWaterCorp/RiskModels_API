import ExcelJS from "exceljs";

const NAVY = "FF1F4E79";
const BLACK = "FF000000";
const GREEN = "FF1E7A46";
const GREY = "FF666666";
const M = 1e6;
const MFMT = "#,##0;(#,##0)";
const PFMT = "0.0%";

type Cell = { value?: number | null; source?: string };

export type ModelScaffoldRow = Record<string, unknown> & {
  period_end_date?: string;
  sec_facts?: Record<string, Cell>;
  rf_rate?: number | null;
  beta_market?: number | null;
  cost_of_equity?: number | null;
  cost_of_debt?: number | null;
  wacc?: number | null;
};

export type ScaffoldDefaultedAssumption = "erp" | "tax_rate";

function secVal(row: ModelScaffoldRow, concept: string): number | null {
  const fact = row.sec_facts?.[concept];
  return fact && typeof fact.value === "number" && Number.isFinite(fact.value)
    ? fact.value
    : null;
}

export function buildWorkbook(
  ticker: string,
  rows: ModelScaffoldRow[],
  asOf: string,
  erp: number,
  taxRate: number,
  assumptionsDefaulted: ScaffoldDefaultedAssumption[] = [],
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RiskModels (riskmodels.app)";

  const ws = wb.addWorksheet("Historicals ($M)");
  ws.getCell("A1").value = `${ticker} — Historical block (RiskModels, SEC-sourced, PIT)`;
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value =
    "Filled from GET /api/fundamentals/{ticker} — the historical block an Excel model pulls from a licensed terminal. $0.005/call. Forward projections = your assumptions.";
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: GREY } };

  const nQ = rows.length;
  const header = ["Line item ($M)", ...rows.map((row) => row.period_end_date ?? "")];
  const r0 = 4;
  header.forEach((heading, columnIndex) => {
    const cell = ws.getCell(r0, columnIndex + 1);
    cell.value = heading;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: columnIndex === 0 ? "left" : "center" };
  });

  let rowIndex = r0 + 1;
  const lineRow = (label: string, concept: string): number => {
    ws.getCell(rowIndex, 1).value = label;
    rows.forEach((row, columnIndex) => {
      const value = secVal(row, concept);
      const cell = ws.getCell(rowIndex, columnIndex + 2);
      if (value !== null) cell.value = value / M;
      cell.numFmt = MFMT;
      cell.font = { color: { argb: BLACK } };
    });
    return rowIndex++;
  };
  const formulaRow = (
    label: string,
    format: string,
    make: (column: string) => string,
  ): number => {
    ws.getCell(rowIndex, 1).value = label;
    ws.getCell(rowIndex, 1).font = { bold: true };
    for (let columnIndex = 0; columnIndex < nQ; columnIndex++) {
      const column = ws.getColumn(columnIndex + 2).letter;
      const cell = ws.getCell(rowIndex, columnIndex + 2);
      cell.value = { formula: make(column) };
      cell.numFmt = format;
      cell.font = { color: { argb: GREEN } };
    }
    return rowIndex++;
  };

  const revenueRow = lineRow("Revenue", "revenue");
  const ebitRow = lineRow("Operating income (EBIT)", "operating_income");
  formulaRow("  EBIT margin", PFMT, (column) => `${column}${ebitRow}/${column}${revenueRow}`);
  lineRow("Pretax income", "pretax_income");
  lineRow("Income tax", "income_tax_expense");
  lineRow("Net income", "net_income");
  const cashFromOperationsRow = lineRow("Cash from operations", "cash_from_operations");
  const capitalExpendituresRow = lineRow("Capital expenditures", "capital_expenditures");
  const freeCashFlowRow = formulaRow(
    "Free cash flow (CFO − capex)",
    MFMT,
    (column) => `${column}${cashFromOperationsRow}-${column}${capitalExpendituresRow}`,
  );
  formulaRow("  FCF margin", PFMT, (column) => `${column}${freeCashFlowRow}/${column}${revenueRow}`);

  ws.getCell(rowIndex + 1, 1).value =
    "Black = pulled from RiskModels (SEC us_gaap). Green = formula. Blank = cell not SEC-sourced. As-originally-reported, point-in-time.";
  ws.getCell(rowIndex + 1, 1).font = {
    italic: true,
    size: 9,
    color: { argb: GREY },
  };
  ws.getColumn(1).width = 30;
  for (let columnIndex = 2; columnIndex <= nQ + 1; columnIndex++) {
    ws.getColumn(columnIndex).width = 12;
  }

  const latest = rows[rows.length - 1] ?? {};
  const waccSheet = wb.addWorksheet("WACC build");
  waccSheet.getCell("A1").value = `${ticker} — WACC build (RiskModels cost-of-capital layer)`;
  waccSheet.getCell("A1").font = { bold: true, size: 13 };
  waccSheet.getCell("A2").value =
    "CAPM cost of equity; ERP & tax are YOUR inputs (blue). Cost of equity is a live formula.";
  waccSheet.getCell("A2").font = { italic: true, size: 9, color: { argb: GREY } };

  const keyValueRow = (
    row: number,
    label: string,
    value: number | null | undefined,
    format: string,
    kind: "pulled" | "input" | "formula",
    formula?: string,
  ) => {
    waccSheet.getCell(row, 1).value = label;
    waccSheet.getCell(row, 1).font = { bold: true };
    const cell = waccSheet.getCell(row, 2);
    if (formula) {
      cell.value = { formula };
      cell.font = { color: { argb: GREEN } };
    } else {
      cell.value = value ?? null;
      cell.font = {
        bold: kind === "input",
        color: { argb: kind === "input" ? NAVY : BLACK },
      };
    }
    cell.numFmt = format;
  };

  keyValueRow(4, "Risk-free rate (10y CMT)", latest.rf_rate, PFMT, "pulled");
  keyValueRow(5, "Market beta (ERM3 conditional)", latest.beta_market, "0.00", "pulled");
  keyValueRow(6, "Equity risk premium (your input)", erp, PFMT, "input");
  keyValueRow(7, "Cost of equity = rf + β·ERP", null, PFMT, "formula", "B4+B5*B6");
  keyValueRow(8, "Cost of debt (pretax)", latest.cost_of_debt, PFMT, "pulled");
  keyValueRow(9, "Tax rate (your input)", taxRate, PFMT, "input");
  keyValueRow(10, "After-tax cost of debt", null, PFMT, "formula", "B8*(1-B9)");
  keyValueRow(12, "WACC (book weights, RiskModels)", latest.wacc, PFMT, "pulled");
  waccSheet.getCell(14, 1).value =
    "Cost of equity recomputes live if you change the ERP (B6). WACC as-served uses book weights — supply market weights for the textbook convention. Forward projections = your assumptions (RiskModels is realized-only). as_of " +
    asOf;
  waccSheet.getCell(14, 1).font = {
    italic: true,
    size: 9,
    color: { argb: GREY },
  };
  waccSheet.getCell(16, 1).value = "assumptions_defaulted";
  waccSheet.getCell(16, 1).font = { bold: true };
  waccSheet.getCell(16, 2).value = assumptionsDefaulted.join(", ");
  waccSheet.getColumn(1).width = 34;
  waccSheet.getColumn(2).width = 16;

  return wb;
}
