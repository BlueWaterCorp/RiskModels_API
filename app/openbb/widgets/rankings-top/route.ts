/**
 * Live widget: top-ranked names by metric/cohort/window → OpenBB table.
 *
 * GET /openbb/widgets/rankings-top?metric=gross_return&cohort=universe&window=252d&limit=10
 * Maps the real /rankings/top snapshot. Enum params are validated upstream; a
 * bad combo returns the upstream error message (no fabricated rows).
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const sp = req.nextUrl.searchParams;
  const metric = (sp.get("metric") || "gross_return").trim();
  const cohort = (sp.get("cohort") || "universe").trim();
  const window = (sp.get("window") || "252d").trim();
  const limit = (sp.get("limit") || "10").trim();

  const key = bearerFromRequest(req);
  if (!key) return NextResponse.json(noKeyRows(), { headers: cors });

  const qs = new URLSearchParams({ metric, cohort, window, limit }).toString();
  const { status, body } = await upstreamGet(`/rankings/top?${qs}`, key);
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
        ticker?: string;
        symbol?: string;
        rank_ordinal?: number | null;
        rank_percentile?: number | null;
        cohort_size?: number | null;
      }>;
    }).rankings ?? [];

  const rows = rankings.map((r) => ({
    rank: r.rank_ordinal ?? null,
    ticker: r.ticker ?? r.symbol ?? "—",
    percentile:
      r.rank_percentile != null && Number.isFinite(Number(r.rank_percentile))
        ? Number(Number(r.rank_percentile).toFixed(1))
        : null,
    cohort_size: r.cohort_size ?? null,
  }));

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
