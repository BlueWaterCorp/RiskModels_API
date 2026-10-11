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
 * security_master rows whose `ticker` / `unique_ticker` is the request, and
 * the day before a closed alias's (half-open) end. ds_daily labels never
 * date a candidate (a label can lag an in-place rename).
 *
 * REGISTRY VETO: any candidate whose `symbols` row (under any ticker) is
 * flagged delisted is never live, and is ranked as a former holder.
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
  /**
   * Strength of the ds_daily label evidence for T, used only to break ties
   * among undated candidates: 2 = display ticker AND listing code are T,
   * 1 = one of them, 0 = neither (unique_ticker / caller evidence only).
   */
  label_score?: number;
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
 * then stronger ds_daily label evidence (display + listing over one label),
 * then present in ds_daily, then lowest bw_sym_id.
 */
export function rankHolderCandidates<T extends HolderCandidate>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    const ah = a.held_through ?? "";
    const bh = b.held_through ?? "";
    if (ah !== bh) return ah > bh ? -1 : 1;
    const al = a.label_score ?? 0;
    const bl = b.label_score ?? 0;
    if (al !== bl) return bl - al;
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
    if (error || (typeof count === "number" && got.length < count)) {
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

/**
 * Ids whose `symbols` row (under any ticker) is flagged delisted. Chunked,
 * count-checked, retried one key at a time; ids still unread are `failed`.
 */
async function fetchRegistryDeadIds(
  ids: string[],
): Promise<{ dead: Set<string>; failed: Set<string> }> {
  const dead = new Set<string>();
  const failed = new Set<string>();
  if (!ids.length) return { dead, failed };
  const admin = createAdminClient();
  const once = async (keys: string[]): Promise<boolean> => {
    try {
      const { data, error, count } = (await admin
        .from("symbols")
        .select("symbol, metadata", { count: "exact" })
        .in("symbol", keys)) as { data: unknown; error: unknown; count?: number | null };
      const rows = (data ?? []) as { symbol?: string; metadata?: { is_delisted?: boolean } | null }[];
      if (error || (typeof count === "number" && rows.length < count)) return false;
      for (const r of rows) if (r.symbol && r.metadata?.is_delisted === true) dead.add(r.symbol);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < ids.length; i += SM_CHUNK) {
    const slice = ids.slice(i, i + SM_CHUNK);
    if (await once(slice)) continue;
    for (const k of slice) if (slice.length === 1 || !(await once([k]))) failed.add(k);
  }
  return { dead, failed };
}

function chunked(col: SmRequest["col"], values: string[]): SmRequest[] {
  const out: SmRequest[] = [];
  for (let i = 0; i < values.length; i += SM_CHUNK) {
    out.push({ col, values: values.slice(i, i + SM_CHUNK) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-instance result cache. Misses (options lines, uncovered ETFs, typeahead
// keystrokes) repeat; each would otherwise pay up to four Supabase round
// trips. Keyed by ticker plus the caller's candidates for it; failed lookups
// are never cached. TTL from TICKER_HOLDER_CACHE_TTL_MS (0 disables).
// ---------------------------------------------------------------------------

const HOLDER_CACHE_MAX = 2000;
const holderCache = new Map<string, { at: number; holder: TickerHolder | null }>();

function holderCacheTtlMs(): number {
  const raw = process.env.TICKER_HOLDER_CACHE_TTL_MS;
  const n = raw === undefined || raw === "" ? 5 * 60 * 1000 : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function holderCacheKey(t: string, extra: ExtraHolderCandidate[]): string {
  const parts = extra
    .filter((e) => label(e.ticker) === t)
    .map((e) => `${e.bw_sym_id}:${e.dead ? 1 : 0}:${e.alias_valid_to ?? ""}`)
    .sort();
  return `${t}|${parts.join(",")}`;
}

/** Test hook: clear the per-instance holder cache. */
export function _resetHolderCache(): void {
  holderCache.clear();
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
  const ttl = holderCacheTtlMs();
  const now = Date.now();
  const toFetch: string[] = [];
  for (const t of wanted) {
    const hit = ttl > 0 ? holderCache.get(holderCacheKey(t, extra)) : undefined;
    if (hit && now - hit.at < ttl) {
      if (hit.holder) holders.set(t, hit.holder);
    } else {
      toFetch.push(t);
    }
  }
  if (!toFetch.length) return { failed, holders };
  const fresh = await findMostRecentHoldersUncached(toFetch, extra);
  for (const t of toFetch) {
    if (fresh.failed.has(t)) {
      failed.add(t);
      continue;
    }
    const h = fresh.holders.get(t) ?? null;
    if (h) holders.set(t, h);
    // A decision made without the ds_daily index is degraded: not cached.
    if (ttl > 0 && fresh.indexAvailable) {
      const key = holderCacheKey(t, extra);
      holderCache.delete(key);
      holderCache.set(key, { at: now, holder: h });
      if (holderCache.size > HOLDER_CACHE_MAX) {
        const oldest = holderCache.keys().next().value;
        if (oldest !== undefined) holderCache.delete(oldest);
      }
    }
  }
  return { failed, holders };
}

async function findMostRecentHoldersUncached(
  tickers: string[],
  extra: ExtraHolderCandidate[],
): Promise<MostRecentHolderLookup & { indexAvailable?: boolean }> {
  const holders = new Map<string, TickerHolder>();
  const failed = new Set<string>();
  const wanted = [...new Set(tickers.map(label).filter(Boolean))];
  if (!wanted.length) return { failed, holders };
  const wantedSet = new Set(wanted);

  try {
    // The ds_daily index and security_master pass 1 are independent.
    const labelReqs = [...chunked("ticker", wanted), ...chunked("unique_ticker", wanted)];
    const [index, pass1] = await Promise.all([
      readDailyTickerHolderIndex().catch(() => null),
      fetchSecurityMasterRows(labelReqs),
    ]);

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

    // Pass 1 (above): rows by ticker label (finds security_master-only holders).
    for (const req of pass1.failedRequests) for (const t of req.values) failed.add(t);
    for (const r of pass1.rows) {
      for (const l of [r.ticker, r.unique_ticker]) {
        const t = label(l);
        if (wantedSet.has(t) && r.bw_sym_id) addTo(t, r.bw_sym_id);
      }
    }

    // Pass 2: every security_master row of every candidate id (liveness +
    // windows), and every candidate's registry flag (veto before ranking).
    const allIds = [...new Set([...idsByTicker.values()].flatMap((s) => [...s]))];
    const [pass2, registry] = await Promise.all([
      fetchSecurityMasterRows(chunked("bw_sym_id", allIds)),
      fetchRegistryDeadIds(allIds),
    ]);
    const failedIds = new Set([...pass2.failedRequests.flatMap((r) => r.values), ...registry.failed]);
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
        const registryDead = extras.some((e) => e.dead === true) || registry.dead.has(id);
        const identityOpen = sm.some(smIsOpen);
        const forT = sm.filter((r) => label(r.ticker) === t || label(r.unique_ticker) === t);
        const live = !registryDead && sm.some((r) => smIsOpen(r) && label(r.ticker) === t);

        let held: string | null = null;
        for (const r of forT) {
          if (!smIsOpen(r)) held = maxDay(held, isoDay(r.valid_to ?? r.delisted_date));
        }
        for (const e of extras) held = maxDay(held, dayBefore(e.alias_valid_to));
        // An id linked to T only by a ds_daily label (display / unique /
        // listing code) gets no date: a label can lag an in-place rename, and
        // nothing says when it held T. It ranks behind every T-dated former
        // holder and answers only when no candidate is dated (CTRA: the only
        // security_master row still says COG). An OPEN identity needs more
        // than one label: an open security_master row naming T (LIVE), a
        // closed T-dated window, or ds_daily pricing it under T on BOTH its
        // display ticker and its listing code (a listing pin such as
        // BBQDH7 → BBBY.US while security_master still says BYON). A display
        // label alone can lag an in-place rename; a stale unique_ticker never
        // qualifies.
        const onDisplay = index?.byDisplayTicker.get(t)?.includes(id) ?? false;
        const onListing = index?.byListingTicker.get(t)?.includes(id) ?? false;
        const pricedUnderT = onDisplay && onListing;
        if (identityOpen && !live && held === null && !pricedUnderT) continue;

        const representative =
          forT.find(smIsOpen) ??
          sm.find(smIsOpen) ??
          [...sm].sort((a, b) => (b.valid_to ?? "").localeCompare(a.valid_to ?? ""))[0] ??
          null;
        candidates.push({
          bw_sym_id: id,
          live,
          held_through: live ? null : held,
          in_daily_store: index ? index.symbols.has(id) : null,
          label_score: (onDisplay ? 1 : 0) + (onListing ? 1 : 0),
          identity_delisted: registryDead || !identityOpen,
          security_master: representative,
        });
      }
      const winner = rankHolderCandidates(candidates);
      if (winner) holders.set(t, winner);
    }
    return { failed, holders, indexAvailable: index !== null };
  } catch (error) {
    console.error("[ticker-holder] most-recent-holder lookup failed", error);
    return { failed: new Set(wanted), holders: new Map() };
  }
}
