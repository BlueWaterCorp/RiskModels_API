# AOM compiler mapping (non-breaking)

**Status**: Draft  
**Updated**: 2026-04-29  

This document maps **Analysis Object Model** requests to **existing** ERM3 Risk Metrics REST tables exposed via PostgREST. It does **not** rename or replace endpoints.

Reference API: [`../OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml) (this repo root).

---

## Pipeline

```
AOMRequest | AOMChain → ExecutionPlan → REST calls (existing resources only)
```

An **ExecutionPlan** is an ordered list of:

- **Resolve subject** — ticker filters, universe keys, portfolio expansion (multi-call + weighting client-side or future portfolio service).
- **Bind lens + attribution_mode + resolution + view + scope** — choose resource(s), filters, aggregation strategy.
- **Merge / align** — comparison subjects require aligned joins on date/ticker.
- **Chain** — run stages sequentially; pass structured outputs from **analyze** stages into **hedge_action** compilation.

---

## Lens → primary data facet

| Lens | Typical resources | Notes |
|------|-------------------|--------|
| `return_attribution` | `erm3_ticker_returns` | Daily return decomposition columns (`l1`, `l2`, `l3` vs gross); frequency daily. |
| `risk_decomposition` | `erm3_l3_decomposition`, `ticker_factor_metrics` | Monthly HR/ER series vs latest snapshot; RR / ER semantics per OpenAPI. |
| `exposure` | `ticker_factor_metrics`, decomposition as needed | Snapshot-first; exposure derived from HR/ER depending on product definition. |

---

## Resolution → hierarchy filter

| Resolution | Column family |
|------------|----------------|
| `market_only` | L1 columns only |
| `market_sector` | L2 columns |
| `full_stack` | L3 columns |

Compilation translates semantic resolution to selected columns — never require agents to send `L1`/`L2`/`L3` strings in AOM payloads.

---

## Attribution mode → aggregation

| Mode | Role in compiler |
|------|-------------------|
| `incremental` | Default. Period-wise contributions within scope (daily bars or monthly points). |
| `cumulative` | Window-level aggregation consistent with “explained share” / cumulative attribution semantics for the lens (implementation binds to metric definitions). |

Ignored when **lens** is `exposure`.

---

## Scope → filters

| Scope field | Typical mapping |
|-------------|-----------------|
| `date_range` | PostgREST `date` filters (`gte`, `lte`, `eq`) |
| `as_of` | `latest` → sort/limit to latest row; explicit date → `eq` / inclusive end bound per view rules in AOM_SPEC |
| `benchmark` | Relative attribution when product defines benchmark-series joins (future or composite queries) |

---

## View → shape

| View | Behavior |
|------|----------|
| `snapshot` | Single row / cross-section slice |
| `timeseries` | Ordered series |
| `distribution` | Histogram / bucketing / universe spread |

---

## Chain execution

1. Compile **analyze** stages left-to-right; each yields structured intermediates keyed by stage index or id.
2. **`hedge_action`** reads intermediates from **`depends_on`** (default **`previous`** HR/ER context).
3. No REST mutation — hedge compilation reads same snapshot/time series tables for hedge ratios already exposed.

---

## Comparison

- Emit **N parallel queries** (one per leg), **same scope** when `alignment.date_range === "shared"`**, then align on calendar index.
- **`normalize: true`** triggers compiler-defined scaling so cross-subject charts are comparable.

---

## Optional intent

If `intent` is set, expand to primitives **before** applying this mapping — explicit AOM fields override preset defaults.

See [`AOM_SKILLS.md`](./AOM_SKILLS.md).

---

## Tables (current)

| Resource path | Role |
|---------------|------|
| `erm3_ticker_returns` | Daily returns + level returns |
| `erm3_l3_decomposition` | Monthly HR/ER |
| `ticker_factor_metrics` | Latest HR/ER snapshot |

Portfolio and universe analyses **compose** these resources until dedicated aggregates exist.
