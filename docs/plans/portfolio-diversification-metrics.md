# Portfolio diversification metrics (risk-snapshot)

**Status:** Blocked on L2/L3 data fix (ERM3 sector code repair + betas recomputation)
**Prerequisite:** Verify `/metrics/{ticker}` returns non-null `l3_sec_er`, `l3_sub_er`, `sector_etf`, `subsector_etf` before starting implementation.

## Critical codebase fact

`lib/portfolio/portfolio-risk-core.ts` today computes `portfolioER` as a linear weighted sum of each position's `l3_*_er` via `computePortfolioER` (lines 39–57, 162–163). It does **not** call `lib/risk/factor-correlation-service.ts` (that module correlates stock returns vs macro_factors, not portfolio-wide sector orthogonality).

The `naive_pws` vs `correlation_adjusted` vs `diversification_credit` is **new product logic**. The current `portfolio_risk_index.variance_decomposition` is the "naive" weighted sum.

## Approach

### 1) Methodology — variance-space quadratic adjustment

Work entirely in **variance-fraction space** to match existing ER semantics. No sqrt on exposures — keeps naive and adjusted in the same units so credits are meaningful.

**Naive (unchanged, already in core):** per layer `L`:

```
naive_L = sum_i w_i * l3_{L}_er_i
```

where `l3_mkt_er`, `l3_sec_er`, `l3_sub_er`, `l3_res_er` come from latest metrics (same as today's `computePortfolioER`). Per-stock L3 components sum to ~1.0, so portfolio naive total should be ~1.0 for a fully-invested long-only book.

**Sector and subsector — adjusted:**

- For each layer, group positions by ETF bucket `k` using `sector_etf` / `subsector_etf` from `resolveSymbolsByTickers` / `SymbolRegistryRow`.
- **Exposure vector (variance-space):**
  ```
  u_k = sum_{i mapped to ETF k} w_i * l3_layer_er_i
  ```
  Use `l3_sec_er` for sector layer, `l3_sub_er` for subsector. Missing ETF → skip position in that layer's `u` and emit a **warning**.
- **Correlation matrix `R`:** Pearson on aligned daily gross returns (`returns_gross`) for the unique ETFs in that layer over `window_days` (default 252). Reuse fetch/pivot/overlap patterns from `lib/risk/factor-correlation-service.ts` (shared DAL helpers, not the macro-factor API itself).
- **Adjusted layer metric:**
  ```
  adjusted_L = u' R u
  ```
  Single ETF → `u_1^2 * 1 = u_1^2` (reduces to the squared single-bucket exposure). This is the portfolio variance contribution from that layer, accounting for cross-ETF correlation.

**Market:** apply the same `u'Ru` quadratic form for uniformity. In practice, all positions share the same broad market factor (SPY), so the result is near-identical to naive (market correlations ~0.95+). Keeping the code path uniform avoids special-casing and handles the rare case where multiple broad-market ETFs are introduced later.

**Residual — concentration-adjusted:** `adjusted_residual = sum_i w_i^2 * l3_res_er_i`. Residuals are constructed to be approximately uncorrelated across stocks, so the off-diagonal correlations are ~0 by design. The concentration form captures the fact that idiosyncratic risk diversifies with the number of positions — a 50-stock portfolio has far less residual risk than naive weighting implies. Document as "concentration-adjusted residual" in API output and explanation. Phase 2 can add alternatives behind a flag.

**Credits and stacking:**

- `adjustment_er = naive_er - adjusted_er` (signed). For diversified portfolios, `adjusted_er < naive_er` → positive credit.
- `diversification_credit = max(0, adjustment_er)` per layer. `total` = sum of per-layer credits (documented as summary, not additive variance identity across layers).

**`multiplier` in `layers[]`:** `adjusted_er / naive_er` when `naive_er > epsilon`, else `null`. Interpretable as "retained fraction" for charts.

### 2) API surface

- Extend `PortfolioRiskSnapshotRequestSchema` (`lib/api/schemas.ts`) with optional `include_diversification: z.boolean().optional()` (default `false`). Also accept as query param for URL-only agents.
- When `include_diversification === true`, add to `portfolio_risk_index`:

```json
"diversification": {
  "window_days": 252,
  "method": "variance_space_quadratic",
  "naive_pws": {
    "market_er": 0.52, "sector_er": 0.18, "subsector_er": 0.12,
    "residual_er": 0.18, "total": 1.00
  },
  "correlation_adjusted": {
    "market_er": 0.52, "sector_er": 0.11, "subsector_er": 0.06,
    "residual_er": 0.14, "total": 0.83
  },
  "diversification_credit": {
    "market": 0, "sector": 0.07, "subsector": 0.06,
    "residual": 0.04, "total": 0.17
  },
  "layers": [
    { "layer": "market",    "naive_er": 0.52, "adjusted_er": 0.52, "adjustment_er": 0.00, "multiplier": 1.00 },
    { "layer": "sector",    "naive_er": 0.18, "adjusted_er": 0.11, "adjustment_er": 0.07, "multiplier": 0.61, "unique_etfs": 5 },
    { "layer": "subsector", "naive_er": 0.12, "adjusted_er": 0.06, "adjustment_er": 0.06, "multiplier": 0.50, "unique_etfs": 8 },
    { "layer": "residual",  "naive_er": 0.18, "adjusted_er": 0.14, "adjustment_er": 0.04, "multiplier": 0.78 }
  ],
  "warnings": [],
  "_explanation": "Sector and subsector layers apply quadratic diversification adjustment (u'Ru) using realized correlations between the underlying sector/subsector ETFs. Market layer is near-additive because all positions share the same broad market factor (quadratic form applied for uniformity). Residual applies concentration-adjusted form (sum w_i^2 * res_er_i) because residuals are constructed to be approximately uncorrelated across stocks."
}
```

Note: example numbers are realistic for a 6-position tech-heavy portfolio. Naive total ≈ 1.0 (L3 ER components sum to ~1.0 per stock by construction).

- Keep existing `variance_decomposition` unchanged for backward compatibility.
- Cache key must include the flag so with/without diversification don't collide.

### 3) Core implementation

- **New file:** `lib/portfolio/portfolio-diversification.ts` exporting a **pure function** `computeDiversificationMetrics(positionsWithMetadata, windowDays)` that returns a clean typed object. No side effects, no direct DAL calls — receive pre-fetched data.
- Reuse fetch/pivot/alignment logic from `lib/risk/factor-correlation-service.ts` for ETF return history. Don't duplicate the correlation matrix construction.
- **Leave `computePortfolioER` untouched.** Risk-snapshot calls `computeDiversificationMetrics` only when `include_diversification === true`, reusing the same metrics fetch.
- Add `diversification` under `portfolio_risk_index` in the response. Make `diversification` optional in the Zod schema.
- Performance: dedupe unique sector/subsector ETFs (typically 5–15 per portfolio); single `fetchBatchHistory` call for all unique ETFs.

### 4) Schemas and OpenAPI

- Update `mcp/data/schemas/portfolio-risk-snapshot-v1.json` and regenerate `OPENAPI_SPEC.yaml` / `mcp/data/openapi.json`.
- **Do NOT bundle the `per_ticker` array-vs-object schema fix.** Ship that as a separate change to avoid breaking existing consumers.
- Update `CHANGELOG.md` and `docs/portfolio-risk-snapshot-runbook.md` with before/after JSON example.

### 5) SDK

- Extend `sdk/riskmodels/client.py` request/response handling for optional diversification fields.
- Add `diversification_summary(body) -> dict` helper in `sdk/riskmodels/parsing.py`.

### 6) Deferred to follow-up

- Chat tools passthrough (`lib/chat/tools.ts`) — wire up after JSON contract is stable.
- PDF one-liner (`lib/portfolio/risk-snapshot-pdf.ts`) — defer, layout risk.
- `POST /portfolio/diversification-impact` convenience endpoint — same math as risk-snapshot with flag, don't create a second billing capability.
- Top correlation pairs (`u_i u_j rho_ij` contributions) — phase 2.

## Implementation order

1. `portfolio-diversification.ts` + unit tests (synthetic R and u, 2–3 ETFs)
2. Route + zod schema + cache key
3. OpenAPI + JSON schema
4. SDK
5. Docs / changelog

## Testing

- Synthetic `u` and `R` → verify `adjusted = u'Ru` matches hand computation.
- Residual concentration: `sum w_i^2 * res_er_i` with known weights.
- Single-ETF degenerate case: `adjusted = u_1^2`.
- `layers[]` invariant: `naive_er == adjusted_er + adjustment_er` per layer (by construction).
- Route test: flag off = no `diversification` key; flag on = key present + cache key differs.
- Verify with real data post-L2/L3 fix: sector credit should be positive for a multi-sector portfolio.

## Risks / constraints

- **Blocked until L2/L3 fix ships.** All sector/subsector ER values were zero due to missing `bw_sector_code` in `ds_daily.zarr`. Fix: `scripts/maintenance/update_eodhd_sector_codes.py` + `--re-estimate-1c` betas rebuild. Verify API returns real values before starting.
- **Extra DAL load** when diversification is on (batch ETF history). Mitigate with unique ETF dedup and shared window.
- **Methodology label:** clearly document as portfolio-level approximation, not strict variance decomposition identity. Quant users will check.

## Key files

| File | Role |
|------|------|
| `lib/portfolio/portfolio-risk-core.ts` | Existing naive ER (untouched) |
| `lib/portfolio/portfolio-diversification.ts` | New: quadratic adjustment |
| `app/api/portfolio/risk-snapshot/route.ts` | Route + cache key |
| `lib/api/schemas.ts` | Zod schema |
| `lib/dal/risk-engine-v3.ts` | `sector_etf`/`subsector_etf` from symbols |
| `lib/risk/factor-correlation-service.ts` | Reuse fetch/pivot patterns |
| `mcp/data/schemas/portfolio-risk-snapshot-v1.json` | JSON schema |
| `OPENAPI_SPEC.yaml` | API spec |
| `sdk/riskmodels/client.py` | SDK |
