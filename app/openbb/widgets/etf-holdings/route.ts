/**
 * Live widget: ETF top-N holdings → OpenBB table.
 *
 * GET /openbb/widgets/etf-holdings?ticker=IVV&top=25
 * Maps /data/etf/{ticker}/holdings — only the in-ERM3 sleeve is materialized,
 * so each holding carries a `bw_sym_id` (not a resolved ticker); there is no
 * public endpoint that maps bw_sym_id -> ticker/name, so it's surfaced as-is
 * rather than guessed.
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
  const ticker = (req.nextUrl.searchParams.get("ticker") || "IVV").trim().toUpperCase();
  const top = (req.nextUrl.searchParams.get("top") || "25").trim();

  const key = bearerFromRequest(req);
  if (!key) return NextResponse.json(noKeyRows(), { headers: cors });

  const { status, body } = await upstreamGet(
    `/data/etf/${encodeURIComponent(ticker)}/holdings?top=${encodeURIComponent(top)}`,
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
    ticker?: string;
    sponsor?: string | null;
    report_date?: string;
    holdings?: Array<{ bw_sym_id: string; adj_mv: number; weight: number | null }>;
  };
  const holdings = snapshot.holdings ?? [];

  const rows = holdings.map((h) => ({
    bw_sym_id: h.bw_sym_id,
    weight_pct: pct(h.weight),
    adj_mv: h.adj_mv,
    sponsor: snapshot.sponsor ?? null,
    report_date: snapshot.report_date ?? null,
  }));

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
