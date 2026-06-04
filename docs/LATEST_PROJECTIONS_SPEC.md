# Spec — Derived `_latest` Projections (zarr → Supabase point-read shortcuts)

**Status:** Draft / proposed
**Created:** 2026-06-02
**Owner:** conrad@bwmacro.com
**Scope:** ERM3 (writer) ↔ RiskModels_API (reader) ↔ Funds_DAG (writer). Cross-repo.
**Related:** [`API_HISTORY_SUPABASE_AND_ZARR.md`](./API_HISTORY_SUPABASE_AND_ZARR.md) (pure-Zarr SSOT policy), [`../MAINTENANCE_GUIDE.md`](../MAINTENANCE_GUIDE.md) (forbidden EAV fallback), BWMACRO `docs/ceo/MASTER_BACKLOG.md` **H.25** (the er_l* backfill that motivated this), **H.26** (this spec).

---

## 1. Purpose

Make hot **single-entity, latest-teo** reads cheap **without** reintroducing the dual-write
drift that caused H.25 — by treating Supabase `*_latest` tables as **derived, verifiable
projections of the zarr**, built in the same daily job that writes the zarr, and gated by a
loud-failing drift check.

This is the generalization of "option 2" from the H.25 follow-up discussion, applied across
**every** zarr store that has a hot latest point-read.

## 2. The verified problem (one store, one access pattern)

The zarr-as-SSOT cutover is correct for **history/range** reads. It is *miscast* for one
access pattern on one store:

- **`ds_rankings_SPY_uni_mc_3000.zarr`** is chunked **`{teo: 1, symbol: -1}`** (verified:
  one chunk = one variable × one teo × all 6,346 symbols). This is optimal for the
  **cross-sectional / screen** read ("rank all symbols at one date" = 1 chunk per variable):
  `GET /api/rankings/top`, `GET /api/rankings/screen` (`readLatestRankSnapshot` /
  `fetchTopRankingsSnapshot`).
- But the **single-symbol** read — `GET /api/rankings/[ticker]` →
  `fetchRankingsFromSecurityHistory` → `readSymbolRankSnapshot` — must fetch a full
  6,346-wide row to read **one** symbol's cell, and does so once per variable. With the full
  grid that is **up to ~200 parallel GCS chunk reads** (the code self-describes a
  *"~200-fetch budget"*; cost = `2 × (windows × cohorts × metrics)` for `rank_ord_*` +
  `cohort_size_*`). A Supabase `_latest` point read is **1 indexed round-trip**.

The honest argument is **fetch-count**, not a latency figure: ~200 GCS round-trips vs 1 DB
round-trip for the same answer. The wall-clock impact is **currently unmeasured** — see the
gate in §8.

### Why this is the only real gap

The derive-`_latest`-from-zarr pattern **already exists** on two of three surfaces:

| Surface | `_latest` table | Built by | Source zarr |
|---|---|---|---|
| ERM3 metric **values** | `security_history_latest` (wide row: `returns_gross`, `vol_23d`, L1/L2/L3 `*_hr`/`*_er`, `*_cfr`/`*_rr`, betas, lstar) | `sync_erm3_to_supabase_v3` daily + `post_sync_trim_and_evict.load_betas_to_supabase` | `ds_daily`, `ds_erm3_hedge_weights_*`, `ds_erm3_returns_*`, `ds_erm3_betas_*` |
| Funds (latest portfolio) | `funds_latest` | Funds_DAG `build_funds_latest_rows` | per-fund `ds_ph.zarr` / `ds_portfolio.zarr` |
| Filers (latest + rankings) | `filer_rankings_top` | Funds_DAG `build_filer_rankings_top_rows`, `build_filer_portfolios_latest_rows` | per-filer `ds_portfolio.zarr` |
| **ERM3 rankings** | **— none —** | **— gap —** | `ds_rankings_*.zarr` |

So "comprehensive optimization" is **not** "move more things to Supabase." It is:
1. **Formalize** the pattern these three already follow into one reusable contract (§5).
2. **Fill the one gap** — `rankings_latest` (§6, P1).
3. **Retrofit the drift gate** the existing projections silently lack (§6, P2) — the literal
   H.25 lesson.

## 3. Principle (non-negotiable)

> **The zarr is the single source of truth. A `*_latest` table is a derived, rebuildable
> projection of the zarr's latest-teo slice — never an independent second writer of the same
> fact.**

H.25 was a silent dual-path divergence: the rankings *write path* skipped (an `else: skip`
fell through) and ~20 years of history went all-NaN with nothing failing. The pure-Zarr
cutover deliberately killed that class by collapsing to one source. We do **not** reopen it.
We add a *projection* that is (a) computed **from the zarr we just wrote**, not from a
parallel computation, and (b) **verified equal to the zarr** before the job is allowed to
succeed.

**Anti-pattern (forbidden):** the pipeline computing rankings and writing them to both zarr
and Supabase as *independent* outputs (this is exactly the decommissioned
`sync_rankings_to_security_history` in `sync_erm3_to_supabase_v3.py` — defined, never called,
keep it that way). A projection **reads the zarr** as its input.

## 4. Decision framework — what belongs in `_latest`

A store's latest slice earns a `_latest` projection **only if all** hold:

1. **Access pattern is POINT-LATEST** — single entity (symbol/fund/filer), newest teo.
   (Range/history → zarr. Cross-sectional/screen → zarr.)
2. **The zarr layout makes that point-read expensive** — i.e. the chunking is tuned for a
   different axis, so a single-entity read touches many chunks. (`ds_rankings` `{teo:1,symbol:-1}`
   qualifies. A store already chunked symbol-friendly does not.)
3. **The projection is small and bounded** — one row per entity per teo, wide (or a single
   jsonb blob), **never EAV**. (EAV is what made the old `security_history` fallback a 12–25s
   scan — see MAINTENANCE_GUIDE; do not recreate it.)
4. **It can be derived and verified from the zarr in-job** — no separate compute, no external
   inputs.

If (1)–(2) hold but you'd rather not carry a second store, consider **re-chunking** instead
(§7) — but only when it doesn't degrade the access pattern the current chunking serves.

## 5. The Latest Projection contract (reusable)

Every `*_latest` projection MUST satisfy:

- **Input = the zarr just written.** The builder runs **inside the same Dagster job**, as a
  step **after** the store's write, and reads the store's **latest-teo slice** as its only
  data input.
- **Identity key = the BW `symbol` id** (`bw_sym_id`, e.g. `BW-ABXL`) — the zarr `symbol`
  dimension value, verbatim equal to `public.symbols.symbol`. **Never** the display ticker,
  and **never** a positional index shared across stores (per-store symbol indices differ — a
  prior post-mortem flagged cross-store index aliasing as a live bug; the projection joins on
  the id string, not the index).
- **Wide or jsonb, not EAV.** One row per `(entity_id, periodicity)`; either typed columns
  per field or a single jsonb payload read whole. The API assembles all prefixes per entity
  anyway (cf. `_rankings_dict_from_zarr`), so a jsonb blob keyed by entity is the natural,
  EAV-free shape.
- **Idempotent upsert** keyed on `(entity_id, periodicity)`; carries the source `teo` and an
  `updated_at`.
- **Drift gate (the heart of the spec) — see §5.1.**
- **Loud failure.** A gate failure **fails the Dagster step** (red run, alert). It does **not**
  warn-and-continue. H.25's root cause was a silent skip; the projection's contract is the
  opposite by construction.
- **Rebuildable from zarr alone**, so a corrupt/stale projection is never load-bearing — it
  can be dropped and regenerated, and the reader falls back to the zarr (slow but correct) if
  the projection is absent.

### 5.1 Drift gate (concrete — this is what makes option 2 safe)

After writing the projection, **before the step succeeds**, assert the projection equals the
zarr it was derived from, at the same `teo`:

1. **teo agreement:** projection `teo` == zarr latest `teo`.
2. **Coverage:** the count of entities with a non-null projected row equals the count of
   entities finite in the zarr's latest-teo slice, within a small tolerance. (For rankings:
   `# rows in rankings_latest` ≈ `# symbols finite in rank_ord_1d_universe_* at latest teo`.)
3. **Value equality on a sample:** draw a fixed pseudo-random sample (≥200 entities, seeded by
   teo for determinism — `Date.now`/`random` are not available in some runtimes; seed off the
   teo) and assert each projected field **equals** the zarr cell value (exact for ints like
   `rank_ord`/`cohort_size`; `np.isclose` for floats). Equality, **not** "both non-null."
4. On any failure → raise → **the step fails**. Log which check, which entities, expected vs
   got.

This gate is the inverse of the H.25 bug. Note: **the existing projections
(`security_history_latest`, `funds_latest`, `filer_rankings_top`) have no such gate today** —
retrofitting one is real work (P2), not a freebie.

## 6. Work items

### P1 — `rankings_latest` (fills the only gap)

- **New Supabase table** `rankings_latest(symbol text, periodicity text, teo date,
  payload jsonb, updated_at timestamptz, primary key (symbol, periodicity))`, where `payload`
  is the per-symbol dict of `{ "{window}_{cohort}_{metric}": {rank_ordinal, cohort_size} }`
  for every prefix the zarr carries (the wide grid). `rank_percentile` stays computed in the
  reader (`(1 - (rank_ord-1)/cohort)*100`), as today.
- **Builder** in ERM3, in the rankings-producing job, after `ds_rankings_*.zarr` is written:
  read the latest-teo slice once (this is the cheap axis for that chunking — 1 chunk per
  variable), emit one row per symbol that is finite in the universe cohort, upsert.
- **Drift gate** per §5.1 against `ds_rankings_*.zarr`.
- **Reader change** (`fetchRankingsFromSecurityHistory` in `lib/dal/risk-engine-v3.ts`):
  try `rankings_latest` first (1 round-trip); **on miss/empty, fall back to the existing
  `readSymbolRankSnapshot` zarr path** (slow but correct — never a hard dependency on the
  projection). Keep the public response shape identical.
- **Non-goal:** the screen/top paths (`/api/rankings/top`, `/api/rankings/screen`) stay on the
  zarr — their chunking is already optimal (§7). `rankings_latest` is *only* for the
  single-symbol path.

### P2 — Retrofit the drift gate onto existing projections

`security_history_latest`, `funds_latest`, `filer_rankings_top` currently write without a
post-write equality check against their source zarr. Add §5.1 gates to:
- `post_sync_trim_and_evict.load_betas_to_supabase` + the daily `security_history_latest`
  refresh (assert vs `ds_erm3_betas_*` / `ds_erm3_hedge_weights_*` / `ds_daily` latest slice).
- Funds_DAG `build_funds_latest_rows`, `build_filer_rankings_top_rows`,
  `build_filer_portfolios_latest_rows` (assert vs the per-entity `ds_*` latest slice they read).

This is the highest-leverage *correctness* item even independent of performance: it converts
the entire `_latest` surface from "trust the sync" to "verified against SSOT, fails loud."

### P3 — Eliminate the 400-day fallback scan (depends on P2)

`fetchLatestMetricsWithFallback` triggers a **400-day** zarr scan
(`ZARR_LATEST_METRICS_LOOKBACK_DAYS = 400`) when an L2/L3 hedge ratio is null/zero in
`security_history_latest`. Once P2 guarantees the projection equals the zarr's latest
**non-null** slice (i.e. the projection forward-fills the last finite value at projection
time, matching the zarr), the null/zero-triggered fallback becomes unreachable and the scan
can be removed. Gate this on the P2 gate proving the projection is complete.

## 7. Re-chunk vs project — per store (not interchangeable)

Re-chunking is strictly better on the drift axis (no second store at all). But it is only an
option when it doesn't degrade the access the current chunking serves:

- **`ds_rankings_*` → PROJECT (not re-chunk).** Its `{teo:1, symbol:-1}` is what makes the
  **screen/top** path one chunk per variable. Re-chunking to symbol-blocked would speed the
  single-symbol read but **slow the cross-sectional read it is tuned for**. Two opposed access
  patterns on one store → serve the point-read with a projection, leave the screen-optimized
  chunking alone. **Projection wins here specifically.**
- **Other stores:** before adding any projection, confirm the actual chunk shape (most shapes
  in the discovery pass were *inferred*, not read — verify the `.zarray` at implementation
  time). If a store is already symbol-friendly for point reads, it needs **neither** a
  projection **nor** a re-chunk.

## 8. Gate: measure before building (P1) — DONE 2026-06-02

The fetch-count argument (~200 vs 1) justified *investigating*; the probe sizes the win.

**Probe (deployed `riskmodels.app`, steady-state, measured from a laptop — so absolute
numbers carry client→edge RTT, but the *delta* is pure server-side):**

| Path | GCS fetches | Steady-state latency |
|---|---|---|
| `GET /api/rankings/[ticker]` **no filter** (full grid) | ~200 | **~12.0 s** (p50; stable across repeats, not cold-start) |
| `GET /api/rankings/[ticker]?metric=er_l3&cohort=universe&window=1d` (1 prefix) | 2 | **~2.8 s** |
| `GET /api/batch/latest-metrics` (Supabase `security_history_latest`) | 0 (1 DB RTT) | **~2.6 s** |

**Findings:**
1. The single-prefix rankings read (2 fetches) is **as fast as the Supabase `_latest` path** —
   confirming the cost is **fetch count**, not the storage engine. This is the cleanest
   possible justification for projecting rather than re-engineering storage.
2. **Isolated zarr penalty (location-independent):** full-grid − single-prefix ≈ **~9.3 s of
   pure server-side GCS round-trips** for the ~200-fetch single-symbol path. P1 removes this:
   full-grid single-symbol rankings → **~12 s → ~2.8 s** floor (~4.3×).
3. **Separate finding (NOT this spec):** a **~2.7 s floor sits on *every* billed endpoint**,
   including the cheap ones — auth + `withBilling` middleware + Vercel + client RTT, not the
   data read. From a co-located client it'll be lower, but it dominates the fast paths and
   dwarfs most data work. Worth its own investigation (likely the synchronous billing-event
   write in `withBilling`); tracked separately, orthogonal to H.26.

**Verdict — BUILD P1, with one usage check first.** The ~9 s worst-case is real and severe
*when the full-grid unfiltered `/api/rankings/[ticker]` is hit*. Before building, confirm which
consumer actually calls that route **without** filters (the `/badge` and screen routes use the
cheap paths). If a user-facing surface hits the full grid, P1 is clearly justified; if real
traffic is mostly filtered/screen, P1 is a guardrail against the ~9 s tail rather than urgent.
Either way the §3 principle + P2 gate stand regardless.

## 9. Risks & non-goals

- **Drift reintroduction** — mitigated structurally by §3 (derive-from-zarr) + §5.1 (gate).
  The failure mode to fear is someone "optimizing" the builder to compute ranks independently
  instead of reading the zarr; the gate catches it, but the contract forbids it.
- **EAV regression** — `rankings_latest` must be wide/jsonb, never `(metric_key, value)` rows;
  EAV is what made the old fallback pathological.
- **Projection treated as load-bearing** — readers MUST fall back to the zarr on projection
  miss; the projection is a cache, not a source.
- **Not in scope:** changing what `security_history_latest` *contains* (it already carries the
  metric values correctly); moving history/range or screen reads off the zarr; any independent
  Supabase write of rankings.

## 10. Rollout

1. P2 gates on existing projections (correctness; no schema change) — ship first, it's pure
   safety.
2. §8 latency probe.
3. P1 `rankings_latest` (table + builder + gate + reader-with-fallback) if the probe justifies.
4. P3 remove the 400-day fallback once P2 proves completeness.

## 11. Open questions

- jsonb payload vs typed columns for `rankings_latest` (jsonb favored: read-whole, no EAV, no
  192-column DDL).
- Does any consumer need *historical* per-symbol rankings as a point read (not range)? If yes,
  that's a different projection (keyed by teo) and should be argued separately — default is no,
  history stays zarr.
- Confirm exact chunk shapes per store from `.zarray` before any re-chunk decision beyond
  rankings.
