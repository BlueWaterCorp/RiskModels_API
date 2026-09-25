# Lagged 13F Backtest — Berkshire

*Nijat · re-audited 2026-09-07 (supersedes the 2026-07-27 draft). Single construction choice.
No transaction costs in §1–§6 — see §7. **All Sharpes are GROSS**, no risk-free deduction.
Read §0 first — nothing below counts if the pipeline didn't validate.*

> **This document was fully re-run on 2026-09-07.** Two bugs invalidated the earlier version:
> NaN-day poisoning in `window_return` (n 35→42, lagged Sharpe 0.85→0.99) and a terminal-row
> defect in `get_filer_portfolio` (§0.1). Every number below comes from
> `python reaudit_berkshire.py`. The conclusions did not change; the magnitudes did, and one
> earlier claim (subsector beats sector) was reversed — see §6.1.

Reproduce: `python reaudit_berkshire.py` → `cache/reaudit_berkshire.json`.
Workbook: `attribution_audit.xlsx`, verified by `python verify_audit_xlsx.py`.

## 0. Pipeline validation verdict — PROCEED WITH FLAG

Rebuilt Berkshire's **unlagged** quarterly gross return from daily name-level data (holdings
weights × buy-and-hold ticker returns over the forward quarter) and compared against the
endpoint's `portfolio_gross_return`. Gate set in advance: <25 bps clean, 25–75 proceed with a
flag, >75 stop (`build_lagged.gate_verdict`).

| Set | n | mean \|diff\| | median | max | <25bps | <75bps | verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| Buildable quarters, terminal row dropped | **42** | **61.2 bps** | 44.0 | 295.8 | 16 | 30 | **PROCEED WITH FLAG** |
| *(same, terminal row included)* | *43* | *83.5* | *44.0* | *1020.3* | *16* | *30* | *would read STOP* |

Coverage ~100% of book weight. Signed bias rebuild−endpoint: **median +12 bps** — the rebuild
runs slightly rich, tail-driven by high-vol quarters, consistent with buy-and-hold of *actual
prices* against the endpoint's ERM3 *model-implied* gross. **The bias is common to the lagged
and unlagged rebuilds, so it cancels in the lag differential.**

### 0.1 Why the terminal row is dropped — a data defect, not a rebuild failure

The final row of `get_filer_portfolio` carries a forward return measured over an **open-ended
window** (quarter end → the engine's data horizon), not the one-quarter window every other row
uses. For Berkshire's 2025-12-31 row the endpoint reports +2.18% where the rebuild gives
−8.02% on a 100%-covered 22-name book over a complete 61-trading-day window.

The proof is the market layer, which is ~SPY by construction. Every non-terminal row's
`portfolio_market_return` tracks SPY over its own forward quarter to ~60 bps median; the
terminal row deviates by 2.7×–34× that across all five filers, and the horizon that would
reproduce it is never one quarter:

| filer | terminal teo | deviation vs SPY | × filer's median | implied horizon |
|---|---|---:|---:|---:|
| Berkshire | 2025-12-31 | +1242 bps | 21× | 1.9 quarters |
| Greenlight | 2023-12-31 | +4146 bps | 34× | **9.2 quarters** |
| Appaloosa | 2026-03-31 | +790 bps | 7× | 0.7 quarters |
| D. E. Shaw | 2026-03-31 | +262 bps | 5× | 0.7 quarters |
| Pershing | 2026-03-31 | +130 bps | 3× | 0.7 quarters |

Greenlight settles it — its last filing is 2.5 years stale and its "one quarter" return matches
SPY over 9.2 quarters. **One corrupt row was the difference between passing and failing the
gate.** Always drop the terminal row from quarter-aligned analysis.

### 0.2 Reconciliation — every teo accounted for

| | count |
|---|---:|
| rows returned by `get_filer_portfolio` | 50 |
| … carrying a `portfolio_gross_return` | 46 |
| … with a matching holdings book (`report_date == teo`) | 43 |
| … terminal row dropped (§0.1) | −1 |
| **usable** | **42** |

- **Rows present but carrying no gross return (4):** 2013-06-30, 2015-06-30, 2023-09-30,
  2023-12-31. *(An earlier draft called these "gaps in the teo series" — imprecise. They are
  present as rows.)*
- **Quarter-ends genuinely absent from the series (1):** 2021-06-30.
- **Rows with a return but no holdings book (3):** 2014-09-30, 2020-09-30, 2025-03-31 — see
  §0.3.

### 0.3 The three "missing-book" quarters are stub rows — closed permanently

These are not quarters whose holdings snapshot went missing. The endpoint rows describe a
portfolio of **one or two names**:

| teo | holdings in row | AUM | vs median kept quarter | gross | drop-idio |
|---|---:|---:|---:|---:|---:|
| 2014-09-30 | 1 | $620M | 0.845% | +841 bps | +310 bps |
| 2020-09-30 | 1 | $386M | 0.526% | +343 bps | +1066 bps |
| 2025-03-31 | 2 | $885K | 0.001% | +814 bps | +1134 bps |

Median AUM of the 42 kept quarters: **$73.4B**. No holdings book matches them because there is
no full book behind them — `get_filer_holdings(as_of=...)` correctly falls back to the prior
quarter's ORIGINAL. Not recoverable by any `as_of` escalation or `amendment_type` filter, and
**not worth recovering: they do not describe the filer's book.** Excluded permanently. Their
inflated returns are the entire reason the 46-quarter Sharpe looked like 1.00 (§5).

## 1. Lagged gross series — headline

Construction: enter at **teo + 45 calendar days**, rolled forward to the next trading day
(verified: 2025-12-31 → 2026-02-17, 2026-03-31 → 2026-05-15); hold that book to the next
entry; buy-and-hold; always invested. Across a missing book the current book is simply held
longer (6 of 42 windows span >1 quarter). Not `filing_date` — that field is
amendment-contaminated.

> **Convention (do not "fix" this later):** entry = quarter-end + 45 **calendar** days, rolled
> forward to the next trading day. §13(f) is 45 *calendar* days, **not** 45 *trading* days.
> Pinned in `tests/test_window_primitives.py`.

**42 windows, entries 2013-11-14 → 2026-02-17.**

| Series | mean bps/q | t | hit % | ann Sharpe | ann % | cum % |
|---|---:|---:|---:|---:|---:|---:|
| **Lagged** | **453.6** | 3.19 | 76 | **0.99** | **17.64** | 450.4 |
| Unlagged (rebuild) | 506.6 | 2.94 | 71 | 0.91 | 19.18 | 531.3 |
| Unlagged (endpoint) | 425.2 | 2.73 | 74 | 0.84 | 15.85 | 368.9 |
| SPY (lagged windows) | 398.4 | 3.72 | 81 | **1.15** | 15.89 | 370.2 |
| SPY (unlagged windows) | 424.1 | 3.35 | 83 | 1.04 | 16.59 | 401.0 |

**How much survives:** lagged 453.6 / unlagged 506.6 = **90% of the gross mean**. Risk-adjusted
the lag *helps* — Sharpe 0.91 → 0.99, because the lag also trims beta (§2).

**But read the SPY row.** Over the same lagged windows SPY returned less (398.4 vs 453.6 bps/q)
at lower volatility, giving a **higher Sharpe (1.15 vs 0.99)**. Berkshire delivered more return
at more risk. State this whenever the 0.99 is quoted.

## 2. Market / alpha split (CAPM)

| | alpha (bps/q) | t(alpha) | beta | t(β≠1) |
|---|---:|---:|---:|---:|
| Lagged | +37.3 | **0.36** | 1.04 | 0.35 |
| Unlagged | +33.0 | **0.29** | 1.12 | 0.95 |

**Berkshire's Jensen alpha is statistically zero on both bases.** The raw outperformance versus
SPY is beta above one, not alpha. This reproduces Sammon (2016): the Berkshire replicator
tracks the market. The lag trims beta 1.12 → 1.04 and ~53 bps/q of gross; the (already-zero)
alpha is unchanged.

## 3. Two unlagged constructions — do not mix them

This is subtle and it produced an inconsistency in the earlier workbook.

- **UNLQ** — `teo → teo + 3 calendar months`, a fixed forward quarter. This is the endpoint's
  own window definition, so it is the construction for comparing rebuild against endpoint
  (§0, §4, and step C of the bridge in §5).
- **UNLT** — `teo_i → teo_j` where *j* is the next teo with a usable book, q_len-normalised.
  This mirrors the lagged window structure exactly, so lagged-minus-unlagged isolates the
  45-day entry shift and nothing else. This is the construction for §6.

They coincide except on the 6 windows spanning a missing book. `attribution_audit.xlsx` carries
both, labelled `_UNLQ` and `_UNLT`.

## 4. Layer validation gate — PASS

Rebuild vs the endpoint's own **unlagged** per-quarter layer returns (UNLQ windows, n=42,
terminal row dropped). Bar: median |diff| < 50 bps.

| Layer | mean \|diff\| | median | | Layer | mean \|diff\| | median |
|---|---:|---:|---|---|---:|---:|
| market | 32.5 bps | **16.7** | | subsector | 3.2 bps | **1.2** |
| sector | 7.4 bps | **3.6** | | idiosyncratic | 36.5 bps | **28.9** |

All medians well inside the bar. **PASS.** (The broken `l3_*_er` ER-share method was ±440–530
bps — 25× worse. ER are variance shares, not return weights; `get_returns_decomposition` is the
correct source.)

## 5. The Sharpe bridge — quote 0.91–0.93, never 1.00

| Step | Sharpe | Δ | Cause |
|---|---:|---:|---|
| A. Endpoint drop-idio, all 46 quarters | **1.003** | — | the previously published 1.00 |
| B. Endpoint drop-idio, 42 rebuildable quarters | 0.911 | −0.092 | the four dropped rows |
| C. Daily rebuild, same UNLQ windows | 0.933 | +0.021 | method (actual prices vs model return) |
| D. Daily rebuild, lagged | 1.066 | — | the lag itself |

The bridge reproduces exactly as first published — it runs through the decomposition path,
which already dropped NaN days, so the NaN bug never touched it. What changed is the
**interpretation of step A→B**: the four dropped rows are not merely unverifiable quarters,
they are three stub rows that do not describe Berkshire's book (§0.3) plus the terminal row
(§0.1). Their drop-idio mean is **837 bps/q against 372** for the 42 kept.

**Quote the range 0.91–0.93 with the sample stated. Never 1.00, and never a single decimal.**
The robust claim is the comparison in §6, not the level.

## 6. Lagged layer attribution

Per-day per-name additive decomposition (`l1_factor`=market, `l2_factor`=sector,
`l3_factor`=subsector, `l3_residual`=idio; sums to gross daily to ~5e-10). Portfolio layer over
a window = Σ wᵢ · (name's compounded layer return), renormalised to covered names.
q_len-normalised, n=42, UNLT basis (§3):

| Layer | LAG mean | t | hit % | Sharpe | | UNL mean | t | hit % | Sharpe |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|
| Market | 304.7 | 2.94 | 76 | 0.91 | | 337.6 | 2.69 | 79 | 0.83 |
| **Sector** | 38.1 | 1.31 | 62 | **0.40** | | 48.7 | 1.68 | 67 | **0.52** |
| Subsector | 14.9 | 0.96 | 55 | 0.30 | | 16.5 | 1.20 | 55 | 0.37 |
| **Sector + subsector** | **53.0** | 1.49 | 60 | **0.46** | | **65.2** | 1.78 | 64 | **0.55** |
| **Drop idio** | **357.7** | 3.45 | 79 | **1.07** | | **402.8** | 3.31 | 81 | **1.02** |
| Idiosyncratic | 48.7 | **0.73** | 50 | 0.22 | | 38.5 | **0.67** | 50 | 0.21 |
| Gross | 412.2 | 3.07 | 76 | 0.95 | | 456.1 | — | — | 0.92 |

**Reads:**

- **Drop-idio holds and improves under the lag.** Sharpe 1.02 unlagged → **1.07 lagged**, above
  the gross book (0.92 / 0.95) on both bases. Dropping the idiosyncratic sleeve improves
  risk-adjusted return, and that is not a look-ahead artifact. **This is the affirmative
  finding.**
- **Sector+subsector survives at ~81% of its mean** (65.2 → 53.0 bps/q), Sharpe 0.55 → 0.46,
  positive throughout. It loses about a fifth of its premium to the delay but does not
  evaporate. **Not significant either way** (t 1.78 → 1.49) — do not oversell it.
- **Idiosyncratic is zero both ways** — t 0.67 unlagged, 0.73 lagged, hit 50%. Nothing to keep.
  The decomposition's own linking residual (median 33 bps/q) is the same size as idio's mean
  contribution, so the sleeve cannot be cleanly separated from decomposition noise. That
  *strengthens* the case for dropping it.

### 6.1 Sector vs subsector — an earlier contradiction, resolved

An earlier note reported endpoint Sharpes of sector **0.28** / subsector **0.49**, while the
rebuild said the reverse. It matters: it decides whether you trade broad sector ETFs or narrow
industry ones. It is sample contamination.

| Source | sector | subsector | sec+sub |
|---|---:|---:|---:|
| Endpoint, all 46 quarters *(the old published figure)* | 0.28 | 0.49 | 0.47 |
| Endpoint, terminal row dropped | 0.40 | 0.56 | 0.64 |
| **Endpoint, 42 rebuildable quarters** | **0.56** | **0.49** | 0.63 |
| **Daily rebuild, same UNLQ windows** | **0.54** | **0.47** | 0.61 |
| Daily rebuild, UNLT windows | 0.52 | 0.37 | 0.55 |

**Believe sector > subsector.** On a consistent sample the endpoint (0.56/0.49) and the
independent rebuild (0.54/0.47) agree to 0.02 on both layers. The 0.28/0.49 came from the
contaminated 46-quarter sample. **Trade the broad sector exposure, not the narrow one.**

## 7. Transaction costs

Measured one-way turnover of the sector-ETF exposure the book implies: **4.4%/quarter,
17.4%/year** (name-level turnover is 5.6%/q; a swap between two names in the same sector does
not move the overlay). Sector-map coverage 100% of book weight.

| round-trip cost | annual drag | lagged sleeve gross → net | kept |
|---|---:|---|---:|
| 2 bps (optimistic) | 0 bps/yr | 203 → 203 bps/yr | 100% |
| **5 bps (base)** | **1 bps/yr** | **203 → 202 bps/yr** | **100%** |
| 15 bps (pessimistic) | 3 bps/yr | 203 → 201 bps/yr | 99% |

**Costs are not the binding constraint.** At sector level Berkshire barely trades. What kills
the sleeve is that its gross figure is not statistically distinguishable from zero (t=1.49).
Assumptions: liquid sector/subsector ETFs, quarterly rebalancing, institutional size.
**Excludes financing, borrow, taxes and capacity** — a market-neutral expression would add
financing and be materially worse. Reproduce: `python cost_estimate.py`.

## 8. What this is NOT — read before showing it

- **One construction choice:** +45d calendar entry, buy-and-hold, disclosed weights renormalised
  to covered names, quarterly book swap.
- **Gross of everything** in §1–§6. §7 adds a costs estimate only; still no financing or borrow.
- **Long-only** 13F longs. No shorts, no overlay. The "long the hedges, skip the idio" tradeable
  overlay was not built; §6 is the *attribution* behind it.
- **Post-2013 only** (daily-returns floor 2013-07-29). Sammon's sample starts 2006; Berkshire's
  stronger pre-2013 alpha is out of sample, which is part of why alpha reads ~0 here.
- **Rebuild runs ~median +12 bps/q rich** vs the endpoint. Absolute levels inherit this; the
  survival ratio and lag delta do not.
- **Not significant on one filer.** The sector+subsector premium is positive and survives, but
  t≈1.5. Statistical power is the binding constraint — see HANDOFF §9.
- **n=42**, after excluding 3 stub rows and the terminal row (§0.2).
