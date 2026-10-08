/**
 * POST /api/portfolio/exposure/history/daily — daily model history feed.
 *
 * Same contract as /portfolio/exposure/history (tickers only, signed Parquet
 * URLs, SDK joins locally), but every trading day instead of month-ends. Read
 * straight from the ERM3 hedge-weights and returns stores (no extra stored
 * data); names delivered as one Parquet file per calendar year. The ETF
 * covariance stays month-end (from the month-end panel): a 252-day covariance
 * barely moves day to day, and the SDK uses the latest month-end on or before
 * each day.
 *
 * Measured 2026-10-08: reading full daily history (2006 → today) takes ~7 s for
 * 25 names and ~19 s for 1000; writing Parquet dominates for large books.
 */

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { readDailyExposureHistory, readExposureMonthEndPanel } from "@/lib/dal/zarr-reader";
import { ExposureHistoryRequestSchema } from "@/lib/api/schemas";
import {
  COV_COLUMNS,
  NAME_COLUMNS,
  buildDailyNameRows,
  buildHistoryTables,
  dailyCoverage,
  dailyYears,
  resolveHistoryNames,
  toParquet,
} from "@/lib/portfolio/exposure-history";
import { resolveAll } from "@/lib/portfolio/signed-exposure-data";
import {
  EXPOSURE_HISTORY_URL_TTL_SECONDS,
  serveExposureHistorySet,
  writeExposureHistorySet,
} from "@/lib/supabase/storage";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const URL_TTL_SECONDS = EXPOSURE_HISTORY_URL_TTL_SECONDS;
const DEFAULT_START = "2006-01-01";

async function getItemCount(req: NextRequest): Promise<number | undefined> {
  try {
    const body = await req.clone().json();
    if (!Array.isArray(body?.tickers)) return undefined;
    return new Set(body.tickers.map((t: unknown) => String(t ?? "").toUpperCase())).size;
  } catch {
    return undefined;
  }
}

/** First day of the month before `date`: the covariance needs the month-end preceding the first day. */
function monthBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1, 1);
  return d.toISOString().slice(0, 10);
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
    const start = validation.data.start ?? DEFAULT_START;

    try {
      const fetchStart = performance.now();
      const { names, directEtfs, dropped } = await resolveHistoryNames(tickers, resolveAll);

      const [daily, panel] = await Promise.all([
        readDailyExposureHistory({ symbols: names.map((n) => n.symbol), start, end }),
        readExposureMonthEndPanel({ symbols: [], start: monthBefore(start), end }),
      ]);
      if (!daily || !panel) {
        return NextResponse.json(
          { error: "Unavailable", message: "Daily history or the month-end covariance panel is not available." },
          { status: 503, headers },
        );
      }

      const { delivered, noData } = dailyCoverage(daily, names);
      const bySymbol = new Map(names.map((n) => [n.symbol, n]));
      for (const sym of noData) {
        for (const t of bySymbol.get(sym)!.tickers) dropped.push({ ticker: t, reason: "no_data_in_range" });
      }
      const deliveredNames = delivered.map((s) => bySymbol.get(s)!);
      const cov = buildHistoryTables(panel, deliveredNames, directEtfs);
      const etfsDelivered = directEtfs.filter((e) => cov.covEtfs.includes(e));
      for (const e of directEtfs) {
        if (!etfsDelivered.includes(e)) dropped.push({ ticker: e, reason: "etf_without_covariance" });
      }
      const billable = delivered.length + etfsDelivered.length;
      if (billable === 0) {
        return NextResponse.json(
          { error: "No data", message: "None of the requested tickers has model history in range.", dropped },
          { status: 422, headers },
        );
      }
      context.setBillableItemCount?.(billable);

      const cacheKey = createHash("sha256")
        .update(
          JSON.stringify({
            f: "daily",
            s: deliveredNames.map((n) => `${n.symbol}:${n.tickers[0]}`).sort(),
            e: [...directEtfs].sort(),
            start,
            end: end ?? null,
            last: daily.teos[daily.teos.length - 1] ?? null,
            built: panel.attrs.built_utc ?? null,
          }),
        )
        .digest("hex")
        .slice(0, 32);

      // Cache rules shared with the month-end route and the cleanup cron:
      // lib/supabase/storage.ts, docs/EXPOSURE_HISTORY_FEED.md "Storage and cleanup".
      const built = panel.attrs.built_utc;
      const parts: Array<{ year: string; url: string; rows: number }> = [];
      let covUrl: string;
      const hit = await serveExposureHistorySet(cacheKey, built, URL_TTL_SECONDS);
      const cached = Boolean(hit?.cov);
      if (hit && cached) {
        for (const name of Object.keys(hit).filter((n) => n.startsWith("names_")).sort()) {
          parts.push({ year: name.slice("names_".length), url: hit[name], rows: -1 }); // rows unknown on a hit
        }
        covUrl = hit.cov;
      } else {
        const files: Array<{ name: string; bytes: Buffer }> = [];
        const rowsByYear = new Map<string, number>();
        for (const year of dailyYears(daily)) {
          const yearRows = buildDailyNameRows(daily, deliveredNames, year);
          if (yearRows.length === 0) continue;
          rowsByYear.set(year, yearRows.length);
          files.push({ name: `names_${year}`, bytes: await toParquet(yearRows, NAME_COLUMNS) });
        }
        files.push({ name: "cov", bytes: await toParquet(cov.cov, COV_COLUMNS) });
        const urls = await writeExposureHistorySet(cacheKey, built, files, URL_TTL_SECONDS);
        for (const [year, rows] of rowsByYear) parts.push({ year, url: urls[`names_${year}`], rows });
        covUrl = urls.cov;
      }

      const metadata = await getRiskMetadata();
      const latency = Math.round(performance.now() - fetchStart);
      const response = NextResponse.json(
        {
          as_of: {
            first_teo: daily.teos[0] ?? null,
            last_teo: daily.teos[daily.teos.length - 1] ?? null,
            days: daily.teos.length,
            frequency: "daily",
            covariance_frequency: "month_end",
            note: "Use the latest covariance month-end on or before each day (the SDK does this).",
            etf_mapping: "current symbol registry (not point-in-time)",
          },
          files: {
            names: { format: "parquet", columns: NAME_COLUMNS, parts },
            cov: {
              url: covUrl,
              format: "parquet",
              rows: cov.cov.length,
              columns: COV_COLUMNS,
              description: "Daily ETF return covariance over the 252 trading days ending each month-end; upper triangle.",
            },
            expires_in_seconds: URL_TTL_SECONDS,
            cached,
          },
          names_delivered: delivered.length,
          etfs_in_covariance: cov.covEtfs,
          dropped,
          notes: [
            "Derived data only: no prices, market caps or return series.",
            "l1_mkt_beta equals -l1_mkt_hr exactly (L1 has one factor, SPY).",
            "Join locally with dated holdings via the SDK (client.exposure_history(..., frequency='daily')).",
          ],
          _metadata: buildMetadataBody(metadata, { data_source: "zarr" }),
          _agent: { cost_usd: context.costUsd, request_id: context.requestId, latency_ms: latency },
        },
        { headers: { ...headers, "X-Data-Fetch-Latency-Ms": String(latency) } },
      );
      addMetadataHeaders(response, metadata);
      return response;
    } catch (err) {
      console.error("[portfolio/exposure/history/daily] failed:", err);
      return NextResponse.json(
        { error: "Internal error", message: "Daily exposure history failed" },
        { status: 500, headers },
      );
    }
  },
  { capabilityId: "portfolio-exposure-history-daily", getItemCount },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
