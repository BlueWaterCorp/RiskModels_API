import { NextResponse, type NextRequest } from "next/server";
import { readEtfHoldingsTopN } from "@/lib/dal/funds-zarr-reader";
import { resolveSymIdsToTickers } from "@/lib/dal/symbols-batch";

export const dynamic = "force-dynamic";

const CSV_COLUMNS = ["rank", "bw_sym_id", "ticker", "name", "weight", "adj_mv"] as const;

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/data/etf/:ticker/holdings?top=25[&format=csv]
 *
 * Top-N current holdings of an ETF from its canonical PortfolioSurface zarr
 * (Funds_DAG `etf_holdings_zarr`, source_kind=etf, teo_frequency=daily —
 * MASTER_BACKLOG L.6 / D.9). Only the in-ERM3 sleeve is materialized, so every
 * returned holding carries a `bw_sym_id`; each holding also carries the
 * current `ticker` and `name` (null when the id does not resolve).
 * `report_date` (the sponsor's "Fund Holdings as of" date) and
 * `availability_date` (when that file was observed) are surfaced distinctly —
 * never collapsed — and also as headers:
 *   X-Data-As-Of:           report_date
 *   X-Data-Availability:    availability_date
 *
 * `format=csv` returns the same rows as a CSV download (rank, bw_sym_id,
 * ticker, name, weight, adj_mv) with the dates in the headers and filename.
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
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  if (format !== "json" && format !== "csv") {
    return NextResponse.json(
      { error: "format must be json or csv" },
      { status: 400 },
    );
  }

  const snapshot = await readEtfHoldingsTopN(ticker, top);
  if (!snapshot) {
    return NextResponse.json(
      { error: "ETF not found or no holdings available" },
      { status: 404 },
    );
  }

  let labels = new Map<string, { ticker: string | null; name: string | null }>();
  try {
    labels = await resolveSymIdsToTickers(snapshot.holdings.map((h) => h.bw_sym_id));
  } catch {
    // Labels are a convenience; the bw_sym_id rows stay authoritative.
  }
  const holdings = snapshot.holdings.map((h) => ({
    ...h,
    ticker: labels.get(h.bw_sym_id)?.ticker ?? null,
    name: labels.get(h.bw_sym_id)?.name ?? null,
  }));

  const headers = new Headers();
  headers.set("X-Data-As-Of", snapshot.report_date);
  if (snapshot.availability_date) {
    headers.set("X-Data-Availability", snapshot.availability_date);
  }

  if (format === "csv") {
    const lines = [CSV_COLUMNS.join(",")];
    holdings.forEach((h, i) => {
      lines.push(
        [i + 1, h.bw_sym_id, h.ticker, h.name, h.weight, h.adj_mv].map(csvCell).join(","),
      );
    });
    const fname = `${snapshot.ticker.toLowerCase()}_holdings_${snapshot.report_date}.csv`;
    headers.set("Content-Type", "text/csv; charset=utf-8");
    headers.set("Content-Disposition", `attachment; filename="${fname}"`);
    return new NextResponse(lines.join("\n") + "\n", { headers });
  }

  return NextResponse.json({ ...snapshot, holdings }, { headers });
}
