# ERM3 zarr ↔ RiskModels API parity (ER / HR)

Research pipelines that merge **ERM3 zarr** `ds_erm3_hedge_weights_*` with **RiskModels API** `POST /batch/analyze` need the same economic quantities under stable names. This document maps **zarr-style** `L*_ER` / `L*_HR` variables to **API payload keys** and records naming aliases between endpoints.

## Topic-level features (`wmean_L*_ER`, `wmean_L*_HR`)

**Topic / holdings-weighted aggregation stays client-side.** The API returns **per-ticker** scalars; you form `wmean_*` features as holdings-weighted means of the API fields below (same as with zarr per-name arrays). There is **no** server-side topic or basket endpoint in the public contract as of this document.

## API key → zarr variable (hedge weights naming)

Zarr hedge-weight datasets often use **`L{level}_{component}_ER`** and **`L{level}_{component}_HR`**. The RiskModels API uses **snake_case** with `market` / `sector` / `subsector` / `residual` spellings.

### Hedge ratios (HR)

| Zarr-style (typical) | `POST /batch/analyze` → `hedge_ratios` | `full_metrics` (flat snapshot) |
|----------------------|----------------------------------------|----------------------------------|
| `L1_market_HR` | `l1_market` | `l1_market_hr` |
| `L2_market_HR` | `l2_market` | `l2_market_hr` |
| `L2_sector_HR` | `l2_sector` | `l2_sector_hr` |
| `L3_market_HR` | `l3_market` | `l3_market_hr` |
| `L3_sector_HR` | `l3_sector` | `l3_sector_hr` |
| `L3_subsector_HR` | `l3_subsector` | `l3_subsector_hr` |

**Important:** `hedge_ratios` uses **short** property names (`l1_market`, …) while `full_metrics` uses **long** names (`l1_market_hr`, …). Values are the same notionals (dollar hedge per $1 stock) when both are populated.

### Explained risk (ER)

| Zarr-style (typical) | `full_metrics` (and `GET /metrics/{ticker}` note) |
|----------------------|--------------------------------------------------|
| `L1_market_ER` | `l1_market_er` |
| `L1_residual_ER` | `l1_residual_er` |
| `L2_market_ER` | `l2_market_er` |
| `L2_sector_ER` | `l2_sector_er` |
| `L2_residual_ER` | `l2_residual_er` |
| `L3_market_ER` | `l3_market_er` |
| `L3_sector_ER` | `l3_sector_er` |
| `L3_subsector_ER` | `l3_subsector_er` |
| `L3_residual_ER` | `l3_residual_er` |

**`GET /api/metrics/{ticker}`** exposes the same numbers under **abbreviated** keys inside `metrics` (e.g. `l3_mkt_hr`, `l3_mkt_er`, `l3_res_er`). See [SEMANTIC_ALIASES.md](../SEMANTIC_ALIASES.md).

## Request shape for a full ER/HR snapshot

Ask for **both** `full_metrics` (flat ER + L3 HR + aux) and `hedge_ratios` (all six HR names with short keys) until your integration confirms a single object covers all fields:

```json
{
  "tickers": ["AAPL", "MSFT", "NVDA"],
  "metrics": ["full_metrics", "hedge_ratios"],
  "years": 1
}
```

`metrics` is a **whitelist**: only requested blocks are returned. Omitting `hedge_ratios` or `full_metrics` means those sections are absent—not silently filled.

## Lineage / PIT alignment

Use response **`_metadata`** (when present) and HTTP headers documented in [RESPONSE_METADATA.md](../RESPONSE_METADATA.md) and **`OPENAPI_SPEC.yaml`** (`X-Risk-Model-Version`, `X-Data-As-Of`, `X-Factor-Set-Id`, `X-Universe-Size`) so point-in-time tests can match zarr slices on the same `teo` / model.

## Parity tolerances

- **ER**: Components at a given level are variance fractions; L3 quadruple should sum to **1.0 ± 0.02** (see [VALIDATION_HELPERS.md](../VALIDATION_HELPERS.md)).
- **HR**: Same units (`dollar_ratio`) as [SEMANTIC_ALIASES.md](../SEMANTIC_ALIASES.md); cross-source diffs should be evaluated on the same `teo` and model version.

## Example JSON (illustrative)

```json
{
  "results": {
    "AAPL": {
      "ticker": "AAPL",
      "status": "success",
      "hedge_ratios": {
        "l1_market": 0.98,
        "l2_market": 0.85,
        "l2_sector": 0.12,
        "l3_market": 0.72,
        "l3_sector": 0.11,
        "l3_subsector": 0.05
      },
      "full_metrics": {
        "ticker": "AAPL",
        "date": "2026-03-20",
        "volatility": 0.28,
        "l1_market_hr": 0.98,
        "l2_market_hr": 0.85,
        "l2_sector_hr": 0.12,
        "l3_market_hr": 0.72,
        "l3_sector_hr": 0.11,
        "l3_subsector_hr": 0.05,
        "l1_market_er": 0.42,
        "l1_residual_er": 0.58,
        "l2_market_er": 0.35,
        "l2_sector_er": 0.08,
        "l2_residual_er": 0.57,
        "l3_market_er": 0.28,
        "l3_sector_er": 0.09,
        "l3_subsector_er": 0.06,
        "l3_residual_er": 0.57,
        "market_cap": 3000000000000,
        "close_price": 220.5
      }
    }
  },
  "summary": { "total": 1, "success": 1, "errors": 0 },
  "_agent": { "cost_usd": 0.01, "latency_ms": 120, "request_id": "req_..." },
  "_metadata": {
    "model_version": "ERM3-L3-v30",
    "data_as_of": "2026-03-20",
    "factor_set_id": "SPY_uni_mc_3000",
    "universe_size": 2987
  }
}
```

## Backend implementation note (maintainers)

`security_history_latest` may currently store **only L3** HR/ER columns for fast paths. Serving **full L1/L2/L3** ER/HR in `full_metrics` requires reading the latest `teo` from `security_history` (or widening the latest table) for all `metric_key` values listed in [SUPABASE_TABLES.md](../SUPABASE_TABLES.md). The **OpenAPI** `BatchFullMetrics` schema is the public contract for which fields should appear when the backend has data.

## Related docs

- [SEMANTIC_ALIASES.md](../SEMANTIC_ALIASES.md) — units, formulas, `/ticker-returns` column notes
- [SUPABASE_TABLES.md](../SUPABASE_TABLES.md) — `metric_key` / `security_history` vocabulary
- [VALIDATION_HELPERS.md](../VALIDATION_HELPERS.md) — ER sum and null checks
