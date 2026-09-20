import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { readWeeklyHedgeSnapshot } from "@/lib/dal/zarr-reader";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";
import { parseFormat, formatResponse } from "@/lib/api/format-response";
import { isStale } from "@/lib/risk/weekly-hedge-freshness";
import { isWeeklyHedgeAuthorized } from "@/lib/api/weekly-hedge-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");
    const fetchStart = performance.now();

    try {
      // Entitlement before any data read. This feed is for named accounts, not
      // a tier: one call returns the whole cross-section including the
      // subsector ETF legs.
      if (
        !isWeeklyHedgeAuthorized({
          userId: context.userId,
          adminSecret: request.headers.get("x-admin-secret"),
        })
      ) {
        return NextResponse.json(
          {
            error: "Forbidden",
            message: "This account is not entitled to the weekly hedge feed.",
          },
          { status: 403, headers: getCorsHeaders(origin) },
        );
      }

      const snapshot = await readWeeklyHedgeSnapshot();

      if (!snapshot || snapshot.rows.length === 0) {
        return NextResponse.json(
          {
            error: "Not found",
            message: "Weekly hedge snapshot unavailable",
          },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

      const { metadata: meta, rows } = snapshot;
      const allowStale = searchParams.get("allow_stale") === "true";

      // 409, not a silent serve. The whole point of a pre-market snapshot is
      // that it is the CURRENT week's; an endpoint that quietly returns an
      // expired one is worse than one that is down, because the caller cannot
      // tell. `allow_stale=true` exists for reconciliation, not for trading.
      if (!allowStale && isStale(meta.effective_from, new Date())) {
        return NextResponse.json(
          {
            error: "Stale snapshot",
            message:
              `Weekly hedge snapshot is effective_from ${meta.effective_from} ` +
              `(computed_through ${meta.computed_through}) and is no longer current. ` +
              `Pass allow_stale=true to retrieve it anyway.`,
            effective_from: meta.effective_from,
            computed_through: meta.computed_through,
          },
          { status: 409, headers: getCorsHeaders(origin) },
        );
      }

      const riskMeta = await getRiskMetadata();
      const latency = Math.round(performance.now() - fetchStart);
      const snapshotHeaders: Record<string, string> = {
        ...(getCorsHeaders(origin) as Record<string, string>),
        "X-Effective-From": meta.effective_from ?? "",
        "X-Computed-Through": meta.computed_through ?? "",
        "X-Refit-Grid": meta.refit_grid ?? "",
        "X-Data-Fetch-Latency-Ms": String(latency),
      };

      const format = parseFormat(searchParams, request.headers.get("accept"));
      if (format !== "json") {
        return formatResponse({
          rows,
          format,
          filename: `weekly_hedge_${meta.effective_from ?? "snapshot"}.${format}`,
          extraHeaders: snapshotHeaders,
        });
      }

      const response = NextResponse.json(
        {
          effective_from: meta.effective_from,
          computed_through: meta.computed_through,
          refit_grid: meta.refit_grid,
          universe: meta.universe,
          market_etf: meta.market_etf,
          built_at_utc: meta.built_at_utc,
          basis: { hedge_ratios: meta.hr_basis, betas: meta.beta_basis },
          count: rows.length,
          rows,
          _metadata: buildMetadataBody(riskMeta, { data_source: "zarr" }),
          _agent: {
            cost_usd: context.costUsd,
            request_id: context.requestId,
            latency_ms: latency,
          },
        },
        { headers: snapshotHeaders },
      );
      addMetadataHeaders(response, riskMeta);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return NextResponse.json(
        { error: "Internal error", message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "weekly-hedge" },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
