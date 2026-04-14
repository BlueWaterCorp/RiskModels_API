/**
 * Stock Deep Dive (DD) snapshot — served from precomputed GCS objects.
 *
 * The DD snapshots are generated offline by the Python pipeline in
 * `sdk/riskmodels/snapshots/stock_deep_dive.py` and uploaded to
 * `gs://rm_api_public/snapshot/{TICKER}/{TICKER}_DD_latest.{png,pdf}`.
 *
 * This endpoint adds an authenticated, branded API URL on top of the
 * public bucket, enforcing API-key auth, billing, CORS, and a Redis cache
 * layer. The Python generation code stays proprietary on the offline
 * batch infrastructure — only the rendered bytes ever leave that
 * environment.
 *
 *   GET /api/snapshot/{ticker}              → image/png
 *   GET /api/snapshot/{ticker}?format=pdf   → application/pdf
 *   GET /api/snapshot/{ticker}?format=png   → image/png
 */

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getBillingUserId } from "@/lib/agent/billing-user";
import {
  getCache,
  setCache,
  generateCacheKey,
  CACHE_TTL,
} from "@/lib/cache/redis";
import { isDdSnapshotCacheHit } from "@/lib/cache/snapshot-payload-guards";
import { TickerSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

// Public GCS bucket where the offline pipeline uploads the rendered DD files.
const GCS_BASE = "https://storage.googleapis.com/rm_api_public/snapshot";

const ALLOWED_FORMATS = ["png", "pdf"] as const;
type SnapshotFormat = (typeof ALLOWED_FORMATS)[number];

type SnapshotCache = {
  base64: string;
  contentType: string;
  lastModified?: string;
  etag?: string;
};

function snapshotCacheKey(ticker: string, format: SnapshotFormat) {
  const h = createHash("sha256")
    .update(JSON.stringify({ ticker: ticker.toUpperCase(), format }))
    .digest("hex");
  return generateCacheKey("dd_snapshot", h);
}

function buildGcsUrl(ticker: string, format: SnapshotFormat): string {
  const upper = ticker.toUpperCase();
  return `${GCS_BASE}/${upper}/${upper}_DD_latest.${format}`;
}

async function fetchFromGcs(
  ticker: string,
  format: SnapshotFormat,
  origin: string | null,
): Promise<NextResponse> {
  const url = buildGcsUrl(ticker, format);
  let upstream: Response;
  try {
    upstream = await fetch(url, { cache: "no-store" });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Upstream fetch failed",
        message: `Could not reach precomputed snapshot store for ${ticker}.`,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502, headers: getCorsHeaders(origin) },
    );
  }

  if (upstream.status === 404) {
    return NextResponse.json(
      {
        error: "Snapshot not found",
        message: `No precomputed DD snapshot exists for ${ticker}. The offline batch pipeline may not yet cover this ticker.`,
        ticker: ticker.toUpperCase(),
      },
      { status: 404, headers: getCorsHeaders(origin) },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: "Upstream error",
        message: `GCS returned ${upstream.status} for ${ticker} snapshot.`,
      },
      { status: 502, headers: getCorsHeaders(origin) },
    );
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  const contentType =
    upstream.headers.get("content-type") ??
    (format === "pdf" ? "application/pdf" : "image/png");
  const lastModified = upstream.headers.get("last-modified") ?? undefined;
  const etag = upstream.headers.get("etag") ?? undefined;

  const headers: Record<string, string> = {
    ...getCorsHeaders(origin),
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename="${ticker.toUpperCase()}_DD_latest.${format}"`,
    "Cache-Control": "public, max-age=300, s-maxage=300",
  };
  if (lastModified) headers["Last-Modified"] = lastModified;
  if (etag) headers["ETag"] = etag;

  const res = new NextResponse(buf, { status: 200, headers });
  // Stash on the response so the caller can write it to Redis after billing succeeds.
  (res as NextResponse & { __cachePayload?: SnapshotCache }).__cachePayload = {
    base64: buf.toString("base64"),
    contentType,
    lastModified,
    etag,
  };
  return res;
}

export async function GET(
  request: NextRequest,
  segmentData: { params: Promise<{ ticker: string }> },
) {
  const origin = request.headers.get("origin");
  const { ticker: rawTicker } = await segmentData.params;

  const parsed = TickerSchema.safeParse(rawTicker);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ticker", message: parsed.error.issues[0].message },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }
  const ticker = parsed.data;

  const url = new URL(request.url);
  const formatParam = (url.searchParams.get("format") ?? "png").toLowerCase();
  if (!ALLOWED_FORMATS.includes(formatParam as SnapshotFormat)) {
    return NextResponse.json(
      {
        error: "Invalid format",
        message: `format must be one of: ${ALLOWED_FORMATS.join(", ")}`,
      },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }
  const format = formatParam as SnapshotFormat;

  // Auth gate (mirrors snapshot.png/snapshot.pdf routes).
  const auth = await getBillingUserId(request);
  if (!auth) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: "Valid API key or authentication required",
      },
      { status: 401, headers: getCorsHeaders(origin) },
    );
  }

  // Redis hot cache: keyed on (ticker, format), shared across users since the
  // file is identical for everyone. Short TTL because the offline pipeline
  // updates GCS daily.
  const key = snapshotCacheKey(ticker, format);
  const hit = await getCache<SnapshotCache>(key);
  if (isDdSnapshotCacheHit(hit)) {
    const headers: Record<string, string> = {
      ...getCorsHeaders(origin),
      "Content-Type": hit.contentType,
      "Content-Disposition": `inline; filename="${ticker}_DD_latest.${format}"`,
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Cache": "HIT",
    };
    if (hit.lastModified) headers["Last-Modified"] = hit.lastModified;
    if (hit.etag) headers["ETag"] = hit.etag;
    return new NextResponse(Buffer.from(hit.base64, "base64"), {
      status: 200,
      headers,
    });
  }

  // Cache miss → bill the request, fetch from GCS, populate cache.
  const req2 = new NextRequest(url.toString(), {
    method: "GET",
    headers: request.headers,
  });

  return withBilling(
    async (req, _ctx: BillingContext) => {
      const res = await fetchFromGcs(ticker, format, req.headers.get("origin"));
      if (res.status === 200) {
        const payload = (res as NextResponse & {
          __cachePayload?: SnapshotCache;
        }).__cachePayload;
        if (payload) {
          // 1h TTL matches the offline pipeline's daily refresh cadence — long
          // enough to absorb traffic bursts, short enough that a fresh GCS
          // upload propagates to end users in under an hour. Previously this
          // was HISTORICAL (24h), which meant a same-day refresh of GCS could
          // be invisible to website users for almost a full day.
          await setCache(key, payload, CACHE_TTL.DAILY);
        }
      }
      return res;
    },
    { capabilityId: "portfolio-risk-snapshot" },
  )(req2);
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
