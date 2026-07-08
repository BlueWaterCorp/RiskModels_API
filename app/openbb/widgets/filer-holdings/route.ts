/**
 * Live widget: 13F filer top holdings -> OpenBB table.
 *
 * GET /openbb/widgets/filer-holdings?bw_filer_id=...&limit=25
 * Maps /13f/filers/{bw_filer_id}/holdings — already enriched upstream with
 * display ticker/name and latest L3 explained-risk shares (best-effort).
 * `bw_filer_id` is an opaque internal id; look one up via /13f/filers/search
 * (or the RiskModels MCP `riskmodels_search_filers` tool) first.
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

const pct = (x: unknown): number | null => {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? Number((n * 100).toFixed(2)) : null;
};

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const bwFilerId = (req.nextUrl.searchParams.get("bw_filer_id") || "").trim();
  const limit = (req.nextUrl.searchParams.get("limit") || "25").trim();

  const key = bearerFromRequest(req);
  if (!key) return NextResponse.json(noKeyRows(), { headers: cors });
  if (!bwFilerId) {
    return NextResponse.json(
      [{ status: "Enter a bw_filer_id — look one up via /13f/filers/search" }],
      { headers: cors },
    );
  }

  const { status, body } = await upstreamGet(
    `/13f/filers/${encodeURIComponent(bwFilerId)}/holdings?limit=${encodeURIComponent(limit)}`,
    key,
  );
  if (status < 200 || status >= 300) {
    const message =
      (body as { error?: string; message?: string })?.error ||
      (body as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return NextResponse.json({ error: message }, { status, headers: cors });
  }

  const snapshot = body as {
    holdings?: Array<{
      security_id: string;
      ticker?: string | null;
      name?: string | null;
      adj_mv: number;
      weight: number | null;
      l3_market_er?: number | null;
      l3_residual_er?: number | null;
    }>;
  };
  const holdings = snapshot.holdings ?? [];

  const rows = holdings.map((h) => ({
    ticker: h.ticker ?? h.security_id,
    name: h.name ?? null,
    weight_pct: pct(h.weight),
    adj_mv: h.adj_mv,
    market_er_pct: pct(h.l3_market_er),
    residual_er_pct: pct(h.l3_residual_er),
  }));

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
