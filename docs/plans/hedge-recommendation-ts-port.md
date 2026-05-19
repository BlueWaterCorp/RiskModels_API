# Hedge-recommendation TS port — spec

**Status:** spec only (no code yet)
**Owner:** Conrad Gann
**Related task:** #21 (`API: /api/hedge-basket/{ticker} endpoint`)
**Python SSOT:** `~/BW_Code/ERM3/erm3/shared/hedge_recommendation.py`
**Python tests:** `~/BW_Code/ERM3/tests/test_hedge_recommendation.py` (12/12 passing)

## Purpose

Surface a **trader-grade** hedge recommendation alongside the existing **statistical** `Lstar` field. Today the chat shows `Lstar=L3` and `Market HR (L3) = -2.00` without any framing — a reader (correctly) infers a beta of 2 and recoils. Adding `recommended_hedge_level` plus per-leg gross-leverage breakdown gives the chat the structured object it needs to recommend a hedge a real desk would respect.

Critical constraint: the Python implementation in ERM3 is the **single source of truth** for the decision rule. This TS port must produce byte-identical output for the same inputs. Any change to the rule must land in Python first; this TS file mirrors it.

## Decision rule (short form)

`recommendHedgeLevel(...)` takes `Lstar` as the statistical floor and steps it down zero, one, or two levels based on two economic gates:

1. **Leverage gate** — `hedge_gross` at that level exceeds the user-segment cap.
2. **Haircut-ER gate** — the marginal ER added by that level, multiplied by an OOS haircut, falls below an economic floor.

Top-down from `Lstar`:
- L3 → L2 if either gate fails at L3
- L2 → L1 if either gate fails at L2
- L1 is always the floor

`Lstar` itself is **never mutated**. The two fields coexist on the payload. Divergence between them is the regime-change alert the chat surfaces.

## Constants (must match Python byte-for-byte)

```ts
export const SEGMENT_LEVERAGE_CAPS: Record<UserSegment, number> = {
  retail:        1.5,
  family_office: 2.0,
  ls_equity:     3.0,
  stat_arb:      5.0,
};

export const DEFAULT_USER_SEGMENT: UserSegment = "family_office";
export const DEFAULT_ER_HAIRCUT: number = 0.7;
export const DEFAULT_MIN_HAIRCUT_ER: number = 0.01;  // 1% haircut ER floor
```

## File layout

```
RiskModels_API/
├── lib/
│   └── dal/
│       ├── hedge-recommendation.ts          # NEW — pure decision function + helpers
│       └── hedge-recommendation.test.ts     # NEW — 12 test cases ported from Python
├── app/
│   └── api/
│       ├── metrics/
│       │   └── [ticker]/
│       │       └── route.ts                 # MODIFY — add 5 new fields to payload
│       └── hedge-basket/
│           └── [ticker]/
│               └── route.ts                 # NEW — structured basket endpoint
└── docs/plans/
    └── hedge-recommendation-ts-port.md      # THIS DOC
```

## `lib/dal/hedge-recommendation.ts` — stub

```ts
/**
 * Economic recommendation layer on top of Lstar.
 *
 * Mirrors `erm3.shared.hedge_recommendation` in the ERM3 repo. The Python file
 * is the source of truth; if behavior diverges, the Python wins and this file
 * must be updated. Run the parallel test suite (12 cases) to detect drift.
 */

export type LStar = "L1" | "L2" | "L3";
export type LStarOrNone = LStar | null;
export type UserSegment = "retail" | "family_office" | "ls_equity" | "stat_arb";

export const SEGMENT_LEVERAGE_CAPS: Record<UserSegment, number> = {
  retail:        1.5,
  family_office: 2.0,
  ls_equity:     3.0,
  stat_arb:      5.0,
};

export const DEFAULT_USER_SEGMENT: UserSegment = "family_office";
export const DEFAULT_ER_HAIRCUT = 0.7;
export const DEFAULT_MIN_HAIRCUT_ER = 0.01;

export interface RecommendHedgeLevelInputs {
  lstar: LStarOrNone;
  l1HedgeGross: number;
  l2HedgeGross: number;
  l3HedgeGross: number;
  l2SectorEr: number;
  l3SubsectorEr: number;
  userSegment?: UserSegment;
  leverageCap?: number;             // explicit override of segment default
  erHaircut?: number;               // defaults to 0.7
  minHaircutMarginalEr?: number;    // defaults to 0.01
}

export function recommendHedgeLevel(inp: RecommendHedgeLevelInputs): LStar {
  const {
    lstar, l1HedgeGross, l2HedgeGross, l3HedgeGross,
    l2SectorEr, l3SubsectorEr,
    userSegment = DEFAULT_USER_SEGMENT,
    leverageCap,
    erHaircut = DEFAULT_ER_HAIRCUT,
    minHaircutMarginalEr = DEFAULT_MIN_HAIRCUT_ER,
  } = inp;

  if (lstar !== "L1" && lstar !== "L2" && lstar !== "L3") return "L1";

  const cap = leverageCap ?? SEGMENT_LEVERAGE_CAPS[userSegment]
    ?? SEGMENT_LEVERAGE_CAPS[DEFAULT_USER_SEGMENT];

  let candidate: LStar = lstar;

  if (candidate === "L3") {
    const marginalHaircut = (l3SubsectorEr || 0) * erHaircut;
    if (l3HedgeGross > cap || marginalHaircut < minHaircutMarginalEr) {
      candidate = "L2";
    }
  }
  if (candidate === "L2") {
    const marginalHaircut = (l2SectorEr || 0) * erHaircut;
    if (l2HedgeGross > cap || marginalHaircut < minHaircutMarginalEr) {
      candidate = "L1";
    }
  }
  return candidate;
}

/** Σ |HR_leg| over the supplied hedge legs (exclude the +1 stock). NaN-safe. */
export function hedgeGrossFromHrs(...hrs: Array<number | null | undefined>): number {
  return hrs.reduce<number>((acc, h) => {
    if (h == null || Number.isNaN(h)) return acc;
    return acc + Math.abs(h);
  }, 0);
}
```

## Wiring 1: `app/api/metrics/[ticker]/route.ts`

The existing metrics route reads from Supabase `security_history_latest` for the L1/L2/L3 betas (per the earlier diagnosis at `lib/dal/risk-engine-v3.ts:510-516`, beta keys are in `ZARR_UNSUPPORTED_DAILY_KEYS`). HRs come from `ds_erm3_hedge_weights_*.zarr`.

**New work:**
1. After reading the existing HR fields (`L1_market_HR`, `L2_market_HR`, `L2_sector_HR`, `L3_market_HR`, `L3_sector_HR`, `L3_subsector_HR`) at the latest teo for the requested ticker, compute:
   ```ts
   const l1HedgeGross = hedgeGrossFromHrs(L1_market_HR);
   const l2HedgeGross = hedgeGrossFromHrs(L2_market_HR, L2_sector_HR);
   const l3HedgeGross = hedgeGrossFromHrs(L3_market_HR, L3_sector_HR, L3_subsector_HR);
   ```
2. Add a new zarr reader for the shrunk hedge sidecar at `gs://rm_api_data/eodhd-shrinkage-v1/ds_erm3_hedge_shrinkage_SPY_uni_mc_3000.zarr` and pull `L2_sector_ER_shrunk`, `L3_subsector_ER_shrunk`, and `Lstar` (the shrunk LStar — distinct from the raw `Lstar` in `ds_erm3_hedge_weights`). Use the shrunk Lstar as the input to `recommendHedgeLevel` since it's the cleaner statistical signal.
3. Parse `user_segment` from `req.nextUrl.searchParams` (default `family_office`); fallback to `family_office` on unknown values.
4. Call `recommendHedgeLevel(...)` and add the result to the payload.

**New payload fields:**

| Field | Type | Source | Notes |
|---|---|---|---|
| `l1_hedge_gross` | `number` | computed | Σ \|HR_leg\| at L1 (= \|β_m\|) |
| `l2_hedge_gross` | `number` | computed | Σ \|HR_leg\| at L2 (market + sector legs) |
| `l3_hedge_gross` | `number` | computed | Σ \|HR_leg\| at L3 (market + sector + subsector legs) |
| `higher_er_haircut` | `number` | computed | `(l2_sector_ER + l3_subsector_ER) × 0.7` — combined OOS estimate |
| `recommended_hedge_level` | `"L1"\|"L2"\|"L3"` | computed | from `recommendHedgeLevel` |
| `user_segment_applied` | `string` | echo | the segment that drove the recommendation (for the chat to narrate) |

**Backward compatibility:** existing payload fields are unchanged. New fields are additive — readers that don't know about them get an empty `Lstar` divergence story but break nothing.

## Wiring 2: `app/api/hedge-basket/[ticker]/route.ts` — NEW

Returns the structured per-leg basket the chat needs to render the table. Format:

```ts
{
  ticker: "AAPL",
  as_of: "2026-05-18",
  lstar: "L3",
  recommended_hedge_level: "L1",
  user_segment_applied: "family_office",
  leverage_cap: 2.0,
  haircut_applied: 0.7,
  legs: [
    { leg: "AAPL", side: "long",  position:  1.00, beta_to_spy: 0.876, market_beta_contribution:  0.876 },
    { leg: "SPY",  side: "short", position: -2.00, beta_to_spy: 1.000, market_beta_contribution: -2.002 },
    { leg: "XLK",  side: "short", position: -0.03, beta_to_spy: 1.497, market_beta_contribution: -0.039 },
    { leg: "<subsector_etf>", side: "long", position: 0.41, beta_to_spy: 1.478, market_beta_contribution:  0.606 },
  ],
  net_market_beta_after_hedge: -0.559,         // sum of contributions; FYI per task #22
  hedge_gross: { L1: 0.876, L2: 1.695, L3: 2.303 },
  marginal_er: {
    L2_sector_raw: 0.006, L2_sector_haircut: 0.0042,
    L3_subsector_raw: 0.0162, L3_subsector_haircut: 0.0114,
  },
  decision_trace: [
    "Lstar=L3 (shrunk subsector ER 1.62% ≥ 1% threshold)",
    "L3 hedge gross 2.30 > 2.0 cap (family_office) → drop to L2",
    "L2 sector ER haircut 0.42% < 1.0% floor → drop to L1",
    "Final: L1 (short 0.88 SPY)",
  ],
}
```

The `decision_trace` array is critical — it's what the chat narrates to make the recommendation legible.

Link-betas (`λ_s→m`, `λ_u→m`) come from `ds_erm3_link_betas_SPY.zarr` (already in GCS). Subsector ETF resolution comes from `FS_INDUSTRY_TO_SUBSECTOR_ETFS` — either port the mapping table to TS, or expose it via a new internal endpoint, or co-locate it in a JSON config that both Python and TS read.

## Test parity (REQUIRED)

Port all 12 Python test cases from `tests/test_hedge_recommendation.py` to `hedge-recommendation.test.ts`. The cases:

1. `aapl_l3_lstar_downgraded_to_l1_by_leverage` — AAPL today, family_office cap
2. `high_signal_smallcap_keeps_l3` — strong signal, ls_equity cap
3. `defensive_utility_stays_l1` — Lstar=L1 input
4. `regional_bank_keeps_l2` — Lstar=L2 input, both gates pass
5. `high_beta_semi_downgrades_by_segment` — same inputs, 4 segments, 4 different recommendations
6. `none_lstar_falls_back_to_l1` — null/empty/unknown Lstar
7. `explicit_leverage_cap_overrides_segment` — `leverageCap` kwarg wins
8. `zero_haircut_disables_economic_floor` — `erHaircut=0` collapses to leverage-only check
9. `default_haircut_value` — pins `DEFAULT_ER_HAIRCUT === 0.7`
10. `segment_caps_ordering` — monotonic ordering of caps
11. `hedge_gross_from_hrs_excludes_nans` — NaN-safe sum
12. `hedge_gross_l1_l2_l3_for_aapl` — basket math against live AAPL numbers

CI rule: if any of these 12 TS tests diverges from its Python twin in expected output, the build fails. Run both suites in CI.

## Rollout

1. **Phase 1 (this spec → PR1):** add `lib/dal/hedge-recommendation.ts` + test suite. No route wiring yet. Behavior: net-zero. CI passes.
2. **Phase 2 (PR2):** wire to `app/api/metrics/[ticker]/route.ts`. Add the 6 new payload fields. Existing fields untouched. Chat reads the new fields when present.
3. **Phase 3 (PR3):** add `app/api/hedge-basket/[ticker]/route.ts` with the structured basket payload. Chat skill switches to this for the table render.
4. **Phase 4 (later — Phase B2 deliverable):** replace `DEFAULT_ER_HAIRCUT = 0.7` with a per-level realized haircut measured from walk-forward backtests. Update both Python and TS together.

## Open questions to resolve before PR1

1. **Where does the TS read the shrunk hedge zarr from?** The existing zarr reader (`lib/dal/zarr-reader.ts`) is configured for `gs://rm_api_data/eodhd/` only. Either extend it to support the `eodhd-shrinkage-v1/` prefix, or add a second reader. Recommended: extend the existing reader with a `subdir` parameter.
2. **`FS_INDUSTRY_TO_SUBSECTOR_ETFS` mapping in TS** — port the Python `dict` to a TS `Record`, or read from a shared JSON. JSON is better for keeping both languages in sync; a small build script can emit the JSON from the Python module on every ERM3 release.
3. **Caching.** Hedge gross and recommended level are deterministic functions of the latest-teo HRs and shrunk ERs. Cache aggressively at the route level; invalidate on ERM3 sync completion.

## References

- Python SSOT: `~/BW_Code/ERM3/erm3/shared/hedge_recommendation.py`
- Python tests: `~/BW_Code/ERM3/tests/test_hedge_recommendation.py`
- Shrunk hedge sidecar: `gs://rm_api_data/eodhd-shrinkage-v1/ds_erm3_hedge_shrinkage_SPY_uni_mc_3000.zarr` (Phase B1.1 deliverable, schema includes `L2_sector_ER_shrunk`, `L3_subsector_ER_shrunk`, `Lstar`)
- Methodology context: `content/docs/methodology.mdx` (will get a new "Recommended hedge level" section in Phase 3)
- LStar side study: `RM_ORG/content/Medium/series/drafts/lstar_selection/`
- Related task: #20 (chat-skill table that consumes this payload)
- Related task: #22 (methodology check on residual net market β — informational for `decision_trace` narration, not blocking this port)
