# D. E. Shaw — Report-Date Window Study

*Nijat · 2026-08-17, updated at closeout 2026-09-07. Characterisation, not a backtest. Read §0 and §6 before quoting any number. **Numbers are at full coverage (median ~93%), n=49. All Sharpes and returns are GROSS.***

> **Closeout update (2026-09-07).** Two things were added and one conclusion changed:
> **§5.1** strips market beta out of the regime split — the quadrant return differences do
> **not** survive it, so §5 is now reported as beta, not as a regime effect. **§2.1** adds a
> size-and-sector-matched placebo control, which finds the post-report rise is **not**
> D. E. Shaw-specific. Both strengthen the deflationary reading. The positioning result (the
> Leading/Lagging barbell) is unaffected. Reproduce with `deshaw_regime_beta.py` and
> `deshaw_size_control.py`.

> **What this is.** For every studiable quarter we take D. E. Shaw's *disclosed* 13F book and measure what it does over short trading-day windows immediately after the quarter-end report date. **This is a characterisation of how the firm positions into quarter-end. It is NOT a strategy and NOT tradeable** — the book is not public until ~45 calendar days after quarter-end, so nobody could have held the +1..+10-day window in real time. Every performance figure below is gross, coverage-limited, and pre-disclosure.

> ### ⚠️ CORRECTION, 2026-09-22 (PR review): the "commercial window" was measured in the wrong place
> Windows here are **trading-day** offsets from quarter end. The book goes public at **calendar**
> teo+45, which is a median of **32 trading days** (range 30–33), not 45. So the old
> D (+35..+45) and E (+45..+55) report-anchored windows were *both already post-public*, with E
> sitting **13–23 trading days after disclosure** rather than the "10 days after filing" §4
> claimed. **The commercial window was never actually measured.** D and E are now anchored to
> `build_lagged.entry_date(teo)`: **D = the 10 trading days ending at disclosure**, **E = the 10
> trading days after it**. Every E figure below is re-run on that basis. Windows A/B/C, the
> same-quarter control and the A regressions are report-anchored and are **unchanged**.
> The §4 conclusion survives, but the numbers behind it and the "coin flip" wording did not —
> see §4.

> ### ⚠️ Headline changed between runs — read this first
> A first pass ran on **36** quarters and found the post-report window clearly special (paired t≈2.9). That pass was **wrong**: a NaN-handling bug (see §0) silently dropped **13 early quarters (2013–2017)**, leaving only the strong 2017–2026 subsample. Fixed, on the **full 49 quarters at ~93% coverage**, the headline is **much weaker**: the post-report window is **not distinguishable** from a typical same-quarter window (paired **t=1.15**), and a regression says the post-report return is **levered market beta with ~zero alpha** (α t=−0.64, β=1.29). The honest finding is deflationary. This is exactly the "dropped quarters were unusual and the result moved materially" problem, caught on our own data.

---

## 0. What is measurable — the achievable window, and the effective n

Determined empirically, not assumed:

| Constraint | Value | Source |
|---|---|---|
| D. E. Shaw portfolio series | 81 quarters, 2005-12-31 → 2026-03-31 | `get_filer_portfolio` |
| Earliest daily return (`get_ticker_returns`) | **2013-07-29** | probed across the cached universe + SPY |
| Earliest decomposition (`get_returns_decomposition`) | 2011-07-27 | probed across the cached universe |
| Earliest holdings with `report_date == teo` | 2013-09-30 | escalating-`as_of` probe; all 31 older books present |
| **Studiable report dates** | **49 quarters, 2013-09-30 → 2026-03-31** | book exists AND the post-disclosure window (entry+1..+10 trading days) inside the return calendar |

**Conrad asked for 20 years; the honest number is ~13 (49 quarters).** The binding constraint is the **daily-return floor of 2013-07-29** — not holdings (books exist to 2013-09-30) and not the decomposition (2011). D. E. Shaw filed back to 2005, but there are no daily returns before mid-2013 to measure against.

### Effective n = 49 of 49 (after a bug fix that changed the result)

The first analysis produced window returns for only **36** of the 49 studiable quarters and did not say why. The 13 missing quarters were **2013-09-30 through 2017-06-30** — every one had 63–70% coverage and 257–300 covered names, so it was **not** a coverage or missing-book problem. The cause was a bug:

> **NaN-day poisoning in the gross-return path.** `window_return` compounded `∏(1+r)` over a name's window **without dropping NaN return days**. A single name with one NaN day returns NaN, which still counted toward `covered` but poisoned the whole portfolio sum. In 2013-09-30, one freshly-IPO'd name — `Z` (Zillow), **weight 0.03%**, all 10 window days NaN — nulled the entire quarter. The decomposition path already dropped NaN days; the gross path did not.

Fixed (drop NaN days before compounding, skip all-NaN names), **all 13 quarters populate → n = 49, 0 dropped.** Coverage median **92.9%** (min 75.0%, max 95.2%).

**Why this matters (per Conrad's Berkshire lesson):** the 13 dropped quarters were **not** random — they were the early half of the sample, and the early half is *weaker*. Recovering them **cut the headline roughly in half.** The finding was an artifact of which quarters the bug happened to keep. (With the fix, 0 quarters drop, so there is no dropped-vs-kept set left to compare — the whole 49 are in.)

> ⚠️ **The same bug is in the shared `build_lagged.window_return`, so it also affected the prior Berkshire lagged results** (n 35→42 windows, lagged gross Sharpe 0.85→0.99 once fixed). That is a *separate* deliverable that has already been audited and presented; it is **flagged for a dedicated re-run, not silently rewritten here.** See [DATA_ISSUES.md](DATA_ISSUES.md).

**Coverage caveat (carry it through).** D. E. Shaw's book is diffuse (~2,000 names, 1,000-row API cap; ~90% of weight in ~550 names). The illiquid tail is **intentionally excluded from the ERM3 3000 universe** (confirmed: by design), so those names have no returns. We renormalise to the covered book — an **explicit imputation** (the uncovered weight is assigned the covered book's return) — and report coverage on every result. **Characterisation figures, not validated performance.**

**Coverage basis (stated per PR #373 review, finding 6).** Every coverage figure here is an **absolute share of the full book**: the endpoint's weights are weights of the whole book and sum to <1 when the 1,000-row cap truncates it, so names past row 1,000 count as uncovered by construction. That cap bites on **71 of 74** D. E. Shaw books, leaving a median **0.4%** (max 3.2%) of weight unlisted — small, but it never appears in a `missing` list, which is why it is stated here. The SDK offers no paging. The ~93% window coverage is therefore ~93% of the whole book, with restricted (`BW-RESTRICTED`, median 16.9% of weight) and unlisted names both outside it.

**Spend note.** The cache only reached back to 2021 (prior session fetched the last 20 quarters). Because the request was for the *full available history*, I extended the returns+decomposition cache back to the 2013 floor across the top-92%-weight union of names — **767 additional names, ≈ $46** (`deshaw_fetch_history.py`, resumable), lifting median coverage from ~82% to ~93%. Recording it here so it's read rather than encountered on a bill.

---

## 1. The headline — is the post-report window special? **No.**

The test that matters is the **control**: is the first 10 days after quarter-end different from a *typical* 10-day window in the same quarter, for the same book? A good book rises in most windows, so the raw rise means nothing on its own.

| Measure | Return | t | hit |
|---|---:|---:|---:|
| Post-report window (+1..+10d) | +135 bps | 2.36 | 73% |
| Typical 10-day window, same quarter (pooled, days +11..+50) | +65 bps | — | 65% |
| **Paired: post-report − same-quarter control mean** | **+70 bps** | **1.15** | 63% |

The post-report window sits at the **~60th percentile** of its own quarter's later windows (pooled: 53rd). **The paired difference is not significant (t=1.15).** The book does rise meaningfully in the 10 days after quarter-end (raw t=2.36), but that rise is **not distinguishable from an ordinary window** for the same book, and — next section — it is **not distinguishable from market beta**.

**Read it as characterisation:** D. E. Shaw's disclosed names drift up for a couple of weeks after quarter-end, but no more than the book drifts up in general, and no more than the market. There is no evidence here of a special report-date effect once the full history is used.

---

## 2. Is it beta or is it selection? (regressions — the decisive framing)

Regress the book's window return on SPY's return over the identical window, across quarters. This is the clean test of whether anything survives once market exposure is accounted for:

| Window | Days | alpha | t(alpha) | beta | t(beta≠1) | n |
|---|---|---:|---:|---:|---:|---:|
| **A** | +1..+10 (pre-disclosure) | **−11 bps** | **−0.64** | **1.29** | 5.36 | 49 |
| **E** | entry+1..+10 (post-public) | **+20.5 bps** | **1.17** | **1.25** | 3.86 | 49 |

- **Window A is pure levered beta.** Alpha is indistinguishable from zero (t=−0.64); beta is **1.29**, significantly above 1 (t=5.36). The entire post-report "outperformance" is market exposure at ~1.3×. This **confirms the deflationary framing** and supersedes any earlier "the window is special" reading.
- **Window E carries no significant alpha.** On the corrected, entry-anchored window the post-disclosure alpha is **+20.5 bps, t=1.17** — not significant. Beta 1.25. (The old mis-anchored window read +34 bps t=1.88, which was also not significant; the correction moves it *further* from significance, not closer.) There is nothing here to defend.
- **Beta is higher pre-disclosure (1.29) than post (1.16).** The book is more market-levered in the days right after quarter-end than a month and a half later. That is a modest, real difference and is the cleanest thing relevant to the momentum-vs-reversion question (§5): the post-report drift is largely the book's high beta meeting a rising market.

## 2.1 Is it D. E. Shaw, or is it the universe? — size-matched control

SPY is a cap-weighted index, not a book that looks like theirs. The sharper control replaces
every held name with a *different* name from the same sector and a similar within-sector
market-cap weight, keeps D. E. Shaw's own portfolio weights, and runs the identical
measurement. 500 random matched books per report date (`deshaw_size_control.py`, seed
20260907); matched-name coverage median **82.3% of the full book** *(re-stated 2026-10-02 on the absolute basis — an earlier 89.6% divided by the sum of ticker-bearing returned rows, i.e. it excluded the ~17% of weight under confidential treatment from the denominator)*.

| Window | D. E. Shaw actual | matched placebo | paired difference | t | verdict |
|---|---:|---:|---:|---:|---|
| **A** (+1..+10) | +131 bps | +123 bps | **+8 bps** | **0.35** | no selection |
| **E** (entry+1..+10) | +78 bps | +115 bps | **−37 bps** | −1.87 | no selection |

*(The actual is measured on the names that have a size match, so actual and placebo are
like-for-like — hence +131 rather than the +135 in §1.)*

**The post-report rise is a property of the size/sector universe, not of D. E. Shaw's picks.**
A random book of similarly-sized names in the same sectors earns essentially the same +123 bps.

**A note on the statistic**, because it changes the answer: the spread of the placebo *means*
(sd 8 bps) measures Monte-Carlo and matching variation only. Judged against that spread the
window-E difference would look significant — but the 49-quarter mean itself carries a standard
error of 56–77 bps. The paired-by-quarter test above is the one that carries the quarter-level
variance, and neither window is close to significant on it.

**Limitation:** `ffx_constituents_latest.csv` is a single 2026-07-02 snapshot, so sector
membership and relative size are applied historically. Acceptable here — the matching only
defines a control group and cannot leak into the measured return — but a name that changed size
a lot over 13 years is matched on its end-of-sample size.

---

## 3. Layer decomposition — DID NOT VALIDATE. Withheld entirely.

The plan was to split each window into market / sector / subsector / idiosyncratic via `get_returns_decomposition`. **Per protocol I validated first — reproduce the endpoint's own unlagged quarterly layer returns for D. E. Shaw — and it FAILED.**

| Layer | mean \|diff\| | median \|diff\| | verdict |
|---|---:|---:|---|
| market | 49 bps | 24 | marginal |
| sector | 11 bps | 6 | ok |
| subsector | 7 bps | 5 | ok |
| **idiosyncratic** | **78 bps** | **59** | **FAIL (>50 bps bar)** |

The idiosyncratic layer does not reproduce (median 59 vs a <50 bps bar) even at full coverage. Same failure mode as the lagged D. E. Shaw backtest (Stage 0, 79 bps): high turnover + thin coverage means the residual — the arithmetic remainder, hence the most coverage-sensitive layer — cannot be rebuilt from the covered subset. **No D. E. Shaw factor split is published, in any form, qualitative or quantitative.** There is nothing to say about market-vs-sector-vs-selection from the ERM3 decomposition here in either direction. (The "it's market beta" conclusion in §2 comes from the SPY regression — a different, validated measurement — not from this decomposition.)

---

## 4. Does it survive to the filing date? (window E — the commercial question)

> **Re-measured 2026-09-22.** D and E are now anchored at disclosure (`entry_date(teo)`),
> not at quarter end. The previous version of this section measured a window 13–23 trading
> days *after* the book was public and described it as "the 10 days after the ~45-day
> filing". The conclusion below is unchanged in substance — nothing bankable survives — but
> the figures and the "coin flip" characterisation were wrong and are corrected.

| Window | Days | Port mean | t | hit | SPY | Excess | t(exc) |
|---|---|---:|---:|---:|---:|---:|---:|
| A | +1..+10 | +135 bps | 2.36 | 73% | +113 | +22 | 1.09 |
| B | +1..+5 | +63 bps | 1.48 | 59% | +44 | +19 | 1.25 |
| C | +1..+21 | +242 bps | 2.87 | 76% | +206 | +36 | 1.24 |
| D | entry−9..+0 (run-up to public) | +117 bps | 2.19 | 65% | +110 | +7 | 0.35 |
| **E** | **entry+1..+10 (post-public)** | **+75 bps** | 1.46 | 69% | +44 | +32 | 1.59 |

- **The book does keep drifting up after it is public — but not in a way you could bank.** The correctly-anchored window E (the 10 trading days after disclosure) returns **+75 bps, t=1.46, hit 69%**: positive, and *not* the coin flip the previous mis-anchored measurement suggested. It is simply **not significant**, and neither is anything derived from it.
- **The +32 bps excess over SPY at E is not significant (t=1.59), and the regression alpha behind it is not significant either (§2, +20.5 bps, t=1.17).** Nothing survives to the public window in a form worth quoting.
- **Against a matched book it is if anything negative.** The size-and-sector-matched placebo earns **+115 bps** over the same post-disclosure window against D. E. Shaw's **+78**, a paired difference of **−37 bps (t=−1.87)**. Not significant, but the sign is the wrong way round for any edge story: in the window you could actually trade, their book slightly *lags* a random lookalike.
- **Front-loaded and beta-driven throughout.** Half the 10-day move is in by day +5; it builds through +21 on an absolute basis but the *excess over SPY* is flat and never significant. The book-specific component is small at every horizon.

**Bottom line for the commercial question:** nothing you could bank survives to the filing date. The book does still drift up in the ten trading days after disclosure (+75 bps), but that drift is not significant, is not distinguishable from market beta, and is **smaller than a size-and-sector-matched random book's** over the same window. There is no tradeable claim here.

---

## 5. Regime split (Leading / Improving / Weakening / Lagging) — momentum or reversion?

Aman's relative-rotation-graph (RRG) classifier arrived. It labels **sector and subsector factors** (not names) into four quadrants from weekly factor-vs-SPY relative strength; methodology follows Rothe (2023), "Dynamic Sector Rotation." Ported verbatim in `rrg_classifier.py` (spans, thresholds, quadrant rules unchanged).

**Port validated + labels are point-in-time (both gates passed):**
- **Reproduction:** his in-sample test (entry into Improving, sectors only, 24-week horizon) reports 517 signals / 76.60% prob-gain / 6.15% mean. Our port: **515 signals / 76.12% / 6.07% / 13.61% ann** — the 2-signal gap is data (our SPY endpoint; the factor plane ends 2026-07-02), not method. PASS.
- **Point-in-time (non-negotiable):** `label_fn(as_of)` recomputes labels on the series truncated at `as_of`. Verified against the full-history labels at 8 dates spanning 2001–2026 — **exact match, 19 factors each, zero leakage.** The RRG pipeline (cumprod + causal EWM) is a filtering problem, so truncation reproduces. The momentum-vs-reversion answer below is **not** contaminated by future information.

**Bridge + coverage.** Each holding is tagged by the quadrant its **sector** (primary) and **subsector** sat in *as of the report date*, via the FFX constituents map (`ffx_constituents_latest.csv`). Only **8** subsectors are in Aman's universe, so:

| Level | Mapping coverage (median book weight tagged) | Usable? |
|---|---:|---|
| **Sector** (11 factors) | **91.1%** (min 80%) | **yes — primary result** |
| Subsector (8 factors) | **9.9%** (min 8%) | **no — far below the 40% bar; reported for completeness only** |

**The subsector split covers ~10% of the book — treat it as noise, not a result.** Everything below is sector-level.

### D. E. Shaw's sector-regime positioning at report date — a barbell, not momentum

Mean book weight by the quadrant each name's sector occupied at report date (equal-weight across 4 quadrants would be 25%):

| Quadrant | Mean book weight | Reading |
|---|---:|---|
| **Leading** (rising, strong) | **30.6%** | overweight |
| **Lagging** (falling, weak) | **28.6%** | overweight |
| Improving (turning up) | 15.7% | underweight |
| Weakening (rolling over) | 15.5% | underweight |

**D. E. Shaw is not concentrated in Leading.** They hold Leading and Lagging sectors about equally and **underweight the transitional (Improving/Weakening) middle** — a barbell of clear winners and clear laggards. That is *not* the clean momentum signature ("hold what's already working") the exercise was set up to detect; the heavy Lagging weight leans the other way.

### Post-report window return, split by sector quadrant

Per-unit-weight return = the quadrant basket's own window return; contribution = weight × that, summed to the covered-book return.

| Quadrant | Weight | **A: +1..10** per-unit ret | A contrib | **E: entry+1..+10** per-unit ret | E contrib |
|---|---:|---:|---:|---:|---:|
| Leading | 30.6% | **+71 bps** | +33 | +67 bps | +25 |
| Improving | 15.7% | +175 bps | +32 | +11 bps | +9 |
| Weakening | 15.5% | +192 bps | +25 | +81 bps | +21 |
| Lagging | 28.6% | +102 bps | +26 | +30 bps | +17 |

- **The post-report drift is weakest, per unit weight, in Leading sectors** (+71 bps) and strongest in the *turning* quadrants (Improving +175, Weakening +192). Paired across quarters, the largest-weight bucket (Leading) minus the smallest-weight bucket (Weakening) is **−136 bps, t=−2.73** — Leading sectors *underperformed* Weakening ones in the 10 days after quarter-end. **Caveat: 4 quadrants ⇒ up to 6 pairwise comparisons; a Bonferroni bar for 6 tests is |t|≈2.6, so this sits right at the edge — treat it as suggestive, not established.**
- **This does not support a momentum read.** If the post-report return were momentum (already-Leading names running further), Leading would carry it. Instead the per-unit-weight drift skews to the transitional/lagging quadrants — a weak lean toward the *reversion* side (recently-cooling and weak sectors bouncing in the short window). But see the strong caveat below.
- **Window E washes out.** On the corrected post-disclosure window every quadrant's per-unit-weight return compresses toward the book average (Leading +67, Improving +11, Weakening +81, Lagging +30) and the Leading−Weakening gap is **no longer significant (−69 bps, t=−1.53; beta-adjusted alpha −70 bps, t=−1.56)**. The quadrant structure does not survive to the public window — consistent with §4: whatever is there is gone by the filing date across *all* regimes, not concealed in one.

> **⚠️ The caveat above was tested, and it holds — see §5.1. The quadrant return differences
> are beta. Do not read the per-unit-weight table as a regime effect.**

### 5.1 Stripping beta out of the regime split — the differences do not survive

Each quadrant basket regressed on SPY over the identical window, HC0 robust standard errors
(`deshaw_regime_beta.py`), n=49:

| Quadrant | mean weight | raw return | alpha | t(alpha) | **beta** |
|---|---:|---:|---:|---:|---:|
| Leading | 30.6% | +71 bps | −46 | −1.54 | **1.00** |
| Improving | 15.7% | +175 bps | +5 | +0.15 | **1.27** |
| Weakening | 15.5% | +192 bps | +56 | +1.22 | **1.25** |
| Lagging | 28.6% | +102 bps | −40 | −1.69 | **1.19** |

**The raw ordering is a beta ordering.** Leading — the quadrant with the weakest raw drift —
is the only one carrying market beta of 1.00; the two "turning" quadrants that looked strongest
carry ~1.26. **No individual quadrant alpha is significant.**

The headline paired comparison attenuates by ~30% and drops below the multiple-comparison bar:

| | raw | beta-adjusted |
|---|---|---|
| Leading − Weakening (largest- minus smallest-weight) | −136 bps, t=−2.73 | alpha **−95 bps, t=−2.29** |

The paired series itself loads on SPY with beta −0.36, confirming a genuine beta difference
between the quadrants. With four quadrants there are six pairwise comparisons, so the
Bonferroni bar is |t|≈2.64: **none of the six beta-adjusted alphas clears it** (largest
|t|=2.29). At window E nothing clears either (largest |t|=2.45, Improving−Lagging).

**Verdict: report this as beta, not as a regime effect.** The defensible statement is the
positioning one — *their book is a Leading/Lagging barbell, and the short post-report drift is
not concentrated in their Leading names*. The weight barbell stands on its own; it is a
weighting observation and does not depend on any return measurement. **I would not say
"D. E. Shaw does reversion."**

### Context — Aman's prior (Task 5, one line)

Aman's own test (entry into Improving sectors, 24-week horizon) shows 76.6% probability of gain / 13.81% annualised — a directional momentum-rotation edge. **D. E. Shaw holds only ~15.6% of the book in Improving-quadrant sectors at report date — below the 25% equal-weight line — so there is no sign they are running anything like his Improving-rotation play.**

---

## 6. What this is NOT — read before showing it

- **NOT tradeable.** The +1..+10 window sits ~45 calendar days before the book is public. This is the single most important caveat; every chart caption repeats it.
- **NOT a report-date effect.** Over the full 49 quarters the post-report window is not significantly different from a typical same-quarter window (paired t=1.15) and is not significantly different from market beta (regression alpha t=−0.64). The earlier "significant" version was a 36-quarter artifact.
- **NOT a validated performance figure.** Coverage ~93% median; characterisation only.
- **NOT a layer-attributed result.** The market/sector/subsector/idio split failed its validation gate (§3) and is withheld entirely, including qualitatively.
- **NOT alpha.** The +70 bps vs control and the raw +135 bps are excesses over the book's own typical windows / over zero, on a partial universe, gross of costs — not risk-adjusted alpha. No regression alpha in any window clears significance.
- **Gross of everything**; long-only disclosed 13F book held fixed across each window (understates a ~22%/quarter-turnover manager's real activity).
- **n = 49; fiscal-quarter buckets are n ≈ 12** — underpowered, see below.

### Fiscal-quarter split (the meeting-note prior about Dec 31) — Q4 does NOT clear the bar

| Fiscal quarter | Report month | A mean | t | hit | n | Clears Bonferroni (|t|≥2.50)? |
|---|---|---:|---:|---:|---:|:--|
| Q1 | Mar | +147 bps | 1.08 | 67% | 12 | no |
| Q2 | Jun | +237 bps | 4.21 | 92% | 12 | **yes** |
| Q3 | Sep | +49 bps | 0.45 | 62% | 13 | no |
| Q4 | Dec | +114 bps | 0.78 | 75% | 12 | **no** |

Four tests at α=0.05 → Bonferroni per-test p=0.0125, **critical |t| ≈ 2.50**. **Only Q2 (June) clears it; Q4 (December) does not** (t=0.78). **The Dec-31 prior from the meeting notes is not supported by the data.** Q2 clearing is itself suspect — with four correlated tests on n≈12 and no ex-ante reason to single out June, I would treat it as a curiosity, not a finding.

---

## 7. Status at closeout — everything here is closed

1. **The headline is settled at full coverage.** The bug fix (36→49 quarters) was the mover; the coverage extension (82%→93%) only confirmed it — paired-control t 1.22→1.15, window-A alpha t −0.33→−0.64, window-E alpha t 2.12→1.88 (dropped below significance). No conclusion is coverage-fragile.
2. **Size/liquidity confound — TESTED and closed (§2.1).** The covered book does skew to large, index-eligible names, and that is exactly what drives the rise: a size-and-sector-matched random book earns +123 bps against the book's +131 (paired t=0.35). The post-report effect is not D. E. Shaw-specific.
3. **Regime (Aman's RRG) — answered, and the return half is closed as beta (§5.1).** Not a momentum book: Leading/Lagging barbell, and the post-report drift is not concentrated in Leading. But the quadrant *return* differences do not survive a beta adjustment — no quadrant alpha is significant and no pairwise difference clears the six-test Bonferroni bar. Report the positioning, not the returns. Subsector coverage (~10%) remains unusable.
4. **The shared NaN bug → Berkshire re-audited.** Done at closeout; see LAGGED_RESULTS.md, which was fully re-run (n=42, lagged Sharpe **0.95** on the corrected q_len-normalised basis). Do not carry the pre-2026-09-07 Berkshire figures forward. A second defect — the terminal row of `get_filer_portfolio` — was found during that re-audit and also affects this study's filer list; see LAGGED_RESULTS §0.1.

**Not pursued, deliberately:** extending to more filers, which is the only thing that would
resolve the statistical-power problem. Scoped out with reasoning in HANDOFF.md §9 — it is the
primary recommendation for anyone resuming.

---

## Changelog — partial-coverage (n=36, buggy) → full-sample (n=49, fixed)

| Result | n=36 run (superseded) | n=49 @82% | n=49 @93% | **n=49, E re-anchored (current)** |
|---|---|---|---|---|
| Post-report +1..10 mean · t | +225 bps · 3.54 | +142 bps · 2.45 | +135 bps · 2.36 | +135 bps · 2.36 (unchanged) |
| Paired vs same-quarter control · t | +176 bps · **2.86 (sig)** | +74 bps · **1.22 (NS)** | +70 bps · **1.15 (NS)** | +70 bps · **1.15 (NS)** (unchanged) |
| Window-A regression alpha · t | (not run) | −6 bps · −0.33 | −11 bps · −0.64 | −11 bps · −0.64 (unchanged) |
| Window-A beta | (not run) | 1.30 | 1.29 | 1.29 (unchanged) |
| Size-matched placebo, window A · paired t | (not run) | (not run) | +8 bps · 0.35 | +8 bps · 0.35 (unchanged) |
| **Window-E return · t** | (not run) | (not run) | −7 bps · −0.10 *(mis-anchored)* | **+75 bps · 1.46 (NS)** |
| **Window-E regression alpha · t** | (not run) | +40 bps · 2.12 | +34 bps · 1.88 *(mis-anchored)* | **+20.5 bps · 1.17 (NS)** |
| **Window-E vs matched placebo · paired t** | (not run) | (not run) | +15 bps · 0.67 *(mis-anchored)* | **−37 bps · −1.87 (NS)** |
| Q4 (Dec) clears Bonferroni | (not tested) | no | no | no (unchanged) |
| Layer validation | FAIL | FAIL | FAIL (idio median 59) | FAIL (idio median 59) |

**The one-line change:** with the bug fixed and all 49 quarters in, **the "post-report window is special" finding does not survive — it is market beta, and it is not distinguishable from a typical window.** The coverage extension confirmed rather than revived it.

**The 2026-09-22 correction changes only the post-public window.** Everything anchored at quarter end — the headline, the control, the A regressions, the size-matched placebo on A — is untouched. Re-anchoring E at disclosure replaces a "coin flip" (−7 bps) with a real but insignificant drift (+75 bps, t=1.46), moves its alpha *further* from significance (t 1.88 → 1.17), and flips the matched-placebo comparison negative (−37 bps, t=−1.87). **The commercial conclusion — nothing bankable survives to the filing date — holds on every one of those measures.**

---

*Files: `deshaw_report_date.py` (windows/control/regressions), `rrg_classifier.py` (Aman's RRG port + point-in-time `label_fn`), `regime_split.py` + `tests/test_regime_split.py` (factor→name bridge + split), `deshaw_regime.py` (§5 analysis), `ffx_constituents_latest.csv` (ticker→factor map), `chart_deshaw_report_date.py` (charts), `deshaw_report_date.csv` / `deshaw_regime_{sector,subsector}.csv` (per-quarter data), `cache/deshaw_*_results.json` (aggregates), `deshaw_fetch_history.py` (coverage extension, ~$46). Charts in `charts/deshaw_report_date_*`. Bug fix in `build_lagged.window_return`. Window re-anchoring (2026-09-22) in `deshaw_report_date.WINDOWS` / `win_bounds(basis=)`, pinned by `tests/test_review_regressions.py`. Factor returns from `gs://rm_api_public/eodhd/ds_synth_factors.zarr` (anon), cached to `cache/rrg_*`.*
