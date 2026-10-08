/**
 * POST /api/portfolio/exposure/history — model data feed for long/short books.
 *
 * Takes a list of tickers (no values: holdings never leave the client) and
 * returns signed URLs to two Parquet files: each name's month-end model history
 * since 2006 and the ETF covariance at each month-end. The SDK joins them with
 * the client's dated holdings locally (docs/EXPOSURE_HISTORY_FEED.md).
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
  NAME_COLUMNS,
  buildHistoryTables,
  toParquet,
  type HistoryName,
} from "@/lib/portfolio/exposure-history";
import { resolveAll } from "@/lib/portfolio/signed-exposure-data";
import {
  EXPOSURE_HISTORY_URL_TTL_SECONDS,
  inspectExposureHistoryFolder,
  newExposureHistoryGen,
  removeExposureHistoryPaths,
  signExposureHistoryPath,
  touchExposureHistoryFolder,
  uploadExposureHistoryFile,
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
    const { tickers, start, end } = validation.data;

    try {
      const fetchStart = performance.now();
      const upper = [...new Set(tickers.map((t) => t.toUpperCase()))];
      const registry = await resolveAll(upper);

      const dropped: Array<{ ticker: string; reason: string }> = [];
      const bySymbol = new Map<string, HistoryName>();
      const directEtfs: string[] = [];
      for (const t of upper) {
        const row = registry.get(t);
        if (!row) {
          dropped.push({ ticker: t, reason: "symbol_not_found" });
          continue;
        }
        if ((row.asset_type ?? "").toLowerCase() === "etf") {
          directEtfs.push(row.ticker.toUpperCase());
          continue;
        }
        const cur = bySymbol.get(row.symbol) ?? {
          symbol: row.symbol,
          tickers: [],
          sector_etf: row.sector_etf ?? null,
          subsector_etf: row.subsector_etf ?? null,
        };
        cur.tickers.push(t);
        bySymbol.set(row.symbol, cur);
      }
      const names = [...bySymbol.values()];

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
          { error: "No data", message: "None of the requested tickers has model history in range.", dropped },
          { status: 422, headers },
        );
      }
      context.setBillableItemCount?.(delivered);

      // Same request on the same panel build → same files; reuse them.
      const cacheKey = createHash("sha256")
        .update(
          JSON.stringify({
            s: names.map((n) => `${n.symbol}:${n.tickers[0]}`).sort(),
            e: [...directEtfs].sort(),
            start: start ?? null,
            end: end ?? null,
            built: slice.attrs.built_utc ?? null,
          }),
        )
        .digest("hex")
        .slice(0, 32);

      // Cleanup safety (docs/EXPOSURE_HISTORY_FEED.md, "Storage and cleanup"):
      // serve a hit only from a pair written after any `condemned` marker
      // (inspect enforces this), and only after writing a hit marker so the
      // daily cleanup sees the activity. Otherwise upload a new generation:
      // new paths that no pending delete can target.
      const built = slice.attrs.built_utc;
      const state = await inspectExposureHistoryFolder(cacheKey);
      let namesUrl: string | null = null;
      let covUrl: string | null = null;
      if (!state.error && state.pair) {
        if (await touchExposureHistoryFolder(cacheKey, built)) {
          namesUrl = await signExposureHistoryPath(state.pair.names, URL_TTL_SECONDS);
          covUrl = namesUrl ? await signExposureHistoryPath(state.pair.cov, URL_TTL_SECONDS) : null;
        }
      }
      const cached = Boolean(namesUrl && covUrl);
      if (!cached) {
        const gen = newExposureHistoryGen();
        const [namesBuf, covBuf] = await Promise.all([
          toParquet(tables.names, NAME_COLUMNS),
          toParquet(tables.cov, COV_COLUMNS),
        ]);
        const up = await Promise.allSettled([
          uploadExposureHistoryFile(cacheKey, "names", gen, namesBuf, URL_TTL_SECONDS),
          uploadExposureHistoryFile(cacheKey, "cov", gen, covBuf, URL_TTL_SECONDS),
        ]);
        if (up[0].status === "rejected" || up[1].status === "rejected") {
          // Do not leave half a generation behind; nothing was handed out.
          await removeExposureHistoryPaths([`${cacheKey}/names.${gen}.parquet`, `${cacheKey}/cov.${gen}.parquet`]);
          throw up[0].status === "rejected" ? up[0].reason : (up[1] as PromiseRejectedResult).reason;
        }
        [namesUrl, covUrl] = [up[0].value, up[1].value];
        // Build tag for the stale-build rule.
        await touchExposureHistoryFolder(cacheKey, built);
      }

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
          dropped,
          notes: [
            "Derived data only: no prices, market caps or return series.",
            "l1_mkt_beta equals -l1_mkt_hr exactly (L1 has one factor, SPY).",
            "Join locally with dated holdings via the SDK (client.exposure_history). A fixed book applied to past dates has look-back bias.",
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
