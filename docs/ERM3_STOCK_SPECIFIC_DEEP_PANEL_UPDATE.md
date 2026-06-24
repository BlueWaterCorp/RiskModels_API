# API Prep — ERM3 stock_specific + deep-panel(2000) + CUSIP landing

**Status:** Ready to execute. ERM3 producer is on `origin/main` @ `e4cab09`; this doc is the
API-side reconciliation + checklist for when the next Full Dagster run lands the new zarrs.
**Date:** 2026-06-23
**Design SoT (do not duplicate — read first):**
`BWMACRO/docs/api_roadmap/v4_stock_specific_reset.md` (Tier-1 ER scalars, Tier-2 skill metrics,
SDK shape, migration) + `BWMACRO/docs/api_roadmap/ff_block_architecture_decision.md` (response
schema). This doc records only what **changed vs those plans** because of what actually shipped,
plus the deep-panel + CUSIP work the v4 plan doesn't cover, plus the first-customer onboarding.

> **Gating:** the new zarr levels / hedge vars / 2000 history only exist **after** the next Full
> `full_supabase_gcs` run. Do the code/doc changes now (they're backward-safe with `IF NOT
> EXISTS` / additive levels), but the contract tests pass only post-rebuild + post-sync.

---

## 0. What actually shipped (vs the v4 plan's assumptions)

| Area | v4 plan assumed | What shipped on ERM3 main | API impact |
|---|---|---|---|
| Strip math | "OLS strip of raw ff3; FWL ⇒ orthogonalization changes only attribution" | **Orthogonalized** strip — styles ⊥ each stock's assigned {market, sector, subsector} basis (raw spreads reintroduce a −0.30 industry tilt; the residual is genuinely industry-neutral) | No code change; **whitepaper/docs language must say "orthogonalized," not "raw OLS"** (the residual VALUES differ from a raw strip) |
| Style factor set | "FF3+UMD" / "size, value, momentum" (plan + `sequential_lstar_ff3_umd` name) | **2-factor `[SMB=IWM−IWB, HML=IWD−IWF]` (size + value) only** — momentum (WML) + RMW dropped per locked decision (QUAL/MTUM 2013 inception would break the 2000 panel); strip = `materialize_stock_specific_in_returns_zarr` | **whitepaper / `/api/decompose` / MCP copy must say "size + value (SMB, HML)," never "momentum" or "FF3+UMD"** for the style block. Plan docs corrected 2026-06-23 (`ff_block_architecture_decision.md`, `v4_stock_specific_reset.md`, backlog H.81) |
| Returns levels | `l2_ff_smb`, `l3_ff_smb_hml` (old parallel ff cascade) | **RETIRED** those; producer now writes `stock_specific_l3` + `stock_specific_lstar` | **BREAKING for the metric registry** — see §1 |
| ds_hedge ER vars | `Style_ER`, `StockSpecific_ER` `(symbol,)` | `Style_ER_l3`, `Style_ER_lstar`, `StockSpecific_ER_l3`, `StockSpecific_ER_lstar` — `(teo, symbol)`, **basis-suffixed** | Sync map needs the suffixed names + a basis decision — see §2 |
| History floor | ~2006 | **~2000** (deep panel; stock_specific from ~2001 after warmup) | Raise `years` cap + doc dates — see §3 |
| Symbology | n/a | **18,615 CUSIP aliases** in `security_master` | Auto-flows to resolve route — see §4 |
| "smarter lstar" | — | `stock_specific` is computed on the **L\*** (adaptive-depth) basis = the doubly-cleaned skill residual; `stock_specific_lstar` is the new skill feature | The skill metric (Tier 2) keys off `stock_specific_lstar` — see §2/§5 |
| lstar selector | fixed 1% threshold rule | **GBM selector ENABLED** (`config.yaml` `lstar.selector: "gbm"`, commit `2f8124b`) — bundled in this Full run (P3) | No API code change (reads `lstar_level` SSOT); **lstar VALUES shift 2007+** (pre-2007 → threshold). Terminal: lstar slice only, not betas/ER/HR/rankings — see §5 |

---

## 1. Metric registry — retire old ff levels, add stock_specific (BREAKING if skipped)

`lib/dal/zarr-metric-registry.ts:18-24` enumerates the `ds_erm3_returns` `level` values as
`market | sector | subsector | lstar | l2_ff_smb | l3_ff_smb_hml`. After the rebuild, **the two
`*_ff_*` levels no longer exist in the zarr** — any registry row pointing at them (lines ~121-130)
returns missing chunks (NaN/empty) on `/api/returns-decomposition`.

- **Add** levels `stock_specific_l3`, `stock_specific_lstar`, mirroring the `lstar_rr ← lstar`
  row (line 104): e.g. `stock_specific_rr_l3 ← stock_specific_l3`, `stock_specific_rr_lstar ←
  stock_specific_lstar`. `factor_return` / `combined_factor_return` are NaN placeholders at these
  levels (like lstar) — only `residual_return` is meaningful.
  **[DONE 2026-06-23]** — additive rows + `V3MetricKey` union members +
  registry test added; tsc + tests green. Backward-safe (new keys unread by any current endpoint).
- **Remove** the `l2_ff_smb` / `l3_ff_smb_hml` level entries + their metric rows —
  **DEFERRED, gated on the run + an `axis=style` decision (see below).** Two reasons it is NOT
  "now/backward-safe": (1) the old zarr is still live, so deleting these rows breaks the queries
  immediately, not just post-rebuild; (2) `l2_ff_smb_rr` / `l3_ff_smb_hml_rr` are not orphaned —
  `lib/risk/lstar-service.ts:176-177` (`dispatchStyleLstarResidualReturn`) reads them to serve the
  **style-axis residual return** on `/api/lstar?axis=style` and `/api/returns-decomposition`.
  > **Producer reality (ERM3 @ e4cab09):** `compute_ff3_style_cascade` is **still called**
  > (`erm3/core/risk_decomposition.py:752`) and still emits the FF *hedge* vars (`L2_ff_smb_ER`,
  > ff HRs — `risk_decomposition.py:1515-1524`), so the registry's FF **hedge** rows
  > (`l*_ff_*_er` / `l*_ff_*_hr`) stay valid and the style-axis ER/HR cascade survives. Only the two
  > FF **returns levels** were dropped from `ds_erm3_returns` (new full level set is
  > `[market, sector, subsector, lstar, stock_specific_l3, stock_specific_lstar]`,
  > `risk_decomposition.py:1028`). So the FF returns-level retirement orphans **only the style-axis
  > residual-return series**, not the whole style axis.
  > **DECIDED 2026-06-23 — retire the style-axis residual-return series** (option b). Style becomes a
  > diagnostic block (ER/HR only), matching the v4 "style is not co-equal" framing. The new
  > `stock_specific_lstar` is a *different* residual (industry-adaptive + style vs pure
  > market→SMB→HML), so repointing was rejected. **Post-landing atomic change** (do all together,
  > after the rebuild, never while the old zarr is live):
  > 1. Delete `l2_ff_smb` / `l3_ff_smb_hml` from the `level` union + the `l2_ff_smb_rr` /
  >    `l3_ff_smb_hml_rr` rows in `zarr-metric-registry.ts`, and the two keys from `V3MetricKey`.
  > 2. `lstar-service.ts` `dispatchStyleLstarResidualReturn` → return `null` for L2/L3 (keep L1);
  >    drop the now-dead `l2_ff_smb_rr` / `l3_ff_smb_hml_rr` references. Keep the FF **hedge** rows
  >    (`l*_ff_*_er` / `l*_ff_*_hr`) — ER/HR cascade is unaffected.
  > 3. Update the registry test (remove the two `_rr` assertions; FF hedge assertions stay) and the
  >    style-axis rr docstring in `lstar-service.ts`. Decide whether `axis=style` callers get
  >    `null` rr or a 410-style note in the response.
- Same two levels are also in **`ds_erm3_monthly`** (the producer relocated monthly compounding
  to end-of-1d specifically so monthly carries lstar + stock_specific) — any monthly reader gets
  them for free on the same `level` dim.
- Update `docs/ERM3_ZARR_API_PARITY.md` (the zarr-var ↔ API-key map) accordingly.

## 2. ER scalars → Supabase (reconcile the v4 plan's Part B/C with the shipped var names)

The v4 plan's `HEDGE_WEIGHTS_V2_TO_V3` add (`Style_ER→style_er`, `StockSpecific_ER→
stock_specific_er`) assumed un-suffixed `(symbol,)` vars. **Shipped vars are basis-suffixed and
`(teo,symbol)`**, and the producer's `emit_stock_specific_er_to_hedge` wrote all four this run
(confirmed in the run log). Decision needed:

- **Use the L\* (skill) basis for the headline scalars** — consistent with the v4 plan's own
  "Definitional decision" note (the style block operates on the lstar residual, so
  `style_er + stock_specific_er` = the lstar residual share). Map:
  - `StockSpecific_ER_lstar → stock_specific_er`
  - `Style_ER_lstar → style_er`
  (the sync's latest-teo slice handles the extra `teo` dim, same as other hedge vars).
- **Optionally also expose the L3 (hedge) basis** as `stock_specific_er_l3` / `style_er_l3` if you
  want the tradeable-basis variant in the response; otherwise skip for v1.
- Everything else in v4 plan Parts B/C stands: the `security_history_latest` `ADD COLUMN
  IF NOT EXISTS style_er, stock_specific_er` migration, and the wide-key auto-derivation.
- **Verification (NVDA):** `stock_specific_er ≤ l3_res_er`, `style_er ≥ 0`,
  `l1_mkt_er + l3_sec_er + l3_sub_er + style_er + stock_specific_er ≈ 1.0` (within lstar-vs-L3
  tolerance). These match the run's offline numbers (Style_ER≈0.03, StockSpecific_ER≈0.66).

## 3. Deep panel to 2000 (history floor moved)

The reader **auto-adapts** — `lib/dal/zarr-reader.ts:129-130` parses the CF epoch from each
array's `units` attribute, so a 2000-epoch zarr needs **no reader change**. What does need updating:

- **`lib/api/schemas.ts:22` — raise `YearsSchema` max from 15.** **[DONE 2026-06-23]** — set to
  **27**; it's a validation ceiling so raising it early is safe (requests just return whatever depth
  exists). Used by ticker-returns, lstar, l3/returns-decomposition, batch.
- **Doc/spec date strings (2006 → 2000-ish):** `OPENAPI_SPEC.yaml:8,27`, `README_API.md:19,22`,
  `SEMANTIC_ALIASES.md:233`. (Note: `stock_specific` series specifically starts ~2001 — 252-day
  warmup from the 2000-05 style-ETF inception; market/sector/subsector go back to ~2000.)
  **DEFERRED to land WITH the data** — these are published coverage claims (esp. the OpenAPI
  contract); advertising "2000" before the rebuild + sync is live would misadvertise coverage for
  the ~1 day until landing, with no upside. Flip them in the post-landing pass alongside §2/§3
  verification.
- **Regression-test deep ranges** — `docs/API_IMPROVEMENT_PROMPT.md` Finding 3 flags
  `/ticker-returns` 500s on long history; a 2000 floor makes max-range requests routine. Verify
  `/ticker-returns`, `/lstar`, `/returns-decomposition` at `years=26`.

## 4. CUSIP aliases (18,615) — already wired, just verify

The aliases land in Supabase `security_master`. The existing resolver
`app/api/data/security-master/resolve/route.ts` (gateway-auth, CUSIP/ISIN → `{ticker, symbol}`,
`valid_to IS NULL`) and `lib/dal/ticker-search.ts` consume that table directly — **no new
endpoint**. CUSIP/ISIN stay stripped from public responses (`lib/dal/symbol-metadata.ts`
`filterSafeMetadata` allowlist). **Verify post-sync:** a known CUSIP in the 18,615 set resolves via
the route; spot-check a delisted-name alias resolves to the right `bw_sym_id`.

## 5. Decompose / lstar surface (the named-blocks reshape — v4 plan §4/§5)

- `/api/decompose` (`app/api/decompose/route.ts`) today returns flat `market/sector/subsector/
  residual` from `l3_*` keys. The v4 reshape adds `stock_specific` as the headline noun + a `style`
  diagnostic block (exposures + incremental ER, `hedgeable:false`). Keep `decompose_legacy()` for
  current users (SDK §4). Industry = hedgeable; style = diagnostic — encode the asymmetry.
- **lstar — endpoint/shape unchanged, but VALUES shift this release (P3 bundled).** `/api/lstar`
  still serves the materialized `lstar` level + dispatched HRs, and the API reads `lstar_level` as
  SSOT (`lib/risk/lstar-service.ts` — "carries whatever selector ERM3 shipped"), so no API code
  change. **What changed:** this release also flips the ERM3 hedge-depth selector
  `threshold → gbm` (cost-aware walk-forward GBM; `ERM3/config.yaml` `lstar.selector: "gbm"`,
  committed `2f8124b`). So materialized `lstar_level` — and the dispatched HR/residual at that
  level — **differ from prior values for 2007-onward dates** (the GBM walk-forward snapshots span
  2007→2026; pre-2007 deep-panel dates safe-degrade to the threshold selector). Terminal change:
  per the config comment, flipping the selector moves only the lstar slice + Supabase lstar
  columns — **not** betas/ER/HR-cascade/rankings/L3 decomposition. Customer-facing impact (e.g.
  poesis.ai) is the lstar values, not the contract.
- "Smarter lstar" (separate from the selector flip) = the **`stock_specific_lstar`** residual built
  ON the lstar basis — the doubly-cleaned skill feature, surfaced via `stock_specific` (+ Tier-2
  `stock_specific_sharpe_36m`, `rank_percentile`), not a change to the lstar endpoint itself.
- Tier-2 skill metrics are **not pass-through** (36m / cross-sectional) — they come from the ERM3
  rankings producer keyed on `stock_specific_lstar`, per v4 plan §3 (still to be drafted: cohort
  definition for `rank_percentile`).

---

## 6. First customer — chris@poesis.ai

Onboarding email template: `BWMACRO/docs/NEW_CLIENT_ONBOARDING_EMAIL.md` (fill `{{client_email}}`
= chris@poesis.ai, `{{first_name}}`). Concrete prep:

1. **Provision a key.** Options (`app/api/auth/provision*`):
   - Self-serve (recommended, matches the email): point chris at `https://riskmodels.app/get-key`
     ($20 starter credit, daily cap). The email's Step 0 covers this.
   - Or operator-provision a paid key directly via `POST /api/auth/provision`
     (`{agent_name, contact_email: chris@poesis.ai, initial_deposit_usd}`) and hand him the
     one-time key.
   - For a courtesy launch, set `profiles.complimentary_professional` (bypasses the balance gate)
     or the `rate:300` premium scope if he'll batch.
2. **What's new to highlight** (the reason this customer waited on the data flip): the
   `stock_specific` skill residual + `style`/`stock_specific` explained-variance, and **history back
   to ~2000** (two extra cycles for backtests). Point him at `/api/decompose`, `/api/lstar`,
   `/api/returns-decomposition?include_lstar=true`, and the new skill metrics once Tier-2 lands.
3. **Tier/limits:** default pay-as-you-go = 60 RPM (burst 100). If poesis batches universes, grant
   the `rate:300` scope (300/min). Free tier (`/api/auth/provision-free`, 100 q/day) only if he
   wants a no-card trial first.
4. **Don't send until** the Full run lands + sync populates `style_er`/`stock_specific_er` and the
   2000 history is live (else he sees empty stock_specific + a 2006 floor). Gate the send on §2/§3
   verification passing.

---

## Execution order
1. (Now, backward-safe) registry §1, schema cap §3, sync-map §2, migration §2 with `IF NOT EXISTS`,
   doc date strings §3.
2. **ERM3 Full run lands the new zarrs + sync populates the columns** (the gating step).
3. Run the §1–§4 verifications + the contract tests (`docs/API_HISTORY_SUPABASE_AND_ZARR.md`
   checklist: metric registry, zarr-reader, risk-engine-v3, cache, contract tests).
4. Ship the decompose/lstar reshape §5 (v4 plan §4/§5) — can trail the data landing.
5. Onboard chris@poesis.ai §6 once §2/§3 verify green.

Cross-refs: `BWMACRO/docs/api_roadmap/{v4_stock_specific_reset,ff_block_architecture_decision,
current_state}.md`, `BWMACRO/docs/ceo/HANDOFF_ERM3_GATES_FF_FRENCH_V4_20260620.md`,
`docs/ERM3_ZARR_API_PARITY.md`, `docs/API_HISTORY_SUPABASE_AND_ZARR.md`.
