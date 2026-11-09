import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getFundamentalsForTicker } from "@/lib/dal/fundamentals-zarr-reader";
import { sanitizeFundamentalsRow } from "@/lib/api/fundamentals-contract";
import { FundamentalsRequestSchema } from "@/lib/api/schemas";
import { SERVED_HISTORY_START, historyAvailableFromError } from "@/lib/dal/served-history";
import {
  buildWorkbook,
  ModelScaffoldRow,
  ScaffoldDefaultedAssumption,
} from "@/lib/fundamentals/model-scaffold-defaults";

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
  const floorErr = historyAvailableFromError(
    validation.data.as_of,
    SERVED_HISTORY_START.cost_of_capital,
  );
  if (floorErr) {
    return NextResponse.json(floorErr, { status: 404, headers: getCorsHeaders(origin) });
  }
  // The request schema supplies the documented 5% / 21% defaults. Query-key
  // presence, rather than the parsed value, records whether the caller chose them.
  const erpUsed = erp;
  const taxUsed = tax_rate;
  const assumptionsDefaulted: ScaffoldDefaultedAssumption[] = [
    ...(!sp.has("erp") ? ["erp" as const] : []),
    ...(!sp.has("tax_rate") ? ["tax_rate" as const] : []),
  ];

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
    ) as unknown as ModelScaffoldRow[];

    const wb = buildWorkbook(
      result.ticker ?? ticker,
      rows,
      asOf,
      erpUsed,
      taxUsed,
      assumptionsDefaulted,
    );
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());

    return new NextResponse(buf, {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${ticker}_model_scaffold.xlsx"`,
        "Cache-Control": "private, max-age=300",
        "X-Assumptions-Defaulted": assumptionsDefaulted.join(","),
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
