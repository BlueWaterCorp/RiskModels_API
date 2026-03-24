# RiskModels_API — smoke test & fix-it list

**Generated:** 2026-03-23 (updated: L1/L2/L3 checks on latest + batch)

This report is produced by hitting every HTTP route used by `riskmodels_com/src/lib/api-gateway-client.ts` against **`RISKMODELS_API_URL`** with **`RISKMODELS_API_SERVICE_KEY`**, plus a billed **`POST /api/cli/query`** smoke test on **`NEXT_PUBLIC_APP_URL`** with **`RISKMODELS_API_KEY`**.

**Do not commit secrets.** This file contains no keys.

---

## Re-run locally

```bash
cd riskmodels_com
node scripts/smoke-test-riskmodels-api.mjs
```

Requires in `.env.local`:

- `RISKMODELS_API_URL` (default `https://riskmodels.app`)
- `RISKMODELS_API_SERVICE_KEY`
- Optional: `RISKMODELS_API_KEY` or `RM_API_KEY` for `riskmodels.net` CLI query test
- Optional: `NEXT_PUBLIC_APP_URL` (default `https://riskmodels.net`)

---

## Endpoint matrix (gateway — schema = `api-gateway-client` contract)

| # | Name | Method | Path | HTTP | Notes |
|---|------|--------|------|------|--------|
| 1 | `symbols_NVDA` | GET | `/api/data/symbols/NVDA` | **200** | Resolved symbol `BW-US67066G1040` |
| 2 | `metadata` | GET | `/api/data/metadata` | **200** | |
| 3 | `trading_calendar_daily` | GET | `/api/data/trading-calendar?periodicity=daily` | **200** | |
| 4 | `symbols_search` | GET | `/api/data/symbols/search?q=NVIDIA&limit=2` | **200** | |
| 5 | `symbols_batch` | POST | `/api/data/symbols/batch` | **200** | Body: `{ "tickers": ["AAPL","MSFT"] }` |
| 6 | `security_master_resolve` | POST | `/api/data/security-master/resolve` | **200** | ISIN `US0378331005` |
| 7 | `security_history_page` | GET | `/api/data/security-history/{symbol}?keys=` includes L1/L2/L3 `*_hr`/`*_er` | **200** | Sample page of EAV rows |
| 8 | `security_history_latest` | GET | `/api/data/security-history/latest/{symbol}?periodicity=daily` | **200** | Wide row; see L1/L2 gap below |
| 9 | `security_history_batch_latest` | POST | `/api/data/security-history/batch` | **200** | `{ symbols, periodicity, latest: true }` |
| 10 | `security_history_batch_series` | POST | `/api/data/security-history/batch` | **200** | `{ symbols, keys, start, end }` |
| 11 | `landing_cache` | GET | `/api/data/landing-cache?limit=20` | **200** | |
| 12 | `symbols_GOOGL_alias` | GET | `/api/data/symbols/GOOGL` | **404** | See fix-it §1 |
| — | `validate_latest_l123_hr_er_present` | CHECK | `.../latest/{symbol}` | **fail** | **L3** `*_hr`/`*_er`/`*_res_er` present; **L1 & L2** all **null** on NVDA (`teo` 2026-03-20) |
| — | `validate_batch_series_l123_hr_er_rows` | CHECK | batch EAV `2026-03-18`–`2026-03-20` | **pass** | All keys below had ≥1 non-null `metric_value` in window |

**Keys asserted (V3 contract):**

- **L1:** `l1_mkt_hr`, `l1_mkt_er`, `l1_res_er`
- **L2:** `l2_mkt_hr`, `l2_sec_hr`, `l2_mkt_er`, `l2_sec_er`, `l2_res_er`
- **L3:** `l3_mkt_hr`, `l3_sec_hr`, `l3_sub_hr`, `l3_mkt_er`, `l3_sec_er`, `l3_sub_er`, `l3_res_er`

**Interpretation:** **Time-series / EAV** path is healthy for **L1–L3**. The **wide latest** surface (`security_history_latest` / `GET .../latest/...`) is **missing L1/L2 columns** in production for the sample symbol even though the same metrics exist in `security_history` for recent dates.

### Billed app (not hosted on `riskmodels.app`)

| Name | Method | URL | HTTP |
|------|--------|-----|------|
| `net_cli_query_smoke` | POST | `{APP_URL}/api/cli/query` | **200** | SQL: `SELECT 1 AS one` |

---

## Fix-it list — apply in **RiskModels_API** repo

### 1. **`GET /api/data/symbols/GOOGL` returns 404** (blocking for GOOGL clients)

- **Observed:** `{"error":"Ticker not found"}` for ticker `GOOGL`.
- **Expected (align with `Risk_Models`):** Same behavior as Next.js / DAL: resolve **`GOOGL` → `GOOG`** (or store both tickers in `symbols`).
- **Suggested work:**
  - [x] In symbol resolution used by `GET /api/data/symbols/{ticker}` (and batch/search if needed), add alias map **`GOOGL` → `GOOG`** (mirror `riskmodels_com/src/lib/dal/risk-engine-v3.ts` `TICKER_ALIASES`).
  - [x] Add regression test: `GET .../symbols/GOOGL` → **200** with same `symbol` as `GOOG`.
  - [ ] Update `OPENAPI_SPEC.yaml` / examples if you document ticker resolution rules.
  
  **Fixed in:**
  - `lib/ticker-aliases.ts` — shared alias map (`GOOGL` → `GOOG`)
  - `app/api/data/symbols/[ticker]/route.ts` — applies alias before lookup
  - `app/api/data/symbols/batch/route.ts` — applies aliases to input tickers
  - `app/api/data/symbols/search/route.ts` — searches canonical ticker when alias queried

### 2. **`GET /api/data/security-history/latest/{symbol}` — L1/L2 null while L3 populated** (data / pipeline)

- **Observed (NVDA, `BW-US67066G1040`, `teo` 2026-03-20):** Response JSON has **non-null L3** hedge/explained-risk fields, but **`l1_*` and `l2_*` are all null**.
- **Same period via EAV:** `POST /api/data/security-history/batch` with `keys` = all L1/L2/L3 metrics above and `start`/`end` covering recent days returns **non-null** values for **every** key — so metrics exist in `security_history`, not in the **latest wide** projection.
- **Suggested work (RiskModels_API + Supabase pipeline):**
  - [ ] Verify `upsert_security_history_latest` (or equivalent) **selects and writes** `l1_mkt_hr`, `l1_mkt_er`, `l1_res_er`, `l2_mkt_hr`, `l2_sec_hr`, `l2_mkt_er`, `l2_sec_er`, `l2_res_er` from the pivoted daily row (see `docs/supabase/PYTHON_V3_WRITE_SPEC.md` §4b).
  - [ ] Backfill or re-run latest summary for symbols missing L1/L2 on max `teo`.
  - [x] Add API fallback: query EAV and merge when wide table has null L1/L2.
  
  **API-side fixed in:**
  - `app/api/data/security-history/latest/[symbol]/route.ts` — EAV backfill for missing L1/L2/L3
  - `app/api/data/security-history/batch/route.ts` — EAV backfill for batch latest mode
  
  **Note:** Pipeline fix still needed in `Risk_Models` to populate `security_history_latest` correctly.

### 3. **Optional — CI parity**

- [ ] Port `riskmodels_com/scripts/smoke-test-riskmodels-api.mjs` into RiskModels_API (or call it from CI) so deploys fail if any gateway route regresses or **latest** L1/L2 regression reappears.

---

## Not covered here

- **Supabase PostgREST “schema” tables** listed by `riskmodels schema` (CLI) are **not** the same as these gateway URLs; they are direct DB access.
- **Next.js-only routes** (`/api/ticker-returns`, `/api/metrics/...`, etc.) live in `Risk_Models`, not on `riskmodels.app`.
- **Rate limits, auth edge cases, and large pagination** — only happy-path smoke.

---

## Reference

- Gateway client source of truth: `riskmodels_com/src/lib/api-gateway-client.ts`
- Smoke script: `riskmodels_com/scripts/smoke-test-riskmodels-api.mjs`
- Landing cache pipeline doc: `docs/ERM3_LANDING_CACHE_SYNC.md`
