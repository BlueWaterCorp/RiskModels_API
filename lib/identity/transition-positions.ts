/**
 * Position transitions for portfolio routes (ERM3-73): point-in-time identity, then the reviewed
 * corporate-action events between the date a book was recorded (`held_on`) and the model date (`as_of`).
 *
 * Portfolio routes price a book through today's symbol registry, keyed by today's ticker. A book
 * recorded on a past date can name a ticker that has since been reused (SPCX was an ETF until
 * 2026-04-07 and is SpaceX from 2026-06-12) or a security whose ticker, instrument or quantity changed
 * (SOS ADS -> ordinary, IXHL 4 ADS -> 1 Delaware share). This step rewrites such a position to the
 * ticker under which today's registry holds the security it became, and reports every rewrite with
 * its event ids and exact ratios.
 *
 * Tickers that resolve on the held date follow the original reviewed-event behavior. For an
 * explicitly dated book, only an unresolved ticker is mapped from its current security back to the
 * held date, and only a dated security-master row can prove that the security existed then.
 * Positions carry dollar values, which a ratio does not change; a split into several securities
 * (spin-off) cannot be priced here and is reported `unsupported` with the position left as submitted.
 * A position that cannot be mapped safely, became cash or was cancelled is dropped and reported.
 */
import { loadEvents, type IdentityAnswer, type IdentitySource } from "@/lib/identity/resolve";
import {
  applyEvents,
  effectiveEvents,
  fracToRatio,
  fracToString,
  parseDecimal,
  tickerWindows,
  type SecurityEvent,
  type TickerWindow,
} from "@/lib/identity/security-events";
import { createAdminClient } from "@/lib/supabase/admin";

export type TransitionStepOut = {
  event_id: string;
  event_type: string;
  effective_date: string;
  from_bw_sym_id: string;
  from_ticker: string;
  from_instrument: string | null;
  outcome: string;
  to_bw_sym_id: string | null;
  to_ticker: string | null;
  to_instrument: string | null;
  /** Exact `numerator/denominator` units of the output per unit of the input. */
  ratio: string | null;
  source: { form: string; accession: string | null; url: string };
};

export type PositionTransition = {
  submitted_ticker: string;
  held_on: string;
  as_of: string;
  /** rewritten: identity or pricing ticker changed; carried: same ticker, events applied (e.g. ADS -> ordinary). */
  status: "rewritten" | "carried" | "dropped" | "unsupported" | "unresolved";
  identity_source: IdentitySource | null;
  source_bw_sym_id: string | null;
  bw_sym_id: string | null;
  ticker: string | null;
  /** Every ticker label for the resolved security whose half-open window covers held_on. */
  held_date_tickers: string[];
  /** Present only when held_date_tickers has exactly one label. */
  held_date_ticker?: string;
  outcome: string;
  event_ids: string[];
  steps: TransitionStepOut[];
  detail: string;
};

export type TransitionResult<T> = { positions: T[]; transitions: PositionTransition[] };

const TICKER_ALIAS_TYPES = ["TICKER", "EODHD_TICKER", "FINRA_TICKER", "LEGACY_TICKER"];

type AliasRow = {
  bw_sym_id: string;
  alias_type: string;
  alias_value: string;
  valid_from: string | null;
  valid_to: string | null;
};
type MasterRow = {
  bw_sym_id: string;
  ticker: string | null;
  company_name: string | null;
  cik: string | null;
  valid_from: string | null;
  valid_to: string | null;
  merged_into: string | null;
};
type SymbolRow = { symbol: string; ticker: string | null; name: string | null };
type TransitionEvidence = {
  aliases: AliasRow[];
  masters: MasterRow[];
  symbols: SymbolRow[];
  windows: TickerWindow[];
};

const covers = (row: { valid_from: string | null; valid_to: string | null }, date: string) =>
  (!row.valid_from || row.valid_from.slice(0, 10) <= date) && (!row.valid_to || date < row.valid_to.slice(0, 10));

const baseIdentity = { duplicate_records: [] as string[], excluded_candidates: [] as Array<{ bw_sym_id: string; reason: string }> };

const postgrestValue = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** One batched read per identity table for the request. */
async function transitionEvidence(tickers: string[], events: SecurityEvent[], knownAsOf: string | null): Promise<TransitionEvidence> {
  const eventTickers = effectiveEvents(events, knownAsOf)
    .flatMap((e) => [...e.inputs, ...e.outputs].map((l) => l.ticker).filter(Boolean));
  const lookupTickers = [...new Set([...tickers, ...eventTickers])];
  const admin = createAdminClient();
  const [al, sy] = await Promise.all([
    admin.from("security_aliases")
      .select("bw_sym_id, alias_type, alias_value, valid_from, valid_to")
      .in("alias_value", lookupTickers)
      .in("alias_type", TICKER_ALIAS_TYPES),
    admin.from("symbols").select("symbol, ticker, name").in("ticker", lookupTickers),
  ]);
  if (al.error) throw new Error(`security_aliases read failed: ${al.error.message}`);
  if (sy.error) throw new Error(`symbols read failed: ${sy.error.message}`);
  const aliases = (al.data ?? []) as AliasRow[];
  const symbols = (sy.data ?? []) as SymbolRow[];
  const ids = [...new Set([...aliases.map((r) => r.bw_sym_id), ...symbols.map((r) => r.symbol)])];
  const masterFilters = [
    ids.length ? `bw_sym_id.in.(${ids.map(postgrestValue).join(",")})` : null,
    `ticker.in.(${lookupTickers.map(postgrestValue).join(",")})`,
  ].filter((value): value is string => value !== null);
  const sm = await admin.from("security_master")
    .select("bw_sym_id, ticker, company_name, cik, valid_from, valid_to, merged_into")
    .or(masterFilters.join(","));
  if (sm.error) throw new Error(`security_master read failed: ${sm.error.message}`);
  return { aliases, masters: (sm.data ?? []) as MasterRow[], symbols, windows: tickerWindows(events, knownAsOf) };
}

function contradictedBy(windows: TickerWindow[], id: string, heldOn: string): boolean {
  const mine = windows.filter((w) => w.bw_sym_id === id);
  return mine.length > 0 && !mine.some((w) => (w.start === null || w.start <= heldOn) && (w.end === null || heldOn < w.end));
}

/** Batched equivalent of the ticker branch of resolveIdentity for transition requests. */
function resolveFromEvidence(ticker: string, heldOn: string, evidence: TransitionEvidence): IdentityAnswer {
  const own = historicalTickerOwnerFromWindows(evidence.windows, ticker, heldOn);
  if (own.status === "reviewed") {
    return { ...baseIdentity, status: "resolved", bw_sym_id: own.bw_sym_id, source: "reviewed_event_window", candidates: own.candidates };
  }
  if (own.status === "ambiguous") {
    return { ...baseIdentity, status: "ambiguous", bw_sym_id: null, source: null, candidates: own.candidates };
  }
  const masterById = new Map(evidence.masters.map((r) => [r.bw_sym_id, r]));
  const excluded: Array<{ bw_sym_id: string; reason: string }> = [];
  const aliasIds = new Set<string>();
  for (const row of evidence.aliases.filter((r) => r.alias_value.trim().toUpperCase() === ticker && covers(r, heldOn))) {
    const master = masterById.get(row.bw_sym_id);
    if (!master) excluded.push({ bw_sym_id: row.bw_sym_id, reason: "alias id not in the security master" });
    else if (master.merged_into) excluded.push({ bw_sym_id: row.bw_sym_id, reason: `merged into ${master.merged_into}` });
    else if (!covers(master, heldOn)) excluded.push({ bw_sym_id: row.bw_sym_id, reason: "security master row not valid on held date" });
    else aliasIds.add(row.bw_sym_id);
  }
  const contradicted = [...aliasIds].filter((id) => contradictedBy(evidence.windows, id, heldOn));
  for (const id of contradicted) aliasIds.delete(id);
  const ids = [...aliasIds].sort();
  const common = { ...baseIdentity, excluded_candidates: excluded };
  if (own.status === "before_first_event") {
    const chosen = own.bw_sym_id!;
    const others = ids.filter((id) => id !== chosen);
    const chosenCik = masterById.get(chosen)?.cik ?? null;
    if (!others.length || (chosenCik && others.every((id) => masterById.get(id)?.cik === chosenCik))) {
      return { ...common, status: "resolved", bw_sym_id: chosen, source: "reviewed_event_before_first", candidates: [chosen], duplicate_records: others };
    }
    return { ...common, status: "ambiguous", bw_sym_id: null, source: null, candidates: [...new Set([chosen, ...ids])].sort() };
  }
  if (ids.length === 1) return { ...common, status: "resolved", bw_sym_id: ids[0], source: "ticker_alias_window", candidates: ids };
  if (ids.length > 1) return { ...common, status: "ambiguous", bw_sym_id: null, source: null, candidates: ids };
  const masterIds = evidence.masters
    .filter((r) => !r.merged_into && r.ticker?.trim().toUpperCase() === ticker && covers(r, heldOn))
    .map((r) => r.bw_sym_id)
    .filter((id) => !contradictedBy(evidence.windows, id, heldOn));
  const uniqueMasterIds = [...new Set(masterIds)].sort();
  if (uniqueMasterIds.length === 1) return { ...common, status: "resolved", bw_sym_id: uniqueMasterIds[0], source: "security_master_ticker", candidates: uniqueMasterIds };
  if (uniqueMasterIds.length > 1) return { ...common, status: "ambiguous", bw_sym_id: null, source: null, candidates: uniqueMasterIds };
  return { ...common, status: "unavailable", bw_sym_id: null, source: null, candidates: [] };
}

function historicalTickerOwnerFromWindows(windows: TickerWindow[], ticker: string, heldOn: string) {
  const hits = windows.filter((w) => w.ticker === ticker && (w.start === null || w.start <= heldOn) && (w.end === null || heldOn < w.end));
  const ids = [...new Set(hits.map((w) => w.bw_sym_id))].sort();
  if (!ids.length) return { status: "none" as const, bw_sym_id: null, candidates: [] as string[] };
  if (ids.length > 1) return { status: "ambiguous" as const, bw_sym_id: null, candidates: ids };
  return { status: hits.every((w) => w.start !== null) ? "reviewed" as const : "before_first_event" as const, bw_sym_id: ids[0], candidates: ids };
}

function heldLabels(id: string, heldOn: string, evidence: TransitionEvidence): string[] {
  const aliases = evidence.aliases
    .filter((r) => r.bw_sym_id === id && covers(r, heldOn))
    .map((r) => r.alias_value.trim().toUpperCase());
  const reviewed = evidence.windows
    .filter((w) => w.bw_sym_id === id && (w.start === null || w.start <= heldOn) && (w.end === null || heldOn < w.end))
    .map((w) => w.ticker);
  return [...new Set([...aliases, ...reviewed].filter(Boolean))].sort();
}

function labelFields(id: string | null, heldOn: string, evidence: TransitionEvidence) {
  const held_date_tickers = id ? heldLabels(id, heldOn, evidence) : [];
  return {
    held_date_tickers,
    ...(held_date_tickers.length === 1 ? { held_date_ticker: held_date_tickers[0] } : {}),
  };
}

function registryTicker(id: string, evidence: TransitionEvidence): string | null {
  if (evidence.masters.find((r) => r.bw_sym_id === id)?.merged_into) return null;
  return evidence.symbols.find((r) => r.symbol === id)?.ticker
    ?? evidence.masters.find((r) => r.bw_sym_id === id)?.ticker
    ?? null;
}

function currentIdentity(ticker: string, asOf: string, evidence: TransitionEvidence): IdentityAnswer {
  const masterById = new Map(evidence.masters.map((r) => [r.bw_sym_id, r]));
  const excluded: Array<{ bw_sym_id: string; reason: string }> = [];
  const eligible = (id: string, source: string) => {
    const master = masterById.get(id);
    if (!master) {
      excluded.push({ bw_sym_id: id, reason: `${source} id not in the security master` });
      return false;
    }
    if (master.merged_into) {
      excluded.push({ bw_sym_id: id, reason: `merged into ${master.merged_into}` });
      return false;
    }
    if (!covers(master, asOf)) {
      excluded.push({ bw_sym_id: id, reason: "security master row not valid on current date" });
      return false;
    }
    return !contradictedBy(evidence.windows, id, asOf);
  };
  const symbolIds = [...new Set(evidence.symbols
    .filter((r) => r.ticker?.trim().toUpperCase() === ticker && eligible(r.symbol, "symbol"))
    .map((r) => r.symbol))].sort();
  const aliasIds = [...new Set(evidence.aliases
    .filter((r) => r.alias_value.trim().toUpperCase() === ticker && covers(r, asOf) && eligible(r.bw_sym_id, "alias"))
    .map((r) => r.bw_sym_id))].sort();
  const masterIds = [...new Set(evidence.masters
    .filter((r) => r.ticker?.trim().toUpperCase() === ticker && eligible(r.bw_sym_id, "master"))
    .map((r) => r.bw_sym_id))].sort();
  const ids = [...new Set([...symbolIds, ...aliasIds, ...masterIds])].sort();
  const common = { ...baseIdentity, excluded_candidates: excluded };
  if (ids.length === 1) {
    const source = symbolIds.includes(ids[0]) ? "current_holder"
      : aliasIds.includes(ids[0]) ? "ticker_alias_window"
        : "security_master_ticker";
    return { ...common, status: "resolved", bw_sym_id: ids[0], source, candidates: ids };
  }
  return { ...common, status: ids.length ? "ambiguous" : "unavailable", bw_sym_id: null, source: null, candidates: ids };
}

function retiredBeforeHeldDate(ticker: string, heldOn: string, evidence: TransitionEvidence): boolean {
  const mine = evidence.windows.filter((w) => w.ticker === ticker);
  const endedOwners = new Set(mine.filter((w) => w.end !== null && w.end <= heldOn).map((w) => w.bw_sym_id));
  const explicitlyRetired = evidence.aliases.some((r) =>
    r.alias_value.trim().toUpperCase() === ticker
    && endedOwners.has(r.bw_sym_id)
    && r.valid_to !== null
    && r.valid_to.slice(0, 10) <= heldOn,
  );
  return explicitlyRetired && !mine.some((w) => (w.start === null || w.start <= heldOn) && (w.end === null || heldOn < w.end));
}

export async function transitionPositions<T extends { ticker: string }>(
  positions: T[],
  opts: {
    heldOn: string;
    asOf: string;
    knownAsOf?: string | null;
    mapCurrentTickerToHeldDate?: boolean;
    /** Internal: heldTickerWindows reuses one request-level evidence batch for every time slice. */
    preloaded?: { events: SecurityEvent[]; evidence: TransitionEvidence };
  },
): Promise<TransitionResult<T>> {
  const { heldOn, asOf } = opts;
  if (heldOn > asOf) throw new Error(`positions_as_of ${heldOn} is after as_of ${asOf}`);
  const events = opts.preloaded?.events ?? await loadEvents();
  const eff = effectiveEvents(events, opts.knownAsOf ?? null);
  const eventTickers = new Set(eff.flatMap((e) => [...e.inputs, ...e.outputs].map((l) => l.ticker).filter(Boolean)));
  const byId = new Map(events.map((e) => [e.event_id, e]));
  const submittedTickers = [...new Set(positions.map((p) => p.ticker.trim().toUpperCase()))];
  const touched = (opts.mapCurrentTickerToHeldDate ?? true) ? submittedTickers : submittedTickers.filter((t) => eventTickers.has(t));
  if (!touched.length) return { positions, transitions: [] };
  const evidence = opts.preloaded?.evidence ?? await transitionEvidence(touched, events, opts.knownAsOf ?? null);

  // ticker -> what it became (null: leave the position as submitted)
  const plan = new Map<string, { ticker: string | null; drop: boolean; transition: PositionTransition }>();
  for (const t of touched) {
    const identity = resolveFromEvidence(t, heldOn, evidence);
    const base = {
      submitted_ticker: t, held_on: heldOn, as_of: asOf, identity_source: identity.source,
      source_bw_sym_id: identity.bw_sym_id, ...labelFields(identity.bw_sym_id, heldOn, evidence),
    };
    if (retiredBeforeHeldDate(t, heldOn, evidence)) {
      plan.set(t, {
        ticker: null, drop: true,
        transition: {
          ...base, identity_source: null, source_bw_sym_id: null, held_date_tickers: [],
          status: "dropped", bw_sym_id: null, ticker: null, outcome: "submitted_ticker_retired",
          event_ids: [], steps: [],
          detail: `${t} was retired before ${heldOn}. Position dropped rather than assigned to a later holder of the ticker.`,
        },
      });
      continue;
    }
    if (identity.status !== "resolved" || !identity.bw_sym_id) {
      if (opts.mapCurrentTickerToHeldDate ?? true) {
        const current = currentIdentity(t, asOf, evidence);
        if (current.status !== "resolved" || !current.bw_sym_id) {
          plan.set(t, {
            ticker: null, drop: true,
            transition: {
              ...base, identity_source: current.source, source_bw_sym_id: current.bw_sym_id,
              ...labelFields(current.bw_sym_id, heldOn, evidence),
              status: "dropped", bw_sym_id: null, ticker: null, outcome: `current_identity_${current.status}`,
              event_ids: [], steps: [],
              detail: `${t} on ${heldOn}: identity ${identity.status}; ${t} on ${asOf}: identity ${current.status}. Position dropped to avoid pricing an unverified security.`,
            },
          });
          continue;
        }
        const masterProof = evidence.masters.some((r) =>
          r.bw_sym_id === current.bw_sym_id
          && !r.merged_into
          && r.valid_from !== null
          && r.valid_from.slice(0, 10) <= heldOn
          && (!r.valid_to || heldOn < r.valid_to.slice(0, 10)),
        );
        if (!masterProof) {
          plan.set(t, {
            ticker: null, drop: true,
            transition: {
              ...base, identity_source: current.source, source_bw_sym_id: current.bw_sym_id,
              ...labelFields(current.bw_sym_id, heldOn, evidence),
              status: "dropped", bw_sym_id: null, ticker: null, outcome: "current_security_not_valid_on_held_date",
              event_ids: [], steps: [],
              detail: `${t} on ${asOf} resolves to ${current.bw_sym_id}, but no dated security-master row proves that security existed on ${heldOn}. Position dropped.`,
            },
          });
          continue;
        }
        const registry = registryTicker(current.bw_sym_id, evidence) ?? t;
        const labels = heldLabels(current.bw_sym_id, heldOn, evidence);
        plan.set(t, {
          ticker: registry, drop: false,
          transition: {
            ...base, identity_source: current.source, source_bw_sym_id: current.bw_sym_id,
            ...labelFields(current.bw_sym_id, heldOn, evidence),
            status: "rewritten", bw_sym_id: current.bw_sym_id, ticker: registry,
            outcome: "current_ticker_mapped_to_held_date", event_ids: [], steps: [],
            detail: `${t} submitted for ${heldOn} -> ${current.bw_sym_id}; held-date ticker labels: ${labels.join(", ") || "none"}. Priced as ${registry}.`,
          },
        });
        continue;
      }
      plan.set(t, {
        ticker: null, drop: false,
        transition: { ...base, status: "unresolved", bw_sym_id: null, ticker: null, outcome: identity.status, event_ids: [], steps: [],
          detail: `${t} on ${heldOn}: identity ${identity.status}${identity.candidates.length ? ` (${identity.candidates.join(", ")})` : ""}; position left as submitted.` },
      });
      continue;
    }
    if (!eventTickers.has(t)) continue;
    const carry = applyEvents(events, {
      bw_sym_id: identity.bw_sym_id, quantity: parseDecimal("1"), acquired_on: heldOn, as_of: asOf, ticker: t,
      known_as_of: opts.knownAsOf ?? null, fractions: "exact",
    });
    const steps: TransitionStepOut[] = (carry.steps ?? []).map((s) => {
      const e = byId.get(s.event_id)!;
      return {
        event_id: s.event_id, event_type: s.event_type, effective_date: s.effective_date,
        from_bw_sym_id: s.from_bw_sym_id, from_ticker: s.from_ticker, from_instrument: s.from_instrument || null,
        outcome: s.outcome, to_bw_sym_id: s.to_bw_sym_id, to_ticker: s.to_ticker || null, to_instrument: s.to_instrument || null,
        ratio: s.ratio, source: { form: e.source_form, accession: e.source_accession, url: e.citation },
      };
    });
    const ids = carry.holdings.map((h) => h.bw_sym_id);
    if (carry.status === "unknown" || carry.holdings.length > 1) {
      plan.set(t, {
        ticker: null, drop: false,
        transition: { ...base, status: "unsupported", bw_sym_id: null, ticker: null, outcome: carry.status, event_ids: carry.applied_event_ids, steps,
          detail: carry.holdings.length > 1
            ? `${t} became ${carry.holdings.length} securities (${ids.join(", ")}); a dollar value cannot be split without prices, so the position is left as submitted.`
            : `${t}: ${[...carry.unresolved, ...carry.unknown_by].join("; ") || "outcome unknown"}; position left as submitted.` },
      });
      continue;
    }
    if (!carry.holdings.length) {
      const cash = carry.cash.map((c) => `${c.amount ? fracToString(c.amount) : "?"} ${c.currency} per unit`).join(", ");
      plan.set(t, {
        ticker: null, drop: true,
        transition: { ...base, status: "dropped", bw_sym_id: null, ticker: null, outcome: carry.status, event_ids: carry.applied_event_ids, steps,
          detail: carry.status === "cashed_out" ? `${t} was converted to cash (${cash}); no equity successor.` : `${t} was cancelled with no equity successor.` },
      });
      continue;
    }
    const target = ids[0];
    const reg = registryTicker(target, evidence) ?? carry.holdings[0].ticker;
    const labels = heldLabels(identity.bw_sym_id, heldOn, evidence);
    if (reg === t && !steps.length && labels.length <= 1) continue;
    const q = carry.holdings[0].quantity;
    plan.set(t, {
      ticker: reg, drop: false,
      transition: { ...base, ...labelFields(identity.bw_sym_id, heldOn, evidence), status: reg !== t ? "rewritten" : "carried", bw_sym_id: target, ticker: reg, outcome: carry.status, event_ids: carry.applied_event_ids, steps,
        detail: `${t} held on ${heldOn} is ${target}${steps.length ? `; after ${carry.applied_event_ids.join(", ")} one unit is ${fracToRatio(q)} units` : ""}; priced as ${reg}.` },
    });
  }
  const out: T[] = [];
  for (const p of positions) {
    const step = plan.get(p.ticker.trim().toUpperCase());
    if (!step) out.push(p);
    else if (step.drop) continue;
    else out.push(step.ticker ? { ...p, ticker: step.ticker } : p);
  }
  return { positions: out, transitions: [...plan.values()].map((v) => v.transition) };
}


/** One printed line per transition, for the PDF / PNG footnote (the JSON carries the full `transitions`). */
export function transitionFootnotes(transitions: PositionTransition[]): string[] {
  if (!transitions.length) return [];
  const lines = transitions.map((t) => {
    const ev = t.event_ids.length ? ` (${t.event_ids.join(", ")})` : "";
    switch (t.status) {
      case "rewritten":
        return `${t.submitted_ticker} held on ${t.held_on} is priced as ${t.ticker}${ev}.`;
      case "carried":
        return `${t.submitted_ticker} held on ${t.held_on} carried through${ev}.`;
      case "dropped":
        return `${t.submitted_ticker} held on ${t.held_on} removed: ${
          t.outcome === "cashed_out" ? "converted to cash"
            : t.outcome === "cancelled" ? "cancelled"
              : t.detail.replace(/\.$/, "")
        }${ev}.`;
      default:
        return `${t.submitted_ticker} held on ${t.held_on} left as submitted (${t.status}).`;
    }
  });
  return [`Positions recorded on ${transitions[0].held_on}, carried to today's data through reviewed corporate-action events:`, ...lines];
}

/**
 * How a submitted ticker is priced for holdings dated inside one window (ERM3-73, exposure history).
 * `held_from` is inclusive and `held_to` exclusive; null means open-ended. A holding dated d of
 * `ticker` takes the window with held_from <= d < held_to.
 */
export type HeldTickerWindow = {
  ticker: string;
  held_from: string | null;
  held_to: string | null;
  /** unchanged: today's registry holder of `ticker` is the security held then. Others as in PositionTransition. */
  status: "unchanged" | PositionTransition["status"];
  /** Ticker under which today's registry (and the feed) carries the security; null when dropped. */
  priced_as: string | null;
  /** Security priced (the `symbol` column of the names file when it is a modelled stock); null when unchanged, dropped or left as submitted. */
  bw_sym_id: string | null;
  outcome: string;
  event_ids: string[];
};

function dayBefore(d: string): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/**
 * Point-in-time ticker windows for the tickers-only history feed. For each submitted ticker that
 * appears in a reviewed event, the timeline is cut at every reviewed event date and ticker window
 * edge, and at every alias / security-master validity edge for that ticker; each piece is resolved
 * with `transitionPositions` (the same step as POST /portfolio/exposure with positions_as_of) and
 * adjacent pieces with the same answer are merged. Tickers in no reviewed event get no windows and
 * resolve through today's registry, exactly as before.
 */
export async function heldTickerWindows(
  tickers: string[],
  opts: { asOf: string; knownAsOf?: string | null },
): Promise<HeldTickerWindow[]> {
  const events = await loadEvents();
  const eff = effectiveEvents(events, opts.knownAsOf ?? null);
  const datesByTicker = new Map<string, Set<string>>();
  for (const e of eff) {
    for (const l of [...e.inputs, ...e.outputs]) {
      if (!l.ticker) continue;
      const s = datesByTicker.get(l.ticker) ?? new Set<string>();
      s.add(e.effective_date);
      datesByTicker.set(l.ticker, s);
    }
  }
  for (const w of tickerWindows(events, opts.knownAsOf ?? null)) {
    const s = datesByTicker.get(w.ticker);
    if (!s) continue;
    if (w.start) s.add(w.start);
    if (w.end) s.add(w.end);
  }
  const normalizedTickers = [...new Set(tickers.map((x) => x.trim().toUpperCase()))].sort();
  const evidence = await transitionEvidence(normalizedTickers, events, opts.knownAsOf ?? null);
  const out: HeldTickerWindow[] = [];
  for (const t of normalizedTickers) {
    const reviewed = datesByTicker.get(t);
    if (!reviewed) continue;
    const evidenceRows = [
      ...evidence.aliases.filter((r) => r.alias_value.trim().toUpperCase() === t),
      ...evidence.masters.filter((r) => r.ticker?.trim().toUpperCase() === t),
    ];
    const evidenceCuts = evidenceRows
      .flatMap((r) => [r.valid_from, r.valid_to])
      .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d))
      .map((d) => d.slice(0, 10));
    const cuts = [...new Set([...reviewed, ...evidenceCuts])].filter((d) => d <= opts.asOf).sort();
    const pieces: Array<[string | null, string | null]> = [];
    if (!cuts.length) pieces.push([null, null]);
    else {
      pieces.push([null, cuts[0]]);
      for (let i = 0; i < cuts.length; i++) pieces.push([cuts[i], cuts[i + 1] ?? null]);
    }
    let prev: HeldTickerWindow | null = null;
    for (const [from, to] of pieces) {
      const heldOn = from ?? (to ? dayBefore(to) : opts.asOf);
      const r = await transitionPositions([{ ticker: t }], {
        heldOn,
        asOf: opts.asOf,
        knownAsOf: opts.knownAsOf,
        preloaded: { events, evidence },
      });
      const tr = r.transitions[0];
      const w: HeldTickerWindow = tr
        ? {
            ticker: t, held_from: from, held_to: to, status: tr.status,
            priced_as: tr.status === "dropped" ? null : tr.ticker ?? t,
            bw_sym_id: tr.status === "rewritten" || tr.status === "carried" ? tr.bw_sym_id : null,
            outcome: tr.outcome, event_ids: tr.event_ids,
          }
        : { ticker: t, held_from: from, held_to: to, status: "unchanged", priced_as: t, bw_sym_id: null, outcome: "unchanged", event_ids: [] };
      if (
        prev && prev.status === w.status && prev.priced_as === w.priced_as && prev.bw_sym_id === w.bw_sym_id && prev.outcome === w.outcome &&
        prev.event_ids.join() === w.event_ids.join()
      ) {
        prev.held_to = to;
        continue;
      }
      out.push(w);
      prev = w;
    }
  }
  return out;
}
