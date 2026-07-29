import { NextResponse, type NextRequest } from "next/server";
import { readEtfHoldingsTopN } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/etf/:ticker/holdings?top=25
 *
 * Top-N current holdings of an ETF from its canonical PortfolioSurface zarr
 * (Funds_DAG `etf_holdings_zarr`, source_kind=etf, teo_frequency=daily —
 * MASTER_BACKLOG L.6 / D.9). Only the in-ERM3 sleeve is materialized, so every
 * returned holding carries a `bw_sym_id`; resolve to ticker/name via
 * `/api/data/symbols/batch` if needed. `report_date` (the sponsor's "Fund
 * Holdings as of" date) and `availability_date` (when that file was observed)
 * are surfaced distinctly — never collapsed — and also as headers:
 *   X-Data-As-Of:           report_date
 *   X-Data-Availability:    availability_date
 *
 * Soft gateway auth, like the sibling `/api/data/funds/:bw_fund_id` — public
 * read. v1 has no `?as_of=` query — returns "what we know today" only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const url = new URL(request.url);
  const topRaw = url.searchParams.get("top");
  let top = 25;
  if (topRaw != null) {
    const parsed = Number.parseInt(topRaw, 10);
    if (Number.isFinite(parsed)) top = Math.min(Math.max(parsed, 1), 1000);
  }

  const snapshot = await readEtfHoldingsTopN(ticker, top);
  if (!snapshot) {
    return NextResponse.json(
      { error: "ETF not found or no holdings available" },
      { status: 404 },
    );
  }

  const headers = new Headers();
  headers.set("X-Data-As-Of", snapshot.report_date);
  if (snapshot.availability_date) {
    headers.set("X-Data-Availability", snapshot.availability_date);
  }

  return NextResponse.json(snapshot, { headers });
}
