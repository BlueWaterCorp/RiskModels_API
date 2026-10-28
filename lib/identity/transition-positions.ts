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
 * Only tickers that appear in reviewed events are examined; every other position passes through
 * untouched, so a book with no reviewed history behaves exactly as before. Positions carry dollar
 * values, which a ratio does not change; a split into several securities (spin-off) cannot be priced
 * here and is reported `unsupported` with the position left as submitted. A position that became cash
 * or was cancelled is dropped and reported.
 */
import { describe, loadEvents, resolveIdentity, type IdentitySource } from "@/lib/identity/resolve";
import { applyEvents, effectiveEvents, fracToRatio, fracToString, parseDecimal, tickerWindows } from "@/lib/identity/security-events";
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
  /** rewritten: priced under another ticker; carried: same ticker, events applied (e.g. ADS -> ordinary). */
  status: "rewritten" | "carried" | "dropped" | "unsupported" | "unresolved";
  identity_source: IdentitySource | null;
  source_bw_sym_id: string | null;
  bw_sym_id: string | null;
  ticker: string | null;
  outcome: string;
  event_ids: string[];
  steps: TransitionStepOut[];
  detail: string;
};

export type TransitionResult<T> = { positions: T[]; transitions: PositionTransition[] };

/** Today's registry ticker for each id (symbols, else the security master). */
async function registryTickers(ids: string[]): Promise<Map<string, string | null>> {
  const d = await describe(ids);
  return new Map(ids.map((id) => [id, d.get(id)?.ticker ?? null]));
}

export async function transitionPositions<T extends { ticker: string }>(
  positions: T[],
  opts: { heldOn: string; asOf: string; knownAsOf?: string | null },
): Promise<TransitionResult<T>> {
  const { heldOn, asOf } = opts;
  if (heldOn > asOf) throw new Error(`positions_as_of ${heldOn} is after as_of ${asOf}`);
  const events = await loadEvents();
  const eff = effectiveEvents(events, opts.knownAsOf ?? null);
  const eventTickers = new Set(eff.flatMap((e) => [...e.inputs, ...e.outputs].map((l) => l.ticker).filter(Boolean)));
  const byId = new Map(events.map((e) => [e.event_id, e]));
  const touched = [...new Set(positions.map((p) => p.ticker.trim().toUpperCase()))].filter((t) => eventTickers.has(t));
  if (!touched.length) return { positions, transitions: [] };

  // ticker -> what it became (null: leave the position as submitted)
  const plan = new Map<string, { ticker: string | null; drop: boolean; transition: PositionTransition }>();
  for (const t of touched) {
    const req = {
      identifier: t, identifier_type: "ticker" as const, as_of: asOf, acquired_on: heldOn, quantity: "1",
      known_as_of: opts.knownAsOf ?? null, fractions: "exact" as const, elections: {},
    };
    const identity = await resolveIdentity(req, events, heldOn);
    const base = {
      submitted_ticker: t, held_on: heldOn, as_of: asOf, identity_source: identity.source,
      source_bw_sym_id: identity.bw_sym_id,
    };
    if (identity.status !== "resolved" || !identity.bw_sym_id) {
      plan.set(t, {
        ticker: null, drop: false,
        transition: { ...base, status: "unresolved", bw_sym_id: null, ticker: null, outcome: identity.status, event_ids: [], steps: [],
          detail: `${t} on ${heldOn}: identity ${identity.status}${identity.candidates.length ? ` (${identity.candidates.join(", ")})` : ""}; position left as submitted.` },
      });
      continue;
    }
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
    const reg = (await registryTickers([target])).get(target) ?? carry.holdings[0].ticker;
    if (reg === t && !steps.length) continue; // the registry already holds this security under the submitted ticker
    const q = carry.holdings[0].quantity;
    plan.set(t, {
      ticker: reg, drop: false,
      transition: { ...base, status: reg !== t ? "rewritten" : "carried", bw_sym_id: target, ticker: reg, outcome: carry.status, event_ids: carry.applied_event_ids, steps,
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
        return `${t.submitted_ticker} held on ${t.held_on} removed: ${t.outcome === "cashed_out" ? "converted to cash" : "cancelled"}${ev}.`;
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

const TICKER_ALIAS_TYPES = ["TICKER", "EODHD_TICKER", "FINRA_TICKER", "LEGACY_TICKER"];

/** Dates at which the alias and security-master evidence for `ticker` changes (empty on a read error). */
async function evidenceDates(ticker: string): Promise<string[]> {
  const admin = createAdminClient();
  const [al, sm] = await Promise.all([
    admin.from("security_aliases").select("valid_from, valid_to").eq("alias_value", ticker).in("alias_type", TICKER_ALIAS_TYPES),
    admin.from("security_master").select("valid_from, valid_to").eq("ticker", ticker),
  ]);
  const rows = [...((al.error ? [] : al.data) ?? []), ...((sm.error ? [] : sm.data) ?? [])] as Array<{ valid_from: string | null; valid_to: string | null }>;
  return rows.flatMap((r) => [r.valid_from, r.valid_to]).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10));
}

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
  const out: HeldTickerWindow[] = [];
  for (const t of [...new Set(tickers.map((x) => x.trim().toUpperCase()))].sort()) {
    const reviewed = datesByTicker.get(t);
    if (!reviewed) continue;
    const cuts = [...new Set([...reviewed, ...(await evidenceDates(t))])].filter((d) => d <= opts.asOf).sort();
    const pieces: Array<[string | null, string | null]> = [];
    if (!cuts.length) pieces.push([null, null]);
    else {
      pieces.push([null, cuts[0]]);
      for (let i = 0; i < cuts.length; i++) pieces.push([cuts[i], cuts[i + 1] ?? null]);
    }
    let prev: HeldTickerWindow | null = null;
    for (const [from, to] of pieces) {
      const heldOn = from ?? (to ? dayBefore(to) : opts.asOf);
      const r = await transitionPositions([{ ticker: t }], { heldOn, asOf: opts.asOf, knownAsOf: opts.knownAsOf });
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
        prev && prev.status === w.status && prev.priced_as === w.priced_as && prev.bw_sym_id === w.bw_sym_id &&
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
