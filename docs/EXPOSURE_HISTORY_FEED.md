# Exposure history: model data feed

Status: built 2026-10-08; live once the panel is published to GCS.

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
it is the product.

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

Both `POST /api/portfolio/exposure/history` and `.../history/daily` store their
files in the private Supabase Storage bucket `exposure-history` (BWMACRO
migration `20261008220000_exposure_history_bucket`), one folder per distinct
request, through the same helpers (`serveExposureHistorySet`,
`writeExposureHistorySet` in `lib/supabase/storage.ts`):

```
<cache key>/<file>.<gen>.parquet          # one set per upload; never overwritten
<cache key>/hits/<build tag>.<window>     # tiny marker per 10-minute window with requests
<cache key>/condemned                     # written by cleanup, see below
```

`<file>` is `names` and `cov` (month-end) or `names_<year>` and `cov` (daily).
`<gen>` is a random 16-hex id per upload; `cov` is written last and marks the
set complete. The cache key is a hash of the request and the panel's
`built_utc`, so a rebuilt panel never reuses older files. The build tag is the
first 12 hex characters of `sha256(built_utc)`; it puts the build in the
listing so cleanup can read it without downloading anything. Folders written
before 2026-10-09 hold `<file>.parquet` (no gen) and `hit.<build tag>`; the
routes and cleanup read that layout. A folder's **last activity** is the
latest created/updated time of any object in it (including `hits/`) other
than `condemned`.

**Routes.** A route lists the folder (all pages; an unfinished listing counts
as a failure). It serves a cache hit only from the newest complete set whose
files were all written after any `condemned` marker, and only after upserting
the hit marker for the current 10-minute window (the first request in a
window creates it, so its timestamp is at most 10 minutes old even if upserts
do not refresh `updated_at`). Otherwise (no such set, listing or marker
failure) it writes a new generation; on a condemned folder the next request
then hits that new set. If any upload fails, the files of that generation are
removed and no URL is returned. Uploads never reuse a path, so a cleanup
delete, which removes only the paths it listed, cannot remove a file uploaded
after that listing.

**Cleanup.** `GET /api/cron/exposure-history-cleanup` (Vercel Cron, daily
07:30 UTC, `Authorization: Bearer $CRON_SECRET`, same pattern as the other
`app/api/cron/*` routes; `?dry_run=1` reports without writing). It considers
only top-level folders whose name is a 32-hex key, and works in two phases,
one per run. Guard = URL TTL (1 h) + 2 h margin.

| Phase | Condition | Action |
|---|---|---|
| Condemn | No marker; last activity older than the guard; and either older than `EXPOSURE_HISTORY_MAX_AGE_DAYS` (default 7, minimum 1), or the folder has hit markers and none names the current panel build | Write `condemned` |
| Delete | `condemned` at least 12 h old and no activity since it | Remove the objects listed in this run, `condemned` last |
| Reprieve | `condemned` present and activity since it | Remove `condemned` |
| Keep | Anything else, including any object without timestamps | Prune hit markers older than the guard (except the newest per build tag), superseded generations (a newer complete set has existed for longer than the guard) and incomplete generations older than the guard |

Folders without hit markers fall under the age rule only; if the current
build cannot be read, only the age rule runs. Deletion happens one run after
condemnation, so files are removed about N+1 days after their last request.
A folder that keeps getting requests stays until the panel is rebuilt.

**Why a valid URL is never deleted.** URLs live 1 h
(`EXPOSURE_HISTORY_URL_TTL_SECONDS`; signing with a longer TTL throws). Every
delete path waits longer than that after the last moment a URL could have been
issued for the files it removes:

| Delete path | Bound |
|---|---|
| Folder delete | Runs at least 12 h after `condemned` was written. Routes serve only sets newer than the marker; `condemned` is removed after the data files, so a request during a delete still sees it. A set signed before the marker existed is deleted at least 12 h later. |
| Superseded generation | A newer complete set has existed for longer than the guard (3 h); every request since then served the newer set (requests run at most 300 s). |
| Incomplete generation | Never returned: a set's URLs are returned only after `cov` is uploaded. |
| Hit markers | Not data; the newest per build tag is kept, so last activity does not move. |

`lib/supabase/exposure-history-cleanup.ts` refuses to load if
`DELETE_AFTER_MS` or the margin is reduced below these bounds. The hit marker
serves retention (it keeps requested folders from being condemned), not URL
safety: if writing it fails, the hit is still served. Cleanup assumes no writer
overwrites a path; writers from before this change did (`upsert`), so they
must not run alongside it (Vercel replaces all instances on deploy; the cron
runs at 07:30 UTC).

The month-end route requires `names` and `cov` in a served set; the daily
route requires `cov` and `names_<year>` for every year with rows, so a set
written before a new year had rows is not reused.

The run stops after 240 s (checked before every listing page) and starts at a random
folder, so a run cut short covers different folders next time; it then returns
HTTP 200 with `complete: false`. Any folder error returns HTTP 500. The code (`lib/supabase/exposure-history-cleanup.ts`) is
bound to the `exposure-history` bucket and ignores root-level files.

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

- Size/value (L4).
- Weekly history.
- Point-in-time sector mapping.
