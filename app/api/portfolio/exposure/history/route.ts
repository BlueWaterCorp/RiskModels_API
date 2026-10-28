/**
 * POST /api/portfolio/exposure/history — model data feed for long/short books.
 *
 * Takes a list of tickers (no values: holdings never leave the client) and
 * returns signed URLs to two Parquet files: each name's month-end model history
 * and the ETF covariance at each month-end. The SDK joins them with the
 * client's dated holdings locally (docs/EXPOSURE_HISTORY_FEED.md).
 *
 * History follows the served-history policy (lib/dal/served-history.ts): rows
 * start at the first month-end on or after 2010-12-08 (hedge ratios);
 * explained-risk shares and stock_var are null before 2011-12-07, lstar_level
 * before 2013-01-01. The response states this in `history_available_from`
 * and, when the requested start is earlier, in `warnings`.
 *
 * Tickers resolve point in time (ERM3-73): a ticker that appears in a reviewed
 * corporate-action event gets `ticker_windows` (holding-date ranges, each naming
 * the security a holding dated inside it is priced as), built by the same step
 * as POST /portfolio/exposure with positions_as_of. The securities the windows
 * name are delivered too (`window_targets`), so the SDK joins a past SPCX
 * holding to the ETF (now SPCK), not to SpaceX. Other tickers resolve through
 * today's registry.
 *
 * Everything delivered is derived data (lib/portfolio/exposure-history.ts holds
 * the column allowlist). Priced per call by names delivered: $1.25 up to 25,
 * $5.00 above.
 */

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { readExposureMonthEndPanel } from "@/lib/dal/zarr-reader";
import { ExposureHistoryRequestSchema } from "@/lib/api/schemas";
import {
  COV_COLUMNS,
  EXPOSURE_FIELD_START,
  EXPOSURE_HISTORY_START,
  NAME_COLUMNS,
  buildHistoryTables,
  maskBeforeServedStart,
  servedStartWarnings,
  toParquet,
  historyTickerWindows,
  resolveHistoryNames,
  TICKER_RESOLUTION_NOTE,
} from "@/lib/portfolio/exposure-history";
import { clampStart } from "@/lib/dal/served-history";
import { resolveAll } from "@/lib/portfolio/signed-exposure-data";
import {
  EXPOSURE_HISTORY_URL_TTL_SECONDS,
  serveExposureHistorySet,
  writeExposureHistorySet,
} from "@/lib/supabase/storage";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const URL_TTL_SECONDS = EXPOSURE_HISTORY_URL_TTL_SECONDS;

/** Distinct tickers submitted: sets the price tier for the pre-flight balance check. */
async function getItemCount(req: NextRequest): Promise<number | undefined> {
  try {
    const body = await req.clone().json();
    if (!Array.isArray(body?.tickers)) return undefined;
    return new Set(body.tickers.map((t: unknown) => String(t ?? "").toUpperCase())).size;
  } catch {
    return undefined;
  }
}

export const POST = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    const headers = getCorsHeaders(origin);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request", message: "Body must be valid JSON" },
        { status: 400, headers },
      );
    }
    const validation = ExposureHistoryRequestSchema.safeParse(payload);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", message: validation.error.issues[0].message },
        { status: 400, headers },
      );
    }
    const { tickers, end } = validation.data;
    // Nothing before the served-history start is read; per-column floors are applied below.
    const start = clampStart(validation.data.start, EXPOSURE_HISTORY_START)!;
    const warnings = servedStartWarnings(validation.data.start);

    try {
      const fetchStart = performance.now();
      // Point in time (ERM3-73): tickers in reviewed events get dated windows; the SDK joins each
      // holding through the window covering its own date. Window targets are delivered too.
      const { windows: tickerWindows, targets: windowTargets } = await historyTickerWindows(tickers);
      const { names, directEtfs, dropped, targets } = await resolveHistoryNames(tickers, resolveAll, windowTargets);
      const bySymbol = new Map(names.map((n) => [n.symbol, n]));

      const slice = await readExposureMonthEndPanel({
        symbols: names.map((n) => n.symbol),
        start,
        end,
      });
      if (!slice) {
        return NextResponse.json(
          { error: "Unavailable", message: "The month-end history panel is not available." },
          { status: 503, headers },
        );
      }
      maskBeforeServedStart(slice.teos, slice.bySymbol);

      const tables = buildHistoryTables(slice, names, directEtfs);
      for (const sym of tables.noData) {
        for (const t of bySymbol.get(sym)!.tickers) dropped.push({ ticker: t, reason: "no_data_in_range" });
      }
      const etfsDelivered = directEtfs.filter((e) => tables.covEtfs.includes(e));
      for (const e of directEtfs) {
        if (!etfsDelivered.includes(e)) dropped.push({ ticker: e, reason: "etf_without_covariance" });
      }
      const delivered = tables.delivered.length + etfsDelivered.length;
      if (delivered === 0) {
        // Nothing to deliver: a 4xx, so not billed.
        return NextResponse.json(
          {
            error: "No data",
            message: "None of the requested tickers has model history in range.",
            dropped,
            history_available_from: EXPOSURE_FIELD_START,
          },
          { status: 422, headers },
        );
      }
      // Names delivered only as window targets are not billed beyond the tickers submitted.
      context.setBillableItemCount?.(Math.min(delivered, new Set(tickers.map((t) => t.toUpperCase())).size));

      // Same request on the same panel build → same files; reuse them.
      const cacheKey = createHash("sha256")
        .update(
          JSON.stringify({
            s: names.map((n) => `${n.symbol}:${n.tickers[0]}`).sort(),
            e: [...directEtfs].sort(),
            start,
            end: end ?? null,
            built: slice.attrs.built_utc ?? null,
            // Sets written before the served-history floors applied hold pre-floor rows.
            served: EXPOSURE_FIELD_START,
          }),
        )
        .digest("hex")
        .slice(0, 32);

      // Cache rules shared with the daily route and the cleanup cron:
      // lib/supabase/storage.ts, docs/EXPOSURE_HISTORY_FEED.md "Storage and cleanup".
      const built = slice.attrs.built_utc;
      let urls = await serveExposureHistorySet(cacheKey, built, ["names", "cov"], URL_TTL_SECONDS);
      const cached = Boolean(urls?.names && urls?.cov);
      if (!cached) {
        const [namesBuf, covBuf] = await Promise.all([
          toParquet(tables.names, NAME_COLUMNS),
          toParquet(tables.cov, COV_COLUMNS),
        ]);
        urls = await writeExposureHistorySet(
          cacheKey,
          built,
          [
            { name: "names", bytes: namesBuf },
            { name: "cov", bytes: covBuf },
          ],
          URL_TTL_SECONDS,
        );
      }
      const namesUrl = urls!.names;
      const covUrl = urls!.cov;

      const metadata = await getRiskMetadata();
      const latency = Math.round(performance.now() - fetchStart);
      const response = NextResponse.json(
        {
          as_of: {
            first_teo: slice.teos[0] ?? null,
            last_teo: slice.teos[slice.teos.length - 1] ?? null,
            months: slice.teos.length,
            frequency: "month_end",
            note: "Each row is the last trading day of its month; the current month uses its latest model day.",
            panel_built_utc: slice.attrs.built_utc ?? null,
            source_last_teo: slice.attrs.source_last_teo ?? null,
            etf_mapping: "current symbol registry (not point-in-time)",
            ticker_resolution: TICKER_RESOLUTION_NOTE,
          },
          files: {
            names: { url: namesUrl, format: "parquet", rows: tables.names.length, columns: NAME_COLUMNS },
            cov: {
              url: covUrl,
              format: "parquet",
              rows: tables.cov.length,
              columns: COV_COLUMNS,
              description: "Daily ETF return covariance over the 252 trading days ending each teo; upper triangle (etf_i <= etf_j).",
            },
            expires_in_seconds: URL_TTL_SECONDS,
            cached,
          },
          names_delivered: tables.delivered.length,
          etfs_in_covariance: tables.covEtfs,
          ticker_windows: tickerWindows,
          window_targets: targets,
          dropped,
          history_available_from: EXPOSURE_FIELD_START,
          warnings,
          notes: [
            "Derived data only: no prices, market caps or return series.",
            "l1_mkt_beta equals -l1_mkt_hr exactly (L1 has one factor, SPY).",
            "Join locally with dated holdings via the SDK (client.exposure_history). A fixed book applied to past dates has look-back bias.",
            "A holding of a ticker listed in ticker_windows joins the security its window names for the holding's own date (priced_as / bw_sym_id), not today's holder of the ticker.",
          ],
          _metadata: buildMetadataBody(metadata, { data_source: "zarr" }),
          _agent: { cost_usd: context.costUsd, request_id: context.requestId, latency_ms: latency },
        },
        { headers: { ...headers, "X-Data-Fetch-Latency-Ms": String(latency) } },
      );
      addMetadataHeaders(response, metadata);
      return response;
    } catch (err) {
      console.error("[portfolio/exposure/history] failed:", err);
      return NextResponse.json(
        { error: "Internal error", message: "Exposure history failed" },
        { status: 500, headers },
      );
    }
  },
  { capabilityId: "portfolio-exposure-history", getItemCount },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
