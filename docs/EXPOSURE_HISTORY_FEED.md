# Exposure history: model data feed

Status: built 2026-10-08; live once the panel is published to GCS. Owner: Conrad.

## Decision

History for long/short books is delivered as a **model data feed**, not as a
hosted per-book calculation. The API sends each requested name's month-end
model history plus the ETF covariance at each month-end; the client's SDK
joins that with the client's own dated holdings **locally**.

This is how quant shops usually consume commercial risk models (vendor model
files joined with holdings in-house), as opposed to hosted analytics where the
client uploads a holdings history to the vendor.

Why:

- **Holdings never leave the client.** The request is a list of tickers only —
  no values, no direction, no dates held. This keeps the local-first data
  policy stated on riskmodels.net.
- **Dated holdings come for free.** The client already has its book at each
  date in its own records; the SDK reads them there. Passing one fixed book is
  also supported, with the look-back bias stated in the output.
- **The server computes once per name, not once per book per date.**

The single-date endpoint `POST /api/portfolio/exposure` (latest or `as_of`)
stays the hosted path for agents and the hosted MCP, which cannot join
locally.

## Licensing

Everything in the feed is **derived data**: betas, hedge ratios, explained-risk
and residual shares, `stock_var`, L* level and ETF covariance matrices. EODHD
Exhibit B(c) and B(d) authorise redistributing derived data through our API;
it is the product (BWMACRO `docs/ceo/MASTER_BACKLOG.md` section V).

The feed carries **no raw fields** (B(e)): no closing prices, no market cap, no
bulk raw daily return series. That is why it ships the ETF covariance at each
month-end rather than ETF return histories for the client to compute from.
Responses go through `lib/data-license.ts` like every other route.

Our own API terms (no reselling our content as a standalone feed) are a
commercial restriction on customers, not a licence limit on us.

## Pricing

| Names requested | Full month-end history since 2006 | Full daily history since 2006 |
|---|---|---|
| up to 25 | $1.25 | $2.50 |
| over 25 | $5.00 | $10.00 |

Counted on names actually delivered. Single-date calls on
`/api/portfolio/exposure` are $0.25 (up to 25 names) and $1.00 (over 25).

## Data

### Producer: month-end panel

`scripts/build_exposure_month_end_panel.py` reads the ERM3 hedge-weights and
ETF Zarr stores and writes
`gs://rm_api_data/eodhd/ds_exposure_month_end_<factor set>.zarr`:

| Variable | Dims | Source |
|---|---|---|
| `l1_mkt_hr`, `l2_mkt_hr`, `l2_sec_hr`, `l3_mkt_hr`, `l3_sec_hr`, `l3_sub_hr` | (teo, symbol) | hedge store HR vars |
| `l1_res_er`, `l2_res_er`, `l3_res_er`, `l3_mkt_er`, `l3_sec_er`, `l3_sub_er` | (teo, symbol) | hedge store ER vars |
| `stock_var` | (teo, symbol) | hedge store `_stock_var` |
| `lstar_level` | (teo, symbol) | hedge store, 0 → NaN |
| `etf_cov` | (teo, etf, etf_j) | sample covariance (N−1) of daily ETF returns, 252 trading days ending on the month-end; an ETF with any missing day in the window is NaN for that month |

- `teo` is the last trading day of each calendar month present in the hedge
  store, from 2006. Values are taken **at** that day (no forward fill). The
  current month uses its latest model day until the month closes.
- `l1_mkt_beta` is not stored: it equals `−l1_mkt_hr` exactly (L1 has one
  factor, SPY; verified 311/311 against `ds_erm3_betas`).
- Chunks are `{teo: all, symbol: 1024}` and `{teo: all, etf: all, etf_j: all}`,
  so the endpoint reads a few small chunks instead of full daily histories
  (the hedge store is chunked `[all days, 64 symbols]`).
- Rebuilt after each month-end, once the ERM3 run for that day has synced.

### Endpoint

`POST /api/portfolio/exposure/history`

```json
{ "tickers": ["NVDA", "AMD", "SPY"], "start": "2006-01-31", "end": null }
```

- Up to 1000 tickers. ETFs are allowed; they get no per-name rows but stay in
  the covariance universe.
- Returns metadata plus signed URLs (1 hour) to two Parquet files:
  - `names.parquet` — long format: `month, ticker, symbol, sector_etf,
    subsector_etf, <metrics>`;
  - `etf_cov.parquet` — long format: `month, etf_i, etf_j, cov`.
- Names with no model rows in the range are listed as dropped and do not count
  toward the price tier.
- ETF-to-sector mapping is today's registry, not point-in-time (stated in the
  response).

### Storage and cleanup

Files live in the private Supabase Storage bucket `exposure-history` (BWMACRO
migration `20261008220000_exposure_history_bucket`), one folder per distinct
request:

```
<cache key>/names.parquet
<cache key>/cov.parquet
<cache key>/hit.<build tag>      # tiny marker, rewritten on every request
```

The cache key is a hash of the resolved names, ETFs, range and the panel's
`built_utc`, so a rebuilt panel never reuses older files. The build tag is the
first 12 hex characters of `sha256(built_utc)`; it puts the build in the
listing so cleanup can read it without downloading anything.

On every request the route rewrites the marker **before** signing URLs. A
folder's last activity is the latest created/updated time of any object in
it, so it moves forward on each cache hit. If the marker write fails, the
route uploads the files again instead of serving the hit, which also moves
the last activity forward.

`GET /api/cron/exposure-history-cleanup` (Vercel Cron, daily 07:30 UTC,
`Authorization: Bearer $CRON_SECRET`, same pattern as the other
`app/api/cron/*` routes; `?dry_run=1` reports without deleting) applies, per
top-level folder whose name is a 32-hex cache key:

| Rule | Condition |
|---|---|
| Guard (always) | Keep if last activity is within the URL TTL (1 h) plus a 2 h margin. |
| Age | Delete if last activity is older than `EXPOSURE_HISTORY_MAX_AGE_DAYS` (default 7, minimum 1). |
| Panel build | Delete if the folder's marker names a build other than the current panel's `built_utc`. Folders without a marker (written before markers existed) fall under the age rule only. If the current build cannot be read, only the age rule runs. |
| Missing timestamps | Keep. |

Each folder is re-listed immediately before deletion and judged again, so a
request arriving during the run keeps its folder. The code
(`lib/supabase/exposure-history-cleanup.ts`) is bound to the
`exposure-history` bucket only and ignores root-level files and any folder
whose name is not a cache key.

### SDK

```python
pack = client.exposure_history(tickers)            # downloads both files
series = pack.exposure(holdings_by_date)           # local, same blocks as /portfolio/exposure
series = pack.exposure(fixed_book)                 # one book at every month-end; warns on look-back bias
```

`holdings_by_date` maps a month-end (or any date; the SDK uses the latest
month-end on or before it) to `{ticker: signed dollar value}`. The math is a
port of `lib/portfolio/signed-exposure.ts` (L* default, `l1`/`l2`/`l3`
override, no L* fallback, diagonal residual approximation, √252
annualisation) and is tested against the TypeScript implementation on the
same inputs.

## Daily history

`POST /api/portfolio/exposure/history/daily` delivers the same columns for every
trading day. It reads the ERM3 hedge-weights and returns stores directly — no
extra stored data — because those stores are chunked `[all days, 64 symbols]`:
fetching full history for a set of names is the access they are built for, and
the cost grows with names, not dates. Each needed symbol chunk is read once per
variable, 16 at a time, into typed arrays (`readDailyExposureHistory`).

| Full daily history since 2006 | Read | Parquet write | Output |
|---|---|---|---|
| 25 names | 7 s | 1 s | 2.4 MB |
| 1000 names | 18 s | 51 s | 95.5 MB in yearly files |

Names arrive as one Parquet file per calendar year. The ETF covariance stays
month-end (from the panel): a 252-day covariance barely moves day to day, and
each day uses the latest month-end on or before it. Price: $2.50 up to 25 names
delivered, $10.00 above (2x the month-end feed).

## Not in scope

- Size/value (L4) — backlog C.16.
- Weekly history.
- Point-in-time sector mapping.
