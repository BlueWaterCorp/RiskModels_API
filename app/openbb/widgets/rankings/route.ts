/**
 * Live widget: single-name cross-sectional rankings → OpenBB table.
 *
 * GET /openbb/widgets/rankings?ticker=AAPL
 * Maps the real /rankings/{ticker} response — one row per (metric · cohort ·
 * window) with the name's ordinal rank + percentile in its cohort.
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const ticker = (req.nextUrl.searchParams.get("ticker") || "AAPL").trim().toUpperCase();

  const key = bearerFromRequest(req);
  if (!key) return NextResponse.json(noKeyRows(), { headers: cors });

  const { status, body } = await upstreamGet(
    `/rankings/${encodeURIComponent(ticker)}`,
    key,
  );
  if (status < 200 || status >= 300) {
    const message =
      (body as { error?: string; message?: string })?.error ||
      (body as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return NextResponse.json({ error: message }, { status, headers: cors });
  }

  const rankings =
    (body as {
      rankings?: Array<{
        metric?: string;
        cohort?: string;
        window?: string;
        rank_ordinal?: number | null;
        rank_percentile?: number | null;
        cohort_size?: number | null;
      }>;
    }).rankings ?? [];

  const rows = rankings.map((r) => ({
    metric: r.metric ?? "—",
    cohort: r.cohort ?? "—",
    window: r.window ?? "—",
    percentile:
      r.rank_percentile != null && Number.isFinite(Number(r.rank_percentile))
        ? Number(Number(r.rank_percentile).toFixed(1))
        : null,
    rank_ordinal: r.rank_ordinal ?? null,
    cohort_size: r.cohort_size ?? null,
  }));

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
