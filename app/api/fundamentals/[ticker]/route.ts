/**
 * GET /fundamentals/{ticker}
 *
 * raw-field-ok-file: market_cap is served under Exhibit B(e) — withBilling
 * makes this an authenticated environment, the route is per-symbol/per-request,
 * and the value is ancillary to the derived capital-cost outputs. Raw vendor
 * line items are withheld by lib/api/fundamentals-contract (allowlist + per-cell
 * SEC-provenance gate); only SEC-basis facts ship.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import {
  getFundamentalsForTicker,
  getFundamentalsSensitivityGrid,
  DEFAULT_ERP_GRID,
  RF_TENORS,
} from "@/lib/dal/fundamentals-zarr-reader";
import {
  buildFundamentalsDisclosures,
  sanitizeFundamentalsRow,
} from "@/lib/api/fundamentals-contract";
import {
  resolveSymbolByTicker,
  fetchLatestMetricsWithFallback,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { FundamentalsRequestSchema } from "@/lib/api/schemas";

/**
 * GET /api/fundamentals/{ticker} — PIT quarterly fundamentals, DERIVED-ONLY.
 *
 * H.69 remediation posture: authenticated + billed per call (withBilling),
 * strictly per-symbol (no batch variant exists and none may be added), JSON
 * only (no CSV/parquet bulk export), periods hard-capped at 40, and every row
 * passes the fundamentals-contract allowlist before serialization — raw
 * vendor line items never leave the DAL.
 *
 * PIT: rows are visible iff filed_date <= as_of. Never "latest".
 */

/**
 * Current market cap (EODHD Exhibit B(e)) from the existing metrics surface —
 * a CURRENT snapshot, not PIT per quarter (the fundamentals store carries no
 * price plane). Best-effort: null on any failure, never fails the request.
 */
async function fetchCurrentMarketCap(ticker: string): Promise<number | null> {
  try {
    const symbolRecord = await resolveSymbolByTicker(ticker);
    if (!symbolRecord) return null;
    const latest = await fetchLatestMetricsWithFallback(
      symbolRecord.symbol,
      ["market_cap"],
      "daily",
    );
    const v = latest?.metrics?.market_cap;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch (err) {
    console.warn("[Fundamentals API] market_cap lookup failed", { ticker, err });
    return null;
  }
}

export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const rawTicker = request.nextUrl.pathname.split("/").pop();
    const origin = request.headers.get("origin");
    const sp = request.nextUrl.searchParams;

    const validation = FundamentalsRequestSchema.safeParse({
      ticker: rawTicker,
      as_of: sp.get("as_of") ?? undefined,
      periods: sp.get("periods") ?? undefined,
      erp: sp.get("erp") ?? undefined,
      tax_rate: sp.get("tax_rate") ?? undefined,
      rf_tenor: sp.get("rf_tenor") ?? undefined,
      grid: sp.get("grid") ?? undefined,
      erp_grid: sp.get("erp_grid") ?? undefined,
      rf_tenor_grid: sp.get("rf_tenor_grid") ?? undefined,
    });
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Malformed request",
          message: validation.error.issues[0].message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { ticker, periods, erp, tax_rate, rf_tenor, grid, erp_grid, rf_tenor_grid } =
      validation.data;
    const asOf = validation.data.as_of ?? new Date().toISOString().slice(0, 10);

    try {
      const fetchStart = performance.now();
      const [result, sensitivityGrid] = await Promise.all([
        getFundamentalsForTicker(ticker, {
          asOf,
          periods,
          erp,
          taxRate: tax_rate,
          rfTenor: rf_tenor,
        }),
        grid
          ? getFundamentalsSensitivityGrid(ticker, {
              asOf,
              erpGrid: erp_grid ?? DEFAULT_ERP_GRID,
              rfTenorGrid: rf_tenor_grid ?? RF_TENORS,
              taxRate: tax_rate,
            })
          : Promise.resolve(null),
      ]);

      if (!result) {
        const metadata = await getRiskMetadata();
        const response = NextResponse.json(
          { error: "Symbol not found" },
          { status: 404, headers: getCorsHeaders(origin) },
        );
        addMetadataHeaders(response, metadata);
        return response;
      }

      const [metadata, marketCap] = await Promise.all([
        getRiskMetadata(),
        fetchCurrentMarketCap(ticker),
      ]);

      // Licensing gate: every row is reduced to the contract allowlist here.
      const rows = result.rows.map((row) =>
        sanitizeFundamentalsRow(row as unknown as Record<string, unknown>),
      );

      const responseBody = {
        ticker: result.ticker,
        as_of: asOf,
        periods_returned: rows.length,
        rows,
        market_cap: {
          value: marketCap,
          basis: "current_snapshot",
          note: "Current market cap, not point-in-time per quarter.",
        },
        ...(grid ? { sensitivity_grid: sensitivityGrid } : {}),
        disclosures: buildFundamentalsDisclosures({ erp, tax_rate, as_of: asOf, rf_tenor }),
        _metadata: buildMetadataBody(metadata),
      };

      const fetchLatency = Math.round(performance.now() - fetchStart);
      // Private: per-call billed surface — never let a shared cache serve
      // unbilled hits. JSON only by design (no bulk/CSV export).
      const response = NextResponse.json(responseBody, {
        headers: {
          ...getCorsHeaders(origin),
          "Content-Type": "application/json",
          "Cache-Control": "private, max-age=300",
          "X-Data-Fetch-Latency-Ms": String(fetchLatency),
        },
      });
      addMetadataHeaders(response, metadata);
      return response;
    } catch (error) {
      console.error(`[Fundamentals API] Exception fetching ${ticker}:`, error);
      const metadata = await getRiskMetadata();
      const response = NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 },
      );
      addMetadataHeaders(response, metadata);
      return response;
    }
  },
  { capabilityId: "fundamentals" },
);
