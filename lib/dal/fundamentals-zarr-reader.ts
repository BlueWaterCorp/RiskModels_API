/**
 * PIT reader for the quarterly fundamentals panel (internal store) on GCS.
 *
 * Mirrors ERM3/erm3/shared/fundamentals_reader.py — the accessor SSOT. Do not
 * re-derive conventions here; any change to TTM pairing, guards, or the PIT
 * gate must land in the Python reader first and be ported faithfully:
 *   - PIT gate: a row is visible iff its filed_date is present AND <= as_of.
 *     Never "latest". (pit_period_indices)
 *   - TTM: FLOW concepts sum the trailing 4 FINITE quarters; STOCK concepts are
 *     point-in-time (latest finite) or trailing-4 AVERAGE for the ROE/ROA
 *     denominator. Fewer than 4 finite quarters → NaN. (ttm_sum / ttm_avg)
 *   - Guards: equity <= 0 → NaN, debt <= 0 → NaN, missing betas → NaN. Never
 *     clip. (cost_of_debt / roe_ttm / economic_profit)
 *   - Windows look at the last 8 visible quarters so TTM can find 4 finite
 *     values when the newest quarter is only partially reported.
 *
 * LICENSING: raw line items are EODHD-primary and NOT redistributable, EXCEPT
 * per cell where the store serves a SEC-XBRL value (public). Those cells ship
 * inside `sec_facts`, gated one cell at a time by `secCellValue` (H.69 per-row
 * rule): an EODHD-served or empty cell never enters sec_facts. Everything else
 * that leaves the server still goes through lib/api/fundamentals-contract.ts.
 * A raw EODHD plane must never be attached flat to a response object. Never
 * expose bucket paths or store names in errors or API JSON.
 *
 * Store layout (one whole-panel chunk per variable) makes a cold read heavy,
 * so the extracted single-symbol row pack is cached in Redis and all PIT
 * filtering / derivation happens per-request from the pack.
 */

import type { AbsolutePath, Readable } from "@zarrita/storage";
import { Storage } from "@google-cloud/storage";
import type { Bucket } from "@google-cloud/storage";
import { get, open, root, tryWithConsolidated, UnicodeStringArray } from "zarrita";
import type { Group } from "zarrita";
import { parseZarrGcsPrefix, zarrFundamentalsBasename } from "@/lib/zarr-config";
import {
  CACHE_TTL,
  generateCacheKey,
  getCache,
  setCache,
} from "@/lib/cache/redis";
import {
  SEC_FACT_CONCEPTS,
  decodeEquityBridgeInputs,
  secCellValue,
  type SecFactConcept,
  type SecFacts,
} from "@/lib/api/fundamentals-contract";

export const DEFAULT_ERP = 0.05; // suggested only; ERP is ALWAYS caller-supplied
export const DEFAULT_TAX_RATE = 0.21;
export const MAX_FUNDAMENTALS_PERIODS = 40;

/** Trailing window width — 8 visible quarters, per fundamentals_reader.py. */
const TTM_WINDOW_QUARTERS = 8;

// ── Pure accessors (no I/O) — faithful ports of fundamentals_reader.py ──────

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** CAPM cost of equity = rf + beta_market * erp. Conditional beta: may dip below rf. */
export function costOfEquity(
  rfRate: number,
  betaMarket: number,
  erp: number = DEFAULT_ERP,
): number {
  if (!(finite(rfRate) && finite(betaMarket) && finite(erp))) return NaN;
  return rfRate + betaMarket * erp;
}

/** Realized cost of debt = interest_expense_ttm / total_debt. Guards debt <= 0 or interest <= 0 → NaN. */
export function costOfDebt(interestExpenseTtm: number, totalDebt: number): number {
  if (!(finite(interestExpenseTtm) && finite(totalDebt)) || totalDebt <= 0) return NaN;
  if (interestExpenseTtm <= 0) return NaN;
  return interestExpenseTtm / totalDebt;
}

/**
 * WACC with BOOK-value weights (balance-sheet equity/debt) — deliberately, per
 * the Python SSOT; market-value weights are the caller's job. Debt leg is
 * tax-shielded; a no-debt firm collapses to equity-only (= ke). Positive book
 * debt with missing kd → NaN (never return wE*ke — that understates WACC).
 */
export function waccBookWeights(
  rfRate: number,
  betaMarket: number,
  interestExpenseTtm: number,
  totalEquity: number,
  totalDebt: number,
  taxRate: number,
  erp: number = DEFAULT_ERP,
): number {
  const ke = costOfEquity(rfRate, betaMarket, erp);
  const kd = costOfDebt(interestExpenseTtm, totalDebt);
  const E = finite(totalEquity) ? totalEquity : NaN;
  const D = finite(totalDebt) ? totalDebt : NaN;
  if (!(Number.isFinite(E) && Number.isFinite(D))) return NaN;
  const cap = E + D;
  if (cap <= 0 || !Number.isFinite(ke)) return NaN;
  const wE = E / cap;
  const wD = D / cap;
  if (wD <= 0) return ke;
  if (!Number.isFinite(kd)) return NaN;
  return wE * ke + wD * kd * (1.0 - taxRate);
}

/** ROE = net_income_ttm / avg trailing-4Q equity. Guard avg <= 0 → NaN, never clip. */
export function roeTtm(netIncomeTtm: number, avgTotalEquity: number): number {
  if (!(finite(netIncomeTtm) && finite(avgTotalEquity)) || avgTotalEquity <= 0) return NaN;
  return netIncomeTtm / avgTotalEquity;
}

/**
 * Economic profit = (roe_ttm - cost_of_equity) * total_equity (equity-charge
 * form; charge on point-in-time equity). Guard equity <= 0 → NaN.
 */
export function economicProfit(
  netIncomeTtm: number,
  avgTotalEquity: number,
  totalEquity: number,
  rfRate: number,
  betaMarket: number,
  erp: number = DEFAULT_ERP,
): number {
  const ke = costOfEquity(rfRate, betaMarket, erp);
  const re = roeTtm(netIncomeTtm, avgTotalEquity);
  if (!(Number.isFinite(ke) && Number.isFinite(re) && finite(totalEquity)) || totalEquity <= 0) {
    return NaN;
  }
  return (re - ke) * totalEquity;
}

// ── Capital-return ratios (Phase 2) — the reinvestment inputs for economic-profit models ──
// All computed from SEC-served TTM flows. These are DERIVED analytics (redistributable), so they
// use the served value of each concept, not the per-cell SEC gate that guards the raw line items.
// A ratio over non-positive earnings is not meaningful, so `net_income_ttm <= 0 → NaN` (matching
// the equity<=0 guard on ROE); the caller sees null, not a misleading negative payout.
//
// DIVIDEND BASIS = CASH PAID. These are shareholder-return metrics, so they use dividends_paid,
// which is denser than dividends_declared (many filers — Apple, Exxon — tag only paid). The
// distinction matters: dividends DECLARED (accrual) is what drives the retained-earnings
// roll-forward, and it is exposed RAW in sec_facts for a modeller who needs exact RE dynamics.
// retention_ratio here is therefore a CASH-basis reinvestment proxy (1 - cash payout), which
// equals the accrual retention up to declaration-vs-payment timing.

/** dividends_paid_ttm / net_income_ttm — cash dividends as a share of earnings. */
export function payoutRatio(dividendsPaidTtm: number, netIncomeTtm: number): number {
  if (!(finite(dividendsPaidTtm) && finite(netIncomeTtm)) || netIncomeTtm <= 0) return NaN;
  return dividendsPaidTtm / netIncomeTtm;
}

/** 1 - cash payout = the reinvestment-rate proxy `b`. NaN whenever payout is NaN. */
export function retentionRatio(dividendsPaidTtm: number, netIncomeTtm: number): number {
  const p = payoutRatio(dividendsPaidTtm, netIncomeTtm);
  return Number.isFinite(p) ? 1 - p : NaN;
}

/** share_repurchases_ttm / net_income_ttm — buybacks as a share of earnings. */
export function buybackRatio(shareRepurchasesTtm: number, netIncomeTtm: number): number {
  if (!(finite(shareRepurchasesTtm) && finite(netIncomeTtm)) || netIncomeTtm <= 0) return NaN;
  return shareRepurchasesTtm / netIncomeTtm;
}

/** (dividends_paid + share_repurchases) / net_income — total cash returned per $ earned. */
export function totalPayoutRatio(
  dividendsPaidTtm: number,
  shareRepurchasesTtm: number,
  netIncomeTtm: number,
): number {
  const div = finite(dividendsPaidTtm) ? dividendsPaidTtm : 0;
  const buy = finite(shareRepurchasesTtm) ? shareRepurchasesTtm : 0;
  if (!finite(netIncomeTtm) || netIncomeTtm <= 0) return NaN;
  if (!finite(dividendsPaidTtm) && !finite(shareRepurchasesTtm)) return NaN; // nothing to sum
  return (div + buy) / netIncomeTtm;
}

/** Sustainable growth g = retention * ROE — the internally-funded equity growth rate. */
export function sustainableGrowth(retention: number, roe: number): number {
  if (!(Number.isFinite(retention) && Number.isFinite(roe))) return NaN;
  return retention * roe;
}

/** SUM of the last `minQuarters` finite FLOW values. NaN if fewer are finite. */
export function ttmSum(values: (number | null)[], minQuarters = 4): number {
  const fin = values.filter(finite);
  if (fin.length < minQuarters) return NaN;
  return fin.slice(-minQuarters).reduce((a, b) => a + b, 0);
}

/** AVERAGE of the last `minQuarters` finite STOCK values. NaN if fewer are finite. */
export function ttmAvg(values: (number | null)[], minQuarters = 4): number {
  const fin = values.filter(finite);
  if (fin.length < minQuarters) return NaN;
  const w = fin.slice(-minQuarters);
  return w.reduce((a, b) => a + b, 0) / w.length;
}

/** Most-recent finite value (point-in-time STOCK read). NaN if none finite. */
export function latestFinite(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (finite(v)) return v;
  }
  return NaN;
}

// ── Row pack (internal) ──────────────────────────────────────────────────────

/** Variables read from the store. Raw planes are compute inputs ONLY. */
const PACK_VARS = [
  "revenue",
  "net_income",
  "total_assets",
  "total_equity",
  "total_debt",
  "cash_from_operations",
  "capital_expenditures",
  "interest_expense",
  "beta_market",
  "beta_sector",
  "beta_subsector",
  "beta_source",
] as const;

type PackVar = (typeof PACK_VARS)[number];

/**
 * Risk-free tenor strip (2026-07-06 store revision): the per-cell `rf_rate`
 * plane was REPLACED by six 1-D Treasury CMT variables `rf_3m..rf_30y` on the
 * period_end axis (rf does not vary by symbol). Default tenor `10y` follows
 * the store's `rf_default_tenor` attr — the valuation convention (equities are
 * long-duration claims; standard ERPs are measured over long-term bonds). A
 * caller selecting a short tenor must pair a bill-basis ERP or cost of capital
 * is understated (see the ds_fundamentals spec §Cost-of-capital layer).
 */
export const RF_TENORS = ["3m", "1y", "2y", "5y", "10y", "30y"] as const;
export type RfTenor = (typeof RF_TENORS)[number];
export const DEFAULT_RF_TENOR: RfTenor = "10y";

/** Single-symbol extract: full period axis + per-column stamps + variable rows. */
export interface FundamentalsRowPack {
  ticker: string;
  /** ISO dates for the full shared period_end axis. */
  periodEndDates: string[];
  /** ISO filed date per column; null where this symbol never reported. */
  filedDates: (string | null)[];
  /** 1=exact, 2=approx, 0/null=none — per column. */
  filedDateSource: (number | null)[];
  vars: Record<PackVar, (number | null)[]>;
  /** Raw SEC-facts concept values per column (value plane). Gated at row-build, not here. */
  secRaw: Record<SecFactConcept, (number | null)[]>;
  /** `{concept}_source` plane per column (0=none,1=EODHD,2=SEC us-gaap,3=SEC ifrs). */
  secSource: Record<SecFactConcept, (number | null)[]>;
  /** Equity-bridge residual per column (dollars); null on a symbol's first reported period. */
  bridgeResidual: (number | null)[];
  /** Equity-bridge inputs bitmask per column; decoded to component names at row-build. */
  bridgeInputs: (number | null)[];
  /** 1-D rf strip per tenor over the shared period_end axis (fraction, e.g. 0.0448). */
  rfCurve: Partial<Record<RfTenor, (number | null)[]>>;
}

/** Internal (pre-sanitize) row: allowlist fields only, numbers may be NaN→null later. */
export interface FundamentalsInternalRow {
  period_end_date: string;
  filed_date: string | null;
  filed_date_source: "exact" | "approx" | null;
  gross_margin: number | null;
  operating_margin: number | null;
  roe_ttm: number | null;
  roa_ttm: number | null;
  leverage_ratio: number | null;
  fcf_margin: number | null;
  payout_ratio: number | null;
  retention_ratio: number | null;
  buyback_ratio: number | null;
  total_payout_ratio: number | null;
  sustainable_growth: number | null;
  equity_bridge_residual: number | null;
  equity_bridge_inputs: string[];
  beta_market: number | null;
  beta_sector: number | null;
  beta_subsector: number | null;
  beta_source: "none" | "in-universe" | "out-of-universe" | "post-delisting" | null;
  rf_rate: number | null;
  cost_of_equity: number | null;
  cost_of_debt: number | null;
  wacc: number | null;
  economic_profit: number | null;
  /** SEC-sourced raw line items for this period, gated per cell (H.69 per-row rule). */
  sec_facts: SecFacts;
}

/**
 * PIT visibility — port of pit_period_indices: only columns where THIS symbol
 * actually filed (filed_date present) AND filed_date <= asOf, ordered by
 * period_end ascending. ISO strings compare lexicographically.
 */
export function selectPitIndices(pack: FundamentalsRowPack, asOf: string): number[] {
  const idx: number[] = [];
  for (let i = 0; i < pack.periodEndDates.length; i++) {
    const filed = pack.filedDates[i];
    if (filed !== null && filed !== undefined && filed <= asOf) idx.push(i);
  }
  idx.sort((a, b) => (pack.periodEndDates[a]! < pack.periodEndDates[b]! ? -1 : 1));
  return idx;
}

const BETA_SOURCE_LABELS: Record<number, FundamentalsInternalRow["beta_source"]> = {
  0: "none",
  1: "in-universe",
  2: "out-of-universe",
  3: "post-delisting",
};

function toNull(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/**
 * Derive the response rows from a pack. Each returned row is its own anchor:
 * betas/rf/point-in-time stocks come from that row's window; TTM aggregates
 * use up to the trailing 8 visible quarters ending at that row (so 4 finite
 * values survive a partially reported newest quarter — same intent as the
 * Python reader's n=8 window).
 */
export function buildFundamentalsRows(
  pack: FundamentalsRowPack,
  opts: { asOf: string; periods: number; erp: number; taxRate: number; rfTenor?: RfTenor },
): FundamentalsInternalRow[] {
  const rfByPeriod = pack.rfCurve[opts.rfTenor ?? DEFAULT_RF_TENOR];
  const visible = selectPitIndices(pack, opts.asOf);
  const periods = Math.max(1, Math.min(opts.periods, MAX_FUNDAMENTALS_PERIODS));
  const out: FundamentalsInternalRow[] = [];

  const windowVals = (name: PackVar, positions: number[]): (number | null)[] =>
    positions.map((i) => pack.vars[name][i] ?? null);
  // Capital-management concepts live in secRaw (the served plane value). Used here for DERIVED
  // ratios only — not gated, because derived analytics are redistributable.
  const secWindow = (name: SecFactConcept, positions: number[]): (number | null)[] =>
    positions.map((i) => pack.secRaw?.[name]?.[i] ?? null);

  for (let p = Math.max(0, visible.length - periods); p < visible.length; p++) {
    const i = visible[p]!;
    const windowPos = visible.slice(Math.max(0, p - (TTM_WINDOW_QUARTERS - 1)), p + 1);

    const niTtm = ttmSum(windowVals("net_income", windowPos));
    const ieTtm = ttmSum(windowVals("interest_expense", windowPos));
    const revTtm = ttmSum(windowVals("revenue", windowPos));
    const cfoTtm = ttmSum(windowVals("cash_from_operations", windowPos));
    const capexTtm = ttmSum(windowVals("capital_expenditures", windowPos));
    const divPaidTtm = ttmSum(secWindow("dividends_paid", windowPos));
    const buybackTtm = ttmSum(secWindow("share_repurchases", windowPos));
    const eqAvg = ttmAvg(windowVals("total_equity", windowPos));
    const assetsAvg = ttmAvg(windowVals("total_assets", windowPos));
    const eqLast = latestFinite(windowVals("total_equity", windowPos));
    const debtLast = latestFinite(windowVals("total_debt", windowPos));

    const rf = rfByPeriod?.[i] ?? NaN;
    const bm = pack.vars.beta_market[i] ?? NaN;
    const bsec = pack.vars.beta_sector[i] ?? NaN;
    const bsub = pack.vars.beta_subsector[i] ?? NaN;
    const bsrcRaw = pack.vars.beta_source[i];

    const roa =
      Number.isFinite(niTtm) && Number.isFinite(assetsAvg) && assetsAvg > 0
        ? niTtm / assetsAvg
        : NaN;
    const leverage =
      Number.isFinite(debtLast) && Number.isFinite(eqLast) && eqLast > 0
        ? debtLast / eqLast
        : NaN;
    const fcfMargin =
      Number.isFinite(cfoTtm) && Number.isFinite(capexTtm) && Number.isFinite(revTtm) && revTtm > 0
        ? (cfoTtm - capexTtm) / revTtm
        : NaN;

    const fdsRaw = pack.filedDateSource[i];
    const fds = fdsRaw === 1 ? "exact" : fdsRaw === 2 ? "approx" : null;

    // SEC facts for this period: a concept enters ONLY when secCellValue confirms its cell is
    // SEC-served (source plane 2/3). EODHD-served or empty cells are simply absent. This is the
    // single door raw values pass through.
    const secFacts: SecFacts = {};
    for (const concept of SEC_FACT_CONCEPTS) {
      const fact = secCellValue(concept, pack.secRaw?.[concept]?.[i], pack.secSource?.[concept]?.[i]);
      if (fact) secFacts[concept] = fact;
    }

    out.push({
      period_end_date: pack.periodEndDates[i]!,
      filed_date: pack.filedDates[i] ?? null,
      filed_date_source: fds,
      // Gross/operating margin inputs (gross profit, operating income) are not
      // in the Phase-1 store — null until the planes land upstream.
      gross_margin: null,
      operating_margin: null,
      roe_ttm: toNull(roeTtm(niTtm, eqAvg)),
      roa_ttm: toNull(roa),
      leverage_ratio: toNull(leverage),
      fcf_margin: toNull(fcfMargin),
      // Capital-return ratios (Phase 2) — reinvestment inputs for economic-profit models
      payout_ratio: toNull(payoutRatio(divPaidTtm, niTtm)),
      retention_ratio: toNull(retentionRatio(divPaidTtm, niTtm)),
      buyback_ratio: toNull(buybackRatio(buybackTtm, niTtm)),
      total_payout_ratio: toNull(totalPayoutRatio(divPaidTtm, buybackTtm, niTtm)),
      sustainable_growth: toNull(
        sustainableGrowth(retentionRatio(divPaidTtm, niTtm), roeTtm(niTtm, eqAvg)),
      ),
      equity_bridge_residual: toNull(
        finite(pack.bridgeResidual[i]) ? (pack.bridgeResidual[i] as number) : NaN,
      ),
      equity_bridge_inputs: decodeEquityBridgeInputs(pack.bridgeInputs[i]),
      beta_market: toNull(finite(bm) ? bm : NaN),
      beta_sector: toNull(finite(bsec) ? bsec : NaN),
      beta_subsector: toNull(finite(bsub) ? bsub : NaN),
      beta_source: finite(bsrcRaw) ? (BETA_SOURCE_LABELS[Math.round(bsrcRaw)] ?? null) : null,
      rf_rate: toNull(finite(rf) ? rf : NaN),
      cost_of_equity: toNull(costOfEquity(rf, bm, opts.erp)),
      cost_of_debt: toNull(costOfDebt(ieTtm, debtLast)),
      wacc: toNull(waccBookWeights(rf, bm, ieTtm, eqLast, debtLast, opts.taxRate, opts.erp)),
      economic_profit: toNull(economicProfit(niTtm, eqAvg, eqLast, rf, bm, opts.erp)),
      sec_facts: secFacts,
    });
  }
  return out;
}

// ── Sensitivity grid (H.89.6) — erp × rf_tenor cost-of-capital grid ─────────

/** Canonical erp grid: brackets the 0.05 suggested default without editorializing. */
export const DEFAULT_ERP_GRID: readonly number[] = [0.03, 0.04, 0.05, 0.06, 0.07];

export interface SensitivityGridCell {
  cost_of_equity: number | null;
  wacc: number | null;
  economic_profit: number | null;
}

export interface SensitivityGrid {
  period_end_date: string;
  filed_date: string | null;
  erp_values: number[];
  rf_tenor_values: RfTenor[];
  tax_rate: number;
  /** [erp_idx][tenor_idx], row-major over erp_values × rf_tenor_values. */
  cells: SensitivityGridCell[][];
}

/**
 * Cost-of-capital sensitivity grid for the latest PIT-visible period only
 * (grid across all historical periods would be unbounded cost for no
 * incremental use case — sensitivity is a "what if my assumptions were
 * different today" tool, not a time series). Reuses the same TTM window
 * inputs as `buildFundamentalsRows`'s last row and the already-loaded
 * `rfCurve` strip (all six tenors are read into the pack regardless of the
 * caller's single-row `rf_tenor`, so this is pure computation — no extra I/O).
 * Returns null when no PIT-visible period exists.
 */
export function buildSensitivityGrid(
  pack: FundamentalsRowPack,
  opts: {
    asOf: string;
    erpGrid: readonly number[];
    rfTenorGrid: readonly RfTenor[];
    taxRate: number;
  },
): SensitivityGrid | null {
  const visible = selectPitIndices(pack, opts.asOf);
  if (visible.length === 0) return null;
  const p = visible.length - 1;
  const i = visible[p]!;
  const windowPos = visible.slice(Math.max(0, p - (TTM_WINDOW_QUARTERS - 1)), p + 1);
  const windowVals = (name: PackVar, positions: number[]): (number | null)[] =>
    positions.map((pos) => pack.vars[name][pos] ?? null);

  const niTtm = ttmSum(windowVals("net_income", windowPos));
  const ieTtm = ttmSum(windowVals("interest_expense", windowPos));
  const eqAvg = ttmAvg(windowVals("total_equity", windowPos));
  const eqLast = latestFinite(windowVals("total_equity", windowPos));
  const debtLast = latestFinite(windowVals("total_debt", windowPos));
  const bm = pack.vars.beta_market[i] ?? NaN;

  const cells: SensitivityGridCell[][] = opts.erpGrid.map((erp) =>
    opts.rfTenorGrid.map((tenor) => {
      const rf = pack.rfCurve[tenor]?.[i] ?? NaN;
      return {
        cost_of_equity: toNull(costOfEquity(rf, bm, erp)),
        wacc: toNull(waccBookWeights(rf, bm, ieTtm, eqLast, debtLast, opts.taxRate, erp)),
        economic_profit: toNull(economicProfit(niTtm, eqAvg, eqLast, rf, bm, erp)),
      };
    }),
  );

  return {
    period_end_date: pack.periodEndDates[i]!,
    filed_date: pack.filedDates[i] ?? null,
    erp_values: [...opts.erpGrid],
    rf_tenor_values: [...opts.rfTenorGrid],
    tax_rate: opts.taxRate,
    cells,
  };
}

// ── GCS plumbing (per-store, mirroring lib/dal/funds-zarr-reader.ts) ────────

let _storage: Storage | null = null;

function getGcs(): Storage {
  if (!_storage) {
    const raw = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
    if (raw) {
      try {
        const credentials = JSON.parse(raw) as Record<string, unknown>;
        _storage = new Storage({ credentials });
      } catch {
        console.error("[fundamentals-zarr] GCP_SERVICE_ACCOUNT_JSON parse failed");
        _storage = new Storage();
      }
    } else {
      const keyFile = process.env.RISKMODELS_GCS_KEYFILE?.trim();
      _storage = keyFile ? new Storage({ keyFilename: keyFile }) : new Storage();
    }
  }
  return _storage;
}

class GcsZarrStore {
  constructor(
    private readonly bucket: Bucket,
    private readonly zarrObjectPrefix: string,
  ) {}

  async get(key: AbsolutePath): Promise<Uint8Array | undefined> {
    const rel = key.startsWith("/") ? key.slice(1) : key;
    const objectName = `${this.zarrObjectPrefix}/${rel}`.replace(/\/+/g, "/");
    try {
      const [buf] = await this.bucket.file(objectName).download();
      return new Uint8Array(buf);
    } catch (e: unknown) {
      const err = e as { code?: number };
      if (err?.code === 404) return undefined;
      console.error("[fundamentals-zarr] storage read failed");
      throw new Error("Zarr read failed");
    }
  }
}

async function openFundamentalsGroup(): Promise<Group<Readable> | null> {
  const { bucket: bucketName, basePath } = parseZarrGcsPrefix();
  const fullPrefix = `${basePath}/${zarrFundamentalsBasename()}`
    .replace(/\/+/g, "/")
    .replace(/^\//, "");
  try {
    const bucket = getGcs().bucket(bucketName);
    const raw = new GcsZarrStore(bucket, fullPrefix);
    const consolidated = await tryWithConsolidated(raw);
    const store = consolidated as unknown as Readable;
    return (await open.v2(root(store), { kind: "group" })) as Group<Readable>;
  } catch {
    console.error("[fundamentals-zarr] open group failed");
    return null;
  }
}

// ── CF datetime decoding ─────────────────────────────────────────────────────
// The store's datetime arrays are int64 offsets from ARBITRARY epochs chosen by
// the writer (e.g. "nanoseconds since 1884-05-28 22:43:41.128654848",
// "days since 2000-01-31"). Decode strictly from the `units` attr — never
// assume the unix epoch. NaT = INT64_MIN.

const NAT = -9223372036854775808n;

const UNIT_NS: Record<string, bigint> = {
  nanoseconds: 1n,
  microseconds: 1_000n,
  milliseconds: 1_000_000n,
  seconds: 1_000_000_000n,
  minutes: 60_000_000_000n,
  hours: 3_600_000_000_000n,
  days: 86_400_000_000_000n,
};

/** Parse a CF `units` attr into (epoch ns since unix epoch, ns per unit). */
function parseCfUnits(units: string): { epochNs: bigint; unitNs: bigint } | null {
  const m = units.match(
    /^(nanoseconds|microseconds|milliseconds|seconds|minutes|hours|days) since (\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2})(\.\d+)?)?/,
  );
  if (!m) return null;
  const unitNs = UNIT_NS[m[1]!];
  if (!unitNs) return null;
  const baseMs = Date.parse(`${m[2]}T${m[3] ?? "00:00:00"}Z`);
  if (!Number.isFinite(baseMs)) return null;
  let epochNs = BigInt(baseMs) * 1_000_000n;
  if (m[4]) {
    const fracNs = Math.round(parseFloat(m[4]) * 1e9);
    epochNs += BigInt(fracNs);
  }
  return { epochNs, unitNs };
}

function cfValueToIsoDate(v: bigint, epochNs: bigint, unitNs: bigint): string | null {
  if (v === NAT) return null;
  const ns = epochNs + v * unitNs;
  const ms = Number(ns / 1_000_000n);
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

interface ZarrChunkLike {
  data: unknown;
}

function unitsOf(arr: { attrs?: unknown }): string {
  const attrs = (arr.attrs ?? {}) as Record<string, unknown>;
  return typeof attrs.units === "string" ? attrs.units : "";
}

function decodeDates(d: unknown, units: string): (string | null)[] | null {
  const cf = parseCfUnits(units);
  if (d instanceof BigInt64Array) {
    if (cf) return Array.from(d, (v) => cfValueToIsoDate(v, cf.epochNs, cf.unitNs));
    // No/unknown units attr: treat as datetime64[ns] since unix epoch.
    return Array.from(d, (v) => cfValueToIsoDate(v, 0n, 1n));
  }
  if (ArrayBuffer.isView(d) && !(d instanceof Uint8Array)) {
    const nums = d as unknown as ArrayLike<number>;
    const epochNs = cf ? cf.epochNs : 0n;
    const unitNs = cf ? cf.unitNs : 1n;
    return Array.from(nums, (v) =>
      Number.isFinite(v) ? cfValueToIsoDate(BigInt(Math.trunc(v)), epochNs, unitNs) : null,
    );
  }
  return null;
}

function decodeStrings(d: unknown): string[] | null {
  if (d instanceof UnicodeStringArray) {
    const out: string[] = [];
    for (let i = 0; i < d.length; i++) out.push(String(d.get(i)).trim());
    return out;
  }
  if (Array.isArray(d)) return d.map((v) => String(v).trim());
  return null;
}

function decodeFloatsNullable(d: unknown): (number | null)[] | null {
  if (ArrayBuffer.isView(d) && !(d instanceof Uint8Array)) {
    const nums = d as unknown as ArrayLike<number>;
    return Array.from(nums, (v) => (Number.isFinite(v) ? v : null));
  }
  return null;
}

// ── Pack read + cache ────────────────────────────────────────────────────────

const FUNDAMENTALS_PACK_TTL = CACHE_TTL.HISTORICAL; // store refreshes weekly
const FUNDAMENTALS_NEGATIVE_TTL = CACHE_TTL.FREQUENT;
const EMPTY_SENTINEL = { __empty: true } as const;

async function readStringCoord(grp: Group<Readable>, name: string): Promise<string[] | null> {
  try {
    const arr = await open.v2(grp.resolve(name), { kind: "array" });
    const ch = (await get(arr, null)) as ZarrChunkLike | null;
    return decodeStrings(ch?.data);
  } catch {
    return null;
  }
}

/**
 * Resolve the symbol axis index for a ticker — `ticker` coord first (first hit,
 * matching the Python reader), then `unique_ticker`, then the `symbol` axis so
 * internal callers can address by bw_sym_id.
 */
async function resolveSymbolIndex(
  grp: Group<Readable>,
  ticker: string,
): Promise<number | null> {
  for (const coord of ["ticker", "unique_ticker", "symbol"] as const) {
    const values = await readStringCoord(grp, coord);
    if (!values) continue;
    const hit = values.findIndex((v) => v === ticker);
    if (hit >= 0) return hit;
  }
  return null;
}

async function readVarRow(
  grp: Group<Readable>,
  name: string,
  symIdx: number,
): Promise<{ data: unknown; units: string } | null> {
  try {
    const arr = await open.v2(grp.resolve(name), { kind: "array" });
    const ch = (await get(arr, [symIdx, null])) as ZarrChunkLike | null;
    if (!ch) return null;
    return { data: ch.data, units: unitsOf(arr) };
  } catch {
    return null;
  }
}

/** Whole 1-D variable on the period_end axis (the rf tenor strip has no symbol dim). */
async function readVar1d(
  grp: Group<Readable>,
  name: string,
): Promise<(number | null)[] | null> {
  try {
    const arr = await open.v2(grp.resolve(name), { kind: "array" });
    const ch = (await get(arr, null)) as ZarrChunkLike | null;
    return ch ? decodeFloatsNullable(ch.data) : null;
  } catch {
    return null;
  }
}

async function computeRowPack(ticker: string): Promise<FundamentalsRowPack | null> {
  const grp = await openFundamentalsGroup();
  if (!grp) return null;

  const symIdx = await resolveSymbolIndex(grp, ticker);
  if (symIdx === null) return null;

  // Period axis
  let periodEndDates: string[] | null = null;
  try {
    const arr = await open.v2(grp.resolve("period_end_date"), { kind: "array" });
    const ch = (await get(arr, null)) as ZarrChunkLike | null;
    const decoded = decodeDates(ch?.data, unitsOf(arr));
    periodEndDates = decoded ? decoded.map((v) => v ?? "") : null;
  } catch {
    periodEndDates = null;
  }
  if (!periodEndDates) return null;

  const filedRaw = await readVarRow(grp, "filed_date", symIdx);
  if (!filedRaw) return null;
  const filedDates = decodeDates(filedRaw.data, filedRaw.units);
  if (!filedDates) return null;

  const fdsRaw = await readVarRow(grp, "filed_date_source", symIdx);
  const filedDateSource = fdsRaw ? decodeFloatsNullable(fdsRaw.data) : null;

  const vars = {} as Record<PackVar, (number | null)[]>;
  for (const name of PACK_VARS) {
    const rowRaw = await readVarRow(grp, name, symIdx);
    const decoded = rowRaw ? decodeFloatsNullable(rowRaw.data) : null;
    vars[name] = decoded ?? new Array<number | null>(periodEndDates.length).fill(null);
  }

  // SEC-fact concepts: read the value plane AND its `{concept}_source` companion. A concept or
  // source plane absent from the store leaves an all-null column, so the gate simply omits it.
  const nulls = () => new Array<number | null>(periodEndDates.length).fill(null);
  const secRaw = {} as Record<SecFactConcept, (number | null)[]>;
  const secSource = {} as Record<SecFactConcept, (number | null)[]>;
  for (const concept of SEC_FACT_CONCEPTS) {
    const valRaw = await readVarRow(grp, concept, symIdx);
    const srcRaw = await readVarRow(grp, `${concept}_source`, symIdx);
    secRaw[concept] = (valRaw ? decodeFloatsNullable(valRaw.data) : null) ?? nulls();
    secSource[concept] = (srcRaw ? decodeFloatsNullable(srcRaw.data) : null) ?? nulls();
  }

  // Equity-bridge planes (Phase 3). Both are per-cell on the symbol row; residual is float
  // (null on a symbol's first period), inputs is a small-integer bitmask stored float32 (exact).
  const bridgeResRaw = await readVarRow(grp, "equity_bridge_residual", symIdx);
  const bridgeInRaw = await readVarRow(grp, "equity_bridge_inputs", symIdx);
  const bridgeResidual = (bridgeResRaw ? decodeFloatsNullable(bridgeResRaw.data) : null) ?? nulls();
  const bridgeInputs = (bridgeInRaw ? decodeFloatsNullable(bridgeInRaw.data) : null) ?? nulls();

  // rf tenor strip: six tiny 1-D arrays, read once per pack so any tenor is
  // served from cache. A missing tenor variable (pre-2026-07-06 store) leaves
  // that tenor absent → rf/CoC null, never a wrong-tenor substitute.
  const rfCurve: Partial<Record<RfTenor, (number | null)[]>> = {};
  for (const tenor of RF_TENORS) {
    const strip = await readVar1d(grp, `rf_${tenor}`);
    if (strip) rfCurve[tenor] = strip;
  }

  return {
    ticker,
    periodEndDates,
    filedDates,
    filedDateSource:
      filedDateSource ?? new Array<number | null>(periodEndDates.length).fill(null),
    vars,
    secRaw,
    secSource,
    bridgeResidual,
    bridgeInputs,
    rfCurve,
  };
}

async function readRowPackCached(ticker: string): Promise<FundamentalsRowPack | null> {
  // v3: pack shape changed 2026-07-10 (added secRaw/secSource for SEC-fact exposure).
  // Bumping the key invalidates v2 packs that lack those fields.
  const ck = generateCacheKey("fundamentals_zarr", "row_pack_v4", { ticker });
  const hit = await getCache<FundamentalsRowPack | typeof EMPTY_SENTINEL>(ck);
  if (hit !== null && hit !== undefined) {
    return (hit as { __empty?: boolean }).__empty === true
      ? null
      : (hit as FundamentalsRowPack);
  }
  const pack = await computeRowPack(ticker);
  if (pack === null) {
    setCache(ck, EMPTY_SENTINEL, FUNDAMENTALS_NEGATIVE_TTL).catch(console.error);
  } else {
    setCache(ck, pack, FUNDAMENTALS_PACK_TTL).catch(console.error);
  }
  return pack;
}

// ── Public entry point ───────────────────────────────────────────────────────

export interface FundamentalsResult {
  ticker: string;
  rows: FundamentalsInternalRow[];
}

/**
 * PIT fundamentals rows for one ticker. Returns null when the ticker is not in
 * the store. Rows are internal — the route must pass them through
 * sanitizeFundamentalsRow before serializing.
 */
export async function getFundamentalsForTicker(
  ticker: string,
  opts: { asOf: string; periods: number; erp: number; taxRate: number; rfTenor?: RfTenor },
): Promise<FundamentalsResult | null> {
  const pack = await readRowPackCached(ticker);
  if (!pack) return null;
  return { ticker: pack.ticker, rows: buildFundamentalsRows(pack, opts) };
}

/**
 * Sensitivity-grid entry point — same cached row pack as `getFundamentalsForTicker`
 * (Redis-cached, so calling both for one request costs a single cold read).
 */
export async function getFundamentalsSensitivityGrid(
  ticker: string,
  opts: { asOf: string; erpGrid: readonly number[]; rfTenorGrid: readonly RfTenor[]; taxRate: number },
): Promise<SensitivityGrid | null> {
  const pack = await readRowPackCached(ticker);
  if (!pack) return null;
  return buildSensitivityGrid(pack, opts);
}
