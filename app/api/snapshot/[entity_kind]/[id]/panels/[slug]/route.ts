/**
 * GET /api/snapshot/{entity_kind}/{id}/panels/{slug}
 *
 * Stock (and later fund/filer) panel drill-down — thin alias onto Artifact
 * Registry render-svc. See BWMACRO docs/architecture/SNAPSHOT_CANONICAL_PROCESS_ADR.md.
 *
 * Examples:
 *   GET /api/snapshot/stock/CRM/panels/l3_explained_risk_hbar?format=png
 *   GET /api/snapshot/stock/WATCHLIST/panels/watchlist_er_stacked?tickers=CRM,MSFT,NVDA&format=png
 *   GET /api/snapshot/stock/NVDA/panels/_full?format=png  → full DD page (GCS)
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { getBillingUserId } from "@/lib/agent/billing-user";
import { renderArtifact } from "@/lib/artifacts/render-client";
import { getCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENTITY_KINDS = new Set([
  "stock",
  "fund",
  "filer_13f",
  "client_portfolio",
  "cohort",
]);

const STOCK_PANEL_SLUGS = new Set([
  "l3_explained_risk_hbar",
  "hedge_notionals_hbar",
  "hedge_depth_retained",
  "watchlist_er_stacked",
  "_full",
]);

const GCS_DD_BASE = "https://storage.googleapis.com/rm_api_public/snapshot";

type SnapshotFormat = "png" | "json" | "svg" | "pdf";

function subjectIdFor(entityKind: string, id: string): string {
  const upper = id.trim().toUpperCase();
  if (entityKind === "stock") {
    if (upper.startsWith("BW-STOCK-")) return upper;
    return `BW-STOCK-${upper}`;
  }
  if (entityKind === "fund" && !upper.startsWith("BW-FUND-")) {
    return `BW-FUND-${upper}`;
  }
  if (entityKind === "filer_13f" && !upper.startsWith("BW-FILER-")) {
    return `BW-FILER-${upper}`;
  }
  return upper;
}

async function fetchFullDd(
  ticker: string,
  format: "png" | "pdf",
  origin: string | null,
): Promise<NextResponse> {
  const upper = ticker.toUpperCase();
  const url = `${GCS_DD_BASE}/${upper}/${upper}_DD_latest.${format}`;
  const upstream = await fetch(url, { cache: "no-store" });
  if (upstream.status === 404) {
    return NextResponse.json(
      {
        error: "Snapshot not found",
        message: `No precomputed DD snapshot for ${upper}`,
      },
      { status: 404, headers: getCorsHeaders(origin) },
    );
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Upstream error", message: `GCS returned ${upstream.status}` },
      { status: 502, headers: getCorsHeaders(origin) },
    );
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  const contentType = format === "pdf" ? "application/pdf" : "image/png";
  return new NextResponse(buf, {
    status: 200,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${upper}_DD_latest.${format}"`,
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Snapshot-Panel": "_full",
      "X-Deprecated-Alias-Of": `/api/snapshot/${upper}`,
    },
  });
}

async function buildPanelResponse(
  request: NextRequest,
  _ctx: BillingContext,
  entityKind: string,
  id: string,
  slug: string,
): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const formatParam = (url.searchParams.get("format") ?? "png").toLowerCase();
  if (!["png", "json", "svg", "pdf"].includes(formatParam)) {
    return NextResponse.json(
      { error: "Invalid format", message: "format must be png|json|svg|pdf" },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }
  const format = formatParam as SnapshotFormat;
  const version = url.searchParams.get("version") ?? "v1";
  const asOf = url.searchParams.get("as_of") ?? "latest";

  if (slug === "_full") {
    if (entityKind !== "stock") {
      return NextResponse.json(
        {
          error: "Not supported",
          message: "_full panel is stock-only (dd_stock template / GCS DD)",
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
    if (format !== "png" && format !== "pdf") {
      return NextResponse.json(
        { error: "Invalid format", message: "_full supports png|pdf only" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
    const ticker = id.replace(/^BW-STOCK-/i, "").toUpperCase();
    return fetchFullDd(ticker, format, origin);
  }

  if (entityKind === "stock" && !STOCK_PANEL_SLUGS.has(slug)) {
    return NextResponse.json(
      {
        error: "Unknown panel",
        message: `Known stock panels: ${[...STOCK_PANEL_SLUGS]
          .filter((s) => s !== "_full")
          .join(", ")}`,
      },
      { status: 404, headers: getCorsHeaders(origin) },
    );
  }

  if (format === "pdf") {
    return NextResponse.json(
      {
        error: "Not implemented",
        message: "Panel PDF not yet supported; use format=png or _full?format=pdf",
      },
      { status: 501, headers: getCorsHeaders(origin) },
    );
  }

  let subjectId = subjectIdFor(entityKind, id);
  let subjectPayload: Record<string, unknown> | undefined;

  if (slug === "watchlist_er_stacked") {
    const tickersParam = url.searchParams.get("tickers");
    const tickers = tickersParam
      ? tickersParam.split(/[\s,;]+/).filter(Boolean)
      : id.toUpperCase() === "WATCHLIST"
        ? []
        : [id.replace(/^BW-STOCK-/i, "")];
    if (!tickers.length) {
      return NextResponse.json(
        {
          error: "Missing tickers",
          message:
            "Pass ?tickers=CRM,MSFT,NVDA for watchlist_er_stacked (or use id=WATCHLIST with tickers query)",
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
    subjectId = "BW-STOCK-WATCHLIST";
    subjectPayload = { tickers: tickers.map((t) => t.toUpperCase()) };
  }

  const result = await renderArtifact({
    slug,
    version,
    subject_id: subjectId,
    as_of: asOf,
    format: format as "png" | "json" | "svg",
    subject_payload: subjectPayload,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: result.status, headers: getCorsHeaders(origin) },
    );
  }

  const headers: Record<string, string> = {
    ...getCorsHeaders(origin),
    "X-Snapshot-Panel": slug,
    "X-Artifact-Resolved-As-Of": result.resolved_as_of,
    "X-Artifact-Gcs-Path": result.gcs_path,
    "Cache-Control":
      asOf === "latest"
        ? "public, max-age=3600"
        : "public, max-age=31536000, immutable",
  };
  if (result.receipt_id) {
    headers["X-Artifact-Receipt-Id"] = result.receipt_id;
  }

  if (format === "json") {
    headers["Content-Type"] = "application/json";
    return NextResponse.json(result.data, { status: 200, headers });
  }

  const bin = result.data as {
    base64: string;
    content_type: string;
  };
  headers["Content-Type"] = bin.content_type;
  headers["Content-Disposition"] =
    `inline; filename="${subjectId}_${slug}.${format}"`;
  return new NextResponse(Buffer.from(bin.base64, "base64"), {
    status: 200,
    headers,
  });
}

export async function GET(
  request: NextRequest,
  segmentData: {
    params: Promise<{ entity_kind: string; id: string; slug: string }>;
  },
) {
  const origin = request.headers.get("origin");
  const { entity_kind, id, slug } = await segmentData.params;
  const entityKind = entity_kind.toLowerCase();

  if (!ENTITY_KINDS.has(entityKind)) {
    return NextResponse.json(
      {
        error: "Invalid entity_kind",
        message: `entity_kind must be one of: ${[...ENTITY_KINDS].join(", ")}`,
      },
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

  const url = new URL(request.url);
  const req2 = new NextRequest(url.toString(), {
    method: "GET",
    headers: request.headers,
  });

  return withBilling(
    async (req, context) =>
      buildPanelResponse(req, context, entityKind, id, slug),
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
