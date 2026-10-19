/**
 * Point-in-time security identity and corporate-action resolution (identity plan Stage 1.5).
 *
 * 1. Identity: which security an identifier meant on `held_on` (= `acquired_on`, else `as_of`).
 *    Reviewed event windows first; then dated ticker aliases (`security_aliases`); then, only for
 *    a date within the last week, today's holder of the ticker. An answer that rests on aliases
 *    or today's holder is `inferred`, never `reviewed`.
 * 2. Carry: apply the reviewed events between `acquired_on` and `as_of` (lib/identity/security-events.ts).
 * 3. Coverage: `reviewed` only when the identity came from reviewed events and every security in
 *    the answer appears in reviewed events; `unknown` when the identity is ambiguous or unavailable.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { groupNames, nameOn, tickerOn, type NameRow, type TickerSpan } from "@/lib/identity/names";
import { resolveSymbolByTicker } from "@/lib/dal/risk-engine-v3";
import {
  applyEvents,
  buildEvents,
  effectiveEvents,
  fracToString,
  historicalTickerOwner,
  isExact,
  tickerWindows,
  parseDecimal,
  type EventResolution,
  type EventRow,
  type LegRow,
  type SecurityEvent,
  type TickerWindow,
} from "@/lib/identity/security-events";

export const IDENTITY_SCHEMA_VERSION = "identity-resolve/1";
const TICKER_ALIAS_TYPES = ["TICKER", "EODHD_TICKER", "FINRA_TICKER", "LEGACY_TICKER"];
const CACHE_MS = 10 * 60 * 1000;

let cache: { at: number; events: SecurityEvent[] } | null = null;

export function _resetIdentityCache(): void {
  cache = null;
}

export async function loadEvents(): Promise<SecurityEvent[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.events;
  const admin = createAdminClient();
  const [ev, lg] = await Promise.all([
    admin.from("security_events").select("*"),
    admin.from("security_event_legs").select("*"),
  ]);
  if (ev.error || lg.error) throw new Error(`security_events read failed: ${(ev.error ?? lg.error)?.message}`);
  const events = buildEvents((ev.data ?? []) as EventRow[], (lg.data ?? []) as LegRow[]);
  cache = { at: Date.now(), events };
  return events;
}

export type ResolveRequest = {
  identifier: string;
  identifier_type: "ticker" | "bw_sym_id";
  as_of: string;
  acquired_on: string | null;
  quantity: string;
  known_as_of: string | null;
  fractions: "apply" | "exact";
  elections: Record<string, string>;
};

type IdentitySource =
  | "bw_sym_id"
  | "reviewed_event_window"
  | "reviewed_event_before_first"
  | "ticker_alias_window"
  | "security_master_ticker"
  | "current_holder";

type MasterRow = { bw_sym_id: string; cik: string | null; merged_into: string | null };

async function masterRows(ids: string[]): Promise<Map<string, MasterRow>> {
  const out = new Map<string, MasterRow>();
  if (!ids.length) return out;
  const { data, error } = await createAdminClient()
    .from("security_master")
    .select("bw_sym_id, cik, merged_into")
    .in("bw_sym_id", ids);
  if (error) throw new Error(`security_master read failed: ${error.message}`);
  for (const r of (data ?? []) as MasterRow[]) out.set(r.bw_sym_id, r);
  return out;
}

// Dated names (issuer legal name, share class, fund name) for ids; empty when the table is absent or unreadable.
async function datedNames(ids: string[]): Promise<Map<string, NameRow[]>> {
  if (!ids.length) return new Map();
  const { data, error } = await createAdminClient()
    .from("security_name_history")
    .select("bw_sym_id, kind, name, valid_from, valid_to, source")
    .in("bw_sym_id", ids);
  return error ? new Map() : groupNames((data ?? []) as NameRow[]);
}

type Listing = { listed_on: string | null; listed_on_or_before: string | null; basis: string };

/** Listing dates (empty on a read error: the answer then simply carries none). */
async function listings(ids: string[]): Promise<Map<string, Listing>> {
  if (!ids.length) return new Map();
  const { data, error } = await createAdminClient()
    .from("security_listing")
    .select("bw_sym_id, listed_on, listed_on_or_before, basis")
    .in("bw_sym_id", ids);
  if (error) return new Map();
  return new Map(((data ?? []) as Array<Listing & { bw_sym_id: string }>).map(({ bw_sym_id, ...l }) => [bw_sym_id, l]));
}

/** Ticker aliases of these ids, as spans (empty on a read error: callers fall back to today's ticker). */
async function aliasSpans(ids: string[]): Promise<TickerSpan[]> {
  if (!ids.length) return [];
  const { data, error } = await createAdminClient()
    .from("security_aliases")
    .select("bw_sym_id, alias_value, valid_from, valid_to")
    .in("bw_sym_id", ids)
    .in("alias_type", TICKER_ALIAS_TYPES);
  if (error) return [];
  return ((data ?? []) as Array<{ bw_sym_id: string; alias_value: string; valid_from: string | null; valid_to: string | null }>)
    .map((r) => ({ bw_sym_id: r.bw_sym_id, ticker: r.alias_value, start: r.valid_from, end: r.valid_to }));
}

/**
 * Dated ticker aliases on `heldOn`. Aliases whose id is not in the security master (orphans left by
 * the legacy symbol map) are dropped and reported; merged ids are followed to their survivor.
 */
async function aliasCandidates(
  ticker: string,
  heldOn: string,
): Promise<{ ids: string[]; excluded: Array<{ bw_sym_id: string; reason: string }>; master: Map<string, MasterRow> }> {
  const { data, error } = await createAdminClient()
    .from("security_aliases")
    .select("bw_sym_id, valid_from, valid_to")
    .eq("alias_value", ticker)
    .in("alias_type", TICKER_ALIAS_TYPES);
  if (error) throw new Error(`security_aliases read failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ bw_sym_id: string; valid_from: string | null; valid_to: string | null }>;
  const raw = [
    ...new Set(
      rows
        .filter((r) => (!r.valid_from || r.valid_from <= heldOn) && (!r.valid_to || heldOn < r.valid_to))
        .map((r) => r.bw_sym_id),
    ),
  ];
  const master = await masterRows(raw);
  const excluded: Array<{ bw_sym_id: string; reason: string }> = [];
  const ids = new Set<string>();
  for (const id of raw) {
    const m = master.get(id);
    if (!m) excluded.push({ bw_sym_id: id, reason: "alias id not in the security master" });
    else if (m.merged_into) {
      excluded.push({ bw_sym_id: id, reason: `merged into ${m.merged_into}` });
      ids.add(m.merged_into);
    } else ids.add(id);
  }
  const extra = await masterRows([...ids].filter((i) => !master.has(i)));
  for (const [k, v] of extra) master.set(k, v);
  return { ids: [...ids].sort(), excluded, master };
}

/** True when reviewed events give this security windows for the ticker and none covers heldOn. */
function contradictedBy(windows: TickerWindow[], id: string, heldOn: string): boolean {
  const mine = windows.filter((w) => w.bw_sym_id === id);
  return mine.length > 0 && !mine.some((w) => (w.start === null || w.start <= heldOn) && (w.end === null || heldOn < w.end));
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

type IdentityAnswer = {
  status: "resolved" | "ambiguous" | "unavailable";
  bw_sym_id: string | null;
  source: IdentitySource | null;
  candidates: string[];
  duplicate_records: string[];
  excluded_candidates: Array<{ bw_sym_id: string; reason: string }>;
};

async function resolveIdentity(req: ResolveRequest, events: SecurityEvent[], heldOn: string): Promise<IdentityAnswer> {
  const base = { duplicate_records: [] as string[], excluded_candidates: [] as Array<{ bw_sym_id: string; reason: string }> };
  if (req.identifier_type === "bw_sym_id") {
    return { ...base, status: "resolved", bw_sym_id: req.identifier, source: "bw_sym_id", candidates: [req.identifier] };
  }
  const ticker = req.identifier.trim().toUpperCase();
  const own = historicalTickerOwner(events, ticker, heldOn, req.known_as_of);
  if (own.status === "reviewed") {
    return { ...base, status: "resolved", bw_sym_id: own.bw_sym_id, source: "reviewed_event_window", candidates: own.candidates };
  }
  if (own.status === "ambiguous") return { ...base, status: "ambiguous", bw_sym_id: null, source: null, candidates: own.candidates };
  const al = await aliasCandidates(ticker, heldOn);
  // Reviewed events outrank aliases: a security whose reviewed use of this ticker does not cover
  // heldOn (FB left Meta on 2022-06-09) cannot be the holder, whatever an undated alias says.
  const windows = tickerWindows(events, req.known_as_of).filter((w) => w.ticker === ticker);
  const contradicted = al.ids.filter((id) => contradictedBy(windows, id, heldOn));
  for (const id of contradicted) {
    const ends = windows.filter((w) => w.bw_sym_id === id && w.end).map((w) => w.end).join(", ");
    al.excluded.push({ bw_sym_id: id, reason: `reviewed events end this security's use of ${ticker} (${ends})` });
  }
  al.ids = al.ids.filter((id) => !contradicted.includes(id));
  base.excluded_candidates = al.excluded;
  if (own.status === "before_first_event") {
    const chosen = own.bw_sym_id!;
    const others = al.ids.filter((a) => a !== chosen);
    if (!others.length) {
      return { ...base, status: "resolved", bw_sym_id: chosen, source: "reviewed_event_before_first", candidates: [chosen] };
    }
    // Duplicate records of the same issuer (same CIK) as the reviewed id: the reviewed id stands.
    const cik = (await masterRows([chosen])).get(chosen)?.cik ?? al.master.get(chosen)?.cik ?? null;
    if (cik && others.every((o) => al.master.get(o)?.cik === cik)) {
      return { ...base, status: "resolved", bw_sym_id: chosen, source: "reviewed_event_before_first", candidates: [chosen], duplicate_records: others };
    }
    return { ...base, status: "ambiguous", bw_sym_id: null, source: null, candidates: [...new Set([chosen, ...al.ids])].sort() };
  }
  if (al.ids.length === 1) return { ...base, status: "resolved", bw_sym_id: al.ids[0], source: "ticker_alias_window", candidates: al.ids };
  if (al.ids.length > 1) return { ...base, status: "ambiguous", bw_sym_id: null, source: null, candidates: al.ids };
  // Security-master rows whose own ticker and validity cover heldOn (the ETF that took FB in 2025).
  const { data: smRows, error: smErr } = await createAdminClient()
    .from("security_master")
    .select("bw_sym_id, valid_from, valid_to, merged_into")
    .eq("ticker", ticker);
  if (smErr) throw new Error(`security_master read failed: ${smErr.message}`);
  const sm = ((smRows ?? []) as Array<{ bw_sym_id: string; valid_from: string | null; valid_to: string | null; merged_into: string | null }>)
    .filter((r) => !r.merged_into && (!r.valid_from || r.valid_from <= heldOn) && (!r.valid_to || heldOn < r.valid_to))
    .map((r) => r.bw_sym_id)
    .filter((id) => !contradictedBy(windows, id, heldOn));
  const smIds = [...new Set(sm)].sort();
  if (smIds.length === 1) return { ...base, status: "resolved", bw_sym_id: smIds[0], source: "security_master_ticker", candidates: smIds };
  if (smIds.length > 1) return { ...base, status: "ambiguous", bw_sym_id: null, source: null, candidates: smIds };
  const today = new Date().toISOString().slice(0, 10);
  if (daysBetween(heldOn, today) <= 7) {
    const holder = await resolveSymbolByTicker(ticker);
    const id = holder?.symbol;
    if (id && !contradictedBy(windows, id, heldOn)) {
      return { ...base, status: "resolved", bw_sym_id: id, source: "current_holder", candidates: [id] };
    }
  }
  return { ...base, status: "unavailable", bw_sym_id: null, source: null, candidates: [] };
}

async function describe(ids: string[]): Promise<Map<string, { ticker: string | null; name: string | null }>> {
  const out = new Map<string, { ticker: string | null; name: string | null }>();
  if (!ids.length) return out;
  const { data } = await createAdminClient().from("symbols").select("symbol, ticker, name").in("symbol", ids);
  for (const r of (data ?? []) as Array<{ symbol: string; ticker: string | null; name: string | null }>) {
    out.set(r.symbol, { ticker: r.ticker, name: r.name });
  }
  // Ids outside the modelled registry (the ETF on FB, delisted lines): name them from the security master.
  const missing = ids.filter((id) => !out.get(id)?.name);
  if (missing.length) {
    const { data: sm } = await createAdminClient()
      .from("security_master")
      .select("bw_sym_id, ticker, company_name")
      .in("bw_sym_id", missing);
    for (const r of (sm ?? []) as Array<{ bw_sym_id: string; ticker: string | null; company_name: string | null }>) {
      const prev = out.get(r.bw_sym_id);
      out.set(r.bw_sym_id, { ticker: prev?.ticker ?? r.ticker, name: prev?.name ?? r.company_name });
    }
  }
  return out;
}

const num = (f: { n: bigint; d: bigint }) => fracToString(f);

export async function resolveSecurityIdentity(req: ResolveRequest) {
  const events = await loadEvents();
  const heldOn = req.acquired_on ?? req.as_of;
  const identity = await resolveIdentity(req, events, heldOn);
  const reviewedIds = new Set(
    effectiveEvents(events, req.known_as_of).flatMap((e) => [...e.inputs, ...e.outputs].map((l) => l.bw_sym_id).filter(Boolean) as string[]),
  );

  let carry: EventResolution | null = null;
  if (identity.status === "resolved" && req.acquired_on) {
    carry = applyEvents(events, {
      bw_sym_id: identity.bw_sym_id!,
      quantity: parseDecimal(req.quantity),
      acquired_on: req.acquired_on,
      as_of: req.as_of,
      ticker: req.identifier_type === "ticker" ? req.identifier : "",
      known_as_of: req.known_as_of,
      elections: req.elections,
      fractions: req.fractions,
    });
  }

  const resultIds = carry ? carry.holdings.map((h) => h.bw_sym_id) : identity.bw_sym_id ? [identity.bw_sym_id] : [];
  const nameIds = [...new Set([...resultIds, ...identity.candidates])];
  const [names, dated, aliases, listed] = await Promise.all([
    describe(nameIds), datedNames(nameIds), aliasSpans(nameIds), listings(nameIds),
  ]);
  // First trading date (listed_on), or a lower bound when the security trades from the start of the price data.
  const listing = (id: string) => {
    const l = listed.get(id);
    if (!l) return {};
    return l.listed_on ? { listed_on: l.listed_on, listed_on_basis: "first_trading_date" } : { listed_on_or_before: l.listed_on_or_before };
  };
  const reviewedSpans: TickerSpan[] = tickerWindows(events, req.known_as_of);
  // The ticker a security traded under on a date, falling back to today's; current_ticker only when it differs.
  const tick = (id: string, on: string, fallback: string | null = null) => {
    const current = names.get(id)?.ticker ?? fallback;
    const d = tickerOn(reviewedSpans, aliases, id, on);
    return { ticker: d ?? current, ...(d && current && d !== current ? { current_ticker: current } : {}) };
  };
  // The name a security carried on a date, falling back to today's name; current_name only when it differs.
  const label = (id: string, on: string) => {
    const d = nameOn(dated.get(id), on);
    const current = names.get(id)?.name ?? null;
    return {
      name: d?.name ?? current,
      ...(d?.share_class ? { share_class: d.share_class } : {}),
      ...(d && current && current !== d.name ? { current_name: current } : {}),
      ...listing(id),
    };
  };
  const byId = new Map(events.map((e) => [e.event_id, e]));
  const applied = (carry?.applied_event_ids ?? []).map((id) => byId.get(id)!).filter(Boolean);

  const eventSourced = identity.source === "reviewed_event_window" || identity.source === "reviewed_event_before_first";
  const coverage =
    identity.status !== "resolved" || carry?.status === "unknown"
      ? "unknown"
      : eventSourced && resultIds.every((id) => reviewedIds.has(id))
        ? "reviewed"
        : "inferred";

  const holdings = carry
    ? carry.holdings.map((h) => ({
        bw_sym_id: h.bw_sym_id,
        ...tick(h.bw_sym_id, req.as_of, h.ticker ?? null),
        ...label(h.bw_sym_id, req.as_of),
        instrument: h.instrument || null,
        quantity: num(h.quantity),
        quantity_exact: isExact(h.quantity),
      }))
    : identity.bw_sym_id
      ? [{ bw_sym_id: identity.bw_sym_id, ...tick(identity.bw_sym_id, req.as_of), ...label(identity.bw_sym_id, req.as_of), quantity: req.quantity, quantity_exact: true }]
      : [];

  const status =
    identity.status !== "resolved" ? identity.status : carry && carry.unresolved.length ? "unsupported" : "resolved";

  return {
    schema_version: IDENTITY_SCHEMA_VERSION,
    request: req,
    status,
    coverage,
    identity: {
      status: identity.status,
      source: identity.source,
      bw_sym_id: identity.bw_sym_id,
      ...(identity.bw_sym_id ? label(identity.bw_sym_id, heldOn) : {}),
      held_on: heldOn,
      candidates: identity.candidates.map((id) => ({ bw_sym_id: id, ...tick(id, heldOn), ...label(id, heldOn) })),
      duplicate_records: identity.duplicate_records,
      excluded_candidates: identity.excluded_candidates,
    },
    result: {
      outcome: carry?.status ?? (identity.status === "resolved" ? "held" : "unknown"),
      holdings,
      cash: (carry?.cash ?? []).map((c) => ({
        event_id: c.event_id,
        currency: c.currency || null,
        amount: c.amount ? num(c.amount) : null,
        in_lieu_of_units: c.in_lieu_of_units ? num(c.in_lieu_of_units) : null,
        in_lieu_of: c.in_lieu_of,
      })),
      no_equity_successor: carry ? carry.holdings.length === 0 && (carry.cash.length > 0 || carry.cancelled_by.length > 0) : false,
      cancelled_by: carry?.cancelled_by ?? [],
      unresolved: carry?.unresolved ?? [],
      fractional_notes: carry?.fractional_notes ?? [],
    },
    events: applied.map((e) => ({
      event_id: e.event_id,
      event_type: e.event_type,
      effective_date: e.effective_date,
      legal_effective_date: e.legal_effective_date,
      record_date: e.record_date,
      ex_date: e.ex_date,
      knowledge_date: e.knowledge_date,
      inputs: e.inputs.map((l) => ({ bw_sym_id: l.bw_sym_id, ticker: l.ticker, instrument: l.instrument })),
      outputs: e.outputs.map((o) => ({
        outcome: o.outcome,
        bw_sym_id: o.bw_sym_id,
        ticker: o.ticker || null,
        instrument: o.instrument || null,
        instrument_changed: instrumentChanged(e, o),
        ratio: o.ratio ? num(o.ratio) : null,
        cash_per_unit: o.cash_per_unit ? num(o.cash_per_unit) : null,
        currency: o.currency || null,
        fractional_treatment: o.fractional_treatment || null,
        package: o.package || null,
      })),
      source: { form: e.source_form, accession: e.source_accession, url: e.citation },
      evidence: e.evidence,
    })),
    explanation: explain(req, identity, carry, applied, coverage),
  };
}

// A continuing output whose instrument differs from its input leg's (e.g. ADS -> ordinary share): the
// RiskModels id and ticker continue, but the listed instrument and its identifiers changed.
function instrumentChanged(e: SecurityEvent, o: SecurityEvent["outputs"][number]): boolean {
  if (o.outcome !== "continues" || !o.instrument) return false;
  const src = e.inputs.find((l) => l.leg === o.input_leg) ?? (e.inputs.length === 1 ? e.inputs[0] : undefined);
  return !!src?.instrument && src.instrument.trim().toLowerCase() !== o.instrument.trim().toLowerCase();
}

function explain(
  req: ResolveRequest,
  identity: IdentityAnswer,
  carry: EventResolution | null,
  applied: SecurityEvent[],
  coverage: string,
): string {
  const who = `${req.identifier} on ${req.acquired_on ?? req.as_of}`;
  if (identity.status === "ambiguous") return `${who} matches more than one security (${identity.candidates.join(", ")}); supply bw_sym_id.`;
  if (identity.status === "unavailable") return `No reviewed or dated record says which security ${who} was. Not guessed.`;
  const src = {
    bw_sym_id: "given directly",
    reviewed_event_window: "from reviewed corporate-action events",
    reviewed_event_before_first: "from reviewed events (date precedes the first reviewed event)",
    ticker_alias_window: "from dated ticker aliases (not reviewed)",
    security_master_ticker: "from the security master's current ticker and validity (not reviewed)",
    current_holder: "from today's holder of the ticker (not reviewed)",
  }[identity.source!];
  let s = `${who} is ${identity.bw_sym_id}, ${src}.`;
  if (identity.duplicate_records.length) s += ` Duplicate records of the same issuer: ${identity.duplicate_records.join(", ")}.`;
  if (carry) {
    if (!applied.length) s += ` No reviewed corporate action through ${req.as_of}.`;
    else s += ` Applied: ${applied.map((e) => `${e.event_type} ${e.effective_date} (${e.event_id})`).join("; ")}.`;
    const changed = applied.flatMap((e) => e.outputs.filter((o) => instrumentChanged(e, o)).map((o) => {
      const src = e.inputs.find((l) => l.leg === o.input_leg) ?? e.inputs[0];
      return `${e.event_id}: ${src.instrument} became ${o.instrument} (same RiskModels id ${o.bw_sym_id}; the listed instrument and its identifiers changed)`;
    }));
    if (changed.length) s += ` Instrument change: ${changed.join("; ")}.`;
    if (carry.status === "cashed_out") s += " Converted to cash; no equity successor.";
    if (carry.status === "cancelled") s += " Cancelled with no consideration; no equity successor.";
    if (carry.unresolved.length) s += ` Unresolved: ${carry.unresolved.join("; ")}.`;
  }
  return `${s} Coverage: ${coverage}.`;
}
