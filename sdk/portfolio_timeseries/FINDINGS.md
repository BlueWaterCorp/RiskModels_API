# FINDINGS — 13F factor attribution and the reporting lag

*Nijat Aliyev · final, 2026-09-07 · all numbers from the closeout re-audit on the fixed code.*

**Every Sharpe below is GROSS** — no risk-free deduction, quarterly data annualised by √4.
Long-only disclosed 13F books. No transaction costs except where stated, no financing, no
borrow. Nothing here is a tradeable P&L; it is attribution.

Method and reproduction: **[HANDOFF.md](HANDOFF.md)**.

---

## The short version

**Berkshire (n=42 quarters, 2013–2026).** Dropping the idiosyncratic sleeve improves
risk-adjusted return, and the improvement survives the 45-day reporting delay. The book's
outperformance over SPY is beta, not alpha — Jensen alpha is statistically zero (t=0.36
lagged, t=0.29 unlagged). Of the two factor layers, **sector is the one that pays, not
subsector** — the opposite of what an earlier note said, and that note was wrong for a
reason worth knowing (below).

**D. E. Shaw (n=49 quarters, 2013–2026, ~93% coverage).** Nothing survives. The book rises
+135 bps in the ten trading days after quarter end, but that rise is not distinguishable from
a typical window in the same quarter (paired t=1.15), not distinguishable from levered market
beta (regression alpha t=−0.64, beta 1.29), and **not distinguishable from a random
size-and-sector-matched book (paired t=0.35)**. The regime split shows a Leading/Lagging
barbell rather than a momentum book — but once market beta is removed, none of the
quadrant differences clears a multiple-comparison bar either.

**The negative results are the substantive ones.** A post-report effect that dies under
three independent controls is a real finding about D. E. Shaw's disclosed book, not a failed
experiment.

---

## Strand A — Berkshire: does the factor premium survive the reporting lag?

### The question

13F books are public up to 45 calendar days after quarter end. Every naive attribution enters
at quarter end and therefore has half a quarter of look-ahead. Enter at `report_date + 45
calendar days` instead, hold to the next entry, always invested, and ask: what still pays?

### Validation first

The pipeline rebuilds each quarter's **unlagged** return from daily name-level data and
compares against the endpoint's own figure. Pre-registered gate: <25 bps clean, 25–75 proceed
with a flag, >75 stop.

| | n | mean \|diff\| | median | max | verdict |
|---|---:|---:|---:|---:|---|
| Berkshire | 42 | **61.2 bps** | 44.0 | 295.8 | PROCEED WITH FLAG |

Coverage ~100% of book weight. The layer rebuild validates separately against the endpoint's
own per-quarter layer returns — median |diff| market 17, sector 4, subsector 1, idiosyncratic
29 bps, all inside the 50 bps bar.

### Headline — gross return

| Series | mean bps/q | t | hit % | Sharpe | ann % |
|---|---:|---:|---:|---:|---:|
| **Lagged** (enter +45d) | **453.6** | 3.19 | 76 | **0.99** | 17.64 |
| Unlagged rebuild | 506.6 | 2.94 | 71 | 0.91 | 19.18 |
| Unlagged endpoint | 425.2 | 2.73 | 74 | 0.84 | 15.85 |
| SPY over the lagged windows | 398.4 | 3.72 | 81 | **1.15** | 15.89 |

**90% of the gross mean survives the lag, and the Sharpe improves** (0.91 → 0.99). But note
the last row: **SPY's Sharpe over the same windows is 1.15, higher than the book's 0.99.**
Berkshire delivered more return at more risk. That is not an edge.

### It is beta, not alpha

| | alpha (bps/q) | t(alpha) | beta | t(β≠1) |
|---|---:|---:|---:|---:|
| Lagged | +37.3 | **0.36** | 1.04 | 0.35 |
| Unlagged | +33.0 | **0.29** | 1.12 | 0.95 |

Jensen alpha is statistically zero on both bases. The outperformance versus SPY is beta above
one. This reproduces Sammon (2016): the Berkshire replicator tracks the market. Note the lag
*lowers* beta (1.12 → 1.04), which is why risk-adjusted performance improves slightly even as
the gross mean falls.

### Layer attribution — the affirmative result

Per-quarter contributions, q_len-normalised, n=42:

| Layer | LAG mean | t | Sharpe | | UNL mean | t | Sharpe | survives |
|---|---:|---:|---:|---|---:|---:|---:|---:|
| Market | 304.7 | 2.94 | 0.91 | | 337.6 | 2.69 | 0.83 | 90% |
| **Sector** | 38.1 | 1.31 | **0.40** | | 48.7 | 1.68 | **0.52** | 78% |
| Subsector | 14.9 | 0.96 | 0.30 | | 16.5 | 1.20 | 0.37 | 90% |
| **Sector + subsector** | **53.0** | 1.49 | **0.46** | | **65.2** | 1.78 | **0.55** | **81%** |
| **Drop idio** (mkt+sec+sub) | **357.7** | 3.45 | **1.07** | | **402.8** | 3.31 | **1.02** | 89% |
| Idiosyncratic | 48.7 | **0.73** | 0.22 | | 38.5 | **0.67** | 0.21 | — |
| Gross book | 412.2 | 3.07 | 0.95 | | 456.1 | — | 0.92 | 90% |

Three reads:

1. **Dropping the idiosyncratic sleeve improves risk-adjusted return, lagged and unlagged**
   (1.07 and 1.02, against 0.95 and 0.92 for the gross book). This is the affirmative finding
   and it is not a look-ahead artifact.
2. **The idiosyncratic sleeve is statistically zero either way** (t=0.73 lagged, 0.67
   unlagged). There is nothing to keep. Note also that the decomposition's own linking
   residual (median 33 bps/q) is the same size as idio's mean contribution — the sleeve cannot
   be cleanly separated from decomposition noise, which strengthens rather than weakens the
   case for dropping it.
3. **The sector+subsector premium survives at ~81% of its mean** and stays positive, but it is
   not statistically significant on one filer either way (t=1.78 → 1.49). Do not oversell it.

### Sector or subsector? — a contradiction, resolved

An earlier note reported endpoint Sharpes of sector **0.28** / subsector **0.49** while the
rebuild said the reverse. That determines whether you would trade broad sector ETFs or narrow
industry ones, so it could not be left open. It is sample contamination:

| Source | sector | subsector | sec+sub |
|---|---:|---:|---:|
| Endpoint, all 46 quarters *(the published figure)* | 0.28 | 0.49 | 0.47 |
| Endpoint, terminal row dropped | 0.40 | 0.56 | 0.64 |
| **Endpoint, restricted to the 42 rebuildable quarters** | **0.56** | **0.49** | 0.63 |
| **Daily rebuild, same forward-quarter windows** | **0.54** | **0.47** | 0.61 |
| Daily rebuild, lag-twin windows | 0.52 | 0.37 | 0.55 |

**Believe sector > subsector.** On a consistent sample the endpoint (0.56 / 0.49) and the
independent daily rebuild (0.54 / 0.47) agree to 0.02 on both layers. The 0.28 / 0.49 figure
came from a 46-quarter endpoint sample containing four rows that do not describe Berkshire's
book (below). **Trade the broad sector exposure, not the narrow industry one.**

### The 1.00 Sharpe — do not quote it

| Step | Sharpe | Δ | Cause |
|---|---:|---:|---|
| A. Endpoint drop-idio, all 46 quarters | **1.003** | — | the previously published 1.00 |
| B. Endpoint drop-idio, 42 rebuildable quarters | 0.911 | −0.092 | the four dropped rows |
| C. Daily rebuild, same windows as the endpoint | 0.933 | +0.021 | method (actual prices vs model return) |
| D. Daily rebuild, lagged | 1.066 | — | the lag itself |

The A→B step is the whole gap, and the reason is stronger than "sample selection". **Three of
the four dropped rows are not Berkshire's book at all:**

| teo | holdings in row | AUM | vs median quarter | drop-idio |
|---|---:|---:|---:|---:|
| 2014-09-30 | 1 | $620M | 0.845% | +310 bps |
| 2020-09-30 | 1 | $386M | 0.526% | +1066 bps |
| 2025-03-31 | 2 | $885K | 0.001% | +1134 bps |

(Median AUM of the 42 kept quarters: **$73.4B**.) These are stub filings the portfolio endpoint
has stamped as full reporting periods and computed a return from. The fourth dropped row is
the terminal row, which carries an open-ended return (see the data defects below). Their
drop-idio returns average 837 bps/q against 372 for real quarters — that gap *is* the
inflation.

**Quote the range 0.91–0.93 with the sample stated. Never quote 1.00, and never a single
decimal.** The robust claim is the *comparison* — drop-idio beats the gross book and survives
the lag — not the level.

### Transaction costs — not the binding constraint

The sector+subsector sleeve is quoted gross at ~2.0%/yr, small enough that costs matter.
Measured one-way turnover of the sector-ETF exposure the book implies: **4.4% per quarter,
17.4% per year** (name-level turnover is higher at 5.6%/q, but a swap between two names in the
same sector does not move the overlay).

| round-trip cost | annual drag | lagged sleeve gross → net | kept |
|---|---:|---|---:|
| 2 bps (optimistic) | 0 bps/yr | 203 → 203 bps/yr | 100% |
| **5 bps (base)** | **1 bps/yr** | **203 → 202 bps/yr** | **100%** |
| 15 bps (pessimistic) | 3 bps/yr | 203 → 201 bps/yr | 99% |

**Costs are not what kills this sleeve.** At sector level Berkshire barely trades, so the drag
is ~1 bp/yr against ~203 bps/yr gross. What kills it is that the gross figure is not
statistically distinguishable from zero (t=1.49, n=42). Excludes financing and borrow — a
market-neutral expression would add both and be materially worse.

---

## Strand A2 — Pershing Square: the gate says no

Added at closeout, to test whether the Berkshire result generalises. Pershing was chosen as the
*most concentrated* book available (median effective N 3.3 vs Berkshire's 4.0), 52 studiable
quarters, all 52 holdings books present — and with a published external prior: Sammon (2016) ran
this same +45-day lag on Pershing and found the replicator roughly doubled the market.

**It failed Stage 0 at 195 bps against a 75 bps stop. No Pershing lagged figure is published.**

| Filer | Stage 0 mean \|diff\| | median restricted weight | max | verdict |
|---|---:|---:|---:|---|
| Berkshire | 61 bps | **1.2%** | 6.3% | PASS |
| D. E. Shaw | 78 bps | 16.9% | 44.4% | FAIL |
| Pershing | **195 bps** | **22.7%** | **100.0%** | FAIL |

**The cause is confidential treatment, not concentration.** `BW-RESTRICTED` rows are holdings the
manager asked the SEC to withhold; they arrive with no ticker and have no market data at any
price. Pershing's 2013-Q4 book is **95.6% restricted by weight** — two hidden rows and one
visible 4% position. It has quarters that are 100% restricted. Coverage runs from a 83% median
down to a 2.6% minimum, and the gate fails even on the best-covered subset (104 bps at ≥98%
coverage, n=11), so this is not a threshold that could be tuned into passing.

**What this changes.** It corrects the selection rule this project had been carrying. Pershing is
*more* concentrated than Berkshire and still fails, so concentration was never the binding
constraint — **completeness of the disclosed book is.** The screen is one API call: compute the
share of book weight in rows with no ticker, and treat anything above ~10% as unstudiable. See
[HANDOFF.md](HANDOFF.md) §9.

**Two of three filers tried have now failed the gate.** That is the gate doing its job, and it is
the strongest single piece of evidence that the Berkshire result was not simply the first thing we
looked at that happened to work.

---

## Strand B — D. E. Shaw: is there a report-date effect?

**Framing, non-negotiable: the +1..+10 day window is NOT tradeable.** The book is not public
until ~45 days later. This characterises how the firm is positioned *into* quarter end. It is
not a strategy.

n=49 quarters, 2013-09-30 → 2026-03-31, coverage median 92.9% (min 75%).

### The raw effect, and three controls that kill it

| Test | Result | Verdict |
|---|---|---|
| Raw post-report window (+1..+10d) | **+135 bps, t=2.36, hit 73%** | a real rise |
| **Control 1** — vs a typical 10-day window in the same quarter, paired | +70 bps, **t=1.15** | not special |
| **Control 2** — regression on SPY over the identical window | alpha −11 bps, **t=−0.64**, beta **1.29** | pure levered beta, zero alpha |
| **Control 3** — vs a size-and-sector-matched random book, paired | +8 bps, **t=0.35** | not D. E. Shaw-specific |

The post-report window sits at roughly the 60th percentile of its own quarter's later windows.
Control 3 is the sharpest: 500 random books per report date, each name replaced by a different
name from the same sector with a similar within-sector market-cap weight, D. E. Shaw's own
weights retained. The matched placebo returns **+123 bps** against the book's **+131 bps** on
the same names-with-matches basis. The rise is a property of the large, index-eligible
size/sector universe — not of their selection.

### Does anything survive to the filing date? No.

| Window | Days | Port mean | t | hit | SPY | Excess | t(exc) |
|---|---|---:|---:|---:|---:|---:|---:|
| A | +1..+10 | +135 bps | 2.36 | 73% | +113 | +22 | 1.09 |
| B | +1..+5 | +63 bps | 1.48 | 59% | +44 | +19 | 1.25 |
| C | +1..+21 | +242 bps | 2.87 | 76% | +206 | +36 | 1.24 |
| D | +35..+45 | +54 bps | 0.84 | 69% | +38 | +16 | 0.69 |
| **E** | **+45..+55** | **−7 bps** | **−0.10** | **51%** | −35 | +28 | 1.35 |

By the time the book is public the ten-day return is a coin flip. Regression alpha at window E
is +34 bps, t=1.88 — below significance, and it *fell* when coverage rose from 82% to 93%
(t was 2.12 at partial coverage). The matched control at window E also finds nothing
(paired +15 bps, t=0.67). Nothing here is bankable.

### Regime — a barbell, and the return split is beta

Using Aman Dhillon's relative-rotation-graph classifier (Rothe 2023 construction), ported
verbatim and verified point-in-time causal, each holding is tagged by the quadrant its
**sector** occupied at report date. Sector-level coverage 91% of book weight; **subsector
coverage is 9.9% and is unusable — never quote subsector quadrant numbers.**

**Positioning (this part stands):**

| Quadrant | Mean book weight | vs 25% equal weight |
|---|---:|---|
| **Leading** (rising, strong) | **30.6%** | overweight |
| **Lagging** (falling, weak) | **28.6%** | overweight |
| Improving (turning up) | 15.7% | underweight |
| Weakening (rolling over) | 15.5% | underweight |

**D. E. Shaw holds a Leading/Lagging barbell and underweights the transitional middle. That is
not a momentum signature.** They hold only ~15.7% in Improving sectors, below the equal-weight
line, so there is no sign they run anything like Aman's Improving-rotation play. This is a
weight observation and does not depend on any return measurement.

**The return split, however, is beta.** Window A, each quadrant basket regressed on SPY over
the identical window (HC0 robust standard errors):

| Quadrant | raw return | alpha | t(alpha) | beta |
|---|---:|---:|---:|---:|
| Leading | +71 bps | −46 | −1.54 | **1.00** |
| Improving | +175 bps | +5 | +0.15 | **1.27** |
| Weakening | +192 bps | +56 | +1.22 | **1.25** |
| Lagging | +102 bps | −40 | −1.69 | **1.19** |

The raw ordering — Leading weakest, the turning quadrants strongest — **is a beta ordering.**
Leading carried beta 1.00 while Improving and Weakening carried ~1.26. **No individual
quadrant alpha is significant.** The headline paired comparison attenuates and falls below the
bar:

| | raw | beta-adjusted |
|---|---|---|
| Leading − Weakening | −136 bps, t=−2.73 | alpha −95 bps, **t=−2.29** |

With four quadrants there are six pairwise comparisons, so the Bonferroni bar is |t|≈2.64.
**None of the six beta-adjusted alphas clears it** (the largest is −2.29). The paired
difference also loads on SPY with beta −0.36, confirming it is partly a beta bet.

**Conclusion: report §5 as beta, not as a regime effect.** The defensible statement is "their
book is a Leading/Lagging barbell, and the short post-report drift is not concentrated in
their Leading names" — a characterisation of positioning, not a rotation edge. I would not
tell anyone "D. E. Shaw does reversion."

### What was withheld, and why

Two D. E. Shaw results failed their validation gates and are published nowhere, in any form:

- **The lagged backtest.** Stage 0 failed at **78 bps** against a 75 bps stop. The failure is
  structural: as coverage rose from 69% to 85% the error plateaued rather than falling,
  because the remaining names are intentionally outside the ERM3 3000 universe and have no
  daily data at any price. No lagged D. E. Shaw survival, Sharpe or CAPM figure exists.
- **The layer split.** The idiosyncratic layer would not reproduce the endpoint's own
  unlagged figures — median |diff| **59 bps** against a 50 bps bar, still failing at 93%
  coverage. The residual is the arithmetic remainder and therefore the most coverage-sensitive
  layer. **There is nothing to say about market-vs-sector-vs-selection for D. E. Shaw in
  either direction.** The "it's beta" conclusion comes from the SPY regression, a different and
  validated measurement.

### The fiscal-quarter split

| Fiscal quarter | mean | t | hit | n | clears Bonferroni (\|t\|≥2.50)? |
|---|---:|---:|---:|---:|---|
| Q1 (Mar) | +147 bps | 1.08 | 67% | 12 | no |
| Q2 (Jun) | +237 bps | 4.21 | 92% | 12 | **yes** |
| Q3 (Sep) | +49 bps | 0.45 | 62% | 13 | no |
| Q4 (Dec) | +114 bps | 0.78 | 75% | 12 | **no** |

**The December-quarter prior is not supported.** Q2 clearing is itself suspect — one of four
correlated tests on n≈12 with no ex-ante reason to single out June. Treat it as a curiosity.

---

## Data defects that changed published numbers

Both were found in our own data and both moved headlines. They are documented in full in
[DATA_ISSUES.md](DATA_ISSUES.md) and [HANDOFF.md](HANDOFF.md) §6.

**1. NaN-day poisoning** (fixed). A single NaN return day for one name nulled an entire
quarter, silently, while coverage still looked healthy. Found via Zillow at 0.03% of D. E.
Shaw's 2013-Q4 book. Effects: D. E. Shaw n 36→49 and **the headline flipped** (the buggy
36-quarter sample had kept only the strong recent years and showed a significant effect);
Berkshire n 35→42 and lagged Sharpe 0.85→0.99.

**2. Terminal-row defect** (found in this closeout). **The last row of `get_filer_portfolio`
carries a forward return measured over an open-ended window — quarter end to the engine's data
horizon — not the one-quarter window every other row uses.** Every non-terminal row tracks SPY
over its own forward quarter to ~60 bps median; terminal rows deviate by 2.7× to 34× that.
Greenlight is decisive: its last filing is 2.5 years stale and its "one quarter" return matches
SPY over **9.2 quarters**. Including Berkshire's terminal row pushed the Stage 0 gate from
61 bps (pass) to 84 bps (stop) on the strength of one row. **Always drop the terminal row.**

---

## What this does and does not establish

**Does:**
- On Berkshire 2013–2026, dropping the idiosyncratic sleeve improves gross risk-adjusted
  return, and the improvement survives a realistic 45-day entry delay.
- Berkshire's excess over SPY in this window is beta, not alpha.
- Between the two factor layers, sector is the one that pays.
- D. E. Shaw's disclosed book shows no post-report effect that survives a same-quarter
  control, a market-beta control, or a size-and-sector-matched control.
- D. E. Shaw's book is a Leading/Lagging sector barbell, not a momentum book.

**Does not:**
- Establish anything tradeable. Gross, long-only, no financing or borrow, and the
  sector+subsector sleeve is not statistically significant on one filer.
- Generalise beyond these two filers. **Statistical power is the binding constraint on
  everything here** — nothing clears significance on a single filer, and that is the reason a
  multi-filer extension is the primary recommendation for anyone resuming (HANDOFF §9).
- Say anything about the pre-2013 period. The daily-returns floor of 2013-07-29 caps every
  study at ~13 years, and Berkshire's stronger 2006–2012 alpha is out of sample.
- Say anything about D. E. Shaw's factor attribution, which failed its validation gate and is
  withheld.
- Measure filing behaviour. Filing dates are ~63–68% synthetic (exactly `report_date + 45`);
  45 days is the statutory convention baked into the data, not observed timing.
