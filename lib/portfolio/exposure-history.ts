/**
 * Exposure history feed (POST /api/portfolio/exposure/history).
 *
 * Turns a month-end panel slice into two long tables the SDK joins locally
 * with the client's dated holdings (docs/EXPOSURE_HISTORY_FEED.md):
 *   names: teo, ticker, symbol, sector_etf, subsector_etf, l1_mkt_beta, <panel vars>
 *   cov:   teo, etf_i, etf_j, cov   (upper triangle, i <= j)
 *
 * Every column is derived data. The allowlist below is the licence boundary:
 * no raw price, market cap or return series may ever appear (EODHD B(e),
 * lib/data-license.ts RAW_SERIES_KEYS).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  EXPOSURE_PANEL_VARS,
  type DailyExposureHistory,
  type ExposurePanelSlice,
} from "@/lib/dal/zarr-reader";
const parquet = require("parquetjs-lite"); // eslint-disable-line

export const MARKET_ETF = "SPY";

export const NAME_COLUMNS = [
  "teo",
  "ticker",
  "symbol",
  "sector_etf",
  "subsector_etf",
  "l1_mkt_beta",
  ...EXPOSURE_PANEL_VARS,
] as const;

export const COV_COLUMNS = ["teo", "etf_i", "etf_j", "cov"] as const;

const STRING_COLUMNS = new Set(["teo", "ticker", "symbol", "sector_etf", "subsector_etf", "etf_i", "etf_j"]);

export interface HistoryName {
  symbol: string;
  /** Requested ticker(s) that resolved to this symbol; the first is used in rows. */
  tickers: string[];
  sector_etf: string | null;
  subsector_etf: string | null;
}

export interface HistoryTables {
  names: Array<Record<string, string | number | null>>;
  cov: Array<Record<string, string | number | null>>;
  /** Symbols with at least one row in range. */
  delivered: string[];
  /** Symbols in the request with no model rows in range. */
  noData: string[];
  /** ETFs in the covariance table. */
  covEtfs: string[];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function buildHistoryTables(
  slice: ExposurePanelSlice,
  names: HistoryName[],
  directEtfs: string[],
): HistoryTables {
  const rows: HistoryTables["names"] = [];
  const delivered: string[] = [];
  const noData: string[] = [];

  for (const n of names) {
    const cols = slice.bySymbol.get(n.symbol);
    let any = false;
    if (cols) {
      for (let t = 0; t < slice.teos.length; t++) {
        if (!EXPOSURE_PANEL_VARS.some((v) => finite(cols[v]?.[t]))) continue;
        any = true;
        const hr = cols.l1_mkt_hr?.[t];
        const row: Record<string, string | number | null> = {
          teo: slice.teos[t]!,
          ticker: n.tickers[0] ?? n.symbol,
          symbol: n.symbol,
          sector_etf: n.sector_etf,
          subsector_etf: n.subsector_etf,
          // L1 has one factor (SPY), so the L1 hedge ratio is exactly -beta.
          l1_mkt_beta: finite(hr) ? (hr === 0 ? 0 : -hr) : null,
        };
        for (const v of EXPOSURE_PANEL_VARS) row[v] = cols[v]?.[t] ?? null;
        rows.push(row);
      }
    }
    (any ? delivered : noData).push(n.symbol);
  }

  // Covariance universe: SPY, every delivered name's sector/subsector ETF, and
  // ETFs held directly — only those present in the panel.
  const deliveredSet = new Set(delivered);
  const wanted = new Set<string>([MARKET_ETF, ...directEtfs]);
  for (const n of names) {
    if (!deliveredSet.has(n.symbol)) continue;
    if (n.sector_etf) wanted.add(n.sector_etf);
    if (n.subsector_etf) wanted.add(n.subsector_etf);
  }
  const idx = slice.etfs
    .map((e, i) => [e, i] as const)
    .filter(([e]) => wanted.has(e));
  const k = slice.etfs.length;
  const cov: HistoryTables["cov"] = [];
  for (let t = 0; t < slice.teos.length; t++) {
    const m = slice.cov[t]!;
    for (let a = 0; a < idx.length; a++) {
      for (let b = a; b < idx.length; b++) {
        const x = m[idx[a]![1] * k + idx[b]![1]]!;
        if (!Number.isFinite(x)) continue;
        cov.push({ teo: slice.teos[t]!, etf_i: idx[a]![0], etf_j: idx[b]![0], cov: x });
      }
    }
  }

  return { names: rows, cov, delivered, noData, covEtfs: idx.map(([e]) => e) };
}

/** Symbols with at least one finite daily value (delivered) and those without. */
export function dailyCoverage(daily: DailyExposureHistory, names: HistoryName[]) {
  const delivered: string[] = [];
  const noData: string[] = [];
  for (const n of names) {
    const cols = daily.bySymbol.get(n.symbol);
    const any =
      cols &&
      EXPOSURE_PANEL_VARS.some((v) => {
        const c = cols[v];
        if (!c) return false;
        for (let t = 0; t < c.length; t++) if (Number.isFinite(c[t])) return true;
        return false;
      });
    (any ? delivered : noData).push(n.symbol);
  }
  return { delivered, noData };
}

/** Calendar years present in the daily axis. */
export function dailyYears(daily: DailyExposureHistory): string[] {
  return [...new Set(daily.teos.map((d) => d.slice(0, 4)))];
}

/**
 * Daily rows for one calendar year (same columns as the month-end feed). Built
 * a year at a time so a 1000-name, 20-year request never holds every row.
 */
export function buildDailyNameRows(
  daily: DailyExposureHistory,
  names: HistoryName[],
  year: string,
): HistoryTables["names"] {
  const rows: HistoryTables["names"] = [];
  const idx: number[] = [];
  for (let t = 0; t < daily.teos.length; t++) if (daily.teos[t]!.startsWith(year)) idx.push(t);
  for (const n of names) {
    const cols = daily.bySymbol.get(n.symbol);
    if (!cols) continue;
    for (const t of idx) {
      if (!EXPOSURE_PANEL_VARS.some((v) => Number.isFinite(cols[v]?.[t] ?? NaN))) continue;
      const hr = cols.l1_mkt_hr?.[t];
      const row: Record<string, string | number | null> = {
        teo: daily.teos[t]!,
        ticker: n.tickers[0] ?? n.symbol,
        symbol: n.symbol,
        sector_etf: n.sector_etf,
        subsector_etf: n.subsector_etf,
        l1_mkt_beta: finite(hr) ? (hr === 0 ? 0 : -hr) : null,
      };
      for (const v of EXPOSURE_PANEL_VARS) {
        const x = cols[v]?.[t];
        row[v] = finite(x) ? x : null;
      }
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Parquet with a fixed schema: strings UTF8, numbers FLOAT (the panel is
 * float32, so nothing is lost), every column GZIP-compressed.
 */
export async function toParquet(
  rows: Array<Record<string, string | number | null>>,
  columns: readonly string[],
): Promise<Buffer> {
  const schema = new parquet.ParquetSchema(
    Object.fromEntries(
      columns.map((c) => [
        c,
        { type: STRING_COLUMNS.has(c) ? "UTF8" : "FLOAT", optional: true, compression: "GZIP" },
      ]),
    ),
  );
  const tmp = path.join(os.tmpdir(), `exposure-history-${randomUUID()}.parquet`);
  try {
    const writer = await parquet.ParquetWriter.openFile(schema, tmp, { rowGroupSize: 50_000 });
    for (const r of rows) {
      const clean: Record<string, string | number | null> = {};
      for (const c of columns) clean[c] = r[c] ?? null;
      await writer.appendRow(clean);
    }
    await writer.close();
    return fs.readFileSync(tmp);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/** Resolve requested tickers into modelled names (netted by symbol), ETFs held, and drops. */
export async function resolveHistoryNames(
  tickers: string[],
  resolve: (t: string[]) => Promise<Map<string, { symbol: string; ticker: string; asset_type: string | null; sector_etf: string | null; subsector_etf: string | null }>>,
): Promise<{ names: HistoryName[]; directEtfs: string[]; dropped: Array<{ ticker: string; reason: string }> }> {
  const upper = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const registry = await resolve(upper);
  const dropped: Array<{ ticker: string; reason: string }> = [];
  const bySymbol = new Map<string, HistoryName>();
  const directEtfs: string[] = [];
  for (const t of upper) {
    const row = registry.get(t);
    if (!row) {
      dropped.push({ ticker: t, reason: "symbol_not_found" });
      continue;
    }
    if ((row.asset_type ?? "").toLowerCase() === "etf") {
      directEtfs.push(row.ticker.toUpperCase());
      continue;
    }
    const cur = bySymbol.get(row.symbol) ?? {
      symbol: row.symbol,
      tickers: [],
      sector_etf: row.sector_etf ?? null,
      subsector_etf: row.subsector_etf ?? null,
    };
    cur.tickers.push(t);
    bySymbol.set(row.symbol, cur);
  }
  return { names: [...bySymbol.values()], directEtfs, dropped };
}
