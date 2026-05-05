/**
 * GET /api/funds/style/{slug}/snapshot.pdf — C1 cohort tearsheet PDF.
 *
 * Stage D.2.d. Pairs with `/api/funds/style/{slug}/snapshot` (JSON):
 * same `loadCohortSnapshot` composition is rendered through the C1
 * print template via the Playwright worker.
 *
 * Capability `style-cohort-snapshot-pdf` @ $0.10, content-keyed cache
 * on `(slug, report_date)`.
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
import { loadCohortSnapshot } from "@/lib/funds/cohort-snapshot-loader";

export const dynamic = "force-dynamic";

type PdfCache = { base64: string };

function cohortPdfCacheKey(userId: string, slug: string, reportDate: string) {
  const h = createHash("sha256")
    .update(JSON.stringify({ userId, slug, reportDate }))
    .digest("hex");
  return generateCacheKey("cohort_snapshot_pdf", h);
}

async function buildCohortPdf(
  slug: string,
  _context: BillingContext,
  origin: string | null,
): Promise<NextResponse> {
  if (process.env.PLAYWRIGHT_PDF_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: "PDF rendering disabled",
        message:
          "Set PLAYWRIGHT_PDF_ENABLED=true on the API runtime; the C1 cohort tearsheet has no pdf-lib fallback.",
      },
      { status: 503, headers: getCorsHeaders(origin) },
    );
  }

  const result = await loadCohortSnapshot(slug);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, slug },
      { status: result.status, headers: getCorsHeaders(origin) },
    );
  }

  const { renderCohortSnapshotPdf } = await import(
    "@/lib/portfolio/playwright-pdf-worker"
  );
  const baseUrl =
    process.env.PLAYWRIGHT_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`;

  const pdfBytes = await renderCohortSnapshotPdf(result.snapshot, baseUrl);

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${slug}-cohort-tearsheet.pdf"`,
      "X-Data-As-Of": result.reportDate,
      ...(result.filingDate ? { "X-Data-Filing-Date": result.filingDate } : {}),
    },
  });
}

export async function GET(
  request: NextRequest,
  segmentData: { params: Promise<{ slug: string }> },
) {
  const origin = request.headers.get("origin");
  const { slug } = await segmentData.params;
  if (!slug) {
    return NextResponse.json(
      { error: "slug is required" },
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

  const peek = await loadCohortSnapshot(slug);
  if (!peek.ok) {
    return NextResponse.json(
      { error: peek.error, slug },
      { status: peek.status, headers: getCorsHeaders(origin) },
    );
  }

  const key = cohortPdfCacheKey(auth.userId, slug, peek.reportDate);
  const hit = await getCache<PdfCache>(key);
  if (isRasterSnapshotCacheHit(hit)) {
    return new NextResponse(Buffer.from(hit.base64, "base64"), {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${slug}-cohort-tearsheet.pdf"`,
        "X-Data-As-Of": peek.reportDate,
        ...(peek.filingDate ? { "X-Data-Filing-Date": peek.filingDate } : {}),
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
      const res = await buildCohortPdf(slug, context, req.headers.get("origin"));
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
    { capabilityId: "style-cohort-snapshot-pdf" },
  )(req2);
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
