/**
 * Correctness and quality annotations for the 13F filer portfolio history (BWMACRO backlog H.307, items 1–4, 6–8;
 * researcher API enhancements 1 and 2, 2026-10-06). Pure functions: no GCS, no cache — the route reads the stores
 * and passes them in.
 *
 * Every field added here is additive; existing row fields keep their meaning.
 */

// Accepted CIK forms: `BW-FILER-CIK<digits>`, `CIK<digits>`, or bare digits (a filer id slot holding only a number
// can only be a CIK: every non-CIK filer id carries its own prefix, e.g. `BW-FILER-CRD…`, `BW-SYNTH-…`).
// `BW-FILER-<digits>` without `CIK` is not rewritten.
const CIK_ID_RE = /^(?:BW-FILER-CIK|CIK)?0*(\d{1,10})$/i;

/**
 * Accept the forms researchers type — `BW-FILER-CIK0001067983`, `BW-FILER-CIK1067983`, `CIK1067983`,
 * `0001067983`, `1067983` — and return the canonical `BW-FILER-CIK` + 10-digit id. Every other id passes through
 * unchanged (`BW-FILER-CRD…`, `BW-SYNTH-…`, `BW-FILER-123`). Null for an empty, all-zero or undecodable input.
 */
export function normalizeFilerId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s: string;
  try {
    s = decodeURIComponent(String(raw)).trim();
  } catch {
    return null;
  }
  if (!s) return null;
  const m = CIK_ID_RE.exec(s);
  if (!m) return s;
  const digits = m[1]!;
  if (Number(digits) === 0) return null;
  return `BW-FILER-CIK${digits.padStart(10, "0")}`;
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

/** Per report date, from the accession-vintage store (`ds_filing_vintages.zarr`), keyed on the book the portfolio
 *  row was built from (`ds_ph`'s accession for that quarter — the same book as `ds_portfolio`'s returns and
 *  filing date; checked 2026-10-06 on Berkshire, Lazard, D. E. Shaw and Appaloosa, every quarter). */
export interface VintageQuarter {
  /** EDGAR date of the first filing for this report date. */
  original_filing_date: string | null;
  /** Accession of that first filing. */
  original_accession_number: string | null;
  /** Distinct accessions for this report date after the first (amendments, restatements, new-holdings filings). */
  n_amendments: number;
  /** Accession of the book the row was built from; null when `ds_ph` does not name one. */
  accession_number: string | null;
  /** Filing date of that book in the vintage store (used to check it is the row's book). */
  book_filing_date: string | null;
  /** `ds_ph` named a book for this quarter but the vintage store has no event with that accession. */
  book_missing: boolean;
  /** That book's state was complete. Null when the book is not identified. */
  book_complete: boolean | null;
  /** That book's reported value (USD) and the part whose CUSIPs resolved to a security. */
  reported_aum_usd: number | null;
  mapped_aum_usd: number | null;
}

/** Repair ledger entry per report date (published sidecar). */
export interface BookRepair {
  /** The most severe repair in the quarter: `rows_quarantined` (rows whose units could not be established carry no
   *  value) > `units_repaired` (value units rescaled against the ERM3 close) > `reparsed` (re-parsed after a parser
   *  fix). */
  status: "units_repaired" | "rows_quarantined" | "reparsed";
  /** Rows carrying the winning status. */
  rows_affected: number | null;
  /** Rows per repair kind in the quarter, every kind that occurred (a quarter can have several). */
  detail?: Partial<Record<"units_repaired" | "rows_quarantined" | "reparsed", number | null>>;
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
  /** First EDGAR filing date for the quarter; `filing_date` is the date of the book the row uses. */
  original_filing_date: string | null;
  /** The row's book is not the quarter's first filing (an amendment, restatement or new-holdings filing). */
  filing_date_is_amendment: boolean | null;
  n_amendments: number | null;
  accession_number: string | null;
  /** The row's forward-return window (teo → next quarter-end) ends after the store's returns window_end. Null when
   *  the store's window_end was not read. */
  is_partial_period: boolean | null;
  /** Returns are present but the quarter has no holdings snapshot. */
  is_stub: boolean;
  book_complete: boolean | null;
  /** Share of the book's reported value whose CUSIPs resolved to a security (mapped ÷ reported). */
  mapped_share: number | null;
  /** Share of the book inside the ERM3 universe (same value as `coverage_in_erm3`). */
  erm3_universe_share: number | null;
  /** `none` when the published ledger has no entry for the quarter; null when the ledger is unavailable. */
  repair_status: BookRepair["status"] | "none" | null;
  repair_rows_affected: number | null;
  repair_detail: BookRepair["detail"] | null;
}

const ratio = (num: number | null, den: number | null): number | null =>
  num != null && den != null && Number.isFinite(num) && Number.isFinite(den) && den > 0 ? num / den : null;

/** Result of annotating a series, with the count of rows whose named book did not match the row. */
export interface AnnotatedSeries<R> {
  rows: Array<R & PortfolioRowQuality>;
  /** Rows where the vintage book's filing date differs from the row's `filing_date`, or ds_ph named an accession
   *  the vintage store lacks. Their book fields are null. */
  book_mismatches: number;
}

/**
 * Annotate portfolio rows.
 *  - `windowEnd`: the store's returns `window_end`. A row is partial when its window teo → next quarter-end ends
 *    after it; null when it was not read.
 *  - Book fields are published only when the vintage book is the row's book: its filing date equals the row's
 *    `filing_date`. Otherwise they are null and the row counts in `book_mismatches`.
 *  - `vintages` null: the store is not published; its fields are null. `repairs` null: the ledger is unavailable;
 *    `repair_status` is null, never a guessed "none".
 */
export function annotatePortfolioRows<R extends PortfolioRowLike>(
  rows: R[],
  vintages: Map<string, VintageQuarter> | null,
  repairs: Map<string, BookRepair> | null,
  windowEnd: string | null,
): AnnotatedSeries<R> {
  let mismatches = 0;
  const out = rows.map((r) => {
    const q = vintages?.get(r.teo) ?? null;
    const matched =
      q != null &&
      q.accession_number != null &&
      !q.book_missing &&
      q.book_filing_date != null &&
      r.filing_date != null &&
      q.book_filing_date === r.filing_date;
    if (q && (q.book_missing || (q.accession_number != null && !matched))) mismatches++;
    const v = matched ? q : null;
    const rep = repairs ? repairs.get(r.teo) ?? null : undefined;
    const hasReturn =
      r.portfolio_gross_return != null ||
      r.portfolio_market_return != null ||
      r.portfolio_idiosyncratic_return != null;
    return {
      ...r,
      original_filing_date: q?.original_filing_date ?? null,
      filing_date_is_amendment:
        v && v.original_accession_number ? v.accession_number !== v.original_accession_number : null,
      n_amendments: q ? q.n_amendments : null,
      accession_number: v?.accession_number ?? null,
      is_partial_period: windowEnd ? nextQuarterEnd(r.teo) > windowEnd : null,
      is_stub: hasReturn && (r.n_holdings_active == null || r.n_holdings_active === 0),
      book_complete: v?.book_complete ?? null,
      mapped_share: v ? ratio(v.mapped_aum_usd, v.reported_aum_usd) : null,
      erm3_universe_share: r.coverage_in_erm3,
      repair_status: rep === undefined ? null : rep ? rep.status : ("none" as const),
      repair_rows_affected: rep ? rep.rows_affected : rep === null ? 0 : null,
      repair_detail: rep ? rep.detail ?? { [rep.status]: rep.rows_affected } : rep === null ? {} : null,
    };
  });
  return { rows: out, book_mismatches: mismatches };
}

/**
 * One summary per report date. `governing` maps report date → the accession the portfolio row's book came from
 * (`ds_ph`). Book-specific fields are taken from that accession's event only; without it they are null — the
 * latest-dated event is never assumed to be the book. Arrays of unequal length → null (malformed store).
 */
export function summarizeVintages(
  ev: {
    report_date: Array<string | null>;
    filing_date: Array<string | null>;
    accession_number: Array<string | null>;
    state_complete: Array<number | boolean | null> | null;
    reported_aum_usd: Array<number | null> | null;
    mapped_aum_usd: Array<number | null> | null;
  },
  governing: Map<string, string | null>,
): Map<string, VintageQuarter> | null {
  const n = ev.report_date.length;
  const same = (a: unknown[] | null) => a == null || a.length === n;
  if (
    ev.filing_date.length !== n ||
    ev.accession_number.length !== n ||
    !same(ev.state_complete) ||
    !same(ev.reported_aum_usd) ||
    !same(ev.mapped_aum_usd)
  ) {
    return null;
  }
  const byRd = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const rd = ev.report_date[i];
    if (!rd) continue;
    const list = byRd.get(rd) ?? [];
    list.push(i);
    byRd.set(rd, list);
  }
  const out = new Map<string, VintageQuarter>();
  for (const [rd, idx] of byRd) {
    const dated = idx.filter((i) => ev.filing_date[i] != null && ev.accession_number[i]);
    dated.sort((a, b) =>
      ev.filing_date[a]! < ev.filing_date[b]! ? -1 : ev.filing_date[a]! > ev.filing_date[b]! ? 1 : a - b,
    );
    const first = dated[0];
    const accs = new Set(idx.map((i) => ev.accession_number[i]).filter((a): a is string => !!a));
    const govAcc = governing.get(rd) ?? null;
    // The last event carrying that accession: the store's effective state for it (one row per accession today).
    let gov: number | undefined;
    if (govAcc != null) for (const i of idx) if (ev.accession_number[i] === govAcc) gov = i;
    const sc = gov != null ? ev.state_complete?.[gov] : null;
    out.set(rd, {
      original_filing_date: first != null ? ev.filing_date[first]! : null,
      original_accession_number: first != null ? ev.accession_number[first]! : null,
      n_amendments: Math.max(accs.size - 1, 0),
      accession_number: gov != null ? govAcc : null,
      book_filing_date: gov != null ? ev.filing_date[gov] ?? null : null,
      book_missing: govAcc != null && gov == null,
      book_complete: sc == null ? null : Boolean(sc),
      reported_aum_usd: gov != null ? ev.reported_aum_usd?.[gov] ?? null : null,
      mapped_aum_usd: gov != null ? ev.mapped_aum_usd?.[gov] ?? null : null,
    });
  }
  return out;
}

/** Holdings ranking for paging: adj_mv descending, ties by security_id ascending, so a page boundary that falls
 *  inside a tie is the same on every recompute (H.307 item 8). */
export function compareHoldingsRank(
  a: { adj_mv: number; security_id: string },
  b: { adj_mv: number; security_id: string },
): number {
  return b.adj_mv - a.adj_mv || (a.security_id < b.security_id ? -1 : a.security_id > b.security_id ? 1 : 0);
}
