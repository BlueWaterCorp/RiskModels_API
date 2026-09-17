# HANDOFF — 13F portfolio toolkit

**This project was closed on 2026-09-07 because the author moved off it, not because it was
finished.** Nothing here is abandoned mid-edit: every open thread is either completed or
explicitly scoped out below with the reason. If you are picking this up cold, read this file
first, then [FINDINGS.md](FINDINGS.md) for the results.

Author: Nijat Aliyev (UCLA MFE intern, Blue Water Macro). Reviewer: Conrad Gann.
Branch `feat/13f-attribution-toolkit`. SDK: `riskmodels-py` 0.3.11.

---

## 1. What this is

A toolkit for decomposing institutional 13F books through the RiskModels hierarchical factor
model, built to answer two questions.

**The model.** Every stock's daily return splits into four orthogonal, additive layers —
market (L1), sector net of market (L2), subsector net of sector (L3), and idiosyncratic
residual. They sum to gross return to ~5e-10 per day. Hierarchical L1→L2→L3, so "sector" is
the tilt *net of* market — a tradeable quantity, not a raw exposure.

**13F filings** are quarterly SEC disclosures of US equity holdings by institutions managing
over $100M. Public, but published up to 45 calendar days after quarter end.

**Strand A — Berkshire attribution and the reporting lag.** Did the factor layers pay, and
what survives the 45-day publication delay? Answer: dropping the idiosyncratic sleeve improves
risk-adjusted return, and that improvement survives the lag. The book's outperformance is beta,
not alpha.

**Strand B — D. E. Shaw report-date study.** What does D. E. Shaw's disclosed book do in the
days right after quarter end, and is it momentum or mean reversion? Answer: nothing that
survives a control. The post-report rise is not distinguishable from a typical window, from
market beta, or from a size-and-sector-matched random book. The book is a Leading/Lagging
barbell rather than a momentum book.

Full results with numbers: **[FINDINGS.md](FINDINGS.md)**.

---

## 2. Read in this order

| Order | File | What it gives you |
|---|---|---|
| 1 | **HANDOFF.md** (this) | orientation, architecture, how to run, limitations |
| 2 | **[FINDINGS.md](FINDINGS.md)** | the results, standalone, forwardable |
| 3 | [LAGGED_RESULTS.md](LAGGED_RESULTS.md) | Berkshire method + per-stage detail |
| 4 | [DESHAW_REPORT_DATE.md](DESHAW_REPORT_DATE.md) | D. E. Shaw method + per-section detail |
| 5 | [DATA_ISSUES.md](DATA_ISSUES.md) | every API/data defect found, newest first |
| 6 | [MCP_SETUP.md](MCP_SETUP.md) | environment/credentials setup and known API gotchas |

These six are the whole record. The working history behind them — chronological session logs,
the original scoping diagnostic, and the point-in-time meeting packs written for specific
review meetings — was deliberately **not** committed: it is process ephemera, it carries
superseded numbers, and everything in it that still holds has been folded into the six
documents above. If a number is not in one of these six, do not quote it.

---

## 3. Architecture

Everything is under `sdk/portfolio_timeseries/`. Two layers: a reusable pipeline, and
filer-specific analyses built on it.

### The pipeline (reusable)

| Module | Role |
|---|---|
| **`build_lagged.py`** | The core. All data access, caching, window primitives, the validation gate, and Stages 0–2 for any filer. Everything else imports this. |
| `portfolio_timeseries.py` | `PortfolioTimeSeries` — a filer's book as a bi-temporal xarray Dataset with point-in-time-safe `as_of`. |
| `schema.py` | The xarray schema and `as_of_snapshot`, the anti-look-ahead core. |
| `market_neutral_overlay.py` | `n_leg_hedge` — generalises `riskmodels.pair_trade` netting from 2 legs to N. |
| `regime_split.py` | Bridges factor-level regime labels to per-name labels, splits a window return by bucket. |
| `rrg_classifier.py` | Port of Aman Dhillon's relative-rotation-graph classifier. Labels sector/subsector *factors* into Leading/Improving/Weakening/Lagging. |
| `factor_model.py` | **Stub.** A K=4 style block was scoped but the methodology was never delivered. Left deliberately unimplemented — see §8. |

### Key functions in `build_lagged.py`

```
portfolio_rows(filer)              endpoint quarterly rows (teo, gross, layer returns)
holdings_for_teo(filer, teo)       the book reported FOR that quarter, escalating as_of
returns_series(ticker)             daily gross returns, 13y, cached
decomp_series(ticker)              daily 4-layer additive decomposition, 15y, cached
window_return(tk, start, end)      buy-and-hold over (start, end], NaN days dropped
portfolio_window_return(...)       Σ w·R renormalised to covered names
name_layer_windows / portfolio_window_layers    the same, per layer
entry_date(teo)                    teo + 45 CALENDAR days, rolled to next trading day
fwd_quarter_end(teo)               teo + 3 calendar months
gate_verdict(mean_abs_diff_bps)    CLEAN / PROCEED_WITH_FLAG / STOP
stage0 / stage1 / stage2 / stage2_validate
```

### The analyses

| Module | Strand | What it does |
|---|---|---|
| **`reaudit_berkshire.py`** | A | **The current source of truth for every Berkshire number.** Re-runs Stages 0–2 on the fixed code, diagnoses the terminal-row and stub-row defects, resolves the sector-vs-subsector question, and rebuilds the Sharpe bridge. Writes `cache/reaudit_berkshire.json`. |
| `build_audit_xlsx.py` | A | Builds `attribution_audit.xlsx` from `cache/reaudit_berkshire.json`, with live Excel formulas. |
| `verify_audit_xlsx.py` | A | Evaluates every formula in the saved workbook and checks it against numpy. openpyxl writes formulas without evaluating them, so without this a malformed formula ships silently. |
| `cost_estimate.py` | A | Transaction-cost haircut on the sector+subsector sleeve, from measured turnover. |
| `deshaw_report_date.py` | B | The window study: windows A–E, same-quarter control, SPY regressions, fiscal-quarter split. |
| `deshaw_regime.py` | B | Splits the window return by RRG regime quadrant. |
| **`deshaw_regime_beta.py`** | B | Strips market beta out of the regime split. This is what determines whether §5 of the D. E. Shaw doc is a finding or an artifact. |
| **`deshaw_size_control.py`** | B | The size-and-sector-matched placebo control. The decisive test of whether the post-report rise is D. E. Shaw-specific. |
| `deshaw_fetch.py`, `deshaw_fetch_history.py` | B | Data prefetch. Resumable. **These are the only scripts that spend money.** |
| `deshaw_analyze.py` | B | The lagged D. E. Shaw pipeline. Gated at Stage 0, which it FAILS — it publishes nothing. |

### Charts and one-off scripts

`chart_*.py`, `charts_raw_vs_hedged*.py`, `compute_*.py`, `wire_filers.py`,
`build_presentation.py`, `demo_overlay*.py`, `_chartkit.py` are presentation and exploration
work from earlier sessions, mostly around the market-neutral overlay rather than the lag study.
They run, but they are not on the critical path for either strand's conclusions.


---

## 4. How to run it

Everything below runs **from cache and costs nothing**. Credentials come from the environment
via `RiskModelsClient.from_env()` — never pass keys on a command line.

```bash
cd "sdk/portfolio_timeseries"
```

**Tests** (56 tests, hermetic except the live module, which needs credentials):
```bash
cd sdk && python -m pytest portfolio_timeseries/tests/ -q
```

**The Berkshire re-audit — start here, it regenerates every headline number:**
```bash
python reaudit_berkshire.py
```

**The audit workbook, and its verification:**
```bash
python build_audit_xlsx.py && python verify_audit_xlsx.py
```

**Transaction costs:**
```bash
python cost_estimate.py
```

**D. E. Shaw window study, regime split, beta adjustment, size control:**
```bash
python deshaw_report_date.py
python deshaw_regime.py
python deshaw_regime_beta.py
python deshaw_size_control.py 500
```

**Raw pipeline stages for any filer** (`Berkshire`, `Pershing`, `Appaloosa`, `Greenlight`, `DEShaw`):
```bash
python build_lagged.py 0 Berkshire
python build_lagged.py all Berkshire
```

### Things that DO spend money

`deshaw_fetch.py` and `deshaw_fetch_history.py` fetch uncached names at roughly $0.02 per
call, two calls per name (returns + decomposition). The full-history D. E. Shaw coverage
extension cost **~$46 for 767 names**. Both are resumable — a kill loses nothing, and
already-cached names are skipped instantly.

Every analysis script sets `build_lagged.CACHE_ONLY = True`, so analysis never triggers a
fetch. A partially-fetched universe yields partial coverage, which is reported on every
result rather than silently filled. **Keep it that way.**

---

## 5. The validation gates — and why they exist

The gates are the most important methodological thing in this project. They were set
**before** any lagged analysis ran, so a marginal result could not retro-fit the bar.

### Stage 0 — can the pipeline reproduce something already known?

Before any lagged number is computed, rebuild the **unlagged** series the endpoint already
provides, from daily name-level data, and compare. `build_lagged.gate_verdict()`:

| mean \|rebuild − endpoint\| | verdict | consequence |
|---|---|---|
| < 25 bps | CLEAN | proceed |
| 25–75 bps | PROCEED_WITH_FLAG | proceed, and state the flag on every result |
| > 75 bps | **STOP** | publish nothing downstream, in any form |

The **mean** is the gate, not the median — the median hides exactly the tail quarters where a
rebuild diverges most.

This gate is not advisory, and it has been enforced in both directions:
- **Berkshire passes at 61 bps** (n=42) → results published, flagged.
- **D. E. Shaw fails at 78 bps** → no lagged D. E. Shaw survival, Sharpe, or CAPM figure has
  ever been published. The failure is structural, not fixable: coverage plateaus around 85%
  because the remaining names are intentionally outside the ERM3 3000 universe and have no
  daily data at any price.

### The layer-validation gate

Before publishing a layer split, reproduce the endpoint's own unlagged per-quarter layer
returns. Bar: median |diff| < 50 bps.
- Berkshire passes on all four layers (market 17, sector 4, subsector 1, idio 29 bps).
- **D. E. Shaw fails on the idiosyncratic layer** (median 59 bps) and its layer split is
  withheld entirely — including qualitatively, in either direction.

### Point-in-time discipline

Any regime label attached to a report date must use only data available at that date. Verified
two ways: against the live factor plane at 8 dates spanning 2001–2026, and hermetically in
`tests/test_rrg_causality.py`.

---

## 6. Established facts — do not re-derive these

These cost real time to establish.

### API and data semantics

- **`available_date` does not exist.** Not on portfolio rows, not on the holdings envelope. An
  earlier note claimed it existed and was null — that was wrong and is corrected.
  **`filing_date` is the canonical knowledge-time field for 13F.** The `availability_date`
  spelling belongs to ETF/benchmark endpoints only. (The `available_date` *dimension* in
  `schema.py` is an internal coordinate name populated from `filing_date`; that is a naming
  collision, not a claim about the API.)
- **Entry rule:** `report_date + 45 CALENDAR days`, rolled forward to the next trading day.
  **Not trading days.** Verified: 2026-03-31 → 2026-05-15; 2025-12-31 → 2026-02-17 (45 days
  lands on a Saturday, and the Monday is Presidents' Day). Pinned in
  `tests/test_window_primitives.py`.
- **Filing dates are ~63–68% synthetic** across all five filers — exactly `report_date + 45`.
  `search_filers` exposes `metadata.filing_date_source = "placeholder_lag_75d"` (a different,
  cruder +75 default we do not use). We did not measure filing behaviour; 45 days is the
  statutory convention baked into the data.
- **`filing_type` and `amendment_type` do exist** on the holdings envelope and are populated
  historically. Filtering to ORIGINAL collapses the amendment-contaminated lag tail
  (Berkshire max 228 → 66 days).
- **`get_returns_decomposition(ticker, years=15)`** is the correct source for per-name layer
  work. **Not `l3_*_er`** — those are variance shares, not return weights; using them as return
  weights fails validation by ±440–530 bps.
- **`adj_mv` has an unfixed 1000× scale bug**, varying by filer within the same quarter.
  Weights and betas are scale-invariant so no result here is affected, but **dollar labels are
  unreliable**.
- **Daily returns floor is 2013-07-29.** This caps every study at ~13 years regardless of how
  much holdings or portfolio history exists. It is the binding constraint, and no amount of
  filing history helps.
- **Factor plane:** `gs://rm_api_public/eodhd/ds_synth_factors.zarr`, anonymous access, needs
  `gcsfs` + `zarr`. **Ends 2026-07-02** — regime labels cannot run past that without a refresh.

### Two bugs that moved published numbers

**1. NaN-day poisoning** (found 2026-08-17, fixed). `window_return` compounded `∏(1+r)` without
dropping NaN days. A single NaN day for one name returned NaN, which still counted toward
`covered` while poisoning the whole portfolio sum, so quarters vanished silently with
healthy-looking coverage. Found via Zillow in D. E. Shaw's 2013-Q4 book — 0.03% of book weight,
killed the entire quarter. Effects: D. E. Shaw n 36→49 and the headline **flipped**; Berkshire
n 35→42 and lagged Sharpe 0.85→0.99.

**2. Terminal-row defect** (found 2026-09-07, this closeout). **The last row of
`get_filer_portfolio` carries a forward return measured over an open-ended window — teo to the
engine's data horizon — not the one-quarter forward window every other row uses.** Evidence:
each row's `portfolio_market_return` tracks SPY over its own forward quarter to ~60 bps median,
but the terminal row deviates by 2.7× to 34× that, and the horizon that would reproduce it is
never one quarter:

| filer | terminal teo | deviation vs SPY | × filer's median | implied horizon |
|---|---|---:|---:|---:|
| Berkshire | 2025-12-31 | +1242 bps | 21× | 1.9 quarters |
| Greenlight | 2023-12-31 | +4146 bps | 34× | 9.2 quarters |
| Appaloosa | 2026-03-31 | +790 bps | 7× | 0.7 quarters |
| D. E. Shaw | 2026-03-31 | +262 bps | 5× | 0.7 quarters |
| Pershing | 2026-03-31 | +130 bps | 3× | 0.7 quarters |

Greenlight is decisive: its last filing is 2.5 years stale, and its "one quarter" return
matches SPY over **9.2 quarters**. **Always drop the terminal row from quarter-aligned
analysis.** Including it pushed Berkshire's Stage 0 gate from 61 bps (pass) to 84 bps (STOP) on
the strength of one row.

**If you find a third bug of this class, check every result computed through the same path.**
Both of these moved headline numbers.

### The three "missing-book" quarters are stub rows

Berkshire 2014-09-30, 2020-09-30 and 2025-03-31 carry a `portfolio_gross_return` but no
holdings snapshot. They are **not** missing books — the endpoint rows describe a portfolio of
one or two names:

| teo | n_holdings_active | AUM | vs median kept quarter |
|---|---:|---:|---:|
| 2014-09-30 | 1 | $620M | 0.845% |
| 2020-09-30 | 1 | $386M | 0.526% |
| 2025-03-31 | 2 | $885K | 0.001% |

(Median AUM of the 42 kept quarters: $73.4B.) No holdings book matches them because there is no
full book behind them. `get_filer_holdings(as_of=...)` correctly falls back to the prior
quarter's ORIGINAL. **Not recoverable, and not worth recovering** — they do not describe the
filer's book. Their drop-idio returns average 837 bps/q against 372 for real quarters, which is
the entire reason the 46-quarter Sharpe of 1.003 looked good.

### The teo series, reconciled

For Berkshire: 50 rows returned → 46 carry a gross return → 43 have a matching holdings book →
drop the terminal row → **42 usable**. Only **2021-06-30** is genuinely absent from the series;
2013-06-30, 2015-06-30, 2023-09-30 and 2023-12-31 are *present as rows but carry no gross
return*. (An earlier note called all four "gaps" — imprecise.)

### Two unlagged constructions — do not mix them

This is subtle and it bit the earlier workbook.

- **UNLQ** — `teo → teo + 3 calendar months`, a fixed forward quarter. This is the endpoint's
  own window definition. Use it to compare rebuild against endpoint (Stage 0, layer validation,
  Sharpe-bridge step C).
- **UNLT** — `teo_i → teo_j` where *j* is the next teo with a usable book, q_len-normalised.
  This mirrors the lagged window structure exactly, so lagged-minus-unlagged isolates the
  45-day entry shift and nothing else. Use it for "does the premium survive the lag".

They coincide except on the 6 windows that span a missing book. `attribution_audit.xlsx` now
carries both, labelled.

### Conventions

- **All Sharpes are GROSS** — no risk-free deduction, anywhere. Quarterly data annualised by
  `√4`. This must be stated wherever a Sharpe is quoted.
- Coverage is stated on every D. E. Shaw result (~85–93%).
- Window bounds are half-open `(start, end]`, so chained windows do not overlap.

---

## 7. Known limitations

Each of these is a property of the data, not a defect in the code.

1. **~13 years, not 20.** The 2013-07-29 daily-returns floor binds. Berkshire's stronger
   pre-2013 alpha is out of sample, which is part of why alpha reads ~0 here.
2. **D. E. Shaw coverage plateaus at ~93%** (~85% before the history extension). The tail is
   intentionally outside the ERM3 3000 universe and has no returns at any price. The
   idiosyncratic layer — the arithmetic remainder, hence the most coverage-sensitive — cannot
   be rebuilt from a partial universe. This is why the D. E. Shaw layer split is withheld.
3. **Subsector regime coverage is ~10%** of D. E. Shaw book weight. Only 8 subsectors exist in
   Aman's factor universe. Sector-level (91%) is the only usable regime split. Never quote
   subsector quadrant numbers.
4. **The zarr factor plane ends 2026-07-02.** Regime labels cannot run past early July 2026.
5. **`adj_mv` scale bug** — dollar labels unreliable; weights and betas fine.
6. **Statistical power is the binding constraint on every result.** Nothing clears
   significance on a single filer. See §9.
7. **The vendored SDK is one release behind.** `sdk/riskmodels/` is the build source for the
   `riskmodels-py` wheel and sits at 0.3.10 while the installed wheel is 0.3.11. Because
   `sdk/portfolio_timeseries/tests/` and `portfolio_timeseries/` both have `__init__.py` but
   `sdk/` does not, pytest computes the package root as `sdk/` and prepends it, so
   `import riskmodels` used to resolve to 0.3.10 and skip the entire live test module.
   **Worked around** in `tests/conftest.py` (drop `sdk/` from `sys.path`, import riskmodels so
   the installed distribution wins and caches in `sys.modules`, restore). That is a workaround,
   not a fix. **The real fix is to sync `sdk/riskmodels/` to 0.3.11, which is a cross-repo
   release action outside this module's scope.** Related: `sdk/tests/` has no `__init__.py`, so
   its 344 tests have been validating the *installed wheel*, not the checked-in source — the
   0.3.10 source currently has no unit coverage.
8. **Size matching in `deshaw_size_control.py` is not point-in-time.**
   `ffx_constituents_latest.csv` is a single 2026-07-02 snapshot, so sector membership and
   relative size are applied historically. Acceptable because it only defines a control group
   and cannot leak into the measured return, but a name that changed size a lot over 13 years
   is matched on its end-of-sample size. Stated on the result.

---

## 8. What was closed, and why

Judgement calls made during the closeout. None of these are dangling.

| Item | Decision | Reason |
|---|---|---|
| **Multi-filer extension** | **Not pursued.** The primary recommendation for anyone resuming — see §9. | It is the right next step and needs more time than remained. Scoping it properly was more valuable than starting it badly. |
| **SDK integration** (Conrad's ask) | **Proposed in writing, deliberately NOT executed.** See §10. | A refactor this late risked destabilising results that had just been re-verified after two bugs. A documented plan is worth more than a rushed move that breaks a verified number. |
| **K=4 style block** (`factor_model.py`) | Left a stub. | The style block must be orthogonalized against the subsector block, and that methodology was never delivered. Inventing it would have produced a plausible, unvalidatable number. |
| **D. E. Shaw lagged backtest** | Withheld entirely. | Failed Stage 0 at 78 bps. Structural, not fixable by more fetching. |
| **D. E. Shaw layer split** | Withheld entirely, including qualitatively. | Failed the layer gate on the idiosyncratic layer at 93% coverage. |
| **The three stub quarters** | Closed as a permanent exclusion. | They do not describe the filer's book (§6). |
| **Terminal-row defect** | Fixed by exclusion; reported to be raised with the API team. | We can detect and drop it; we cannot fix it upstream from here. |
| **Vendored SDK shadow** | Worked around in-scope; real fix documented as cross-repo. | See §7.7. |
| **Bottom-up vs top-down overlay** | Left as an open design question. | A genuine product decision for Conrad, not a technical gap. The overlay does not hedge sectors the book omits entirely; that is a design property, documented, not a bug. |
| **Leverage cap on the overlay** | None applied; flagged. | Same open question as `pair_trade`'s `leverage_cap`. Needs a decision, not analysis. |

---

## 9. If you resume this — do this first

**Do first: extend to more filers.** Statistical power is the binding constraint on
everything here. Nothing clears significance on a single filer, and no amount of extra care on
Berkshire alone will change that.

The critical, non-obvious point: **screen filers on how much of the disclosed book is actually
disclosed — before anything else, including concentration.**

That rule is the corrected version of one this project got wrong. The earlier advice was "select
by book concentration, not manager profile", on the evidence that the pipeline handled a 25-name
book well (Berkshire, 61 bps) and a 2,000-name book badly (D. E. Shaw, 78 bps). Pershing Square
was then run as a third filer on exactly that reasoning — it is the *most* concentrated book
available (median effective N 3.3, against Berkshire's 4.0). **It failed the gate at 195 bps.**

The reason is `BW-RESTRICTED` confidential-treatment rows: holdings the manager has asked the SEC
to withhold, which arrive with `ticker: None` and have no market data at any price.

| Filer | median restricted weight | max | Stage 0 | verdict |
|---|---:|---:|---:|---|
| Berkshire | **1.2%** | 6.3% | 61 bps | PASS |
| D. E. Shaw | 16.9% | 44.4% | 78 bps | FAIL |
| Pershing | **22.7%** | **100.0%** | 195 bps | FAIL |

Pershing has quarters where the *entire* disclosed book is confidential. The one filer that
passes the gate is the one whose book is essentially fully disclosed. Concentration was never the
binding constraint — completeness was, and it happens to correlate with the concentrated activist
managers who use swaps and request confidential treatment most.

**The screen, in order, all cheap:**
1. Pull one `get_filer_holdings` call and compute the share of book weight in rows with no
   ticker. **Above ~10% and the filer is probably not studiable.** This costs one call.
2. Then check `effective_n` / `top10_weight_sum` for concentration.
3. Then run Stage 0, which is cheap and definitive.

**Expect filers to fail. Two of the three tried did.** That is the gate working, and it is the
main reason to run the screen before spending on a returns fetch rather than after.

Appaloosa is the remaining untried candidate (n≈27, effective N ≈12, history only back to 2016).
Greenlight is not worth trying: its last filing is 2023-12-31 and its largest single position is
a confidential row.

**Do not bother with:**
- Re-deriving anything in §6. It cost real time.
- Trying to recover the three stub quarters (§6). They are not Berkshire's book.
- Pushing D. E. Shaw coverage past 93%. The remaining tail has no data at any price, and the
  idiosyncratic layer still failed validation at 93%.
- Chasing the Q2/June fiscal-quarter result. It is one of four correlated tests on n≈12 with no
  ex-ante reason to single out June.
- Re-running the ~$46 D. E. Shaw history fetch. The cache is complete and regenerable but not
  free — check `cache/` before fetching anything.

---

## 10. SDK integration — the proposed split (NOT executed)

Conrad asked for this work to move into the SDK. My read, written down rather than performed:

**Promote to the SDK** — general, tested, filer-agnostic:
- the window primitives (`window_return`, `portfolio_window_return`, `name_layer_windows`,
  `portfolio_window_layers`) with their NaN and coverage-renormalisation semantics
- `entry_date` / `fwd_quarter_end` (the +45-calendar-day convention)
- `gate_verdict` and the Stage 0 validation pattern
- the caching layer, generalised behind an injectable store
- `n_leg_hedge`, which already generalises `riskmodels.pair_trade`

**Leave as analysis** — filer-specific, publication-shaped, not reusable:
- `reaudit_berkshire.py`, `deshaw_*.py`, every `chart_*.py`, `build_audit_xlsx.py`

**Why it was not executed.** The pipeline had just been re-verified after two bugs that each
moved headline numbers. Moving the same code into a different package, with a different import
path and a different cache root, at the end of the project and with no one left to re-verify
it, trades a working verified artifact for an unverified one. The split above is
straightforward for whoever owns the SDK; it should be done with the tests in
`tests/test_window_primitives.py` moved alongside the code, and Stage 0 re-run on Berkshire
afterwards to confirm 61 bps still reproduces.

**Scope guardrail observed throughout:** nothing outside `sdk/portfolio_timeseries/` was
modified, and `sdk/riskmodels/pair_trade.py` was not touched.

---

## 11. Data sources

| Source | What | Notes |
|---|---|---|
| `get_filer_portfolio(fid)` | quarterly rows: teo, filing_date, gross + 4 layer returns, HHI, AUM | forward-aligned; **terminal row defective** |
| `get_filer_holdings(fid, as_of=, limit=1000)` | the book, with `filing_type` / `amendment_type` | 1000-row cap; raises `APIError` below the floor, does not return `[]` |
| `get_ticker_returns(tk, years=13)` | daily gross returns | floor **2013-07-29** |
| `get_returns_decomposition(tk, years=15)` | daily additive 4-layer split | floor 2011-07-27; ~$0.02/call |
| `gs://rm_api_public/eodhd/ds_synth_factors.zarr` | 106 daily factor return series, 2000-01-04 → **2026-07-02** | anonymous; needs `gcsfs` + `zarr` |
| `ffx_constituents_latest.csv` | ticker → FFX factor map with within-factor cap weights | from Aman; single snapshot dated 2026-07-02 |

**Filer IDs** (resolve via the deterministic `BW-FILER-CIK{cik.zfill(10)}` form — `search_filers`
does not match zero-padded CIK strings):

```
Berkshire   BW-FILER-CIK0001067983      Appaloosa   BW-FILER-CIK0001656456
Pershing    BW-FILER-CIK0001336528      Greenlight  BW-FILER-CIK0001079114
D. E. Shaw  BW-FILER-CIK0001009207
```

Two CIKs from the original brief do not exist as filer IDs (Appaloosa `0001006438`, Greenlight
`0001522887`/`0001080124`); the working IDs above were found by name search.

**`cache/` is gitignored and fully regenerable — currently ~599 MB** (2,794 files: 1,325 return
series, 1,323 decompositions, 127 holdings vintages, 5 portfolio series, plus stage and result
JSON). Regenerating it from scratch would re-spend the fetch cost, so do not delete it casually.

---

## 12. Test suite

**56 tests, all passing, 0 skipped.**

| File | Covers |
|---|---|
| `test_window_primitives.py` | window compounding and half-open bounds; **NaN regression tests for the bug that moved published results**; coverage renormalisation; layer additivity; the +45-calendar-day entry convention; gate thresholds |
| `test_rrg_causality.py` | point-in-time property of the RRG classifier — truncation reproduces, future shocks cannot rewrite past labels |
| `test_schema.py` | `as_of_snapshot` anti-look-ahead behaviour |
| `test_n_leg_hedge.py` | N-leg netting math, including 2-leg equivalence with `riskmodels.pair_trade` |
| `test_regime_split.py` | factor→name bridge and bucket partitioning |
| `test_portfolio_timeseries_live.py` | live API integration; skips cleanly without credentials |

The suite previously reported "18 passed, 1 skipped" — that skip was hiding a genuine failure
(a hardcoded date in `test_as_of_current_returns_latest_snapshot` that broke when a newer 13F
landed). Both the shadow and the stale assertion are fixed; the test is now date-independent.
