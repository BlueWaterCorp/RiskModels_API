/**
 * Data loading for POST /api/portfolio/exposure. All math is in
 * ./signed-exposure.ts; this file resolves tickers, pins one model date,
 * fills L2/L3 hedge legs from Zarr where the latest table is empty, and
 * builds one aligned ETF covariance matrix ending on that date.
 */

import {
  fetchBatchHistory,
  fetchBatchLatestSummary,
  resolveSymbolByTicker,
  resolveSymbolsByTickers,
  type SymbolRegistryRow,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";
import {
  MARKET_ETF,
  computeSignedExposure,
  type DirectEtfInput,
  type EtfCovariance,
  type StockInput,
  type Basis,
} from "./signed-exposure";

const IN_CHUNK = 200;
/** Unresolved tickers retried one by one (notation variants like BRK.B). */
const MAX_FALLBACK_RESOLVES = 100;
const MIN_COV_OBS = 60;
/** as_of: how far back to look for each name's newest row (covers holidays and gaps). */
const AS_OF_SEARCH_DAYS = 10;

const STOCK_KEYS: V3MetricKey[] = [
  "stock_var",
  "l1_mkt_beta",
  "l1_mkt_hr",
  "l2_mkt_hr",
  "l2_sec_hr",
  "l3_mkt_hr",
  "l3_sec_hr",
  "l3_sub_hr",
  "l3_mkt_er",
  "l3_sec_er",
  "l3_sub_er",
  "l3_res_er",
  "l1_res_er",
  "l2_res_er",
  "lstar_level",
];
/**
 * Zarr has no `l1_mkt_beta` (it lives in ds_erm3_betas, chunked by full history),
 * and `fetchBatchHistory` returns nothing if any requested key is unsupported.
 * At L1 the only factor is SPY, so the L1 hedge ratio is exactly -beta
 * (verified 2026-10-08 against ds_erm3_betas at four dates, 311/311 exact).
 */
const ZARR_KEYS: V3MetricKey[] = STOCK_KEYS.filter((k) => k !== "l1_mkt_beta");

function withL1Beta(m: Record<string, number | null>): Record<string, number | null> {
  const hr = m.l1_mkt_hr;
  if (m.l1_mkt_beta == null && typeof hr === "number" && Number.isFinite(hr)) {
    return { ...m, l1_mkt_beta: hr === 0 ? 0 : -hr };
  }
  return m;
}

/** Legs that can be 0/null in security_history_latest while Zarr has them. */
const HR_OVERLAY_KEYS: V3MetricKey[] = ["l2_sec_hr", "l3_sec_hr", "l3_sub_hr"];
/** L* can be absent from security_history_latest until the ERM3 sync backfills it. */
const NULL_OVERLAY_KEYS: V3MetricKey[] = ["lstar_level"];

export interface ExposurePosition {
  ticker: string;
  value: number;
}

export interface DroppedPosition {
  ticker: string;
  value_usd: number;
  reason:
    | "symbol_not_found"
    | "no_risk_metrics"
    | "stale_metrics"
    | "no_data_at_as_of"
    | "insufficient_history";
  teo?: string | null;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function mode(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN || (n === bestN && best !== null && v > best)) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

async function resolveAll(tickers: string[]): Promise<Map<string, SymbolRegistryRow>> {
  const out = new Map<string, SymbolRegistryRow>();
  for (const part of chunks(tickers, IN_CHUNK)) {
    const m = await resolveSymbolsByTickers(part);
    for (const [k, v] of m) out.set(k.toUpperCase(), v);
  }
  const missing = tickers.filter((t) => !out.has(t)).slice(0, MAX_FALLBACK_RESOLVES);
  const retried = await Promise.all(missing.map((t) => resolveSymbolByTicker(t)));
  missing.forEach((t, i) => {
    const row = retried[i];
    if (row) out.set(t, row);
  });
  return out;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One aligned panel of daily raw ETF returns, ending on `endTeo`; sample cov (N-1). */
export function buildEtfCovariance(
  returnsByEtf: Map<string, Map<string, number>>,
  endTeo: string,
  lookback: number,
): { cov: EtfCovariance | null; excluded: string[] } {
  const spy = returnsByEtf.get(MARKET_ETF);
  if (!spy) return { cov: null, excluded: [...returnsByEtf.keys()] };
  const dates = [...spy.keys()].filter((d) => d <= endTeo).sort().slice(-lookback);

  const etfs: string[] = [];
  const excluded: string[] = [];
  for (const [etf, series] of returnsByEtf) {
    if (dates.every((d) => finite(series.get(d)))) etfs.push(etf);
    else excluded.push(etf);
  }
  etfs.sort((a, b) => (a === MARKET_ETF ? -1 : b === MARKET_ETF ? 1 : a.localeCompare(b)));

  const n = dates.length;
  if (n < MIN_COV_OBS || etfs.length === 0) {
    return { cov: null, excluded: [...excluded, ...etfs] };
  }
  const cols = etfs.map((e) => dates.map((d) => returnsByEtf.get(e)!.get(d)!));
  const means = cols.map((c) => c.reduce((a, b) => a + b, 0) / n);
  const S = etfs.map(() => new Array<number>(etfs.length).fill(0));
  for (let i = 0; i < etfs.length; i++) {
    for (let j = i; j < etfs.length; j++) {
      let s = 0;
      for (let t = 0; t < n; t++) s += (cols[i]![t]! - means[i]!) * (cols[j]![t]! - means[j]!);
      S[i]![j] = S[j]![i] = s / (n - 1);
    }
  }
  return {
    cov: {
      etfs,
      S,
      start: dates[0] ?? null,
      end: dates[n - 1] ?? null,
      requested_n: lookback,
      effective_n: n,
    },
    excluded: excluded.sort(),
  };
}

export async function computePortfolioExposure(
  positions: ExposurePosition[],
  opts: { lookbackDays: number; basis?: Basis; asOf?: string },
) {
  const inputGross = positions.reduce((a, p) => a + Math.abs(p.value), 0);
  const tickers = [...new Set(positions.map((p) => p.ticker.toUpperCase()))];
  const registry = await resolveAll(tickers);

  const dropped: DroppedPosition[] = [];
  const valueByTicker = new Map<string, number>();
  for (const p of positions) {
    const t = p.ticker.toUpperCase();
    valueByTicker.set(t, (valueByTicker.get(t) ?? 0) + p.value);
  }
  const stocksBySymbol = new Map<string, StockInput>();
  const direct = new Map<string, DirectEtfInput>();
  for (const p of positions) {
    const t = p.ticker.toUpperCase();
    const row = registry.get(t);
    if (!row) {
      if (!dropped.some((d) => d.ticker === t)) {
        dropped.push({ ticker: t, value_usd: valueByTicker.get(t) ?? 0, reason: "symbol_not_found" });
      }
      continue;
    }
    if ((row.asset_type ?? "").toLowerCase() === "etf") {
      const key = row.ticker.toUpperCase();
      const cur = direct.get(key) ?? { ticker: key, value: 0 };
      cur.value += p.value;
      direct.set(key, cur);
      continue;
    }
    // Net by model security: two rows (or two share classes) of one symbol
    // are one position, so the residual term squares their sum.
    const cur = stocksBySymbol.get(row.symbol) ?? {
      symbol: row.symbol,
      tickers: [],
      value: 0,
      sector_etf: row.sector_etf ?? null,
      subsector_etf: row.subsector_etf ?? null,
      metrics: {},
    };
    if (!cur.tickers.includes(t)) cur.tickers.push(t);
    cur.value += p.value;
    stocksBySymbol.set(row.symbol, cur);
  }

  // ---- metrics at one model date --------------------------------------------------
  // Latest: security_history_latest, with Zarr filling empty legs below.
  // as_of: Zarr directly, each name's newest row on or before the requested date.
  const symbols = [...stocksBySymbol.keys()];
  const latest = new Map<string, { teo: string; metrics: Record<string, number | null> }>();
  if (opts.asOf) {
    const start = isoMinusDays(opts.asOf, AS_OF_SEARCH_DAYS);
    for (const part of chunks(symbols, IN_CHUNK)) {
      const rows = await fetchBatchHistory(part, ZARR_KEYS, {
        periodicity: "daily",
        startDate: start,
        endDate: opts.asOf,
      });
      const bySym = new Map<string, Map<string, Record<string, number | null>>>();
      for (const r of rows) {
        const teo = r.teo.slice(0, 10);
        if (teo > opts.asOf) continue;
        const byTeo = bySym.get(r.symbol) ?? new Map<string, Record<string, number | null>>();
        const m = byTeo.get(teo) ?? {};
        m[r.metric_key] = r.metric_value;
        byTeo.set(teo, m);
        bySym.set(r.symbol, byTeo);
      }
      for (const [sym, byTeo] of bySym) {
        const teos = [...byTeo.keys()].sort().reverse();
        const teo = teos.find((t) => {
          const m = byTeo.get(t)!;
          return typeof m.l1_mkt_hr === "number" && Number.isFinite(m.l1_mkt_hr);
        });
        if (teo) latest.set(sym, { teo, metrics: withL1Beta(byTeo.get(teo)!) });
      }
    }
  } else {
    for (const part of chunks(symbols, IN_CHUNK)) {
      for (const [k, v] of await fetchBatchLatestSummary(part)) latest.set(k, v);
    }
  }
  const snapshotTeo = mode([...latest.values()].map((v) => v.teo));
  if (!snapshotTeo) {
    return { error: "no_risk_metrics" as const, dropped };
  }

  // Fill hedge legs (and whole rows missing from the latest table) from Zarr at
  // exactly the snapshot date, never a neighbouring one.
  const needZarr = opts.asOf ? [] : symbols.filter((sym) => {
    const l = latest.get(sym);
    if (!l) return true;
    if (l.teo !== snapshotTeo) return false;
    return (
      HR_OVERLAY_KEYS.some((k) => {
        const v = l.metrics[k];
        return v == null || v === 0;
      }) || NULL_OVERLAY_KEYS.some((k) => l.metrics[k] == null)
    );
  });
  const zarrAtSnapshot = new Map<string, Record<string, number | null>>();
  for (const part of chunks(needZarr, IN_CHUNK)) {
    const rows = await fetchBatchHistory(part, ZARR_KEYS, {
      periodicity: "daily",
      startDate: snapshotTeo,
      endDate: snapshotTeo,
    });
    for (const r of rows) {
      if (r.teo.slice(0, 10) !== snapshotTeo) continue;
      const m = zarrAtSnapshot.get(r.symbol) ?? {};
      m[r.metric_key] = r.metric_value;
      zarrAtSnapshot.set(r.symbol, m);
    }
  }

  const stocks: StockInput[] = [];
  for (const [sym, s] of stocksBySymbol) {
    const l = latest.get(sym);
    const z = zarrAtSnapshot.get(sym);
    let metrics: Record<string, number | null> | null = null;
    if (l && l.teo === snapshotTeo) {
      metrics = {};
      for (const k of STOCK_KEYS) {
        const lv = l.metrics[k] ?? null;
        if (HR_OVERLAY_KEYS.includes(k) && (lv == null || lv === 0)) metrics[k] = z?.[k] ?? lv;
        else if (NULL_OVERLAY_KEYS.includes(k) && lv == null) metrics[k] = z?.[k] ?? null;
        else metrics[k] = lv;
      }
      metrics = withL1Beta(metrics);
    } else if (!l && z) {
      metrics = withL1Beta(Object.fromEntries(STOCK_KEYS.map((k) => [k, z[k] ?? null])));
    }
    if (!metrics) {
      for (const t of s.tickers) {
        dropped.push({
          ticker: t,
          value_usd: valueByTicker.get(t) ?? 0,
          reason: l ? "stale_metrics" : opts.asOf ? "no_data_at_as_of" : "no_risk_metrics",
          teo: l?.teo ?? null,
        });
      }
      continue;
    }
    // A model row with every estimate empty: the name has fewer than the 126
    // trading days ERM3 needs (MIN_PERIODS within its 252-day window).
    if (!STOCK_KEYS.some((k) => finite(metrics![k]))) {
      for (const t of s.tickers) {
        dropped.push({ ticker: t, value_usd: valueByTicker.get(t) ?? 0, reason: "insufficient_history" });
      }
      continue;
    }
    stocks.push({ ...s, metrics });
  }

  // ---- ETF covariance -------------------------------------------------------------
  const etfUniverse = new Set<string>([MARKET_ETF]);
  for (const s of stocks) {
    if (s.sector_etf) etfUniverse.add(s.sector_etf.toUpperCase());
    if (s.subsector_etf) etfUniverse.add(s.subsector_etf.toUpperCase());
  }
  for (const d of direct.keys()) etfUniverse.add(d);
  const etfRegistry = await resolveAll([...etfUniverse]);
  const etfBySymbol = new Map<string, string>();
  for (const [t, row] of etfRegistry) etfBySymbol.set(row.symbol, t);

  const returnsByEtf = new Map<string, Map<string, number>>();
  const startDate = isoMinusDays(snapshotTeo, Math.ceil(opts.lookbackDays * 1.6) + 10);
  for (const part of chunks([...etfBySymbol.keys()], IN_CHUNK)) {
    const rows = await fetchBatchHistory(part, ["returns_gross"], {
      periodicity: "daily",
      startDate,
      endDate: snapshotTeo,
    });
    for (const r of rows) {
      const etf = etfBySymbol.get(r.symbol);
      if (!etf || !finite(r.metric_value)) continue;
      const m = returnsByEtf.get(etf) ?? new Map<string, number>();
      m.set(r.teo.slice(0, 10), r.metric_value);
      returnsByEtf.set(etf, m);
    }
  }
  const { cov, excluded } = buildEtfCovariance(returnsByEtf, snapshotTeo, opts.lookbackDays);
  const noReturns = [...etfUniverse].filter((e) => !returnsByEtf.has(e));

  const result = computeSignedExposure({
    stocks,
    directEtfs: [...direct.values()],
    inputGrossUsd: inputGross,
    cov,
    basis: opts.basis ?? "lstar",
  });

  const long = positions.filter((p) => p.value > 0).reduce((a, p) => a + p.value, 0);
  const short = positions.filter((p) => p.value < 0).reduce((a, p) => a + p.value, 0);
  return {
    as_of: {
      requested_as_of: opts.asOf ?? null,
      metrics_source: opts.asOf ? "zarr" : "security_history_latest (Zarr fills empty hedge legs)",
      snapshot_teo: snapshotTeo,
      covariance_start: cov?.start ?? null,
      covariance_end: cov?.end ?? null,
      covariance_requested_n: opts.lookbackDays,
      covariance_effective_n: cov?.effective_n ?? 0,
      vintage_aligned: cov?.end === snapshotTeo,
      etf_mapping: "current symbol registry (not point-in-time)",
    },
    book: {
      positions_submitted: positions.length,
      gross_usd: Math.round(inputGross * 100) / 100,
      net_usd: Math.round((long + short) * 100) / 100,
      long_usd: Math.round(long * 100) / 100,
      short_usd: Math.round(short * 100) / 100,
      modelled_stocks: stocks.length,
      direct_etfs: direct.size,
    },
    ...result,
    coverage: {
      ...result.coverage,
      dropped,
      etfs_excluded_from_covariance: [...new Set([...excluded, ...noReturns])].sort(),
    },
  };
}
