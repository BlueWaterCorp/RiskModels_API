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
 *   1. ds_daily.zarr `ticker` / `unique_ticker` / `eodhd_code` coords — the
 *      pipeline's own labels for every priced identity, delisted included.
 *   2. `public.security_master` rows whose `ticker` or `unique_ticker` equals
 *      the request.
 *   3. Caller-supplied candidates: a dead `symbols` row for the ticker, a
 *      `security_aliases` hit.
 *
 * LIVE means "holds this ticker today", not "the identity is listed": the id
 * has an open security_master row (not delisted, not inactive, valid_to null)
 * AND either a security_master row whose `ticker` equals the request or a
 * ds_daily display `ticker` equal to it. A `unique_ticker` / `eodhd_code`
 * match never makes a candidate live — those labels can be stale (Coterra
 * still carries unique_ticker `COG`), so they only recall former holders.
 *
 * Ranking (rankHolderCandidates): live first; then latest `held_through`
 * (unknown last); then present in ds_daily; then lowest bw_sym_id.
 *
 * Fail-closed: a security_master read error or a possibly truncated result
 * returns `ok: false`, and the caller keeps its pre-existing answer — the
 * pass never invents a holder from a partial read.
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

/** Ids per security_master `.in()` request; keeps every response far below PostgREST's row cap. */
const SM_CHUNK = 200;
/** PostgREST's default max-rows. A response this long may be truncated. */
const POSTGREST_MAX_ROWS = 1000;

export interface HolderCandidate {
  bw_sym_id: string;
  /** Holds the requested ticker today (see module doc). */
  live: boolean;
  /** Last date the identity held the ticker (YYYY-MM-DD, inclusive); null = unknown. */
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
  /** False when security_master could not be read completely. */
  ok: boolean;
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

class SecurityMasterReadError extends Error {}

async function fetchSecurityMasterRows(
  tickers: string[],
  ids: string[],
): Promise<SecurityMasterHolderRow[]> {
  const admin = createAdminClient();
  const requests: { col: string; values: string[] }[] = [];
  for (let i = 0; i < tickers.length; i += SM_CHUNK) {
    const chunk = tickers.slice(i, i + SM_CHUNK);
    requests.push({ col: "ticker", values: chunk }, { col: "unique_ticker", values: chunk });
  }
  for (let i = 0; i < ids.length; i += SM_CHUNK) {
    requests.push({ col: "bw_sym_id", values: ids.slice(i, i + SM_CHUNK) });
  }
  const results = await Promise.all(
    requests.map(({ col, values }) =>
      admin.from("security_master").select(SM_COLUMNS).in(col, values),
    ),
  );
  const out: SecurityMasterHolderRow[] = [];
  for (const { data, error } of results as { data: unknown; error: unknown }[]) {
    if (error) throw new SecurityMasterReadError("security_master read failed");
    const rows = (data ?? []) as SecurityMasterHolderRow[];
    if (rows.length >= POSTGREST_MAX_ROWS) {
      throw new SecurityMasterReadError("security_master response may be truncated");
    }
    out.push(...rows);
  }
  return out;
}

/**
 * For each requested (upper-cased) ticker, the security that holds it today
 * or held it most recently. Tickers with no candidate get no entry.
 */
export async function findMostRecentHolders(
  tickers: string[],
  extra: ExtraHolderCandidate[] = [],
): Promise<MostRecentHolderLookup> {
  const holders = new Map<string, TickerHolder>();
  const wanted = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (!wanted.length) return { ok: true, holders };
  const wantedSet = new Set(wanted);

  try {
    let index: Awaited<ReturnType<typeof readDailyTickerHolderIndex>> = null;
    try {
      index = await readDailyTickerHolderIndex();
    } catch {
      index = null;
    }

    // ticker → candidate ids; ticker → ids whose ds_daily DISPLAY ticker is it.
    const idsByTicker = new Map<string, Set<string>>();
    const displayIdsByTicker = new Map<string, Set<string>>();
    const addTo = (m: Map<string, Set<string>>, t: string, id: string) => {
      const set = m.get(t) ?? new Set<string>();
      set.add(id);
      m.set(t, set);
    };
    for (const t of wanted) {
      for (const id of index?.byTicker.get(t) ?? []) addTo(idsByTicker, t, id);
      for (const id of index?.byDisplayTicker.get(t) ?? []) addTo(displayIdsByTicker, t, id);
    }
    const extraByKey = new Map<string, ExtraHolderCandidate[]>();
    for (const e of extra) {
      const t = e.ticker.trim().toUpperCase();
      if (!wantedSet.has(t) || !e.bw_sym_id) continue;
      addTo(idsByTicker, t, e.bw_sym_id);
      const key = `${t}\u0000${e.bw_sym_id}`;
      extraByKey.set(key, [...(extraByKey.get(key) ?? []), e]);
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
        if (wantedSet.has(t)) addTo(idsByTicker, t, r.bw_sym_id);
      }
    }

    for (const t of wanted) {
      const ids = idsByTicker.get(t);
      if (!ids?.size) continue;
      const candidates: TickerHolder[] = [];
      for (const id of ids) {
        const sm = smById.get(id) ?? [];
        const extras = extraByKey.get(`${t}\u0000${id}`) ?? [];
        const registryDead = extras.some((e) => e.dead === true);
        const identityOpen = sm.some(smIsOpen);
        const holdsLabel =
          sm.some((r) => smIsOpen(r) && (r.ticker ?? "").trim().toUpperCase() === t) ||
          (identityOpen && (displayIdsByTicker.get(t)?.has(id) ?? false));
        const live = !registryDead && identityOpen && holdsLabel;

        let held: string | null = null;
        for (const r of sm) {
          if (!smIsOpen(r)) held = maxDay(held, isoDay(r.valid_to ?? r.delisted_date));
        }
        for (const e of extras) held = maxDay(held, dayBefore(e.alias_valid_to));

        const representative =
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
    return { ok: true, holders };
  } catch (error) {
    console.error("[ticker-holder] most-recent-holder lookup failed", error);
    return { ok: false, holders: new Map() };
  }
}
