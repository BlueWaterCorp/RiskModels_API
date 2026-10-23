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
import { applyEvents, effectiveEvents, fracToRatio, fracToString, parseDecimal } from "@/lib/identity/security-events";

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

