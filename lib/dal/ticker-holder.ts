/**
 * Most-recent-holder recall for tickers with no live `symbols` row.
 *
 * `public.symbols` mirrors the modelled universe only (~3.4k rows), so a
 * ticker whose holder was delisted drops out of it even though the holder's
 * history is still in ds_daily.zarr: CTRA (Coterra, BW-BBG000C3GN47, last bar
 * 2026-05-07) answered "Ticker not found". This module finds, for a requested
 * ticker, the security that holds it today or held it most recently.
 *
 * Candidate sources (every one is data the API already reads):
 *   1. ds_daily.zarr `ticker` (display), `unique_ticker`, `eodhd_code` coords
 *      — the pipeline's labels for every priced identity, delisted included.
 *   2. `public.security_master` rows whose `ticker` or `unique_ticker` equals
 *      the request.
 *   3. Caller-supplied candidates: a dead `symbols` row for the ticker, a
 *      `security_aliases` hit.
 *
 * LIVE means "holds this ticker today": the id has an OPEN security_master
 * row (not delisted, not inactive, valid_to null) whose `ticker` equals the
 * request, and the registry does not flag it dead. ds_daily labels never make
 * a candidate live — a display coord can lag a rename and `unique_ticker`
 * can be stale (Coterra still carries `COG`) — they only recall former
 * holders.
 *
 * HELD_THROUGH is scoped to the requested ticker: the end of closed
 * security_master rows whose `ticker` / `unique_ticker` is the request, the
 * day before a closed alias's (half-open) end, and — for a dead identity
 * whose ds_daily display ticker or listing code is the request, i.e. the
 * label it last traded under — the identity's own end date.
 *
 * Ranking (rankHolderCandidates): live first; then latest `held_through`
 * (unknown last); then present in ds_daily; then lowest bw_sym_id.
 *
 * Fail-closed per ticker: a security_master request that errors or returns
 * fewer rows than its exact count is retried one key at a time; a key that
 * still fails marks the tickers depending on it as `failed`. Those tickers
 * get no holder and the caller keeps its pre-existing answer.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { readDailyTickerHolderIndex } from "@/lib/dal/zarr-reader";

export interface SecurityMasterHolderRow {
  bw_sym_id: string;
  ticker: string | null;
  unique_ticker: string | null;
  company_name: string | null;
  sector_etf: string | null;
  subsector_etfs: string | null;
  asset_type: string | null;
  is_adr: boolean | null;
  is_active: boolean | null;
  is_delisted: boolean | null;
  valid_to: string | null;
  delisted_date: string | null;
}

const SM_COLUMNS =
  "bw_sym_id, ticker, unique_ticker, company_name, sector_etf, subsector_etfs, asset_type, is_adr, is_active, is_delisted, valid_to, delisted_date";

/** Keys per security_master `.in()` request (each response is count-checked). */
const SM_CHUNK = 100;

export interface HolderCandidate {
  bw_sym_id: string;
  /** Holds the requested ticker today (see module doc). */
  live: boolean;
  /** Last date the identity held the requested ticker (YYYY-MM-DD, inclusive); null = unknown. */
  held_through: string | null;
  /** True / false when ds_daily was readable; null when it was not. */
  in_daily_store: boolean | null;
}

/** A candidate the caller already found (dead `symbols` row, alias hit). */
export interface ExtraHolderCandidate {
  ticker: string;
  bw_sym_id: string;
  /** The registry flags this id delisted: it can never be live. */
  dead?: boolean;
  /** Alias window end (half-open, exclusive), when the alias is closed. */
  alias_valid_to?: string | null;
}

export interface TickerHolder extends HolderCandidate {
  /** No open security_master row: delisted, inactive, or unknown to it. */
  identity_delisted: boolean;
  security_master: SecurityMasterHolderRow | null;
}

export interface MostRecentHolderLookup {
  /** Tickers whose security_master evidence could not be read completely. */
  failed: Set<string>;
  holders: Map<string, TickerHolder>;
}

/**
 * Deterministic pick: live first, then latest held_through (unknown last),
 * then present in ds_daily, then lowest bw_sym_id.
 */
export function rankHolderCandidates<T extends HolderCandidate>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    const ah = a.held_through ?? "";
    const bh = b.held_through ?? "";
    if (ah !== bh) return ah > bh ? -1 : 1;
    const ad = a.in_daily_store === true ? 1 : 0;
    const bd = b.in_daily_store === true ? 1 : 0;
    if (ad !== bd) return bd - ad;
    return a.bw_sym_id.localeCompare(b.bw_sym_id);
  });
  return sorted[0] ?? null;
}

/** YYYY-MM-DD prefix of a date or timestamp string; null when unparseable. */
function isoDay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  return m ? m[1]! : null;
}

/** Inclusive last day of a half-open window ending on `raw` (exclusive). */
export function dayBefore(raw: string | null | undefined): string | null {
  const d = isoDay(raw);
  if (!d) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 86_400_000).toISOString().slice(0, 10);
}

function maxDay(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function smIsOpen(r: SecurityMasterHolderRow): boolean {
  return r.is_delisted !== true && r.is_active !== false && r.valid_to == null;
}

function label(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

interface SmRequest {
  col: "ticker" | "unique_ticker" | "bw_sym_id";
  values: string[];
}

/**
 * Runs the security_master requests; returns the rows of complete responses
 * and the requests that failed (error, or fewer rows than the exact count).
 */
async function fetchSecurityMasterRows(
  requests: SmRequest[],
): Promise<{ rows: SecurityMasterHolderRow[]; failedRequests: SmRequest[] }> {
  const first = await fetchSecurityMasterOnce(requests);
  // A failed multi-key request is retried one key at a time, so one bad or
  // oversized key fails only the tickers that depend on it.
  const retry = first.failedRequests.flatMap((r) =>
    r.values.length > 1 ? r.values.map((v) => ({ col: r.col, values: [v] })) : [],
  );
  if (!retry.length) return first;
  const second = await fetchSecurityMasterOnce(retry);
  return {
    rows: [...first.rows, ...second.rows],
    failedRequests: [
      ...first.failedRequests.filter((r) => r.values.length <= 1),
      ...second.failedRequests,
    ],
  };
}

async function fetchSecurityMasterOnce(
  requests: SmRequest[],
): Promise<{ rows: SecurityMasterHolderRow[]; failedRequests: SmRequest[] }> {
  const admin = createAdminClient();
  const results = await Promise.all(
    requests.map(async (req) => {
      try {
        const res = (await admin
          .from("security_master")
          .select(SM_COLUMNS, { count: "exact" })
          .in(req.col, req.values)) as {
          data: unknown;
          error: unknown;
          count?: number | null;
        };
        return { req, ...res };
      } catch (error) {
        return { req, data: null, error, count: null };
      }
    }),
  );
  const rows: SecurityMasterHolderRow[] = [];
  const failedRequests: SmRequest[] = [];
  for (const { req, data, error, count } of results) {
    const got = (data ?? []) as SecurityMasterHolderRow[];
    if (error || typeof count !== "number" || got.length < count) {
      console.error(
        `[ticker-holder] security_master ${req.col} read ${error ? "failed" : "incomplete"} (${got.length}/${count})`,
      );
      failedRequests.push(req);
      continue;
    }
    rows.push(...got);
  }
  return { rows, failedRequests };
}

function chunked(col: SmRequest["col"], values: string[]): SmRequest[] {
  const out: SmRequest[] = [];
  for (let i = 0; i < values.length; i += SM_CHUNK) {
    out.push({ col, values: values.slice(i, i + SM_CHUNK) });
  }
  return out;
}

/**
 * For each requested (upper-cased) ticker, the security that holds it today
 * or held it most recently. Tickers with no candidate get no entry; tickers
 * whose evidence could not be read completely are listed in `failed`.
 */
export async function findMostRecentHolders(
  tickers: string[],
  extra: ExtraHolderCandidate[] = [],
): Promise<MostRecentHolderLookup> {
  const holders = new Map<string, TickerHolder>();
  const failed = new Set<string>();
  const wanted = [...new Set(tickers.map(label).filter(Boolean))];
  if (!wanted.length) return { failed, holders };
  const wantedSet = new Set(wanted);

  try {
    let index: Awaited<ReturnType<typeof readDailyTickerHolderIndex>> = null;
    try {
      index = await readDailyTickerHolderIndex();
    } catch {
      index = null;
    }

    const idsByTicker = new Map<string, Set<string>>();
    const addTo = (t: string, id: string) => {
      const set = idsByTicker.get(t) ?? new Set<string>();
      set.add(id);
      idsByTicker.set(t, set);
    };
    for (const t of wanted) {
      for (const id of index?.byTicker.get(t) ?? []) addTo(t, id);
    }
    const extraByKey = new Map<string, ExtraHolderCandidate[]>();
    for (const e of extra) {
      const t = label(e.ticker);
      if (!wantedSet.has(t) || !e.bw_sym_id) continue;
      addTo(t, e.bw_sym_id);
      const key = `${t}\u0000${e.bw_sym_id}`;
      extraByKey.set(key, [...(extraByKey.get(key) ?? []), e]);
    }

    // Pass 1: rows by ticker label (finds security_master-only holders).
    const labelReqs = [...chunked("ticker", wanted), ...chunked("unique_ticker", wanted)];
    const pass1 = await fetchSecurityMasterRows(labelReqs);
    for (const req of pass1.failedRequests) for (const t of req.values) failed.add(t);
    for (const r of pass1.rows) {
      for (const l of [r.ticker, r.unique_ticker]) {
        const t = label(l);
        if (wantedSet.has(t) && r.bw_sym_id) addTo(t, r.bw_sym_id);
      }
    }

    // Pass 2: every row of every candidate id (liveness + windows).
    const allIds = [...new Set([...idsByTicker.values()].flatMap((s) => [...s]))];
    const pass2 = await fetchSecurityMasterRows(chunked("bw_sym_id", allIds));
    const failedIds = new Set(pass2.failedRequests.flatMap((r) => r.values));
    for (const [t, ids] of idsByTicker) {
      if ([...ids].some((id) => failedIds.has(id))) failed.add(t);
    }

    const smById = new Map<string, SecurityMasterHolderRow[]>();
    for (const r of [...pass1.rows, ...pass2.rows]) {
      if (!r?.bw_sym_id) continue;
      const list = smById.get(r.bw_sym_id) ?? [];
      if (
        !list.some(
          (x) => x.valid_to === r.valid_to && x.ticker === r.ticker && x.unique_ticker === r.unique_ticker,
        )
      ) {
        list.push(r);
      }
      smById.set(r.bw_sym_id, list);
    }

    for (const t of wanted) {
      if (failed.has(t)) continue;
      const ids = idsByTicker.get(t);
      if (!ids?.size) continue;
      const candidates: TickerHolder[] = [];
      for (const id of ids) {
        const sm = smById.get(id) ?? [];
        const extras = extraByKey.get(`${t}\u0000${id}`) ?? [];
        const registryDead = extras.some((e) => e.dead === true);
        const identityOpen = sm.some(smIsOpen);
        const forT = sm.filter((r) => label(r.ticker) === t || label(r.unique_ticker) === t);
        const live = !registryDead && sm.some((r) => smIsOpen(r) && label(r.ticker) === t);

        let held: string | null = null;
        for (const r of forT) {
          if (!smIsOpen(r)) held = maxDay(held, isoDay(r.valid_to ?? r.delisted_date));
        }
        for (const e of extras) held = maxDay(held, dayBefore(e.alias_valid_to));
        const lastLabel =
          (index?.byDisplayTicker.get(t)?.includes(id) ?? false) ||
          (index?.byListingTicker.get(t)?.includes(id) ?? false);
        if (lastLabel && !identityOpen) {
          for (const r of sm) held = maxDay(held, isoDay(r.valid_to ?? r.delisted_date));
        }

        const representative =
          forT.find(smIsOpen) ??
          sm.find(smIsOpen) ??
          [...sm].sort((a, b) => ((a.valid_to ?? "") > (b.valid_to ?? "") ? -1 : 1))[0] ??
          null;
        candidates.push({
          bw_sym_id: id,
          live,
          held_through: live ? null : held,
          in_daily_store: index ? index.symbols.has(id) : null,
          identity_delisted: registryDead || !identityOpen,
          security_master: representative,
        });
      }
      const winner = rankHolderCandidates(candidates);
      if (winner) holders.set(t, winner);
    }
    return { failed, holders };
  } catch (error) {
    console.error("[ticker-holder] most-recent-holder lookup failed", error);
    return { failed: new Set(wanted), holders: new Map() };
  }
}
