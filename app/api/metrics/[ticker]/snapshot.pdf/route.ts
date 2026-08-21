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
import { buildRiskSnapshotPdfBytes, type PeerVarianceBar } from "@/lib/portfolio/risk-snapshot-pdf";
import {
  getCohortVarianceShares,
  ThinCohortError,
} from "@/lib/risk/cohort-variance-shares-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

type PdfCache = { base64: string };

async function loadPeerBar(
  ticker: string,
  row: Record<string, unknown>,
): Promise<PeerVarianceBar | null> {
  const sub = typeof row.subsector_etf === "string" ? row.subsector_etf.trim() : "";
  const sec = typeof row.sector_etf === "string" ? row.sector_etf.trim() : "";
  const cohort = sub || sec;
  if (!cohort) return null;
  const level = sub ? "subsector" : "sector";
  const exclude = typeof row.symbol === "string" ? row.symbol : null;
  try {
    const shares = await getCohortVarianceShares({
      cohort,
      level,
      excludeSymbol: exclude,
    });
    const m = shares.equal_weighted_mean;
    return {
      label: `${shares.cohort} ${shares.level} peers · ${shares.n_names} names`,
      market: m.market_er_pct / 100,
      sector: m.sector_er_pct / 100,
      subsector: m.subsector_er_pct / 100,
      residual: m.residual_er_pct / 100,
    };
  } catch (err) {
    if (!(err instanceof ThinCohortError)) {
      console.error(`[snapshot.pdf] peer bar for ${ticker} failed:`, err);
    }
    return null;
  }
}

function singleTickerPdfKey(userId: string, ticker: string) {
  const h = createHash("sha256")
    .update(JSON.stringify({ userId, ticker: ticker.toUpperCase() }))
    .digest("hex");
  // _v3: stacked peer (cohort) bar under the name's L3 DNA.
  return generateCacheKey("risk_snapshot_pdf_ticker_v3", h);
}

async function buildSingleTickerPdf(
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

  const pdfBytes = await buildRiskSnapshotPdfBytes({
    title: `${ticker} — risk snapshot`,
    asOfLabel: String(asOf),
    data: core,
    peerBar: await loadPeerBar(ticker, (core.perTicker[ticker] ?? {}) as Record<string, unknown>),
  });

  const res = new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ticker}-risk-snapshot.pdf"`,
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

  const key = singleTickerPdfKey(auth.userId, ticker);
  const hit = await getCache<PdfCache>(key);
  if (isRasterSnapshotCacheHit(hit)) {
    return new NextResponse(Buffer.from(hit.base64, "base64"), {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${ticker}-risk-snapshot.pdf"`,
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
      const res = await buildSingleTickerPdf(ticker, context, req.headers.get("origin"));
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
