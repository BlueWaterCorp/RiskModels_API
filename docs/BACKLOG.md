# RiskModels_API Backlog — OPEN items only

**Id prefix:** `RMAPI` · **Next id:** `RMAPI-29`

**If it is in this file, it is open.** Closed work moves to `LEDGER.md` in the PR that closes it — the PR body says
`Backlog: closes RMAPI-n` (or `Backlog: none`), and the same diff cuts the item and appends
`date · RMAPI-n · outcome · ref` to the ledger. Never mark an item done in place. Ids are monotonic and never
reused; take the next id from the header and bump it. An item moved to another repo gets a ledger line
`MOVED → <new id>` here, and the new item says `from RMAPI-n`. Two heading annotations are allowed:
`BLOCKED (on X)` and `DEFERRED (until Y)`.

Every item leads with **Impact** — what is wrong, or could silently go wrong, if this is never done — and **Needs**:
`engineering`, `DECISION` (a human must choose first; keep at most five open), or the owning repo. Classes:
`MATERIAL` (a published number is wrong or unattributable today, or a silent failure is live), `IMPROVEMENT`,
`HYGIENE`, `NOT-OURS`, `BLOCKED`. Oldest first, new items at the bottom, at most 40 lines each. Monthly: any
non-MATERIAL item older than eight weeks is cut to the ledger as `PARKED` (reopening means a new id).

`BWMACRO/docs/ceo/MASTER_BACKLOG.md` is generated from these files (`BWMACRO/scripts/backlog_rollup.py`); do not
edit it. `BWMACRO/scripts/backlog_lint.py` checks this file, the ledger, and a PR's `Backlog:` claim. Rows moved
here from the old hand-maintained master on 2026-10-13 keep their full text in `BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`.

Process: `BWMACRO/docs/architecture/BACKLOG_LEDGER_CHECKLIST_PROCESS.md`.

## RMAPI-1 · `net_expense_ratio` is populated on the fund *search* payload but null on the fund *snapshot*

**Impact:** IMPROVEMENT · `net_expense_ratio` is populated on the fund *search* payload but null on the fund *snapshot* (found 2026-08-03 during G.94). `VLISX = 0.04` comes back from search; the snapshot the roster analyzes carries no expense ratio, so `RosterRowData.netExpenseRatio` is null on every row today and G.94's fee-corroboration branch in the INDEX badge hover is dormant — it degrades honestly ("No expense ratio in this snapshot to … **Needs:** engineering.
From the archived master, row D.12 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: D.12: Open — booked 2026-08-03.

## RMAPI-2 · Long-short sheet, phase 1 (internal)

**Impact:** IMPROVEMENT · Long-short sheet, phase 1 (internal). Two pages from reported NAV and N-PORT signed positions over NET_ASSETS: statistics (CAGR, vol, Sharpe, Sortino, max DD, Calmar, best/worst, % positive, beta, 36m beta, correlation, CAPM alpha, up/down capture), monthly grid, rolling 12m, drawdown; long/short/gross/net history, top longs and shorts, sector long/short/net, holdings-implied vs realised beta, ERM3 L3 hedge legs. … **Needs:** engineering.
From the archived master, row F.27 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: F.27: Moved 2026-10-10 to the RiskModels_API session building the long-short endpoint. Draft code (data and stats modules with each statistic …. Note: owned by the RiskModels_API long-short session.

## RMAPI-3 · Anthropic Connectors directory submission

**Impact:** BLOCKED · Anthropic Connectors directory submission. OAuth connector live (E.20). Prep done 2026-09-02: tool title/`readOnlyHint` audit clean; listing copy + portal fields in `RiskModels_API/docs/gtm/anthropic-directory-submissions.md`; `.app/privacy` → `.net/privacy` redirect in `next.config.mjs` (deploy with API). CEO: submit remote MCP `https://riskmodels.app/api/mcp/sse` (OAuth DCR) via Claude.ai Directory … **Needs:** Anthropic directory review.
From the archived master, row E.24 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: E.24: Deployed 2026-09-02; plugin directory submitted. E.24 blocked: personal Claude Pro has no Organization Directory — needs Blue Water ….

## RMAPI-4 · render-svc has no filer loader, so filer artifacts cannot render at an arbitrary as-of

**Impact:** IMPROVEMENT · render-svc has no filer loader, so filer artifacts cannot render at an arbitrary as-of — the narrow real gap behind G.50 (booked 2026-08-02, correcting an over-broad earlier claim). Filer *data* and *API* already do point-in-time properly: `/api/13f/filers/{id}/holdings` and `/portfolio` implement the house convention (knowledge-mode `filing_date <= as_of`, reality-mode fallback, `as_of_basis` echoed, typed 404 when … **Needs:** engineering.
From the archived master, row G.58 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: G.58: Open — booked 2026-08-02. Reconfirmed 2026-09-06 (snapshots-deploy Phase 2): do not claim filer live-on-miss until this loader exists..

## RMAPI-5 · Pre-rendered subject kinds accept no render params, and no vocabulary said so

**Impact:** HYGIENE · Pre-rendered subject kinds accept no render params, and no vocabulary said so (found 2026-08-02 building G.60). Capability reports `top_holdings_erm_stacked` honors `top_n` and that the `filer_13f` pair is `prerendered: true`. Those two facts disagree in practice: render-svc reads a GCS object whose key includes the params, and only the default render was published. Measured on `BW-FILER-0001067983` @ 2026-03-31 … **Needs:** engineering.
From the archived master, row G.61 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: G.61: Open — booked 2026-08-02; worked around in #272.

## RMAPI-6 · `/api/decompose` serves rows for dates before a company existed

**Impact:** MATERIAL · `/api/decompose` serves rows for dates before a company existed (found 2026-08-02 during G.71). Probing historical `as_of`, OKLO — which listed in 2024 — returns data at `as_of=2010-01-04`. The endpoint answers with *something* for any date in the panel rather than refusing dates outside a symbol's actual history. This matters more now that G.42 shipped real reality-mode `as_of` and G.71 threads it through the … **Needs:** engineering.
From the archived master, row H.154 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: H.154: Open — booked 2026-08-02.

## RMAPI-7 · Interpretive IP (analyst doctrine) sits in the public repo's fallback stub

**Impact:** MATERIAL · Interpretive IP is sitting in the PUBLIC repo — the analyst doctrine leaked into the fallback stub because the private channel was never wired (CEO-raised 2026-08-02). Verified: `RiskModels_API` is PUBLIC; `Risk_Models`, `BWMACRO`, `ERM3` are private. `lib/chat/load-analyst-doctrine-append.ts` `MINIMAL_OPERATIONAL_DOCTRINE` carries ~22 lines of institutional interpretation in the open — e.g. *"Negative HRs can arise … **Needs:** DECISION.
From the archived master, row G.77 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: G.77: Open — booked 2026-08-02. Two facts for the decision, added 2026-08-03: (1) `RiskModels_API` visibility re-confirmed `PUBLIC` via the ….

## RMAPI-8 · P1 — Premium agent tier (bwmacro skills + what-if)

**Impact:** BLOCKED · P1 — Premium agent tier (bwmacro skills + what-if) **Needs:** product gate.
From the archived master, row O.11 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: O.11: Held — product gate. Before expanding portfolio what-if, drift monitoring, or higher-level bwmacro interpretation skills into chat/MCP ….

## RMAPI-9 · `_fund_identity()` falls back silently when `funds.json` missing

**Impact:** MATERIAL · `_fund_identity()` falls back silently when `funds.json` missing [`_fund_data.py:603–617`] — returns `{}` so `fund_name=bw_fund_id` (e.g. `BW-FUND-S000004988`) and `equity_style_9box=None` in renders. In Cloud Run, `FUNDS_DAG_DATA_ROOT` is not set so the fallback sibling path doesn't resolve. Same trigger as O.9 — bundle the fix (set the env + bake the JSON to a GCS-mounted root). **Needs:** engineering.
From the archived master, row P.2 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: P.2: Open — overlaps O.9 operational half.

## RMAPI-10 · `/api/tickers?include_metadata=true` is an unauthenticated whole-universe metadata dump

**Impact:** MATERIAL · `/api/tickers?include_metadata=true` — unauthenticated whole-universe dump of company name + EODHD-derived sector, no limit param, `Access-Control-Allow-Origin: *`, 5-min CDN cache. Reference metadata is B(e)-permitted to *display* but this is neither per-symbol nor authenticated. `mag7=true` variant (7 symbols) is fine. Needs a consumer check first — `lib/llms-txt.ts` documents it as public JSON **Needs:** engineering.
From the archived master, row V.9 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: V.9: Open. ~2h.

## RMAPI-11 · EODHD Exhibit B posture: signed PDF links, the free tier, and print-render price columns

**Impact:** MATERIAL · V.11: Verify whether the DD artifact renders price/market cap; V.13: Free tier weakens "authenticated": `POST /api/auth/provision-free` is unauthenticated + self-serve (anonymous user, no identity, no payment), 3 keys/IP/day × …; V.15: `/(print)/render-snapshot` renders a Price column across the holder's portfolio (up to 100 rows) in one authenticated, billed request. **Needs:** DECISION.
From the archived master, rows V.11, V.13, V.15 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: V.11: Open — conditional, verify bucket contents + renderer; V.13: Open — posture question, no code change proposed; V.15: Open — posture decision, ask counsel/EODHD directly. Cleanest framing to raise on the next call: is a holder's own portfolio table one ….

## RMAPI-12 · GET /13f/filers/search returns a stale latest_report_date / latest_aum_usd

**Impact:** MATERIAL · `GET /13f/filers/search` returns a stale `latest_report_date` / `latest_aum_usd` that contradicts the same filer's snapshot. For `BW-FILER-CIK0001061768` (Baupost Group) the search index reports `latest_report_date` 2024-06-30 and `latest_aum_usd` $3,634,101; `GET /13f/filers/{id}/snapshot` for the same id returns `report_date` 2026-06-30, `total_aum_usd` $5,234,035,000, 21 holdings and `coverage_in_erm3` 1.0. Two … **Needs:** engineering.
From the archived master, row H.207 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: H.207: Open — reproduced live 2026-08-31 via MCP `riskmodels_search_filers` vs `riskmodels_get_filer_snapshot`; evidence in the session's ….

## RMAPI-13 · RiskModels API defects found in the 13F attribution study (RiskModels_API #373)

**Impact:** MATERIAL · RiskModels API defects found by @nijataliyev03 in the 13F attribution study (RiskModels_API PR #373, closed unmerged 2026-10-03). Source: `research/portfolio_timeseries/DATA_ISSUES.md` on branch `feat/13f-attribution-toolkit` (kept as archive). Credit the finder in each fix PR. Endpoint defects: (1) `get_filer_portfolio` terminal row carries a forward return over an open-ended window, not one quarter; (2) stub rows … **Needs:** engineering.
From the archived master, row H.307 (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`; full text and evidence there). Status at archive: H.307: 2026-10-06 (researcher API enhancements 1–2): (1)(2)(3)(4)(7)(8) addressed in RiskModels_API #398 (per-row original_filing_date / ….

## RMAPI-14 · ETF coverage: say what each ETF supports and why, and stop billing empty responses (2026-10-14)

**Impact:** MATERIAL · ETF answers contradict each other today:
- `/data/etf/search` finds EFA, but `/portfolio/exposure` drops it as `symbol_not_found`.
- `/data/etf/{ticker}` returns 404 for any fund without holdings.
- `/ticker-returns?ticker=HYG` returns 0 rows, still bills $0.005 (request `req_mv8frd0k_vut3r8`), and tells the caller to retry and contact support.
A client lost 28 ETFs ($90k of gross) from a 576-position book with no explanation (review of 2026-10-13).

**Needs:** engineering, after the 2026-10-14 publish; data side is ERM3-68. Model: one ETF universe with three capabilities, any combination per fund:
- `cascade`: SPY, sectors and subsectors;
- `priced`: daily returns, covariance and beta to SPY;
- `holdings`: look-through and benchmark-fit.
Each fund also has a `factor_role`: market, sector, subsector, style, `macro:<factor>`, or none.

Work (the `/portfolio/exposure` reason codes and per-ETF `beta_to_spy` shipped 2026-10-15, see LEDGER):
- **`/data/etf/{ticker}`** returns 200 for every known fund, with `capabilities` (cascade, priced, priced_from, holdings, holdings_as_of, factor_role) and `identifiers` (bw_sym_id, bw_etf_id, figi, cik, ticker).
- **`GET /data/etf/universe`** is free: a static JSON generated at sync time from the register, the catalog and the store's symbol list, filterable by capability. `/data/etf/search` and `/tickers` search the same union and return the capability flags.
- **No billing for empty responses.** `/ticker-returns` calls `setBillableItemCount(0)` when `data` is empty, and the warning names the reason.
- **MCP and docs.**
  - Add one sentence on the three capabilities to `riskmodels_search_etfs`, `riskmodels_get_returns`, `riskmodels_get_etf` and `riskmodels_portfolio_exposure`.
  - Add a `docs/ETF_COVERAGE.md` page and an `llms.txt` entry with the lists, counts and reason codes.
  - Fix the stale "~100 ETFs" comment in `lib/dal/zarr-reader.ts`.

Review: Fable, 2026-10-14 (ETF strategy review).

## RMAPI-16 · Cohort fundamentals in the API: free hedge-basket block, priced endpoints on request (2026-10-14)

**Impact:** IMPROVEMENT · The hedge and exposure endpoints tell a user which ETF basket offsets a name but nothing about that basket's fundamentals, so "is this name's margin move company-specific or cohort-wide?" needs another vendor. Positioned as an enhancement of current offerings, not a standalone product.

**Needs:** engineering, after ERM3-69 builds the store. Plan agreed 2026-10-14 (operator, after GPT and Fable reviews). Serve the SEC-only plane only; the all-source plane never leaves ERM3 (its dollar sums over thin cohorts would nearly expose single vendor values).
1. **Free embedded block** in `/hedge-basket`, `/portfolio/exposure`, the stock snapshot (`/metrics`, MCP `riskmodels_get_stock_snapshot`) and any other endpoint where a name's cohort context fits (operator, 2026-10-15): the name's sector and subsector cohort fundamentals at the latest teo (TTM margins, growth, yields, reported share, contributor count). No surcharge: `PricingModel` has no add-on mechanism, and the block is the retention surface. In MCP it arrives as an `include` value (`cohort_fundamentals`), not a new tool.
2. **Static sample** (12 public cohorts) from the store for clients; log who asks for history or subsectors.
3. **Dedicated endpoints, only when a client asks:**
   - `GET /cohorts/fundamentals`: one-teo cross-section of the 12 public cohorts, $0.04 (same as `/cohorts`); `as_of` limited to the trailing 24 months so month-end loops cannot rebuild history cheaply.
   - `GET /cohorts/fundamentals/series`: one cohort over a range, $0.15 base with `size_tiers` (e.g. $1.00 above 3 cohorts or 60 months), mirroring exposure's tiering.
   - Subsector cohorts: no dedicated endpoints until asked (the `/cohorts` contract treats the subsector slate as proprietary; the embedded block already serves a name's own subsector).
   - Roster / metric catalogue free.
4. **Disclosures:** yields divide SEC-filed flows by market cap served under the existing derived-data terms; say so in the field descriptions. Earnings surprise is not served.

## RMAPI-17 · Filer hedge endpoint opens the wrong store (2026-10-18)

**Impact:** MATERIAL · `computeFilerHedgeLatest` (`lib/dal/funds-zarr-reader.ts:2544`) opens `ds_hr.zarr` for a filer. The pipeline writes filer hedge to `ds_hedge`, so the endpoint reads a store the current build does not refresh. **Needs:** engineering + Funds_DAG (FDAG-90 publishes the store); then point the reader at it and add a test that opens the published name.

## RMAPI-18 · Filer holdings weight denominator reads variables that are absent (2026-10-18)

**Impact:** MATERIAL · The filer holdings reader (`lib/dal/funds-zarr-reader.ts:1910`) reads `total_aum_usd` and `aum_in_erm3` from the holdings store. Neither variable is present, so the weight denominator is always the sum of positive positions in the returned book. A response gives no indication of which denominator was used. **Needs:** engineering. Read the denominator from the filing-vintage store, return its basis in the response, and test with a book that has non-positive positions.

## RMAPI-19 · Filer holdings `as_of` uses the filing date and an amendment hides the original book (2026-10-18)

**Impact:** MATERIAL · `as_of` selects the latest quarter by `filing_date` (`lib/dal/funds-zarr-reader.ts:1893`). The pipeline's knowledge clock is acceptance time with the next-session rule, so a book accepted after the close is visible one session early. An amendment filed for a quarter replaces the original book in the same slot, so a caller asking for a date between the two filings gets the amended book. **Needs:** engineering. Select on acceptance time with the next-session rule and serve the original and amended books as separate vintages (depends on the vintage store).

## RMAPI-20 · One documented weight basis for funds and filers (2026-10-18)

**Impact:** IMPROVEMENT · Fund and filer holdings responses compute `weight` against different denominators (net assets, reported AUM, sum of positive positions) and the docs do not name the basis. Weights from the two routes are not comparable. **Needs:** engineering. Define one `weight_basis` enum, return it on every holdings and exposure response, and document each value in the OpenAPI schema.

## RMAPI-21 · Fund holdings may label a forward-filled month as the report date (2026-10-18; unconfirmed)

**Impact:** MATERIAL · Unconfirmed. The fund book is forward-filled across months without a filing. If the response labels a filled month with `report_date` equal to that month, a caller reads a stale book as a fresh disclosure. **Needs:** engineering. First step is a read of one fund with a gap between filings to confirm or reject the label; then expose the date of the book actually used.

## RMAPI-22 · Free `/api/data/funds/*` routes return fields that are metered elsewhere (2026-10-18)

**Impact:** MATERIAL · The routes under `/api/data/funds/*` are free and return fields that the metered fund routes charge for. A caller can obtain the metered content through the free route. **Needs:** engineering, then DECISION on which fields the free tier keeps. Slim the payload to the free-tier field set or put the routes behind the same authentication and metering as the paid routes; add a test that compares the free and metered field lists.

## RMAPI-23 · A response field name carries a third-party brand (2026-10-18)

**Impact:** HYGIENE · One category field in the fund responses is named after a third-party brand. The name appears in the public schema and SDK. **Needs:** engineering. Rename it to a neutral name, keep the old name as a deprecated alias for one release, and update the OpenAPI schema and SDK types.

## RMAPI-24 · Stale route documentation: filer portfolio, fund NAV, filer snapshot (2026-10-18)

**Impact:** HYGIENE · The route docs for the filer portfolio, the fund NAV series and the filer snapshot describe fields and clocks that the handlers no longer return. **Needs:** engineering. Regenerate the three pages from the OpenAPI schema and add a drift check to CI.

## RMAPI-25 · Filer-search MCP tool missing on the hosted server (2026-10-18)

**Impact:** IMPROVEMENT · `riskmodels_search_filers` is in the plugin tool list and the REST route `/13f/filers/search` exists, but the hosted MCP server does not register the tool. Clients that rely on the server cannot resolve a filer name to an identifier. **Needs:** engineering. Register the tool on the server and extend the list-endpoints drift guard to compare the server's tool list with the plugin's.

## RMAPI-26 · Panel endpoints, holders of a security, entity history (2026-10-18)

**Impact:** IMPROVEMENT · Three read paths do not exist: a panel read (many entities, one date range, one request), holders of a security at a date, and an entity's history of names and identifiers. Research clients call the per-entity routes in a loop. **Needs:** engineering, after RMAPI-17 to RMAPI-19. Specify the three routes together so they share the weight basis (RMAPI-20) and the acceptance-time clock (RMAPI-19).

## RMAPI-27 · Filer search lists retired filers beside their live twins (2026-10-20)

**Impact:** MATERIAL · Funds_DAG filer rebuild 4 (2026-10-20) kept 720 retired rows in `filers` with status `no_13f_book`, among them hand-typed duplicates of pension plans (CalPERS BW-FILER-CIK0000776606 beside live 0000919079; SWIB 0000706669 beside 0000854157). `searchFilers` (`lib/dal/filers-engine.ts:213`) queries `filers` with no status filter, so those names show twice and the retired row has no book. **Needs:** engineering: exclude `status = 'no_13f_book'` from search (keep direct id lookup working), with a test on a real retired row.
