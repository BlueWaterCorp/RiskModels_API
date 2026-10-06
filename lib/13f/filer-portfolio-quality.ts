/**
 * Correctness and quality annotations for the 13F filer portfolio history (BWMACRO backlog H.307, items 1–4, 6–8;
 * researcher API enhancements 1 and 2, 2026-10-06). Pure functions: no GCS, no cache — the route reads the stores
 * and passes them in.
 *
 * Every field added here is additive; existing row fields keep their meaning.
 */

const CIK_ID_RE = /^(?:BW-FILER-)?(?:CIK)?0*(\d{1,10})$/i;

/**
 * Accept the forms researchers type — `BW-FILER-CIK0001067983`, `BW-FILER-CIK1067983`, `CIK1067983`,
 * `0001067983`, `1067983` — and return the canonical `BW-FILER-CIK` + 10-digit id. Ids that are not CIK-based
 * (`BW-FILER-CRD…`, `BW-SYNTH-…`) pass through unchanged. Null for an empty input.
 */
export function normalizeFilerId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = decodeURIComponent(String(raw)).trim();
  if (!s) return null;
  const m = CIK_ID_RE.exec(s);
  if (m) {
    const digits = m[1]!;
    if (Number(digits) === 0) return s;
    return `BW-FILER-CIK${digits.padStart(10, "0")}`;
  }
  return s;
}

/** Calendar quarter-end (YYYY-MM-DD) on or after the given ISO date. */
export function quarterEndOnOrAfter(iso: string): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const qm = Math.ceil(m / 3) * 3;
  const last = new Date(Date.UTC(y, qm, 0)).getUTCDate();
  return `${y}-${String(qm).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** The quarter-end after `teo` (teo is itself a quarter-end). */
export function nextQuarterEnd(teo: string): string {
  const [y, m] = teo.split("-").map(Number) as [number, number];
  const nm = m + 3;
  const ny = nm > 12 ? y + 1 : y;
  const mm = nm > 12 ? nm - 12 : nm;
  const last = new Date(Date.UTC(ny, mm, 0)).getUTCDate();
  return `${ny}-${String(mm).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** Quarter-ends strictly between the first and last teo that have no row. */
export function missingQuarters(teos: string[]): string[] {
  if (teos.length < 2) return [];
  const have = new Set(teos);
  const out: string[] = [];
  let q = nextQuarterEnd(quarterEndOnOrAfter(teos[0]!));
  const end = teos[teos.length - 1]!;
  while (q < end) {
    if (!have.has(q)) out.push(q);
    q = nextQuarterEnd(q);
  }
  return out;
}

/** Per report date, from the accession-vintage store (`ds_filing_vintages.zarr`). */
export interface VintageQuarter {
  /** EDGAR date of the first filing for this report date (the original 13F-HR, not an amendment). */
  original_filing_date: string | null;
  /** Number of filings for this report date after the first (13F-HR/A, restatements, new holdings). */
  n_amendments: number;
  /** Accession of the latest filing for this report date: the book the portfolio row is built from. */
  accession_number: string | null;
  /** The latest filing's state was complete (a book the builder could use as a full holdings set). */
  book_complete: boolean | null;
  /** Reported book value (USD) and the part whose CUSIP resolved to a security, at that filing. */
  reported_aum_usd: number | null;
  mapped_aum_usd: number | null;
}

/** Repair ledger per report date (published sidecar; null when not published). */
export interface BookRepair {
  /** `units_repaired` (value units rescaled against the ERM3 close), `rows_quarantined` (rows whose units could
   *  not be established carry no value), `reparsed` (re-parsed from the filing after a parser fix). */
  status: "units_repaired" | "rows_quarantined" | "reparsed";
  rows_affected: number | null;
}

export interface PortfolioRowLike {
  teo: string;
  filing_date: string | null;
  n_holdings_active: number | null;
  coverage_in_erm3: number | null;
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_idiosyncratic_return: number | null;
}

export interface PortfolioRowQuality {
  /** First EDGAR filing date for the quarter; `filing_date` is the latest (an amendment's when one exists). */
  original_filing_date: string | null;
  filing_date_is_amendment: boolean | null;
  n_amendments: number | null;
  accession_number: string | null;
  /** The row's forward-return window (teo → next quarter-end) has not closed yet: returns are partial. */
  is_partial_period: boolean;
  /** Returns are present but the quarter has no holdings snapshot. */
  is_stub: boolean;
  book_complete: boolean | null;
  /** Share of the reported book whose CUSIPs resolved to a security (mapped_aum / reported_aum). */
  mapped_share: number | null;
  /** Share of the book inside the ERM3 universe (same value as `coverage_in_erm3`). */
  erm3_universe_share: number | null;
  /** `none` when the published repair ledger has no entry for the quarter; null when the ledger is unavailable. */
  repair_status: BookRepair["status"] | "none" | null;
  repair_rows_affected: number | null;
}

const ratio = (num: number | null, den: number | null): number | null =>
  num != null && den != null && Number.isFinite(num) && Number.isFinite(den) && den > 0 ? num / den : null;

/**
 * Annotate portfolio rows. `today` is an ISO date (UTC). `vintages` is null when the vintage store is not
 * published for the filer; `repairs` is null when the repair ledger is unavailable (then `repair_status` is null,
 * never a guessed "none").
 */
export function annotatePortfolioRows<R extends PortfolioRowLike>(
  rows: R[],
  vintages: Map<string, VintageQuarter> | null,
  repairs: Map<string, BookRepair> | null,
  today: string,
): Array<R & PortfolioRowQuality> {
  return rows.map((r, i) => {
    const v = vintages?.get(r.teo) ?? null;
    const rep = repairs ? repairs.get(r.teo) ?? null : undefined;
    const hasReturn =
      r.portfolio_gross_return != null ||
      r.portfolio_market_return != null ||
      r.portfolio_idiosyncratic_return != null;
    const isLast = i === rows.length - 1;
    const original = v?.original_filing_date ?? null;
    return {
      ...r,
      original_filing_date: original,
      filing_date_is_amendment:
        original != null && r.filing_date != null ? r.filing_date !== original : null,
      n_amendments: v ? v.n_amendments : null,
      accession_number: v?.accession_number ?? null,
      is_partial_period: isLast && nextQuarterEnd(r.teo) > today,
      is_stub: hasReturn && (r.n_holdings_active == null || r.n_holdings_active === 0),
      book_complete: v?.book_complete ?? null,
      mapped_share: v ? ratio(v.mapped_aum_usd, v.reported_aum_usd) : null,
      erm3_universe_share: r.coverage_in_erm3,
      repair_status: rep === undefined ? null : rep ? rep.status : "none",
      repair_rows_affected: rep ? rep.rows_affected : rep === null ? 0 : null,
    };
  });
}

/**
 * Collapse per-filing-event vintage arrays to one summary per report date. Events are matched to quarters by
 * `report_date`; the latest event by filing date (ties: later array position) governs the quarter.
 */
export function summarizeVintages(ev: {
  report_date: Array<string | null>;
  filing_date: Array<string | null>;
  accession_number: Array<string | null>;
  state_complete: Array<number | boolean | null> | null;
  reported_aum_usd: Array<number | null> | null;
  mapped_aum_usd: Array<number | null> | null;
}): Map<string, VintageQuarter> {
  const byRd = new Map<string, number[]>();
  for (let i = 0; i < ev.report_date.length; i++) {
    const rd = ev.report_date[i];
    if (!rd) continue;
    const list = byRd.get(rd) ?? [];
    list.push(i);
    byRd.set(rd, list);
  }
  const out = new Map<string, VintageQuarter>();
  for (const [rd, idx] of byRd) {
    const dated = idx.filter((i) => ev.filing_date[i] != null);
    const order = [...dated].sort((a, b) =>
      ev.filing_date[a]! < ev.filing_date[b]! ? -1 : ev.filing_date[a]! > ev.filing_date[b]! ? 1 : a - b,
    );
    const first = order[0];
    const gov = order.length ? order[order.length - 1]! : idx[idx.length - 1]!;
    const sc = ev.state_complete?.[gov];
    out.set(rd, {
      original_filing_date: first != null ? ev.filing_date[first]! : null,
      n_amendments: Math.max(idx.length - 1, 0),
      accession_number: ev.accession_number[gov] ?? null,
      book_complete: sc == null ? null : Boolean(sc),
      reported_aum_usd: ev.reported_aum_usd?.[gov] ?? null,
      mapped_aum_usd: ev.mapped_aum_usd?.[gov] ?? null,
    });
  }
  return out;
}
