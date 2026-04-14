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
import { isRasterSnapshotCacheHit } from "@/lib/cache/snapshot-payload-guards";
import { TickerSchema } from "@/lib/api/schemas";
import { runPortfolioRiskComputation } from "@/lib/portfolio/portfolio-risk-core";
import { toReportData } from "@/lib/portfolio/risk-snapshot-pdf";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

type PngCache = { base64: string };

function singleTickerPngKey(userId: string, ticker: string) {
  const h = createHash("sha256")
    .update(JSON.stringify({ userId, ticker: ticker.toUpperCase(), format: "png" }))
    .digest("hex");
  return generateCacheKey("risk_snapshot_png_ticker", h);
}

async function buildSingleTickerPng(
  ticker: string,
  context: BillingContext,
  origin: string | null,
): Promise<NextResponse> {
  const core = await runPortfolioRiskComputation(
    [{ ticker, weight: 1 }],
    {
      timeSeries: false,
      years: 1,
      includeHedgeRatios: true,
    },
  );

  if (core.status === "invalid") {
    return NextResponse.json(
      {
        error: "Ticker not found",
        message: "Could not resolve symbol for ticker",
        errors: core.errors,
      },
      { status: 404, headers: getCorsHeaders(origin) },
    );
  }

  if (core.status !== "ok") {
    return NextResponse.json(
      { error: "Unexpected portfolio state" },
      { status: 500, headers: getCorsHeaders(origin) },
    );
  }

  const metadata = await getRiskMetadata();
  const asOf =
    (core.perTicker[ticker]?.teo as string | undefined) ??
    new Date().toISOString().split("T")[0];

  // Playwright PNG path (requires PLAYWRIGHT_PDF_ENABLED=true)
  if (process.env.PLAYWRIGHT_PDF_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: "PNG rendering unavailable",
        message:
          "PNG snapshots require Playwright. Set PLAYWRIGHT_PDF_ENABLED=true or use snapshot.pdf instead.",
      },
      { status: 501, headers: getCorsHeaders(origin) },
    );
  }

  const { renderSnapshotPng } = await import(
    "@/lib/portfolio/playwright-png-worker"
  );
  const reportData = toReportData({
    title: `${ticker} — Risk Snapshot`,
    asOfLabel: String(asOf),
    data: core,
  });
  const baseUrl =
    process.env.PLAYWRIGHT_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`;

  const pngBytes = await renderSnapshotPng(reportData, baseUrl);

  const res = new NextResponse(Buffer.from(pngBytes), {
    status: 200,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="${ticker}-risk-snapshot.png"`,
    },
  });
  addMetadataHeaders(res, metadata);
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

  const key = singleTickerPngKey(auth.userId, ticker);
  const hit = await getCache<PngCache>(key);
  if (isRasterSnapshotCacheHit(hit)) {
    return new NextResponse(Buffer.from(hit.base64, "base64"), {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${ticker}-risk-snapshot.png"`,
        "X-API-Cost-USD": "0",
        "X-Cache": "HIT",
      },
    });
  }

  const url = new URL(request.url);
  const req2 = new NextRequest(url.toString(), {
    method: "GET",
    headers: request.headers,
  });

  return withBilling(
    async (req, context) => {
      const res = await buildSingleTickerPng(ticker, context, req.headers.get("origin"));
      if (res.status === 200) {
        const buf = new Uint8Array(await res.clone().arrayBuffer());
        await setCache(
          key,
          { base64: Buffer.from(buf).toString("base64") },
          CACHE_TTL.HISTORICAL,
        );
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
