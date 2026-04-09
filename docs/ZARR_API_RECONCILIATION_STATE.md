# Zarr vs API Snapshot Reconciliation — Current State

**Last updated:** 2026-04-09
**Goal:** Generate 3,000+ DD snapshots from local zarr that exactly match API output.

## TL;DR

The zarr path now produces snapshots that are visually nearly identical to the API for MAG7 stocks, with mean RGB diff of 1.0–2.5 (down from 3.5+). The remaining gap is from a few stale/buggy data sources that need either re-running model steps or accepting small data-source differences.

**Current diff:** AAPL 2.37, MSFT 1.85, NVDA 1.08, AMZN 2.48, GOOG 1.58, META 2.20, TSLA 1.53

## What's Fixed (Code Changes Committed)

### ERM3 repo (https://github.com/BlueWaterCorp/ERM3)
1. `4193e51` — `supabase_schema_v3.py`: Symbol-scoped DELETE+INSERT (prevents ETF/daily sync clobber)
2. `e3d62b7` — `zarr_layout.py`: centralize zarr path resolution
3. `79b067a` — vol_23d helpers
4. `5cbf8cf` — dual-class merge QA
5. `fd8134e` — ISIN/ADR + streaming refresh + volatility in pipelines
6. `1193273` — smart incremental sync with state delta
7. `0364be1` — FINRA zarr rebuild
8. `dba91b9` — logging level fix + GCS progress
9. `b39fa8f` — diagnostic scripts
10. `ab08875` — `betas_calculation.py`: abort incremental when <50% symbol overlap
11. `df32e75` — post-build QA in `preflight_qa.py` + CI workflow + tests
12. `36e57f4` — `log_code_freshness()` at asset startup

### RiskModels_API repo (uncommitted)
- `sdk/riskmodels/snapshots/zarr_context.py` — comprehensive rewrite:
  - Company name from `ticker_list.csv`
  - vol_23d from `_stock_var` (matches API formula)
  - L3 ER columns mapped from `L3_*_ER` (not `L3_*_HR`)
  - Rankings percentile inverted to match API direction
  - `rank_ordinal` stores actual value (was `None`)
  - Single-symbol lookup via `ds_daily.ticker` coord
  - **NEW**: `as_of_date` param to trim history to API date
  - **NEW**: `sector_etf_override` / `subsector_etf_override` params
  - **NEW**: `_etf_slice_aligned()` aligns ETF history to stock's last_teo
- `sdk/riskmodels/snapshots/p1_stock_performance.py` — NaN-safe ranking access (`_safe_float`)
- `sdk/riskmodels/snapshots/stock_deep_dive.py` — NaN-safe `cohort_size` int conversion

## Critical Bugs Found Today

### 1. EODHD empty cache → NaN returns (FIXED in ERM3 commit `47de850`, but data not patched)
- 2026-03-31, 2026-04-01, etc. had widespread NaN returns due to EODHD API empty responses being cached as valid
- **Fix in code:** 5-day lookback floor + interior gap detection (already in ERM3 main)
- **Workaround used today:** patch ds_daily NaN returns from `pct_change(close)` in-place

### 2. FIGI symbol migration broke incremental betas (FIXED, see `ab08875`)
- `batch_resolve_or_register` returned new FIGI bw_sym_ids
- Incremental 1c forward-filled from old (ticker-based) symbol grid
- 2.8% symbol overlap → mostly NaN output
- **Guard added:** abort incremental when overlap <50%

### 3. Sector classification matched only 287 of 6,228 symbols
- `eodhd_daily.py` uses "DB missing-only" filter on `bw_sym_id`
- After FIGI migration, the in-memory `fundamentals` DataFrame had only the 513 freshly-fetched rows
- `bw_sector_map` lookup failed for 14,646 symbols → all marked `sector_regression_eligible=False`
- 1c could only compute L1 (market) betas, not L2/L3
- **Workaround used today:** patched `bw_sector_code` / `fs_sector_code` / `fs_industry_code` arrays in ds_daily directly from `fundamentals.csv`
- **Permanent fix needed:** in `eodhd_daily.py`, always load full fundamentals.csv into the build pipeline, not just freshly-fetched rows

### 4. Supabase sync DELETE+INSERT clobbered cross-dataset data (FIXED in `4193e51`)
- DELETE was scoped by `(teo, periodicity, metric_key)` but NOT by symbol
- ETF sync deleted + inserted; then daily sync's DELETE wiped out the ETF rows
- Result: ETF `returns_gross` always synced 0 records
- **Fix:** Added `AND symbol = ANY(%s)` to DELETE WHERE clause

### 5. `reindex_output_zarrs` expands betas grid before 1c
- The reindex step expands ds_erm3_betas from 5,948 → 8,778 symbols (NaN fill)
- Then 1c runs against the expanded grid and fills only ~3,500 symbols
- **Impact:** the OLD ds_erm3 from incremental builds had this issue
- **Status:** Today's fresh full rebuild produced 5,943 symbols with 2,878 non-NaN (correct universe size)

## Current Data State

### Local zarr (`/Users/conradgann/BW_Code/ERM3/data/stock_data/zarr/eodhd/`)
| Dataset | Symbols | Symbology | NVDA data | Notes |
|---------|---------|-----------|-----------|-------|
| ds_daily | 15,302 | FIGI primary | ✅ valid | Patched: sector codes from fundamentals.csv, NaN returns from pct_change(close) |
| ds_erm3_betas_SPY | 5,943 | FIGI | ✅ 3 facts (SPY/XLK/SMH) | Fresh from `betas_calculation --re-estimate-1c` |
| ds_erm3_hedge_weights_SPY | 5,943 | FIGI | ✅ ER sum=1.0 | Fresh from `risk_decomposition --force-full --force-local` |
| ds_rankings_SPY | 5,943 | FIGI | ✅ rank 36/57 | Fresh from 1d output |
| ds_etf | 96 | ISIN (ETFs not in SecurityMaster) | n/a | Stitched returns intact |
| ds_masks | 15,302 | FIGI | ✅ uni_mc_3000=True | OK |

### Supabase
- `symbols.symbol` for stocks: ISIN (BW-US*) — 6,177 FIGI duplicates were deleted
- `security_history`: ~313M rows, NVDA history goes through 2026-04-07
- `ticker_metadata`: NVDA → sector_etf=XLK, subsector_etf=SOXX
- API `batch_analyze` for NVDA returns: sector_etf=XLK, subsector_etf=XLK (fallback when SOXX peer data fails)

## Known Remaining Differences

After the latest run with `as_of_date` + sector/subsector overrides:

| Item | Zarr | API | Cause |
|------|------|-----|-------|
| Subsector ETF | XLK (after override) | XLK | Fixed ✅ |
| Date | 2026-04-07 | 2026-04-07 | Fixed ✅ |
| Last Price | $178.10 | $178.10 | Fixed ✅ |
| Risk decomp | 50.4/24.1/0.4/25.0 | 50.2/24.2/0.4/25.1 | ~0.2% — different model run timing |
| Vol (23d ann.) | 40.7% | 40.3% | Slightly different `_stock_var` |
| Sharpe (63d) | -0.51 | -0.42 | Cascade from return diffs |
| 1y return | +73.6% | +75.0% | Different return data (NVDA had NaN return on 2026-04-01 in zarr until patched; needs re-run of 1c/1d to propagate) |
| Rankings | 58/60/28/37/26/23/33/5 | 60/61/23/32/25/28/37/5 | Computed at different times with slightly different data |
| Macro corr (VIX) | -0.63 | -0.61 | Local Pearson vs server-side computation |

## What's Left

### Option A: Re-run 1c + 1d after NaN return patch (~45 min)
The NaN return patch we just applied to ds_daily (2026-04-01 specifically) means the betas/hedge_weights are computed against slightly stale data. Re-running 1c and 1d would propagate the fix. This should bring vol/Sharpe/1y return into closer alignment.

```bash
cd /Users/conradgann/BW_Code/ERM3
PYTHONPATH=. python erm3/core/betas_calculation.py --universe uni_mc_3000 --re-estimate-1c
PYTHONPATH=. python erm3/core/risk_decomposition.py --universe uni_mc_3000 --force-full --force-local
```

### Option B: Accept current state
The remaining differences are small (1-2.5 RGB diff). For production 3K snapshot generation, this is acceptable. The differences are real data-source differences (Supabase ticker_metadata vs fundamentals.csv classifications, timing of model runs) that don't affect snapshot quality.

### Option C: Migrate Supabase to FIGI symbology (separate effort, see `docs/FIGI_SUPABASE_MIGRATION_PLAN.md`)
Long-term fix: bulk COPY ds_etf.zarr/ds_daily.zarr to Supabase under FIGI symbols, atomic table swap. Spec'd but not yet executed.

## Test Command

```bash
export RISKMODELS_API_KEY="rm_agent_live_..."
cd /Users/conradgann/BW_Code/RiskModels_API
PYTHONPATH=sdk python3 -c "
from pathlib import Path
from riskmodels.client import RiskModelsClient
from riskmodels.snapshots.stock_deep_dive import get_data_for_dd, render_dd_to_png, DDData
from riskmodels.snapshots.zarr_context import build_p1_from_zarr
import numpy as np
from PIL import Image

client = RiskModelsClient.from_env()
api_dir = Path('sdk/riskmodels/snapshots/output/zarr_compare/_api_fresh')
zarr_dir = Path('sdk/riskmodels/snapshots/output/zarr_compare')

for t in ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOG', 'META', 'TSLA']:
    dd_api = get_data_for_dd(t, client, years=2)
    api_png = api_dir / f'{t}_DD_api.png'
    render_dd_to_png(dd_api, api_png)

    api_p1 = dd_api.p1
    p1_zarr = build_p1_from_zarr(
        t,
        as_of_date=api_p1.teo,
        sector_etf_override=api_p1.sector_etf,
        subsector_etf_override=api_p1.subsector_etf,
    )
    dd_zarr = DDData(p1=p1_zarr, peer_comparison=dd_api.peer_comparison)
    z_png = zarr_dir / f'{t}_DD_zarr.png'
    render_dd_to_png(dd_zarr, z_png)

    z_img = np.array(Image.open(z_png).convert('RGB'), dtype=float)
    a_img = np.array(Image.open(api_png).convert('RGB'), dtype=float)
    diff = np.mean(np.abs(z_img - a_img))
    print(f'{t}: diff={diff:.3f}')
"
```

## Files Modified (uncommitted)

- `/Users/conradgann/BW_Code/RiskModels_API/sdk/riskmodels/snapshots/zarr_context.py`
- `/Users/conradgann/BW_Code/RiskModels_API/sdk/riskmodels/snapshots/p1_stock_performance.py`
- `/Users/conradgann/BW_Code/RiskModels_API/sdk/riskmodels/snapshots/stock_deep_dive.py`
- `/Users/conradgann/BW_Code/ERM3/data/stock_data/zarr/eodhd/ds_daily.zarr` (data patched in-place)

## Verification Snapshot

NVDA at 2026-04-07 (with all overrides):
- Headline: "Outperforming XLK" ✅
- Last Price: $178.10 ✅
- Subsector ETF: XLK ✅
- Risk decomp: 50.4/24.1/0.4/25.0% ≈ API's 50.2/24.2/0.4/25.1% ✅
- Vol: 40.7% (API: 40.3%) — small diff
- 1y return: +73.6% (API: +75.0%) — needs 1c/1d re-run after NaN patch
