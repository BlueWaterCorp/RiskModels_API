# Style Factors via macro_factors — Enhancement Profile

**Status:** **Tier 1 DEPLOYED 2026-04-17.** Tier 2 (convenience endpoint) and Tier 3 (website Style DNA card + Medium piece) still scheduled.
**Owner:** Conrad
**Target surfaces:** `macro_factors` Supabase table → `GET /api/macro-factors`, `GET /api/metrics/{ticker}/correlation`, `POST /api/correlation`; website "Style DNA" card; Medium/content angle.

## Deployment notes (Tier 1 — 2026-04-17)

Code landed across two repos; tonight's pipeline cycle will begin writing rows.

**ERM3:**
- `erm3/shared/macro_factor_constants.py` — added `STYLE_SLEEVE_BY_TICKER` (8 ETFs), `STYLE_FACTOR_KEYS_ORDER`, `STYLE_FACTOR_TICKERS`, `STYLE_SLEEVE_SYNC_SOURCE`.
- `scripts/python/lib/supabase_schema_v3.py` — added `extract_style_factor_records(ds_etf, teo_iso_dates)`.
- `scripts/python/sync_erm3_to_supabase_v3.py` — added `sync_style_factors_to_public`; wired into `run_sync` as a piggyback on the existing `"macro_factors"` dataset branch, with non-fatal exception handling so a style-sleeve failure cannot roll back an already-committed macro sync.

**RiskModels_API:**
- `lib/risk/macro-factor-keys.ts` — `MACRO_SLEEVE_FACTORS` + `STYLE_SLEEVE_FACTORS`, types, ~30 new aliases (mtum, qual, usmv, vlue, iwf, iwm, schd, moat, minvol, small_cap, div, yield, etc.).
- `OPENAPI_SPEC.yaml` — extended `factor_key` description with both sleeves.
- `SEMANTIC_ALIASES.md` — rewrote factor-keys table with macro + style split; defaults updated from "all six" to "all 18".
- `mcp/data/openapi.json` — mirrored description edits for MCP consumers.

**Nightly behavior.** `sync_supabase_1f.py` already calls `run_sync(datasets={"macro_factors"})`. That branch now runs the macro sync AND the style-sleeve mirror. The default `lookback=30` means each nightly cycle writes the last 30 trading days of style factor rows for all 8 keys.

**Full historical backfill (one-time manual step, NOT scheduled):**

```bash
# From ERM3 repo root with monorepo venv active
python scripts/python/sync_erm3_to_supabase_v3.py \
  --datasets macro_factors \
  --lookback 10000
```

This will populate history all the way back to each ETF's launch date (IWF/IWM: 2000-05; USMV/SCHD: 2011-10; MOAT: 2012-04; MTUM/QUAL/VLUE: 2013). Pre-launch rows are silently skipped (NaN returns). Safe to run any time — idempotent upsert on `(factor_key, teo)` PK.

Until the one-time backfill runs, the correlation endpoints will return `null` for style factors on windows that predate the last ~30 days of coverage. 30+ days is already enough for the minimum-overlap correlation check (~30 paired days), so short windows will work immediately; long windows (252d/504d/756d) will progressively unlock as either nightly runs stack up or the manual backfill runs.

## Why this matters

The cascade cleanly strips market (SPY) → sector ETF → subsector ETF, leaving an idiosyncratic residual. The narrative currently calls that residual "pure idiosyncratic alpha." Technically it's only *orthogonal to the three factors we stripped* — it may still carry **style tilt** (momentum, quality, value, low-vol, growth, size) the PM didn't intend. That is a real competitive gap against Barra/Axioma, which report style loadings as first-class outputs. We can close most of it with a tiny data addition, not a new engine.

The insight: **because the residual is already orthogonal to SPY and to sector/subsector ETFs, raw style-ETF daily returns already give a clean read on pure-style exposure when correlated with the residual.** The market and sector components embedded in MTUM/QUAL/USMV correlate to zero against an orthogonal residual by construction. We get "pure style" signal for free.

## Proposed approach — add style factor ETFs to the existing macro factor sleeve

The `macro_factors` table already handles exactly this shape: one row per `(factor_key, teo)` with `return_gross` and a `metadata` jsonb. Correlation endpoints already accept `factor_key`. Adding style factors is a data-layer change; zero new endpoints required for v1.

**Key simplification:** the daily return series for MTUM, QUAL, USMV, VLUE, IWF, IWM, SCHD, MOAT are **already ingested in `ds_etf.zarr`** (the sector/style ETF price panel). That means we do not need to fetch from EODHD or extend `build_macro_factor_zarr` to pull new source data. The build step is a **mirror/sync from ds_etf → macro_factors** (or, if we prefer no duplication, a new read path that routes the correlation endpoint to ds_etf when the factor_key resolves to a style ETF).

## Recommended factor set (8 style factors)

| factor_key | ETF | Provider | History | Rationale |
|---|---|---|---|---|
| `momentum` | MTUM | MSCI USA Momentum | 2013-04 | Canonical momentum factor |
| `quality` | QUAL | MSCI USA Quality | 2013-07 | Canonical quality factor |
| `low_vol` | USMV | MSCI USA Min Vol | 2011-10 | Longest-history MSCI factor |
| `value` | VLUE | MSCI USA Value | 2013-04 | Canonical value factor |
| `growth` | IWF | Russell 1000 Growth | 2000-05 | Deep history; paired with IWD |
| `size` | IWM | Russell 2000 | 2000-05 | Small-cap proxy; deep history |
| `dividend` | SCHD | Schwab US Dividend Equity | 2011-10 | High-quality dividend factor |
| `moat` | MOAT | VanEck Wide Moat | 2012-04 | Profitability / competitive advantage |

**History tradeoff:** MSCI factor ETFs are cleaner "factor" products but only back to 2011-2013. Russell family (IWF, IWD, IWM) extends to 2000 at the cost of some factor purity (large-cap value and growth are not quite the same as MSCI Value / Momentum). Hybrid set above optimizes for: (a) ≥6 MSCI factors for factor purity, (b) IWF + IWM for longer-history coverage of growth and size where MSCI options are weaker.

**Drop to 6 if simplicity matters:** momentum, quality, low_vol, value, growth, size — covers the Fama-French-Carhart canon plus quality/low-vol.

## Implementation plan

### 1. Data layer — mirror ds_etf rows into macro_factors

**Committed path: mirror ds_etf → macro_factors.** Storage overhead is ~1 MB (8 series × ~4000 trading days); in return the correlation endpoint stays untouched and factor_keys "just work" end-to-end. (Alternative — routing the correlation endpoint directly at `ds_etf.zarr` — is recorded below as a fallback if Supabase row counts ever become a real concern, but not what we're building.)

Concrete steps:

- **Python canonical source.** Add a new `STYLE_SLEEVE_BY_TICKER` dict (MTUM→momentum, QUAL→quality, USMV→low_vol, VLUE→value, IWF→growth, IWM→size, SCHD→dividend, MOAT→moat) to `erm3/shared/macro_factor_constants.py`, parallel to the existing `MACRO_SLEEVE_BY_TICKER`. Add a `STYLE_FACTOR_KEYS_ORDER` tuple. Keep the two sleeves separate — the `ds_etf` exclusion for the *macro* sleeve stays correct; the style ETFs remain in `ds_etf` and we only mirror their return series into Supabase `macro_factors` with a category discriminator.

- **Sync job.** Write `sync_style_factors_to_macro_factors.py` that:
  - Reads daily returns for the 8 style tickers from `ds_etf.zarr`
  - Upserts into Supabase `macro_factors` with `factor_key` = the style label (`momentum`, `quality`, …), `teo`, `return_gross`, `metadata = {"source": "ds_etf", "etf": "MTUM", "category": "style", "provider": "MSCI"}`
  - Idempotent; safe to re-run
  - Hooked into the daily pipeline after `ds_etf` materializes so incremental rows flow through automatically.

- **Backfill.** One-time full-history run against `ds_etf.zarr` (fast — no network fetch; data already local in GCS zarr). Short-history MSCI ETFs (MTUM/QUAL/VLUE/SCHD) will simply have no rows before their respective launch dates. Document this in `SEMANTIC_ALIASES.md`.

---

**Fallback option (not being built):** route the correlation endpoint to read style factor returns directly from `ds_etf.zarr` via `lib/dal/zarr-reader.ts`, skipping the Supabase mirror entirely. Preserves single-source-of-truth at the cost of an extra branch in the correlation DAL. Revisit only if the mirror becomes a bottleneck.

### 2. API layer — expose new keys

- `lib/risk/macro-factor-keys.ts` — add 8 new canonical keys to `DEFAULT_MACRO_FACTORS`, mapping in `MACRO_FACTOR_DB_KEYS`, and aliases in `MACRO_FACTOR_ALIASES` (e.g. `mom`→`momentum`, `mtum`→`momentum`, `qual`→`quality`, `val`→`value`, `minvol`→`low_vol`, etc.).
- Optional: introduce a `factor_category` discriminator. Two clean options:
  - **A.** Keep flat list; add a `category` ("macro" | "style") inside `metadata` jsonb on each row. Simple.
  - **B.** Split the TS constants into `MACRO_FACTORS` and `STYLE_FACTORS` arrays that both flow into the same DB table. Slightly cleaner for callers who want only one kind.
- `GET /api/macro-factors` — accept optional `?category=style|macro` filter; default returns all.
- Correlation endpoints — no code change; they already accept any `factor_key` present in `macro_factors`.

### 3. Spec + SDK sync (cross-repo — see `docs/AGENTS_CROSS_REPO.md`)

- `OPENAPI_SPEC.yaml` — extend `factor_key` enum; document each style factor's ETF and interpretation.
- `mcp/data/openapi.json` — regenerate.
- `SEMANTIC_ALIASES.md` — one-line definitions for each style key.
- Python SDK — add `StyleFactor` enum / constants; add a convenience `client.get_style_correlations(ticker)` that loops the 8 keys and returns a dict. Optional: `client.style_dna(ticker)` returning a top-N ranked list.

### 4. Convenience endpoint (optional, v1.1)

```
GET /api/metrics/{ticker}/style-correlation
  ?window=252d|504d|756d   (default 504d = ~2y)

Response:
{
  ticker: "NVDA",
  window_days: 504,
  window_start: "2024-04-12",
  window_end: "2026-04-16",
  residual_source: "l3",   // L3 residual (post market/sector/subsector strip)
  correlations: {
    momentum: 0.42,
    quality: 0.11,
    low_vol: -0.18,
    value: -0.33,
    growth: 0.28,
    size: -0.05,
    dividend: -0.12,
    moat: 0.09
  },
  notes: "Correlations against L3 residual. Raw style-ETF returns used; orthogonality of the residual to market/sector/subsector means the market and sector components embedded in the style ETFs contribute zero by construction."
}
```

This is a thin wrapper over the existing correlation endpoint — single call, all 8 factors, structured for "Style DNA" visualization.

## Website content implications (riskmodels.app)

**"Style DNA" card on the stock page** — small horizontal bar chart per factor, colored navy for positive loading, orange for negative, annotated with the factor's ETF ticker. Sits directly under the existing L3 Risk DNA. Tells the PM: "yes, you stripped market and sector, but your NVDA residual is still +0.42 momentum and –0.33 value — if you're value-styled, you are unknowingly carrying anti-value exposure in your residual."

**Landing-page claim upgrade** — "We decompose every US equity down to market, sector, subsector, style factor, and idiosyncratic residual — all through one API." This closes the Barra/Axioma parity gap for the style-factor piece of the story with a tiny data addition.

## Medium / content angle

Fits naturally as a **Part 3.5 appendix** or a **standalone follow-up piece**. Thesis: "Your residual may not be alpha — it may still be style tilt you didn't mean to own."

Concrete example: take NVDA's L3 residual from Part 1 (+11.5pp over the trailing year, looks like pure idiosyncratic alpha). Correlate with MTUM and QUAL. If MTUM correlation is strong, the residual is materially "momentum overlay on top of the semi-cycle bet" rather than pure NVDA-specific information. That's a substantively different thing for a PM to own knowingly vs unknowingly. Same cascade, one more layer.

## Caveats / design decisions

- **Correlation vs regression beta.** Pearson correlation answers "do these move together?" but not "what's the $ exposure?" For a full Barra-parity product the follow-on is **rolling regression of residual on style-ETF returns** to produce style *betas* (dollar or dimensionless). That's a second step; v1 correlation is enough for a visible "Style DNA" story.
- **History matters.** MSCI factor ETFs back to 2013 only. For decade-plus lookbacks (e.g. through 2008), we rely on the Russell pair (IWF/IWD) and IWM. Document this clearly in SEMANTIC_ALIASES so users don't get surprised by NaN-filled pre-2013 rows for MTUM/QUAL/VLUE.
- **Orthogonality holds only vs L3 residual.** If callers correlate style factors against the L2 residual or the raw stock, market/sector components of the style ETFs will leak in. The convenience endpoint should be explicit about which residual it uses.
- **Factor overlap.** Momentum and Quality historically correlate positively; Value and Growth strongly negatively; Low-Vol and Quality moderately positively. Surface the factor-factor correlation matrix on the factor documentation page so PMs can interpret loadings in context.
- **macro vs style mixing.** Keep them co-resident in `macro_factors` for simplicity but do add the `category` metadata field so the UI can separate the two cleanly.

## Effort estimate (if scheduled)

- **Tier 1 (data + API exposure):** ~half a day
  - Add `STYLE_SLEEVE_BY_TICKER` + `STYLE_FACTOR_KEYS_ORDER` to `macro_factor_constants.py` (30 min)
  - Write `sync_style_factors_to_macro_factors.py` that reads from existing `ds_etf.zarr` and upserts to Supabase (1-2 hr — it's just a shaped read + upsert; no source fetching since data already in ds_etf)
  - Run full backfill (fast — all data already local in GCS zarr)
  - Update TS factor-keys file + OpenAPI spec + semantic aliases (2 hr)
  - Cross-repo schema sync (30 min)
  - Smoke test via existing correlation endpoints (30 min)

- **Tier 2 (convenience endpoint + SDK helpers):** 0.5 day

- **Tier 3 (website "Style DNA" card + Medium piece):** 1-2 days content/design work

## Related files

- Python canonical source: `ERM3/erm3/shared/macro_factor_constants.py`
- TS canonical source: `lib/risk/macro-factor-keys.ts`
- Correlation API: `app/api/metrics/[ticker]/correlation/route.ts`, `/api/correlation/route.ts`
- Macro factors endpoint: `app/api/macro-factors/route.ts`
- Supabase schema: `SUPABASE_TABLES.md` — `macro_factors` row
- Build script: `erm3/**/build_macro_factor_zarr.py` (ERM3 repo)
- Cross-repo sync checklist: `docs/AGENTS_CROSS_REPO.md`

## Recommended order of operations (when scheduled)

1. Pick 6 vs 8 factors — commit to the set.
2. Update Python constants; run `build_macro_factor_zarr` in a branch.
3. Verify zarr writes with NaN-filled pre-launch rows for short-history factors.
4. Sync to Supabase; spot-check a few `(factor_key, teo)` rows.
5. Update TS + OpenAPI + SDK; deploy.
6. Manual QA: `GET /api/metrics/NVDA/correlation?factor_key=momentum` against a reference calculation.
7. Ship "Style DNA" card on site.
8. Draft the Medium appendix piece.
