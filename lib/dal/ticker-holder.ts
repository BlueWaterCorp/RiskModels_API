/**
 * Most-recent-holder recall for tickers with no live `symbols` row.
 *
 * `public.symbols` mirrors the modelled universe only (~3.4k rows), so a
 * ticker whose holder was delisted drops out of it even though the holder's
 * history is still in ds_daily.zarr: CTRA (Coterra, BW-BBG000C3GN47, last bar
 * 2026-05-07) and BBBY (Overstock → Beyond → Bed Bath & Beyond,
 * BW-BBG000BBQDH7) answered "Ticker not found". This module finds, for a
 * requested ticker, the security that held it most recently.
 *
 * Candidate sources (every one is data the API already reads):
 *   1. ds_daily.zarr `ticker` / `unique_ticker` / `eodhd_code` coords — the
 *      pipeline's own label for every priced identity, delisted ones included.
 *   2. `public.security_master` rows whose `ticker` or `unique_ticker` equals
 *      the request (liveness + validity window per bw_sym_id).
 *   3. Caller-supplied candidates: a dead `symbols` row for the ticker, a
 *      `security_aliases` hit.
 *
 * Ranking (rankHolderCandidates): a LIVE holder always wins — a recycled
 * ticker must never answer with a former holder's history while someone
 * holds it today. Among non-live holders the latest `held_through` wins,
 * then presence in ds_daily, then lowest bw_sym_id.
 *
 * Never throws: on any read failure it returns what resolved (possibly
 * nothing) and resolution falls back to the pre-existing behaviour.
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

export interface HolderCandidate {
  bw_sym_id: string;
  /** Holds the ticker today (not delisted, open validity window). */
  live: boolean;
  /** Last date the identity held / traded the ticker (YYYY-MM-DD); null = unknown. */
  held_through: string | null;
  /** True / false when ds_daily was readable; null when it was not. */
  in_daily_store: boolean | null;
}

/** A candidate the caller already found (dead `symbols` row, alias hit). */
export interface ExtraHolderCandidate {
  ticker: string;
  bw_sym_id: string;
  /** Liveness known to the caller; undefined = decide from security_master. */
  live?: boolean;
  held_through?: string | null;
}

export interface TickerHolder extends HolderCandidate {
  security_master: SecurityMasterHolderRow | null;
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

function maxDate(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = a ?? null;
  const y = b ?? null;
  if (!x) return y;
  if (!y) return x;
  return x > y ? x : y;
}

function smIsLive(r: SecurityMasterHolderRow): boolean {
  return r.is_delisted !== true && r.is_active !== false && r.valid_to == null;
}

async function fetchSecurityMasterRows(
  tickers: string[],
  ids: string[],
): Promise<SecurityMasterHolderRow[]> {
  const admin = createAdminClient();
  const queries: PromiseLike<{ data: unknown; error: unknown }>[] = [];
  if (tickers.length) {
    queries.push(admin.from("security_master").select(SM_COLUMNS).in("ticker", tickers));
    queries.push(admin.from("security_master").select(SM_COLUMNS).in("unique_ticker", tickers));
  }
  if (ids.length) {
    queries.push(admin.from("security_master").select(SM_COLUMNS).in("bw_sym_id", ids));
  }
  const results = await Promise.all(queries);
  const out: SecurityMasterHolderRow[] = [];
  for (const { data, error } of results) {
    if (error) {
      console.error("[ticker-holder] security_master read failed", error);
      continue;
    }
    out.push(...(((data ?? []) as SecurityMasterHolderRow[]) ?? []));
  }
  return out;
}

/**
 * For each requested (upper-cased) ticker, the security that held it most
 * recently. Tickers with no candidate get no entry.
 */
export async function findMostRecentHolders(
  tickers: string[],
  extra: ExtraHolderCandidate[] = [],
): Promise<Map<string, TickerHolder>> {
  const out = new Map<string, TickerHolder>();
  const wanted = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (!wanted.length) return out;

  try {
    const index = await readDailyTickerHolderIndex().catch(() => null);

    // ticker → candidate ids, with caller-known liveness / held_through.
    const idsByTicker = new Map<string, Set<string>>();
    const extraById = new Map<string, ExtraHolderCandidate>();
    const addId = (t: string, id: string) => {
      const set = idsByTicker.get(t) ?? new Set<string>();
      set.add(id);
      idsByTicker.set(t, set);
    };
    for (const t of wanted) {
      for (const id of index?.byTicker.get(t) ?? []) addId(t, id);
    }
    for (const e of extra) {
      const t = e.ticker.trim().toUpperCase();
      if (!wanted.includes(t) || !e.bw_sym_id) continue;
      addId(t, e.bw_sym_id);
      extraById.set(`${t}\u0000${e.bw_sym_id}`, e);
    }

    const allIds = [...new Set([...idsByTicker.values()].flatMap((s) => [...s]))];
    const smRows = await fetchSecurityMasterRows(wanted, allIds);

    const smById = new Map<string, SecurityMasterHolderRow[]>();
    for (const r of smRows) {
      if (!r?.bw_sym_id) continue;
      const list = smById.get(r.bw_sym_id) ?? [];
      if (!list.some((x) => x.valid_to === r.valid_to && x.ticker === r.ticker)) list.push(r);
      smById.set(r.bw_sym_id, list);
      for (const label of [r.ticker, r.unique_ticker]) {
        const t = (label ?? "").trim().toUpperCase();
        if (wanted.includes(t)) addId(t, r.bw_sym_id);
      }
    }

    for (const t of wanted) {
      const ids = idsByTicker.get(t);
      if (!ids?.size) continue;
      const candidates: TickerHolder[] = [];
      for (const id of ids) {
        const sm = smById.get(id) ?? [];
        const e = extraById.get(`${t}\u0000${id}`);
        const smLive = sm.length ? sm.some(smIsLive) : undefined;
        // Caller-known deadness (a delisted symbols row, a closed alias)
        // overrides; otherwise security_master decides; unknown = not live.
        const live = e?.live === false ? false : smLive ?? e?.live ?? false;
        let held: string | null = e?.held_through ?? null;
        for (const r of sm) held = maxDate(held, r.valid_to ?? r.delisted_date);
        const representative =
          sm.find(smIsLive) ??
          [...sm].sort((a, b) => ((a.valid_to ?? "") > (b.valid_to ?? "") ? -1 : 1))[0] ??
          null;
        candidates.push({
          bw_sym_id: id,
          live,
          held_through: live ? null : held,
          in_daily_store: index ? index.symbols.has(id) : null,
          security_master: representative,
        });
      }
      const winner = rankHolderCandidates(candidates);
      if (winner) out.set(t, winner);
    }
    return out;
  } catch (error) {
    console.error("[ticker-holder] most-recent-holder lookup failed", error);
    return out;
  }
}
