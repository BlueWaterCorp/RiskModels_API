/**
 * Live widget data endpoint: cost-of-capital sensitivity grid → OpenBB table.
 *
 * GET /openbb/widgets/wacc-grid?ticker=AAPL&measure=cost_of_equity&tax_rate=0.21
 * Auth: X-API-KEY header, forwarded upstream as Bearer. Maps the real
 * /fundamentals/{ticker}?grid=true sensitivity_grid — the selected measure
 * (WACC / cost of equity / economic profit) across ERP rows x risk-free-tenor
 * columns for the latest PIT-visible quarter. Rate measures are percent;
 * economic profit is $B. ERP is caller-varied by construction — the grid IS
 * the "no stored ERP opinion" surface.
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

const TENORS = ["3m", "1y", "2y", "5y", "10y", "30y"] as const;
const MEASURES = new Set(["wacc", "cost_of_equity", "economic_profit"]);

type GridCell = {
  cost_of_equity?: number | null;
  wacc?: number | null;
  economic_profit?: number | null;
};

type SensitivityGrid = {
  period_end_date?: string;
  erp_values?: number[];
  rf_tenor_values?: string[];
  cells?: GridCell[][];
};

function cellValue(cell: GridCell | undefined, measure: string): number | null {
  const v = cell?.[measure as keyof GridCell];
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  // Rates as percent (2dp); economic profit in $B (2dp).
  return measure === "economic_profit"
    ? Number((n / 1e9).toFixed(2))
    : Number((n * 100).toFixed(2));
}

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get("ticker") || "AAPL").trim().toUpperCase();
  const rawMeasure = (sp.get("measure") || "cost_of_equity").trim();
  const measure = MEASURES.has(rawMeasure) ? rawMeasure : "cost_of_equity";
  const taxRate = (sp.get("tax_rate") || "0.21").trim();

  const key = bearerFromRequest(req);
  if (!key) {
    return NextResponse.json(noKeyRows(), { headers: cors });
  }

  const qs = new URLSearchParams({
    periods: "1",
    grid: "true",
    tax_rate: taxRate,
    rf_tenor_grid: TENORS.join(","),
  });
  const { status, body } = await upstreamGet(
    `/fundamentals/${encodeURIComponent(ticker)}?${qs}`,
    key,
  );

  if (status < 200 || status >= 300) {
    const message =
      (body as { error?: string; message?: string })?.error ||
      (body as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return NextResponse.json({ error: message }, { status, headers: cors });
  }

  const grid = (body as { sensitivity_grid?: SensitivityGrid | null })
    .sensitivity_grid;
  if (!grid?.cells?.length || !grid.erp_values?.length) {
    return NextResponse.json(
      [{ status: "No PIT-visible quarter for this ticker" }],
      { headers: cors },
    );
  }

  const tenors = grid.rf_tenor_values ?? [...TENORS];
  const rows = grid.erp_values.map((erp, i) => {
    const row: Record<string, string | number | null> = {
      erp: `${(erp * 100).toFixed(1)}%`,
    };
    for (const t of TENORS) {
      const j = tenors.indexOf(t);
      row[t] = j >= 0 ? cellValue(grid.cells?.[i]?.[j], measure) : null;
    }
    return row;
  });

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req),
  });
}
