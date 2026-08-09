# Handoff — cohort residual leadership endpoint

**Written 2026-08-08. Repo: RiskModels_API. Consumer: BWMACRO #184 (stock commentary).**

## What to build

`GET /api/cohorts/residual-leadership?cohort=SMH&window=252d`

Ranks the members of a peer cohort by their **cumulative stock-specific
(residual) return** over a window, and returns the rank table plus the
dispersion and coverage figures the consumer needs to publish it responsibly.

## Why it exists

The consumer already computes this, badly. It loops
`/api/returns-decomposition?ticker=X` once per cohort member — ~51 HTTP
round-trips per cohort — because that is the only shape exposed. At the 60
requests/minute limit a single cohort nearly exhausts the budget, and a
12-name batch initially rendered 4 and lost the rest to 429s.

Nothing about the storage requires this. `fetchBatchHistory(symbols, keys,
{startDate, endDate})` in `lib/dal/risk-engine-v3.ts:659` already reads a panel
of symbols straight from zarr in one call. This is a missing endpoint, not a
data-layer problem.

## The template to copy

`lib/risk/cohort-variance-shares-service.ts` + `app/api/cohorts/variance-shares/route.ts`.

Same cohort-membership query, same `MIN_COHORT_MEMBERS` refusal, same
`ThinCohortError` → 422. Follow it closely; the differences are listed below.

## Response contract

```jsonc
{
  "cohort": "SMH",
  "window": "252d",
  "teo": "2026-08-07",
  "obs": 250,                    // trading days in the ranked window
  "start_date": "2025-08-11",
  "end_date": "2026-08-07",

  "n_ranked": 49,                // members actually ranked
  "n_members": 51,               // members the cohort contains
  "n_short_history": 2,          // dropped: record does not cover the window

  "ranked": [                    // descending by `value`
    { "symbol": "BW-...", "ticker": "MXL", "rank": 1, "value": 1.408 },
    // ...
  ],

  "dispersion": {
    "best": 1.408,
    "worst": -0.301,
    "median": 0.10,
    "sd": 0.457
  }
}
```

`value` is a **fraction** (0.228 = 22.8 points), matching `l3_res_er` and the
rest of the store. The consumer converts for display.

## Four things a naive implementation will get wrong

These are not style preferences. Each one is a bug the consumer already hit and
fixed client-side, and each will come back if the endpoint reimplements it.

**1. The window is the TARGET's dates, not the intersection of all members'.**

Intersecting every member's dates lets one short-history peer truncate the
comparison for everyone. Resolving 46 peers instead of 35 cut the shared window
from 250 days to 151 — a better fetch producing a worse measurement. Define the
window from the cohort ETF's own date range (or the requested window applied to
the latest teo), then **drop members that do not cover it** and report the count
in `n_short_history`. Never silently rank a 180-day return against a 250-day one.

**2. Contributions are sums of DAILY returns, not compounded paths.**

Daily gross = daily factor + daily residual, so the sums are exactly additive.
Compounded paths carry a cross term and do not reconcile. Sum
`l3_residual_return` over the window; do not compound it.

**3. `sd`, `median`, `best`, `worst` are required, not decorative.**

The consuming claim (`S10CohortResidualRank`) **refuses to render** without
them. Residual returns in a cohort routinely span ~170 points with a ~46-point
standard deviation, at which width adjacent ranks are indistinguishable. A rank
published without the dispersion invites a reader to treat 12th and 15th as
different. Do not make these optional or omit them on a thin response.

**4. `n_ranked` vs `n_members` must both be present.**

A rank "of 35" that should have been "of 51" is wrong in a way nothing
downstream can detect. Coverage is part of the claim.

## Refusals

- Cohort below `MIN_COHORT_MEMBERS` → **422**, same `ThinCohortError` shape as
  variance-shares. An ordinal among nine names is not a ranking.
- Window shorter than ~200 observations → 422 with a distinct reason.
- Unknown cohort → 404.

Refuse rather than return a partial table. The consumer treats a 422 as a clean
refusal and renders a stated reason; it treats a malformed 200 as a defect.

## What this is NOT, and why the distinction is load-bearing

This endpoint ranks residual return **inside a cohort**. Do not add a
universe-wide variant.

The reasoning, because it will look like an arbitrary restriction otherwise:
ordering names by residual return is a **skill claim** when used to select — buy
the top decile, expect it to repeat — and **attribution** when it answers "inside
this sector, over this window, whose own performance led". Across 2,566 names
with no shared shock, the top of the list is the largest noise draw almost by
construction. Inside a 49-name cohort that took the same sector shock, with the
dispersion shown, it is a description of what happened.

NVDA is the case that motivated it: **46 of 49 in SMH** on trailing-year
stock-specific return, in a year semiconductors ran hot — the opposite of what
its total-return rank says.

Any `prohibited` block on the response should say: not a forecast, not evidence
of skill, not a screen, and cohort membership is the model's peer mapping rather
than any fund's holdings.

## Also worth fixing while you are in here

`/api/rankings/{ticker}` returns `stock_specific_lstar` rows for the 21d, 63d
and 252d windows with **every field null** — only 1d is populated. Either
populate them or stop emitting the rows; a consumer that trusts the shape gets
nulls with no signal that the metric is unavailable at that window.

## Consumer-side changes once this ships

In BWMACRO, `src/bwmacro/snapshots/stock/_stock_record_data.py`:

- `fetch_cohort_residual_leadership()` drops its `ThreadPoolExecutor` fan-out,
  its date-alignment logic and its `_rank_within` helper, and becomes a single
  GET plus a lookup for the target ticker.
- The `_RateLimiter` and the `--peer-cache` disk cache stay, but stop being
  load-bearing — they become ordinary hygiene rather than the thing making the
  feature viable.
- `S10CohortResidualRank` and its tests need no change. That is the point of the
  claim layer: the evidence contract is unchanged, only its transport.

## Verification

The consumer's tests in
`tests/snapshots/stock/test_stock_record_claims.py` cover the claim's behaviour
against this data. Useful cross-checks for the endpoint itself:

- SMH at 252d should rank ~49 of ~51 members, NVDA near the bottom, spread
  roughly -30 to +141 points, SD ~46.
- XBI at 252d should rank ~46 members with a spread to ~+236 points.
- A cohort of fewer than `MIN_COHORT_MEMBERS` must 422, not return a short list.
