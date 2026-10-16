import { NextResponse, type NextRequest } from "next/server";
import { readEtfHoldingsTopN } from "@/lib/dal/funds-zarr-reader";
import { lookupEtfTicker } from "@/lib/dal/etf-catalog";
import { getEtfUniverseRow, ETF_REASON_CODES, figiFrom, safeBwSymId } from "@/lib/dal/etf-universe";
import { resolveSymbolByTicker } from "@/lib/dal/risk-engine-v3";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/etf/:ticker
 *
 * One ETF: what the API can do with it, its identifiers, and — for funds with
 * holdings — the latest aggregate metrics from the canonical PortfolioSurface
 * zarr (aum_reported, aum_erm3, coverage_pct, n_total_holdings, report_date,
 * availability_date) plus registry fields (portfolio_id, source_kind,
 * teo_frequency, sponsor).
 *
 * 200 for every known fund (holdings catalog, priced ETF return store, cascade
 * lists, ERM3 register mirror, or an ETF row in the symbol registry), with
 *   capabilities  { cascade, priced, priced_from, holdings, holdings_as_of, factor_role }
 *   identifiers   { bw_sym_id, bw_etf_id, figi, cik, ticker }   (null where unknown)
 * 404 (`code: symbol_not_found`) only when the ticker is on none of them.
 * RMAPI-14; docs/ETF_COVERAGE.md.
 *
 * Bitemporal lineage on response headers when holdings exist — never collapsed:
 *   X-Data-As-Of:           report_date    (sponsor's "Fund Holdings as of")
 *   X-Data-Availability:    availability_date (when that file was observed)
 *
 * No per-holding rows — call `/api/data/etf/:ticker/holdings` for those.
 * Soft gateway auth (public read).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params;
  const ticker = (rawTicker ?? "").trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const [universeRow, snapshot] = await Promise.all([
    getEtfUniverseRow(ticker).catch(() => null),
    lookupEtfTicker(ticker) ? readEtfHoldingsTopN(ticker, 1) : Promise.resolve(null),
  ]);

  // Not on any static list: an ETF row in the symbol registry still counts as
  // known (no capabilities yet). Anything else is unknown everywhere.
  let registryRow: Awaited<ReturnType<typeof resolveSymbolByTicker>> = null;
  if (!universeRow && !snapshot) {
    registryRow = await resolveSymbolByTicker(ticker).catch(() => null);
    if (!registryRow || registryRow.asset_type !== "etf") {
      return NextResponse.json(
        {
          error: "ETF not found",
          code: ETF_REASON_CODES.not_found,
          message: `${ticker} is not in the ETF universe. See /api/data/etf/universe for the list.`,
        },
        { status: 404 },
      );
    }
  }

  const caps = universeRow?.capabilities ?? {
    cascade: false,
    priced: false,
    priced_from: null,
    holdings: false,
    holdings_as_of: null,
    factor_role: "none" as const,
  };
  const ids = universeRow?.identifiers ?? {
    bw_sym_id: null,
    bw_etf_id: null,
    figi: null,
    cik: null,
    ticker,
  };

  const capabilities = {
    ...caps,
    // Holdings are live only when the surface has a snapshot.
    holdings: snapshot !== null,
    holdings_as_of: snapshot?.report_date ?? null,
  };
  const bwSymId = ids.bw_sym_id ?? safeBwSymId(registryRow?.symbol ?? null);
  const identifiers = {
    ...ids,
    bw_sym_id: bwSymId,
    bw_etf_id: ids.bw_etf_id ?? lookupEtfTicker(ticker),
    figi: ids.figi ?? figiFrom(null, bwSymId),
  };

  const headers = new Headers();
  if (snapshot) {
    headers.set("X-Data-As-Of", snapshot.report_date);
    if (snapshot.availability_date) {
      headers.set("X-Data-Availability", snapshot.availability_date);
    }
    // Strip the holdings array — callers wanting top-N use /holdings.
    const { holdings: _holdings, n_holdings_returned: _n, ...metrics } = snapshot;
    return NextResponse.json(
      { ...metrics, name: universeRow?.name ?? null, capabilities, identifiers },
      { headers },
    );
  }

  return NextResponse.json({
    ticker,
    name: universeRow?.name ?? registryRow?.name ?? null,
    capabilities,
    identifiers,
  });
}
