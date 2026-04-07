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
import {
  PortfolioRiskSnapshotRequestSchema,
  type PortfolioRiskSnapshotRequest,
} from "@/lib/api/schemas";
import { runPortfolioRiskComputation } from "@/lib/portfolio/portfolio-risk-core";
import { buildRiskSnapshotPdf } from "@/lib/portfolio/risk-snapshot-pdf";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

const CACHE_NS = "risk_snapshot";

type CachePayload =
  | { kind: "json"; body: string; contentType: string }
  | { kind: "pdf"; base64: string }
  | { kind: "png"; base64: string };

function snapshotCacheKey(
  userId: string,
  raw: {
    positions: PortfolioRiskSnapshotRequest["positions"];
    title?: string;
    as_of_date?: string;
    format: string;
  },
) {
  const h = createHash("sha256")
    .update(JSON.stringify({ userId, ...raw }))
    .digest("hex");
  return generateCacheKey(CACHE_NS, h);
}

async function buildSnapshotResponse(
  validation: PortfolioRiskSnapshotRequest,
  context: BillingContext,
  origin: string | null,
): Promise<NextResponse> {
  const core = await runPortfolioRiskComputation(validation.positions, {
    timeSeries: false,
    years: 1,
    includeHedgeRatios: true,
  });

  if (core.status === "invalid") {
    return NextResponse.json(
      {
        error: "No valid positions",
        message: "None of the provided tickers could be resolved",
        errors: core.errors,
      },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  if (core.status !== "ok") {
    return NextResponse.json(
      { error: "Unexpected portfolio state" },
      { status: 500, headers: getCorsHeaders(origin) },
    );
  }

  const metadata = await getRiskMetadata();
  const firstTicker = Object.keys(core.perTicker)[0];
  const teoLabel = firstTicker
    ? String(core.perTicker[firstTicker]?.teo ?? "")
    : "";
  const asOf =
    validation.as_of_date ?? (teoLabel || new Date().toISOString().split("T")[0]);
  const title = validation.title ?? "Portfolio";

  const jsonBody = {
    title,
    as_of: asOf,
    portfolio_risk_index: {
      variance_decomposition: {
        market: core.portfolioER.market,
        sector: core.portfolioER.sector,
        subsector: core.portfolioER.subsector,
        residual: core.portfolioER.residual,
        systematic: core.systematic,
      },
      portfolio_volatility_23d: core.portfolioVol,
      position_count: core.summary.resolved,
    },
    per_ticker: core.perTicker,
    summary: core.summary,
    ...(core.errorsList.length ? { errors: core.errorsList } : {}),
    _agent: { cost_usd: context.costUsd, request_id: context.requestId },
    _metadata: buildMetadataBody(metadata),
  };

  if (validation.format === "json") {
    const res = NextResponse.json(jsonBody, {
      headers: {
        ...getCorsHeaders(origin),
        "X-Data-Fetch-Latency-Ms": String(core.fetchLatencyMs),
      },
    });
    addMetadataHeaders(res, metadata);
    return res;
  }

  if (validation.format === "png") {
    if (process.env.PLAYWRIGHT_PDF_ENABLED !== "true") {
      return NextResponse.json(
        {
          error: "PNG rendering unavailable",
          message:
            "PNG snapshots require Playwright. Set PLAYWRIGHT_PDF_ENABLED=true or use format=pdf.",
        },
        { status: 501, headers: getCorsHeaders(origin) },
      );
    }

    const { renderSnapshotPng } = await import(
      "@/lib/portfolio/playwright-png-worker"
    );
    const { toReportData } = await import(
      "@/lib/portfolio/risk-snapshot-pdf"
    );
    const reportData = toReportData({
      title,
      asOfLabel: String(asOf),
      data: core,
    });
    const baseUrl =
      process.env.PLAYWRIGHT_BASE_URL ??
      `http://localhost:${process.env.PORT ?? 3000}`;

    const pngBytes = await renderSnapshotPng(reportData, baseUrl);

    const pngRes = new NextResponse(Buffer.from(pngBytes), {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="risk-snapshot-${String(asOf).replace(/[^0-9-]/g, "")}.png"`,
        "X-Data-Fetch-Latency-Ms": String(core.fetchLatencyMs),
      },
    });
    addMetadataHeaders(pngRes, metadata);
    return pngRes;
  }

  const pdfBytes = await buildRiskSnapshotPdf({
    title,
    asOfLabel: String(asOf),
    data: core,
  });

  const res = new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="risk-snapshot-${String(asOf).replace(/[^0-9-]/g, "")}.pdf"`,
      "X-Data-Fetch-Latency-Ms": String(core.fetchLatencyMs),
    },
  });
  addMetadataHeaders(res, metadata);
  return res;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const bodyText = await request.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", message: "Expected JSON body" },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const pre = PortfolioRiskSnapshotRequestSchema.safeParse(parsed);
  if (!pre.success) {
    return NextResponse.json(
      { error: "Invalid request", message: pre.error.issues[0].message },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

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

  const key = snapshotCacheKey(auth.userId, {
    positions: pre.data.positions,
    title: pre.data.title,
    as_of_date: pre.data.as_of_date,
    format: pre.data.format,
  });

  const hit = await getCache<CachePayload>(key);
  if (hit) {
    if (hit.kind === "json") {
      return new NextResponse(hit.body, {
        status: 200,
        headers: {
          ...getCorsHeaders(origin),
          "Content-Type": hit.contentType,
          "X-API-Cost-USD": "0",
          "X-Cache": "HIT",
        },
      });
    }
    if (hit.kind === "png") {
      return new NextResponse(Buffer.from(hit.base64, "base64"), {
        status: 200,
        headers: {
          ...getCorsHeaders(origin),
          "Content-Type": "image/png",
          "Content-Disposition": 'inline; filename="risk-snapshot-cached.png"',
          "X-API-Cost-USD": "0",
          "X-Cache": "HIT",
        },
      });
    }
    return new NextResponse(Buffer.from(hit.base64, "base64"), {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="risk-snapshot-cached.pdf"',
        "X-API-Cost-USD": "0",
        "X-Cache": "HIT",
      },
    });
  }

  const req2 = new NextRequest(request.url, {
    method: "POST",
    headers: request.headers,
    body: bodyText,
  });

  return withBilling(
    async (req, context) => {
      const res = await buildSnapshotResponse(
        pre.data,
        context,
        req.headers.get("origin"),
      );

      if (res.status === 200) {
        if (pre.data.format === "json") {
          const body = await res.clone().text();
          await setCache(
            key,
            {
              kind: "json",
              body,
              contentType:
                res.headers.get("content-type") ?? "application/json",
            },
            CACHE_TTL.HISTORICAL,
          );
        } else if (pre.data.format === "pdf") {
          const buf = new Uint8Array(await res.clone().arrayBuffer());
          await setCache(
            key,
            {
              kind: "pdf",
              base64: Buffer.from(buf).toString("base64"),
            },
            CACHE_TTL.HISTORICAL,
          );
        } else if (pre.data.format === "png") {
          const buf = new Uint8Array(await res.clone().arrayBuffer());
          await setCache(
            key,
            {
              kind: "png",
              base64: Buffer.from(buf).toString("base64"),
            },
            CACHE_TTL.HISTORICAL,
          );
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
