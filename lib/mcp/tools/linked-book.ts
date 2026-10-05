/**
 * Linked brokerage book for the RiskModels MCP.
 *
 * Positions synced by Alpaca Connect, Connect Trade, or Plaid live on
 * riskmodels.net (`GET /api/positions`), keyed by the same API key the MCP
 * caller already presented. The tool returns that book so a client installs
 * one server.
 */

export type PortalPositionRow = {
  ticker?: string;
  quantity?: number | null;
  market_value?: number | null;
  weight?: number | null;
};

export type PortalPositionsBody = {
  portfolio_id?: string | null;
  n_positions?: number;
  total_market_value?: number | null;
  positions?: PortalPositionRow[];
};

export type LinkedPosition = {
  ticker: string;
  quantity: number | null;
  market_value: number | null;
  weight: number | null;
};

export type LinkedBook = {
  portfolio_id: string | null;
  n_positions: number;
  total_market_value: number | null;
  positions: LinkedPosition[];
  for_analysis: Array<{ ticker: string; weight: number }>;
  for_hedge: Array<{ ticker: string; dollars: number }>;
  excluded: Array<{ ticker: string; reason: string }>;
  empty: boolean;
};

export function portalPositionsUrl(portalBase?: string): string {
  const base = (portalBase || process.env.RISKMODELS_NET_URL || "https://riskmodels.net").replace(
    /\/+$/,
    "",
  );
  return `${base}/api/positions`;
}

export function shapeLinkedBook(body: PortalPositionsBody | null): LinkedBook {
  const rows = Array.isArray(body?.positions) ? body.positions : [];
  const positions: LinkedPosition[] = [];
  const for_analysis: Array<{ ticker: string; weight: number }> = [];
  const for_hedge: Array<{ ticker: string; dollars: number }> = [];
  const excluded: Array<{ ticker: string; reason: string }> = [];

  for (const row of rows) {
    const ticker = String(row.ticker ?? "").trim().toUpperCase();
    if (!ticker) continue;
    const quantity = typeof row.quantity === "number" ? row.quantity : null;
    const market_value = typeof row.market_value === "number" ? row.market_value : null;
    const weight = typeof row.weight === "number" ? row.weight : null;
    positions.push({ ticker, quantity, market_value, weight });
    if (weight != null && weight > 0) {
      for_analysis.push({ ticker, weight });
    } else if (weight != null && weight <= 0) {
      excluded.push({
        ticker,
        reason: "non-positive weight; riskmodels_analyze_portfolio requires weight > 0",
      });
    } else {
      excluded.push({ ticker, reason: "no market value, so no weight" });
    }
    if (market_value != null && market_value > 0) {
      for_hedge.push({ ticker, dollars: market_value });
    }
  }

  return {
    portfolio_id: typeof body?.portfolio_id === "string" ? body.portfolio_id : null,
    n_positions: positions.length,
    total_market_value:
      typeof body?.total_market_value === "number" ? body.total_market_value : null,
    positions,
    for_analysis,
    for_hedge,
    excluded,
    empty: positions.length === 0,
  };
}

export type FetchLinkedBookResult =
  | { ok: true; book: LinkedBook }
  | { ok: false; status: number; error: string };

export async function fetchLinkedBook(
  apiKey: string,
  opts: { portalBase?: string; fetchImpl?: typeof fetch } = {},
): Promise<FetchLinkedBookResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = portalPositionsUrl(opts.portalBase);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, error: `Network error reading linked positions: ${message}` };
  }
  if (res.status === 401) {
    return {
      ok: false,
      status: 401,
      error:
        "The RiskModels API key was rejected by the portfolio service. The same key must be valid on riskmodels.net.",
    };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `Linked positions request failed (${res.status}).` };
  }
  const body = (await res.json().catch(() => null)) as PortalPositionsBody | null;
  return { ok: true, book: shapeLinkedBook(body) };
}

export const EMPTY_BOOK_MESSAGE =
  "No linked brokerage positions. In riskmodels.net Settings, connect Alpaca, Connect Trade, or Plaid, then click Sync positions. This server reads that book. It does not place orders.";

export const LINKED_BOOK_NEXT_STEP =
  "Pass for_analysis to riskmodels_analyze_portfolio. Pass for_hedge to riskmodels_hedge_portfolio. This server does not place orders.";
