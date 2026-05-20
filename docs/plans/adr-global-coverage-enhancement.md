# ADR / Global Coverage Enhancement — Profile

**Status:** Proposal, not scheduled. Saved for later pickup.
**Owner:** Conrad
**Target surfaces:** RiskModels API (`/api/data/symbols/*`, possibly new `/api/data/adrs`), riskmodels.app marketing/docs pages, Medium Part 1/2/3 appendix material.

## Why this matters

The current RiskModels narrative leans on US equities. But the US tape already contains ~2,100+ foreign-domiciled issuers (ADRs, Cayman/BVI shells for Chinese issuers, Canadian cross-listings, European majors, Israeli tech, LatAm). Surfacing that coverage — with the same L1/L2/L3 cascade we run on domestic names — lets us credibly claim meaningful *global* coverage without leaving the US listing universe. It also opens a targeted content angle: "what does your US-listed book actually look like through a global lens, and what fraction of MSCI ACWI ex-US market cap is reachable via ADRs?"

## Current state

### Data pipeline
- `eodhd_daily.py:870` calls `_classify_adr(gen)` each run — multi-signal detection. Emits `is_adr` + `country` into the fundamentals DataFrame, logs an ADR rate per run.
- Output flows: fundamentals DF → zarr coord `is_adr` (`eodhd_daily.py:2541`) → Supabase `symbols.is_adr` (per sync scripts).
- `security_master.db` (SQLite, `data/providers/eodhd/raw/eodhd_extractions.db`) schema has the fields (`is_adr`, `asset_type`, `country`, `exchange`, `currency`) but **local rows are not populated** as of 2026-04-17 snapshot (all 21,875 active rows: `asset_type='EQUITY'`, `country=NULL`, `is_adr=FALSE`). This is a local-master drift, separate from what Supabase has.

### API
Already selects and returns `is_adr, isin, asset_type` in:
- `app/api/data/symbols/[ticker]/route.ts:33,53,57`
- `app/api/data/symbols/search/route.ts:31`
- `app/api/data/symbols/batch/route.ts:49,70`
- `lib/dal/risk-engine-v3.ts:97-205` (typed `SymbolRow`)

What's missing:
- No `?is_adr=true` filter on `/symbols/search`
- No `country` field in select/return (even if Supabase has it in `metadata` jsonb)
- No dedicated ADR list/rollup endpoint
- Not documented in `OPENAPI_SPEC.yaml` beyond `asset_type` in `MetricsV3.meta`

### Only partially-populated today
The one ADR proxy that *is* populated across the universe is `isin` (10,277/21,875 = 47% coverage). Of those, 2,163 have non-US ISIN prefixes:

| ISO | Count | Interpretation |
|---|---|---|
| KY | 1,136 | Cayman — overwhelmingly Chinese ADRs (BABA, PDD, JD, LI, NIO, XPEV) |
| CA | 338 | Canadian cross-listings |
| VG | 152 | BVI — Chinese / offshore |
| IL | 115 | Israeli tech (MBLY, NICE, CYBR) |
| BM | 88 | Bermuda offshore |
| MH | 57 | Marshall Islands (shipping) |
| IE | 50 | Ireland (ACN, MDLZ, CRH, AER) |
| NL | 46 | Netherlands (ASML parent structure) |
| GB | 42 | UK (BP, Shell, HSBC ADRs) |
| LU / CH / SG / AU / JP / etc. | ≤30 each | long tail |

ISIN prefix is the **fallback** signal; the real `is_adr` classification in Supabase should supersede it once we verify population.

## Diagnostic to run first (before any build work)

Before scheduling this enhancement, confirm what's *actually* in Supabase prod. Run against Supabase `symbols`:

```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN is_adr = TRUE THEN 1 ELSE 0 END) AS adr_count,
  SUM(CASE WHEN metadata->>'country' IS NOT NULL THEN 1 ELSE 0 END) AS with_country,
  COUNT(DISTINCT metadata->>'country') AS distinct_countries
FROM symbols;

-- Top 20 ADRs by market cap
SELECT ticker, name, metadata->>'country' AS country, latest_metrics->>'market_cap' AS mcap
FROM symbols
WHERE is_adr = TRUE
ORDER BY (latest_metrics->>'market_cap')::numeric DESC NULLS LAST
LIMIT 20;
```

Two possible outcomes:
- **`is_adr` populated + `country` present** → content/API build is mostly plumbing (surface, filter, document). Proceed to Tier 1.
- **`is_adr` null / country absent** → fix the sync or re-run `eodhd_daily` → backfill symbols. Treat as prereq.

## Proposed changes — tiered

### Tier 1: Surface what's already classified (≤1 day)

**API**
- Add `?is_adr=true|false` filter to `app/api/data/symbols/search/route.ts`.
- Include `country` in the select (from `symbols.metadata->>'country'` or a top-level column if sync writes it).
- Add `is_adr`, `country` to `OPENAPI_SPEC.yaml` under `SymbolRecord` / `MetricsV3.meta`.
- Update `mcp/data/openapi.json` (cross-repo sync — see `docs/AGENTS_CROSS_REPO.md`).
- Update `SEMANTIC_ALIASES.md` with one-line definitions.

**Website / content** (riskmodels.app)
- "Coverage" page or section showing: **X,XXX US-listed foreign issuers across YY countries**, covering top non-US names by market cap. Visual: stacked bar of ADR market cap by region (Asia / Europe / LatAm / Other) vs total ACWI ex-US market cap (external MSCI or BNY Mellon DR reference).
- Landing page tape/treemap: toggle to show ADRs highlighted.

### Tier 2: Dedicated ADR endpoint (1–2 days)

```
GET /api/data/adrs
  ?country=CN|IL|NL|GB|...   (optional ISO filter)
  &sector_etf=XLK|XLE|...    (optional)
  &order_by=market_cap|latest_vol|l3_res_er
  &limit=50

Response:
{
  results: [{
    ticker, name, isin, country, sector_etf, subsector_etf,
    market_cap, latest_vol,
    l3_mkt_hr, l3_sec_hr, l3_sub_hr, l3_res_er
  }]
}
```

Implementation: wrapper around `symbols` + `security_history_latest` join, filtered by `is_adr = TRUE`. No new pipeline.

### Tier 3: Richer ADR metadata (pipeline enrichment)

Requires pulling additional EODHD fundamentals fields (already on the account). New columns on `symbols` / `security_master`:

| Field | Source | Value |
|---|---|---|
| `home_country` | EODHD General → CountryName | Underlying operations country (vs legal domicile) |
| `home_exchange` | EODHD → PrimaryExchange | e.g. TWSE for TSM, KOSPI for SK, EURONEXT for ASML |
| `home_ticker` | EODHD → HomeTicker | e.g. TSM → 2330 |
| `adr_ratio` | EODHD Fundamentals | 1 ADR = N ordinary shares (essential for cross-listing arb) |
| `adr_level` | EODHD / BNY Mellon DR | I, II, III, 144A, Reg S |
| `sponsor_bank` | BNY Mellon DR directory | BNY Mellon / JPM / Citi / Deutsche (licensing check) |

Then `GET /api/data/adrs/{ticker}` returns the full ADR fact sheet.

## Content/marketing implications

If Tier 1 data confirms coverage, the content opportunity is:

1. **A dedicated "Global Coverage" page** on riskmodels.app — table of regions, ADR count, aggregate market cap, link to filtered API query. Positions the product against "US-only" perception.
2. **A Medium follow-up (Part 4?)**: "Your US book is already global: what the ADR cascade actually looks like." Apply the same L1→L3 decomposition to TSM (Taiwan semi), BABA (China internet), NVO (Danish pharma), SHEL (UK energy), MELI (LatAm e-commerce) — show that the cascade works identically and the residual column is particularly informative for ADRs (home-market idiosyncratic risk surfaces there).
3. **Competitive framing vs Barra/Axioma**: their global models are different products with different licensing; ours is one API, one cascade, covering both domestic and ADR exposures in the same JSON.

## Open questions

- Does Supabase `symbols.is_adr` already populate, or is only the zarr side populated? (Diagnostic above resolves this.)
- Do we need to distinguish **sponsored ADRs** (Level II/III on NYSE/NASDAQ) from **unsponsored / OTC pink ADRs** for the Medium angle? Sponsored-only is the cleaner investable universe.
- Does BNY Mellon DR directory licensing allow redistribution of sponsor_bank / adr_level in a public API? If not, we leave Tier 3 fields to internal/paid tiers only.
- Do we want a **home-market performance comparison** (ADR vs underlying ordinary return, adjusted for FX)? Not in scope here but a natural follow-on.

## Related files / reference paths

- Classification logic: `/Users/conradgann/BW_Code/ERM3/erm3/core/eodhd_daily.py:855-913`
- Schema: `/Users/conradgann/BW_Code/ERM3/erm3/core/security_master_schema.sql`
- API symbol endpoints: `/Users/conradgann/BW_Code/RiskModels_API/app/api/data/symbols/`
- SymbolRow typing: `/Users/conradgann/BW_Code/RiskModels_API/lib/dal/risk-engine-v3.ts:90-230`
- OpenAPI spec: `/Users/conradgann/BW_Code/RiskModels_API/OPENAPI_SPEC.yaml`
- Supabase table reference: `/Users/conradgann/BW_Code/RiskModels_API/SUPABASE_TABLES.md` (symbols row)
- Cross-repo sync checklist: `/Users/conradgann/BW_Code/RiskModels_API/docs/AGENTS_CROSS_REPO.md`

## Recommended order of operations (when scheduled)

1. Run Supabase diagnostic above (~5 min).
2. If `is_adr` / `country` populated → Tier 1 (filter + select + spec + one content page) in one session.
3. Tier 2 endpoint in a follow-on session with a small UI card on riskmodels.app.
4. Tier 3 pipeline enrichment only if Tier 1+2 traction justifies it.
