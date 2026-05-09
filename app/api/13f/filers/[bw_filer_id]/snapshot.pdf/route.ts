/**
 * GET /api/13f/filers/{bw_filer_id}/snapshot.pdf — F1 13F filer tearsheet PDF.
 *
 * Pairs with `/api/13f/filers/{bw_filer_id}/snapshot` (JSON): same
 * `loadFilerSnapshot` composition rendered through the F1 filer print
 * template (`app/(print)/render-snapshot/13f/[bw_filer_id]/page.tsx`) via
 * the Playwright worker.
 *
 * Capability `filer-snapshot-pdf`. Content-keyed cache on
 * (bw_filer_id, report_date), mirrors the funds-side route.
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
import { loadFilerSnapshot } from "@/lib/13f/filer-snapshot-loader";

export const dynamic = "force-dynamic";

type PdfCache = { base64: string };

function filerPdfCacheKey(userId: string, bwFilerId: string, reportDate: string) {
  const h = createHash("sha256")
    .update(JSON.stringify({ userId, bwFilerId, reportDate }))
    .digest("hex");
  return generateCacheKey("filer_snapshot_pdf", h);
}

async function buildFilerPdf(
  bwFilerId: string,
  _context: BillingContext,
  origin: string | null,
): Promise<NextResponse> {
  if (process.env.PLAYWRIGHT_PDF_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: "PDF rendering disabled",
        message:
          "Set PLAYWRIGHT_PDF_ENABLED=true on the API runtime; the F1 13F filer tearsheet has no pdf-lib fallback.",
      },
      { status: 503, headers: getCorsHeaders(origin) },
    );
  }

  const result = await loadFilerSnapshot(bwFilerId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, bw_filer_id: bwFilerId },
      { status: result.status, headers: getCorsHeaders(origin) },
    );
  }

  const { renderFilerSnapshotPdf } = await import(
    "@/lib/portfolio/playwright-pdf-worker"
  );
  const baseUrl =
    process.env.PLAYWRIGHT_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`;

  const pdfBytes = await renderFilerSnapshotPdf(result.snapshot, baseUrl);

  const headers: Record<string, string> = {
    ...getCorsHeaders(origin),
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${bwFilerId}-13f-filer-tearsheet.pdf"`,
  };
  if (result.reportDate) headers["X-Data-As-Of"] = result.reportDate;
  if (result.filingDate) headers["X-Data-Filing-Date"] = result.filingDate;

  return new NextResponse(Buffer.from(pdfBytes), { status: 200, headers });
}

export async function GET(
  request: NextRequest,
  segmentData: { params: Promise<{ bw_filer_id: string }> },
) {
  const origin = request.headers.get("origin");
  const { bw_filer_id: bwFilerId } = await segmentData.params;
  if (!bwFilerId) {
    return NextResponse.json(
      { error: "bw_filer_id is required" },
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

  // Resolve report_date for content-stable cache key.
  const peek = await loadFilerSnapshot(bwFilerId);
  if (!peek.ok) {
    return NextResponse.json(
      { error: peek.error, bw_filer_id: bwFilerId },
      { status: peek.status, headers: getCorsHeaders(origin) },
    );
  }

  const reportDateForKey = peek.reportDate ?? "no-filing";
  const key = filerPdfCacheKey(auth.userId, bwFilerId, reportDateForKey);
  const hit = await getCache<PdfCache>(key);
  if (isRasterSnapshotCacheHit(hit)) {
    const cachedHeaders: Record<string, string> = {
      ...getCorsHeaders(origin),
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${bwFilerId}-13f-filer-tearsheet.pdf"`,
      "X-API-Cost-USD": "0",
      "X-Cache": "HIT",
    };
    if (peek.reportDate) cachedHeaders["X-Data-As-Of"] = peek.reportDate;
    if (peek.filingDate) cachedHeaders["X-Data-Filing-Date"] = peek.filingDate;
    return new NextResponse(Buffer.from(hit.base64, "base64"), {
      status: 200,
      headers: cachedHeaders,
    });
  }

  const url = new URL(request.url);
  const req2 = new NextRequest(url.toString(), {
    method: "GET",
    headers: request.headers,
  });

  return withBilling(
    async (req, context) => {
      const res = await buildFilerPdf(bwFilerId, context, req.headers.get("origin"));
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
    { capabilityId: "filer-snapshot-pdf" },
  )(req2);
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
