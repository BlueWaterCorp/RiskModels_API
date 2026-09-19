import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { readWeeklyHedgeSnapshot } from "@/lib/dal/zarr-reader";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";
import { parseFormat, formatResponse } from "@/lib/api/format-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Next session after `computed_through`, in UTC, as YYYY-MM-DD.
 * Weekend-aware only: the snapshot is always built from a Friday close for the
 * following Monday, so a calendar roll is enough to detect a stale week.
 */
export function expectedEffectiveFrom(computedThrough: string, now: Date): string | null {
  const ct = new Date(`${computedThrough}T00:00:00Z`);
  if (Number.isNaN(ct.getTime())) return null;
  const next = new Date(ct.getTime() + 86400000);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString().slice(0, 10);
}

/**
 * A snapshot is stale once the session it is effective for has passed.
 * Serving it anyway is the failure that costs money: last week's hedge ratios
 * are indistinguishable from this week's to a caller that does not check.
 */
export function isStale(effectiveFrom: string | null, now: Date): boolean {
  if (!effectiveFrom) return true;
  const eff = new Date(`${effectiveFrom}T00:00:00Z`);
  if (Number.isNaN(eff.getTime())) return true;
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // Effective for a week: valid from its Monday through the following Friday.
  return today.getTime() > eff.getTime() + 5 * 86400000;
}

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");
    const fetchStart = performance.now();

    try {
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
