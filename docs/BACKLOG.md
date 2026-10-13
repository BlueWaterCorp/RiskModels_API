# RiskModels_API Backlog — OPEN items only

**Id prefix:** `RMAPI` · **Next id:** `RMAPI-14`

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
