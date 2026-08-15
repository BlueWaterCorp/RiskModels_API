/**
 * GET /api/funds/snapshot.pdf/{bw_fund_id} — F1 fund tearsheet PDF.
 *
 * Stage D.2.b. Pairs with `/api/funds/snapshot/{bw_fund_id}` (JSON):
 * same `loadFundSnapshot` composition is rendered through the F1 print
 * template (`app/(print)/render-snapshot/funds/[bw_fund_id]/page.tsx`)
 * via the Playwright worker.
 *
 * Capability `fund-snapshot-pdf` @ $1.25 per request, content-keyed cache
 * on `(bw_fund_id, report_date)` mirrors the per-stock metrics PDF route.
 */

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { getBillingUserId } from "@/lib/agent/billing-user";
import {
  getCache,
  setCache,
  generateCacheKey,
  CACHE_TTL,
} from "@/lib/cache/redis";
import { isRasterSnapshotCacheHit } from "@/lib/cache/snapshot-payload-guards";
import { getCorsHeaders } from "@/lib/cors";
import { loadFundSnapshot } from "@/lib/funds/snapshot-loader";

export const dynamic = "force-dynamic";

type PdfCache = { base64: string };

function fundPdfCacheKey(userId: string, bwFundId: string, reportDate: string) {
  const h = createHash("sha256")
    .update(JSON.stringify({ userId, bwFundId, reportDate }))
    .digest("hex");
  return generateCacheKey("fund_snapshot_pdf", h);
}

async function buildFundPdf(
  bwFundId: string,
  _context: BillingContext,
  origin: string | null,
): Promise<NextResponse> {
  if (process.env.PLAYWRIGHT_PDF_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: "PDF rendering disabled",
        message:
          "Set PLAYWRIGHT_PDF_ENABLED=true on the API runtime; the F1 fund tearsheet has no pdf-lib fallback.",
      },
      { status: 503, headers: getCorsHeaders(origin) },
    );
  }

  const result = await loadFundSnapshot(bwFundId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, bw_fund_id: bwFundId },
      { status: result.status, headers: getCorsHeaders(origin) },
    );
  }

  const { renderFundSnapshotPdf } = await import(
    "@/lib/portfolio/playwright-pdf-worker"
  );
  const baseUrl =
    process.env.PLAYWRIGHT_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`;

  const pdfBytes = await renderFundSnapshotPdf(result.snapshot, baseUrl);

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${bwFundId}-fund-tearsheet.pdf"`,
      "X-Data-As-Of": result.reportDate,
      "X-Data-Filing-Date": result.filingDate,
    },
  });
}

export async function GET(
  request: NextRequest,
  segmentData: { params: Promise<{ bw_fund_id: string }> },
) {
  const origin = request.headers.get("origin");
  const { bw_fund_id: bwFundId } = await segmentData.params;
  if (!bwFundId) {
    return NextResponse.json(
      { error: "bw_fund_id is required" },
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

  // Resolve the report_date now so the cache key can be content-stable
  // across the day (the JSON sub-fetch happens again inside buildFundPdf;
  // the cost is one extra Supabase round-trip on cache miss).
  const peek = await loadFundSnapshot(bwFundId);
  if (!peek.ok) {
    return NextResponse.json(
      { error: peek.error, bw_fund_id: bwFundId },
      { status: peek.status, headers: getCorsHeaders(origin) },
    );
  }

  const key = fundPdfCacheKey(auth.userId, bwFundId, peek.reportDate);
  const hit = await getCache<PdfCache>(key);
  if (isRasterSnapshotCacheHit(hit)) {
    return new NextResponse(Buffer.from(hit.base64, "base64"), {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${bwFundId}-fund-tearsheet.pdf"`,
        "X-Data-As-Of": peek.reportDate,
        "X-Data-Filing-Date": peek.filingDate,
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
      const res = await buildFundPdf(bwFundId, context, req.headers.get("origin"));
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
    { capabilityId: "fund-snapshot-pdf" },
  )(req2);
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
