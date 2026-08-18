/**
 * Best-effort request facets for usage telemetry (licensed metering).
 * Does not throw; missing or unparseable fields become empty/null.
 */

const MAX_TICKERS = 50;

const TICKER_PATH_RE =
  /\/(?:metrics|lstar|stocks|tickers)\/([A-Za-z0-9][A-Za-z0-9.\-]{0,15})(?:\/|$|\?)/i;

export type RequestFacets = {
  tickers: string[];
  item_count: number | null;
  as_of: string | null;
  years: number | null;
};

function uniqTickers(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const u = t.trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= MAX_TICKERS) break;
  }
  return out;
}

function splitTickerList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tickersFromUnknown(value: unknown): string[] {
  if (typeof value === "string") return splitTickerList(value);
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      names.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const t = rec.ticker ?? rec.symbol ?? rec.id;
      if (typeof t === "string") names.push(t);
    }
  }
  return names;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
}

export function extractRequestFacets(input: {
  url: string;
  body?: unknown;
}): RequestFacets {
  const tickers: string[] = [];
  let item_count: number | null = null;
  let as_of: string | null = null;
  let years: number | null = null;

  try {
    const parsed = new URL(input.url, "https://riskmodels.app");
    const pathMatch = TICKER_PATH_RE.exec(parsed.pathname);
    if (pathMatch?.[1]) tickers.push(pathMatch[1]);

    const q = parsed.searchParams;
    const qTickers = q.get("tickers") ?? q.get("ticker");
    if (qTickers) tickers.push(...splitTickerList(qTickers));
    as_of = q.get("as_of") || q.get("teo") || q.get("asOf") || null;
    years = finiteNumber(q.get("years"));
    const qCount = finiteNumber(q.get("item_count") ?? q.get("n"));
    if (qCount != null) item_count = qCount;
  } catch {
    // ignore malformed URL
  }

  const body = input.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const rec = body as Record<string, unknown>;
    tickers.push(
      ...tickersFromUnknown(
        rec.tickers ?? rec.positions ?? rec.holdings ?? rec.symbols,
      ),
    );
    if (typeof rec.ticker === "string") tickers.push(rec.ticker);
    if (!as_of) as_of = stringOrNull(rec.as_of ?? rec.teo ?? rec.asOf);
    if (years == null) years = finiteNumber(rec.years);
    if (item_count == null) {
      const listed = tickersFromUnknown(
        rec.tickers ?? rec.positions ?? rec.holdings ?? rec.symbols,
      );
      if (listed.length > 0) item_count = listed.length;
    }
  }

  const unique = uniqTickers(tickers);
  if (item_count == null && unique.length > 0) item_count = unique.length;

  return {
    tickers: unique,
    item_count,
    as_of: as_of && as_of.trim() !== "" ? as_of.trim() : null,
    years,
  };
}

export async function extractRequestFacetsFromRequest(req: {
  url: string;
  clone: () => { json: () => Promise<unknown> };
}): Promise<RequestFacets> {
  let body: unknown;
  try {
    body = await req.clone().json();
  } catch {
    body = undefined;
  }
  return extractRequestFacets({ url: req.url, body });
}
