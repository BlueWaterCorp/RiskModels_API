# Changelog

All notable changes to the RiskModels API surface and public assets.


## [Unreleased]

### Added

- **MCP `instructions` + loaded first prompts** — After OAuth connect, Claude/Smithery were listing catalog tools and never calling priced data routes. Initialize now carries server `instructions`; paste-prompts name `riskmodels_compare` / `GET /api/metrics/AAPL`. SSOT: `lib/mcp/activation.ts`.
- **`GET /api/stocks/{ticker}/commentary-bundle`** — One pull for stock-commentary evidence: latest metrics + `hedge_levels`, trailing return-record summary (sums of daily gross/factor/residual + drawdown), cohort standing, peer variance shares, and residual leadership for the name. Replaces the consumer's multi-endpoint fan-out under the 60/min ceiling. Thin cohorts / short windows null the affected piece and list a reason in `refusals` (200, not 422 for the whole bundle). Billed under `cohorts`. OpenAPI path documented; contract tests cover the return-record summary rules.
- **`POST /api/chat` — `get_stock_commentary_bundle` tool** — Single-name risk notes call the commentary-bundle once (capability `cohorts`) instead of fanning `get_risk_metrics` + `get_ticker_returns` + `get_rankings`. Two or more names stay on `compare_tickers`. System-prompt Performance examples no longer tell the model to emit one `get_risk_metrics` per compared ticker.

- **`GET /api/cohorts/residual-leadership`** — Rank members of a peer cohort by cumulative L3 residual (stock-specific) return over a window (`?cohort=SMH&window=252d&level=subsector`). One `fetchBatchHistory` panel read replaces the consumer's per-member `/returns-decomposition` fan-out. Window dates come from the cohort ETF's own calendar (not the intersection of members); short-history names are dropped and counted in `n_short_history`. Values are **sums** of daily `l3_rr`, not compounded paths. Response always carries `dispersion.{best,worst,median,sd}` plus `n_ranked` / `n_members` — S10 refuses without them. Thin cohorts and windows under ~200 observations → **422**; unknown cohort → **404**. Billed under existing `cohorts` capability. Handoff: `docs/HANDOFF_COHORT_RESIDUAL_LEADERSHIP.md`.

- **`POST /api/chat` — workspace command-bus producer (G.36)** — Optional body flag `workspace_tools: true` offers two agent tools, `set_subject` and `set_window`, whose schemas are **generated** from `lib/chat/workspace-action-contract.mirror.json` — an explicit, versioned mirror of Risk_Models's `action-bus.ts` vocabulary (canonical: `riskmodels_net/src/lib/workspace/workspace-action-contract.json`; drift fails `workspace-action-contract-drift.yml`, the AGENTS_CROSS_REPO §1–3 mechanism reversed). Each successful call is emitted as a **new, distinct SSE frame** `event: action` carrying the typed `WorkspaceAction`; existing frames are unchanged and non-workspace consumers ignore the unknown type. Streaming-only by design (the frame is the sole delivery channel — the blocking JSON path never offers the tools), free of billing (`capabilityId: null` — no data fetch), and fail-closed downstream: the `.net` workspace client validates every action (`dispatchWorkspaceAction`) and surfaces typed refusals (`unknown_subject`, `invalid_window`, …) in the thread. Until Risk_Models Phase R (roster) lands, the client's known-subject set is a singleton, so `set_subject` can only confirm the subject already on screen.

- **Cohort statistics — `GET /api/cohorts`, `GET /api/cohorts/series`, `GET /api/cohorts/roster`** (ERM3 H.146) — First surface over `ds_erm3_cohorts`, ERM3's first artifact published at *cohort* level rather than per-stock: cross-sectional residual statistics at (teo × cohort) for the market and the 11 GICS sectors, over a 2000-01-03 → present panel. Variables: `residual_mean`, `residual_mean_cw`, `residual_sd`, `residual_skew`, `residual_p10`/`p90`, `mean_pairwise_corr`, `n_names`, `n_effective`, `weight_top1`, `membership_churn`, `linked_beta` (+`_se`/`_r2`/`_roll63`), `cohort_factor_return`, `cohort_residual_return`, `cohort_ER`, `factor_source`, and the per-day backing instrument via `include_proxy_source=true`. Cross-section $0.02/call, series $0.03/call; the roster discovery endpoint is free.

  **Why it matters: ERM3 residuals are not zero-mean.** The regressions are fitted *without an intercept*, deliberately, so each stock's residual retains its alpha — which leaves the cross-sectional mean non-zero, and until now no consumer could see it. `residual_mean` is that quantity: subtract it at the level your residual is defined against before building any relative-ranking signal. The contract text is read from the store's own `attrs.no_intercept_contract` and returned in every response's `disclosures` block, so it cannot drift from the data it describes. Drift figures are meaningless without their window — the sign is not stable across the sample — so no headline number is quoted anywhere in the surface.

  `residual_sd` exposes cross-sectional dispersion (how much selection opportunity a cohort holds) for the first time. It is documented throughout as a conditioning/allocation input, **not** an alpha source, and is always paired with `mean_pairwise_corr`. Thin cohorts are filterable via `min_names`, and `n_effective` (inverse-Herfindahl breadth) is recommended over `n_names` for breadth — the gap is large in practice.

  **Identity:** cohorts are addressed by ticker. The store's `cohort` coordinate is a `bw_sym_id` and stays internal — all twelve public cohort ids fall in the licensed-identifier-derived tail of that namespace, which `lib/dal/sym-id-scrub.ts` exists to keep out of responses (H.24). **IP boundary:** public scope is SPY + the 11 GICS sector SPDRs, derived from `ETF_FACTOR_REGISTRY` so the two surfaces cannot drift. The subsector cohort slate is proprietary; a request for one is rejected identically to a nonexistent ticker, so the roster cannot be enumerated by probing.
- **`POST /api/cohorts/pnl-decomposition` — selection vs drift** — Splits a book's realized residual return into **selection** (what it earned by holding names that beat their cohort's average residual) and **drift** (what it earned purely from net exposure to that average, which accrues on net weight regardless of any selection skill). $0.05/call.

  The split is an identity, not a fitted attribution: `R_t = Σ_i w_i·(ε_i,t − μ_c(i),t) + Σ_c W_c·μ_c,t`, so the two components sum to the total exactly — verified against an independently computed `Σ w·ε` to 10 decimal places. It answers *"was I paid for stock-picking, or for being net long the average stock?"*, a question that is only answerable because ERM3 fits without an intercept and the cohort store now exposes the non-zero mean. `level=sector` (default) demeans each name's sector-level residual against its sector cohort; `level=market` uses market-level residuals. Weights are treated as constant over the window and are **not** normalized — rescaling them would change the drift term. Positions that cannot be resolved or mapped to an addressable cohort are dropped and named in `coverage.dropped`, never silently omitted.
- **`/cohorts` on riskmodels.app — Dispersion & Opportunity** — Cross-section of residual dispersion by cohort with `mean_pairwise_corr` and `n_effective` always beside it (dispersion conflates idiosyncratic vol with cross-correlation, and effective breadth diverges sharply from headcount — the market cohort carries 2,776 names but ~81 of effective breadth). Thin cohorts are visually de-emphasised. History panel over 3y / 10y / full panel shades spans where the cohort factor ran on a substitute instrument, and a second panel accumulates each cohort's mean residual — the realized return of net exposure alone, i.e. the drift half of the decomposition above. Realized history only; no forecasts or recommendations anywhere on the surface.
- **Python SDK — `cohorts` module** — `fetch_cohort_series()` / `fetch_cohort_cross_section()` / `fetch_cohort_roster()`, plus `demean()`, which joins the cohort store to a user frame and subtracts `residual_mean` at a chosen level, and `decompose_selection_vs_drift()`. `demean()` exists so five consumers do not write five subtly different demeaning implementations; it leaves the subtracted quantity in a `cohort_residual_mean` column so the correction stays auditable, and returns null rather than an uncorrected value on days with no usable cohort mean.
- **MCP tools `riskmodels_get_cohorts` and `riskmodels_decompose_selection_vs_drift`** — cross-section or series (`series=true`) and the book decomposition, each carrying the demeaning, dispersion, and not-advice guidance in its description.
- **OpenAPI: nine previously-undocumented endpoints** — `POST /v4/decompose` (named-block decomposition), `GET /hedge-basket/{ticker}`, `GET /batch/latest-metrics`, `GET /metrics/{ticker}/snapshot.png` and `GET /snapshot/{entity_kind}` (both return image/PDF bytes, not JSON), `GET /funds/search`, and the OAuth trio `POST /oauth/register` · `POST /oauth/token` · `POST /oauth/revoke`. All existed and were callable; none appeared in the spec. Documented with real `x-pricing` from `lib/agent/capabilities.ts` and correct response content types.
- **Schemas** — `OAuthClientRegistrationRequest` / `OAuthClientRegistrationResponse` / `OAuth2RevokeRequest`; `OAuth2TokenRequest` / `OAuth2TokenResponse` / `OAuth2Error` rewritten for the grants that exist.
- **Per-IP rate limits on the unbilled public surface** — `GET /api/funds/search` and `GET /api/13f/filers/search` now enforce 60 req/min per IP (`FUND_SEARCH_IP_RPM`, `FILER_SEARCH_IP_RPM`) and cap `limit` at 100 rows (was 500, unthrottled). `publicRateLimitResponse` option selects a real `429` (default) vs the Shields.io 200-with-badge payload.
- **`GET /api/13f/filers/{bw_filer_id}/holdings` — filing identity** — The response root now identifies *which SEC submission* the returned panel came from, alongside the existing bi-temporal stamps: **`accession_number`** (EDGAR accession of the surviving submission for the selected quarter), **`filing_type`** (the SEC **form type** — `13F-HR` original, `13F-HR/A` amendment, `13F-NT` notice — deliberately *not* named `report_type`, which reads as the report quarter), and **`amendment_type`** (cover-page semantics: `ORIGINAL` / `RESTATEMENT` / `NEW_HOLDINGS` / `UNKNOWN`). Panel-level, not per holding row — one accession state per selected quarter — and under `as_of` they describe the *selected* accession, so knowledge-mode selection is unchanged. Reader precedence: schema-v2 `ds_ph.zarr` teo-axis coords first, then a keyed lookup in the sibling `ds_filing_vintages.zarr` for the two fields the compatibility view does not project onto `teo`; the second read fires only when an accession is known and a field is still unresolved. All three are **present-and-null** on panels published before the accession-vintage stores, and `amendment_type` is **never** inferred from a `/A` suffix — null means "not classified upstream", which is distinct from the `UNKNOWN` value. Mirrored on the Python SDK `get_filer_holdings()` and MCP `riskmodels_get_filer_holdings`; OpenAPI 200 body is now typed (was bare `type: object`). Reader: `readFilerHoldingsTopN` in [`lib/dal/funds-zarr-reader.ts`](lib/dal/funds-zarr-reader.ts) (snapshot cache key `v: 3`).
- **MCP Tool `riskmodels_get_openapi_spec`** — Added to `@riskmodels/mcp` to expose the OpenAPI 3.x specification, allowing agents to read actual API requests and query parameters directly instead of relying solely on `capabilities.json`.
- **`GET /api/snapshot/{entity_kind}/{id}/panels/{slug}`** — Stock panel drill-down (O.6): `l3_explained_risk_hbar`, `hedge_notionals_hbar`, `hedge_depth_retained`, `watchlist_er_stacked`, and `_full` (composed DD page). Thin alias onto Artifact Registry / render-svc. ADR: BWMACRO `docs/architecture/SNAPSHOT_CANONICAL_PROCESS_ADR.md`.
- **Python SDK — `snapshot_panel()`** — Fetches a single panel PNG/JSON/SVG via the product panel route.
- **render-svc** — Live stock `POST /decompose` loader for O.6 panels (`BW-STOCK-*` / watchlist).
- **render-svc `POST /artifacts/render` — render params** — Optional `params` object for per-slug render parameters: `top_n` (int 1–50, default 12) on `top_holdings_erm_stacked@v1` (threads the holdings adapters + module cap; echoed as `top_n_requested`) and `window` (`3m`/`6m`/`1y`/`2y`/`max`, default `max`) on `cumulative_return_strip@v1` (trailing date-cutoff slice — cadence-agnostic across daily fund + monthly filer series — rebased so the window's base point reads 0; echoed as `window_requested`). Unknown or slug-inapplicable params → 422; artifact modules declare honored params via `RENDER_PARAMS` (undeclared → 501 deploy-skew guard). Params fold into the render-once GCS key (`{as_of}.top_n-5.json`); empty params keep the legacy key. Requires the matching BWMACRO artifact modules (the render-svc image symlinks `bwmacro-src` — coordinated rebuild). TS client `renderArtifact()` accepts `params`.

### Fixed

- **render-svc `watchlist_er_stacked` — one real shared date instead of a synthesized one (BWMACRO `G.71`)** — `_resolve_stock_watchlist` fetched every ticker without `as_of`, so each member served its own latest close; when the members disagreed, the resolved `as_of` fell back to `datetime.now()`. That date reached the GCS render-once key and the `X-Artifact-Resolved-As-Of` header while the bars underneath were different vintages — a shared comparison axis labelled with a date no member reported. Reproduced against prod data on 2026-08-02: a three-name set with one member a week behind resolved to `2026-08-03` with rows at `2026-07-31` / `2026-07-24` / `2026-07-31`. The resolver now picks **one date the whole set can honour** — the minimum of the members' own latest, with an explicit `as_of` acting as a **ceiling rather than the label** — and re-fetches the newer members at that date through `/api/decompose`'s reality-mode `as_of` (`G.42`), so every bar is the same vintage. A member with no row at the resolved date is **excluded and disclosed**, never drawn stale or dropped in silence; a payload carrying no date at all is a `502` rather than a fallback. The JSON payload gains an **`as_of_alignment`** block (resolved date, `as_of_basis: "report_date"`, the rule applied, each member's own latest, anything pulled back or excluded), and figures carry the same disclosure on their face when there is something to disclose. Each aligned payload's `data_as_of` is set to the resolved date, because the artifact module prints that field as its provenance line and an explicit-`as_of` decompose response leaves it at the panel head. The peer-group mode (`G.43`) of the same slug carried the identical fallback and is fixed with it; its refusal of historical `as_of` (peer membership is not point-in-time) is unchanged, and a peer excluded by alignment leaves the `peer_group` membership block. A set whose members already agree — the state prod exhibits today across every ticker probed — pays no extra fetch, keys to the same object, and shows no note.

### Changed

- **`render_artifact` (chat) and `riskmodels_render_artifact` (MCP) — the watchlist date claim, moved (`G.71`)** — The `G.72` descriptions hedged at the wording layer, telling the model the watchlist was "a shared composition axis, NOT a date-aligned comparison". With the resolver fixed that hedge is false in the other direction. Both surfaces now state that the set resolves to **one shared date**, name `resolved_as_of` as where that date comes from, and point at `as_of_alignment.excluded` so a model does not assert completeness the render does not have. `tests/artifacts/render-stock-subject-visibility.test.ts` asserted the old disclaimer positively and is inverted in the same change — descriptions and resolver have to move together or the drift `G.72` closed reopens. **Deploy order: render-svc first.** The descriptions ship on the Next.js deploy and the alignment on a render-svc image rebuild; landing the descriptions first would advertise alignment against a render-svc that does not do it.

- **`render_artifact` (chat) and `riskmodels_render_artifact` (MCP) — stock subjects are now described** — Both tools accepted `BW-STOCK-{TICKER}` and `BW-STOCK-WATCHLIST` and neither said so: the tool description, the `subject_id` description, the slug examples, and the payload description named only `BW-FUND-` / `BW-FILER-` / `BW-PORTFOLIO-`, while `lib/agent/capabilities.ts` and the generated `mcp/data/capabilities.json` named the stock forms correctly. Descriptions now carry the stock prefix, the multi-ticker watchlist form (`subject_id=BW-STOCK-WATCHLIST` with `{"tickers":[…]}`, up to 12), and the four slugs verified for stock subjects (`l3_explained_risk_hbar`, `hedge_notionals_hbar`, `hedge_depth_retained`, `watchlist_er_stacked`). `narrative_profile`, which `ARTIFACT_RENDER_CAPABILITY` records as never having rendered, is no longer offered as an example. The watchlist form was initially described as a shared axis that was explicitly *not* date-aligned, because each ticker then resolved at its own latest close; `G.71` (above, same release) fixed that in the resolver and moved the wording with it. No behaviour change; the schemas already accepted these values. `tests/artifacts/render-stock-subject-visibility.test.ts` pins both surfaces against the capability table so the drift cannot silently recur.

- **`GET /api/snapshot/{ticker}`** — Implemented under `[entity_kind]/route.ts` (same dynamic segment as panels) so Next.js does not reject sibling `[ticker]` vs `[entity_kind]` folders. Reserved kinds (`stock`, `fund`, …) return 400 with the panel URL shape. Deprecation header still prefers `…/panels/_full`.

- **OpenAPI security scheme: `OAuth2ClientCredentials` → `OAuth2AuthorizationCode`** — The spec described a `client_credentials` grant the API does not implement. `POST /api/auth/token` (documented `tokenUrl`) returns **404**, and `/api/oauth/token` supports only `authorization_code` (PKCE S256) and `refresh_token`. The scheme now mirrors `/.well-known/oauth-authorization-server` verbatim; the `/auth/token` path is removed and 14 operation-level `security` entries updated to `OAuth2AuthorizationCode: [mcp:read]`. Scope is informational — the API records it for telemetry and authorises on key validity + balance, not scope.
- **`402` responses now carry a reachable top-up URL** — `top_up_url`, `_agent.top_up_url` and the `X-Top-Up-URL` header returned `/api/billing/top-up`, which does not exist. They now return `${APP_URL}/get-key`. `ERROR_SCHEMA.md` and `AUTHENTICATION_GUIDE.md` corrected to match; the guide's "Mode 2" section (212 lines documenting the non-existent grant, with copy-pasteable cURL/Python/TypeScript) is replaced with the real authorization-code + PKCE flow.
- **`500` responses no longer include exception text** — 18 sites across 16 routes echoed the caught error back to the caller, including Supabase admin-client errors from the provisioning endpoints. Detail is logged server-side; the `ERROR_SCHEMA.md` envelope is unchanged.
- **Rate limiters degrade instead of failing open** — the `/api/data/*` gateway limiter and the public per-IP limiter fall back to a per-instance ceiling when Upstash is unconfigured or erroring, logging `FAIL_OPEN`. Previously both allowed all traffic through, which silently voided the anti-bulk safeguard documented in `docs/legal/eodhd-data-license-safeguards.md`; that document is corrected to describe implemented behaviour.
- **`llms.txt`** — OpenAPI link pointed at `/openapi` (404); now `/openapi.json`.

### Removed

- **`GET /api/pdf/{symbol}/latest`** — Undocumented, no callers, and returned 1-hour signed URLs into the `reports` bucket with no key or billing while the documented `GET /api/metrics/{ticker}/snapshot.pdf` requires both. Use the latter.

### Breaking (clients)

- **Python SDK `riskmodels` 0.4.0** — `OAuthClientCredentialsAuth`, the `client_id`/`client_secret` constructor arguments, and `RISKMODELS_CLIENT_ID` / `RISKMODELS_CLIENT_SECRET` / `RISKMODELS_OAUTH_SCOPE` are removed. They drove the `client_credentials` grant against the 404 endpoint above, so that path never completed a request. Supplying them now raises with migration instructions. Use `api_key=` / `RISKMODELS_API_KEY`.
- **npm CLI `riskmodels` 3.0.0** — Same removal for the same reason (`cli/src/lib/oauth.ts` POSTed `client_credentials` to `{apiRoot}/auth/token`). `riskmodels config set clientId|clientSecret|oauthScope` are gone; use `apiKey`.

## [0.6.2] — 2026-06-30

### Added

- **`GET /api/etf/factor-returns`** — One-teo snapshot of close + trailing-window total returns (1d / 21d / 63d / 252d) for the **public-scope** factor ETF set: **SPY + the 11 GICS sector SPDR ETFs** (XLE / XLB / XLI / XLY / XLP / XLV / XLF / XLK / XLC / XLU / XLRE). The broader BWMACRO factor roster (subsector slates, style picks, macro buckets, broad-market coverage tier) is **intentionally not exposed** through this endpoint — that classification is proprietary curation IP. Tickers outside the public scope return 400 (never silently dropped). Pairs with `/industry-panel` for the daily "what's happening at the market and sector index level" read. Capability `etf-factor-returns` ($0.005/request); OpenAPI + MCP capabilities synced. Reader: `readEtfFactorReturnsSnapshot` in [`lib/dal/zarr-reader.ts`](lib/dal/zarr-reader.ts); classification mirror at [`lib/risk/etf-factor-classification.ts`](lib/risk/etf-factor-classification.ts) (single source = ERM3 `erm3/shared/etf_register.py`).
- **Python SDK — `get_etf_factor_returns()`** — Wraps `GET /etf/factor-returns`; returns the snapshot dict directly. Registered in `client.discover()` output.

## [0.6.1] — 2026-06-30

### Added

- **MCP `riskmodels_get_lstar` + `riskmodels_batch_lstar`** — Dedicated SDK-backed tools for `GET /lstar` and `POST /batch/lstar` (marginal-ER dispatch rule, dispatched HRs + residual return series). Unblocks agent discovery without routing through `returns-decomposition` or generic passthrough.
- **`capabilities.json` `lstar` entry** — Standalone capability mirroring `lib/agent/capabilities.ts` ($0.02/request, `lstar_v1`). Also fixes MCP passthrough allowlist for `/lstar`.

### Changed

- **Python SDK semantic map** — `lstar_rr` normalizes to `lstar_residual_return`; `COLUMN_AGENT_HINTS` documents `lstar_residual_return` and `lstar_level`.

## [0.6.0] — 2026-06-09

### Added

- **`/sitemap.xml`** — Generated sitemap covering the public marketing + docs surface (10 static routes + every `content/docs` MDX page, enumerated automatically). Auth/account/oauth, the print render-snapshot routes, and per-ticker dynamic pages are excluded. `robots.txt` now advertises it via a `Sitemap:` directive.
- **Landing "Compare" callout** — A buyer-facing band below the research-proof block linking to `/compare/barra-axioma` ("Evaluating against Barra or Axioma?"), giving the comparison page a higher-visibility entry point than the footer/audience-card links alone.

### Fixed

- **Canonical URLs resolve to the public `.app` domain** — Added `metadataBase` (and a shared `CANONICAL_SITE_URL` constant) so relative canonical/OG URLs resolve to `https://riskmodels.app` instead of the request host. The app also answers on `.net` (legacy/terms), and a per-host canonical split SEO signal. The sitemap and `robots.txt` `Sitemap:` directive use the same canonical, not `NEXT_PUBLIC_APP_URL` (which is `.net` in some envs).


## [0.5.0] — 2026-06-09

### Added

- **`/compare/barra-axioma` page** — Positioning page for buyers evaluating RiskModels against enterprise risk platforms. Framed as a three-tier spectrum (DIY/Fama-French ↔ RiskModels ↔ enterprise Barra/Axioma) rather than a head-to-head: claims describe what RiskModels does (API-native, pay-per-call, agent-callable, executable ETF hedge ratios, additive four-layer decomposition, published methodology), names the mid-market buyer (RIAs, family offices, allocators, emerging managers), and is honest about when an enterprise platform is the right call. Targets "Barra/Axioma alternative" search intent via title, H1, meta description, and canonical. Linked from the footer ("vs Barra / Axioma") for crawlability.

### Changed

- **Landing audience card** — The third "Built for three workflows" card is now "For RIAs, family offices & allocators" (was "For allocators & diligence"), leading with the wedge "Holdings-level risk without an enterprise platform" and pointing to the new comparison page.


## [0.4.0] — 2026-06-05

### Added

- **`GET /api/status`** — Public, aggregate, privacy-safe service reliability: measured latency percentiles (p50/p95/p99) and a 5xx-only success rate over a window (`?window_hours`, default 24, max 720), plus a per-capability breakdown. Aggregated from `billing_events` request telemetry (the same source `/api/health` uses); metered 4xx (auth/payment/rate-limit) are excluded from both latency and success_rate so a flood of fast 401s can't make the service look faster or less reliable than it is. No revenue or user fields exposed. Capability `status-metrics` (free). Distinct from `/api/metrics/{ticker}` (risk metrics) and `/api/health` (current up/degraded/down state).
- **`POST /api/feedback`** — Trust-loop endpoint: an agent or human flags a result by its `_agent.request_id` with `rating` (up/down), `category`, and/or a ≤4000-char `comment`. Authenticated, free (no metering). Writes to `public.feedback_events` (service-role). Returns `503` until the BWMACRO migration is applied; `201` once live. Capability `feedback` (free).
- **`/for-agents` page** — Human approval surface for risk/compliance teams evaluating the API for their agent fleets: discovery artifacts, onboarding/auth flow, pricing at a glance, and trust/compliance signals. Linked from the docs sidebar (Agents group).
- **Response `_agent.latency_ms` + `_agent.provenance`** — The billing middleware now injects the measured total latency (previously header-only) and a methodology/provenance URL into every JSON success body (non-JSON, errors, and arrays untouched). Many agent HTTP clients drop headers; the body is the durable carrier.
- **Enriched `/.well-known/agent-manifest.json`** — Added `reproducibility` (point-in-time from 2006, deterministic, live model_version/data_as_of/universe_size, methodology + validation-manifest URLs), `pricing` summary, `discovery` cross-links, `reliability` (→ `/api/status`), `onboarding`, and `feedback` blocks. Version stamped `3.0.0-agent`. `agentic-disclosure.json` gained `reproducibility` + `audit` blocks.
- **Agent integration docs — "Compose & chain"** — Worked decompose → hedge → portfolio-snapshot → execution flow, with the schema/citeability/idempotency properties that make chaining safe.
- **OpenAPI** — `/status` and `/feedback` added under the Utility tag (`x-pricing` cost 0); `public/openapi.json` + `mcp/data/openapi.json` regenerated.

### Fixed

- **Methodology/provenance URL** — `_metadata.wiki_uri` (and the new `_agent.provenance`) pointed at `riskmodels.net/docs/methodology` (404); corrected to `riskmodels.app/docs/methodology` (200). Single source of truth: `METHODOLOGY_URL` in `lib/constants.ts`.
- **Landing latency badge** — Softened the unbacked "Sub-120 ms" hero claim to "Low-latency" (no asserted SLA without a measured production p95).

### Cross-repo

- **BWMACRO** — `supabase/migrations/20260605120000_feedback_events.sql` (mirrored to `Risk_Models/riskmodels_com/supabase/migrations/`). Must be applied to the Supabase project before `POST /api/feedback` returns 201.
- **RM_ORG (riskmodels.org)** — `GET /.well-known/methodology.json` machine-readable methodology + validation manifest (verbatim published claims only); the API manifest's `reproducibility.validation_manifest_url` points at it.


## [0.3.9] — 2026-05-27

### Added

- **`POST /api/signals/residual-reversion/basket`** — User-defined ticker list aggregated to a single Phase D L3 residual-reversion signal. 1–500 tickers; equal-weight default + optional `weights[]` aligned to tickers + optional `signal_quality_min_quintile` (1–5) gate (Phase B: gross Sharpe lifts from ~0.79 universe-wide to ~1.28 within quintile 5). Returns weighted aggregate + decile / quality-quintile histograms + per-member rows. Trust contract: tickers absent from `ds_erm3_residual_signal` are silently dropped (upstream mask is SSOT); `coverage.missing_tickers` surfaces the gap. Capability `residual-signal-basket` ($0.02/request); OpenAPI + MCP capabilities synced.
- **`GET /api/universe/{name}/members`** — Active membership of a named universe (`uni_mc_50/500/1000/3000` or `uni_dv_*`) at one teo (latest by default). Active = monthly `universe_mask` AND daily `validity` gate — same dual-gate the ERM3 pipeline applies to produce its output zarrs. Path label validated against the `KNOWN_UNIVERSES` registry (mirror of `erm3.partitions.KNOWN_UNIVERSES`); unknown labels return 400. Response carries `members[{symbol, ticker}]` + `counts {active, in_universe_mask, inactive_from_validity}` + a `mask_as_of` month-end stamp (so callers can disambiguate mask-driven vs validity-driven membership changes). Capability `universe-members` ($0.005/request).
- **`POST /api/portfolio/risk-snapshot` — `lstar_variance_decomposition` block** — Parallel Lstar-aware attribution alongside the existing fixed-L3 `variance_decomposition`. For each holding, picks the ER at the cascade depth `lstar_level` dispatched to (L1 → market+residual; L2 → +sector; L3 → +subsector) and weights across the book. Names with `lstar_level=null` are dropped — `weight_covered` and `dropped_count` on the block surface the coverage gap. Per-row payloads now include `lstar_rr` + `lstar_level` columns. Same call shape; same billing; existing fixed-L3 block unchanged so existing callers don't break.
- **Python SDK — `get_residual_signal_basket()`** — Wraps `POST /signals/residual-reversion/basket`; returns the aggregate + coverage + per-member rows. `get_universe_members()` wraps `GET /universe/{name}/members`.
- **`SDK_VERSION` constant fix** — `sdk/riskmodels/capabilities.py` was stamping `0.3.0` in `client.discover()` output despite the package being at 0.3.7+ on disk. Now bumped to `0.3.9` to match `pyproject.toml`; future bumps should keep both in sync.


## [0.3.8] — 2026-05-27

### Added

- **`POST /api/rankings/screen`** — Cross-section filter on `ds_erm3_rankings_*` zarr: metric, cohort, window, optional `as_of`, percentile/decile/sector filters, and `limit`. Capability `rankings-screen` ($0.02/request); OpenAPI + MCP capabilities synced.
- **`POST /api/batch/lstar`** — Batch Lstar time series for many tickers (JSON map or long parquet/CSV). Parallel `getLstar()` per ticker; capability `batch-lstar` ($0.005/ticker, min $0.01). Python SDK: `batch_lstar()`, `batch_lstar_to_dataframes()`.
- **Python SDK — `screen_rankings()`** — Wraps `POST /rankings/screen`; normalizes ranking rows to semantic columns.

### Fixed

- **`GET /api/industry-panel`** — Response envelope now uses `buildMetadataBody(metadata, …)` + `_agent` (was passing three args to `buildMetadataBody`, breaking `next build`).
- **`returns-decomposition-service`** — Coerce undefined ER inputs to `null` before `pickLstar()` (strict TS on Vercel build).
- **`tsconfig.json`** — Exclude local `bwmacro-src` symlink from typecheck (render-svc Docker context only; not part of the portal build).

## [0.3.7] — 2026-05-27

### Added

- **V3 metric keys `lstar_rr` + `lstar_level`** — Direct access to the Lstar-dispatched residual return and the level Lstar picked, per (teo, symbol), at the canonical **1%** marginal-ER threshold. Reachable via `MetricsV3` (`GET /metrics/{ticker}`, `POST /batch/analyze`, V3 history fetches). `lstar_rr` reads `residual_return.sel(level='lstar')` from `ds_erm3_returns`; `lstar_level` reads the new uint8 `lstar_level` companion var with 0→null mapping at the API boundary (1/2/3 = L1/L2/L3, null = no recommendation). New `returnsFlat` zarr-spec role in [`lib/dal/zarr-metric-registry.ts`](lib/dal/zarr-metric-registry.ts); dispatch in [`lib/dal/zarr-reader.ts`](lib/dal/zarr-reader.ts); unit tests in [`tests/zarr-metric-registry.test.ts`](tests/zarr-metric-registry.test.ts). For a custom threshold continue to use `GET /lstar`.
- **`ds_erm3_returns` schema_version 2** (ERM3-side) — Returns zarr now carries a 4th level `'lstar'` plus a flat `lstar_level (teo, symbol) uint8` companion var, materialized at write time alongside hedge-weights by `erm3.shared.output_manager.materialize_lstar_level_in_returns_zarr`. Threshold pinned on `attrs["Lstar_threshold"]`. Schema upgrade path on first run; subsequent runs use an in-place `region`-write that touches only the `lstar` slice + `lstar_level` array (no rewrite of the ~1.5GB level-indexed cubes). Documented in [`docs/MACRO_STAT_ARB_ZARR_GUIDE.md`](../ERM3/docs/MACRO_STAT_ARB_ZARR_GUIDE.md).
- **Supabase `security_history_latest`: `lstar_rr` + `lstar_level` columns** — Migration `BWMACRO/supabase/migrations/20260527120000_security_history_latest_lstar.sql` adds the two columns; sync wired via `ERM3_RETURNS_DECOMP_SYNC_SPEC` + new `ERM3_RETURNS_FLAT_SYNC_SPEC` with sentinel-0 → null parity with the API mapping. (BWMACRO is the SSOT for Supabase migrations; the ERM3 `supabase/migrations/` dir holds only stale copies and should not be appended to.)
- **`GET /api/returns-decomposition`** — One-call daily gross + L1/L2/L3 factor, combined-factor, and residual return series from `ds_erm3_returns`. Query `include_lstar=true` or `dispatch=lstar` appends `lstar` + `lstar_residual_return` (prefers materialized zarr keys when present; else live marginal-ER dispatch at `threshold`, default 1%). Capability `returns-decomposition` ($0.02/request); OpenAPI + MCP capabilities synced.
- **`GET /api/industry-panel`** — Cross-section from `ds_erm3_industry` zarr: `beta_mean`, `beta_variance`, `n_companies`, and `total_log_mcap_weight` by EODHD industry code and cascade level. Capability `industry-panel` ($0.02/request); OpenAPI + MCP capabilities synced.
- **Python SDK — `RiskModelsClient.get_returns_decomposition()`** — Wraps `GET /returns-decomposition`; semantic return columns + optional Lstar dispatch. **`get_industry_panel()`** wraps `GET /industry-panel`.

### Removed

- **`ds_erm3_hedge_weights` `Lstar` object var + `ER` cube** — The `Lstar (teo, symbol)` object var was 100% None in production (object-dtype writer round-trip bug); deleted from the writer. The `ER (teo, symbol, hedge_level, factor)` cube was a redundant reshape of the named scalar `L*_*_ER` vars — also deleted. vBase 1d stamper updated to drop both from the keccak'd CSV (named scalars still stamped, no information lost; on-chain `object_cid` will differ for the first post-deploy stamp). Incremental rebuilds drop the orphan vars from prior zarrs on read to keep schema clean.
- **Hedge-shrinkage sidecar (`compute_shrinkage_dataset` / `compute_shrinkage` / `ds_erm3_hedge_shrinkage_*.zarr`)** — Architecture moved to in-pipeline adjusted-betas in PR #33 (commit 4916bcd); the sidecar shim was never deployed to GCS. `erm3/core/shrinkage.py` retains `compute_adjusted_betas_and_industry_dataset` (production), `_vasicek_shrinkage_factor` + vectorized variants. Sidecar tests + stale `output_subdir` / `gcs_staging_prefix` config keys removed.

## [0.3.6] — 2026-05-26

### Added

- **`GET /api/lstar` — `residual_return` series** — Parallel daily array of Lstar-dispatched residual returns (`l1_rr` / `l2_rr` / `l3_rr` by chosen level), aligned with existing `dates` and `lstar`. OpenAPI `LstarResponse` updated; unit tests in `tests/lstar-service.test.ts`.
- **Python SDK — `RiskModelsClient.get_lstar()`** — Wraps `GET /lstar`; returns a DataFrame with `date`, dispatched hedge ratios, `total_er`, and `residual_return`. Registered in `capabilities.py` discover output.

### Fixed

- **`GET /api/lstar` threshold default** — Omitted `?threshold=` no longer coerces to `0` via `z.coerce.number(null)`; server now applies the documented **1%** default (`threshold_used: 0.01`).

## [0.3.5] — 2026-05-26

### Added

- **Unified `hedge_levels` (L1/L2/L3)** — Shipped on **riskmodels.app** (PR #108): canonical `HedgeLevelsBlock` on `GET /metrics/{ticker}`, `POST /decompose`, `POST /batch/analyze` (per-ticker rows), `GET /hedge-basket`, ticker returns, portfolio snapshots, and chat hedge-basket tooling. MCP registers **`riskmodels_get_hedge_levels`**, **`riskmodels_analyze_portfolio`**, and **`riskmodels_hedge_portfolio`**. **`riskmodels-py 0.3.5`**: **`get_hedge_levels`**, **`extract_hedge_levels`**, portfolio aggregation in **`portfolio_math.py`** (including hedge-ratios-only batch rows without `full_metrics`). **`@riskmodels/sdk 0.1.2`**: **`getHedgeLevels`**, **`analyzePortfolio`**, **`hedgePortfolio`**. **`@riskmodels/mcp 1.0.4`**: stdio/hosted tool parity for the three portfolio/level tools. JSON Schema [`mcp/data/schemas/hedge-levels-v1.json`](mcp/data/schemas/hedge-levels-v1.json); OpenAPI **`HedgeLevelsBlock`**. Portal: [`content/docs/api.mdx`](content/docs/api.mdx). Prod smoke 2026-05-26: metrics, decompose, batch row, hedge-basket, SDK `get_hedge_levels` verified live.

### Removed

- **Snapshot canonicalization PR 3** — Curated stock-snapshot layouts moved to BWMACRO. Deleted from `sdk/riskmodels/snapshots/`: `r1_risk_profile.py`, `p1_stock_performance.py`, `stock_deep_dive.py`, `s1_forensic.py`, `s2_waterfall.py`, `product_tear_sheet.py`, `_base_template.py`, `_compare_waterfall.py`, `_mag7_dna.py`, `section2_alternatives.py`, `sec_profile_blurb.py`, `refine.py`. From `sdk/riskmodels/visuals/`: `_mag7.py`, `gallery.py`, `mag7_l3_er.py`, `mag7_l3_sigma_rr.py`, `smart_subheader.py`. Demo / zarr-vs-API diff scripts: `scripts/preview_l3_plotly.py`, `scripts/run_visuals_gallery.py`, `scripts/generate_sdk_visual_gallery.py`, `sdk/scripts/p1_zarr_vs_api_diff.py`, `sdk/scripts/mag7_dd_zarr_vs_api.py`. Institutional renderers continue to ship as private IP via [BWMACRO `bwmacro/snapshots/stock/`](../BWMACRO/src/bwmacro/snapshots/stock/).

### Changed

- **Public stock snapshots → canonical pipeline** — `bulk_dd_render.py` (the `rm_api_public` GCS bucket writer) now builds `CanonicalStockSnapshot` via `riskmodels.snapshots.canonical.from_components(p1, peer_comparison=…, peer_rankings=…)` and renders through `reference_renderer.render_canonical_to_pdf/png`. P1Data extracted to slim public module [`sdk/riskmodels/snapshots/_stock_data.py`](sdk/riskmodels/snapshots/_stock_data.py) (dataclass + builders only — no rendering). Hard rule: the public bucket pipeline never imports `bwmacro.*`.

- **Subsector swatch: slate (`#2a7fbf`) → institutional violet (`#6d28d9`)** — `Palette.slate` field renamed to `Palette.subsector` across `_theme.py`, `_charts.py`, `_plotly_charts.py`, `reference_renderer.py`. Snapshot cache key version bumped (`SNAPSHOT_CACHE_VERSION = "v2"` in [`app/api/snapshot/[ticker]/route.ts`](app/api/snapshot/[ticker]/route.ts)) so cached PDF/PNG bytes refresh on first read after deploy.

- **`from_dd_data` now structurally typed** — `riskmodels.snapshots.canonical.from_dd_data` no longer imports `DDData` (which moved to BWMACRO); typed as `Any` and delegates to the new `from_components(p1, …)` adapter. `interpretation.compute_features` / `derive_default_judgment` similarly typed `Any` — both already operated duck-typedly at runtime.

### Added

- **`agent_accounts.signup_attribution` (jsonb)** — Persists validated first-touch UTM payload from `/get-key` when `POST /api/agent-keys` includes `utm`; only fills when column is currently null (oldest qualifying row wins if duplicates exist). Supabase migration `20260524120000_add_agent_accounts_signup_attribution.sql` mirrored in Risk_Models and RiskModels_API.

- **AOM portfolio support — `riskmodels-py 0.3.3`** — The Analysis Object Model executor and compiler now accept `portfolio` subjects in both single-analyze and chain forms. Portfolio composition collapses to one `client.snapshot()` call against `POST /api/snapshot`; the response already carries variance decomposition, per-position hedge ratios, and attribution time series, so chains like `risk_decomposition → hedge_action` resolve in a single request rather than fanning out per-ticker. Stock subjects continue to compose normally. Compiler maps `date_range_preset` to `lookback_days` (`mtd`→21, `ytd`/`1y`→252, `3y`→756, `5y`→1260). New tests cover portfolio compile shape, mock execute, and lookback presets (16/16 in [`sdk/tests/test_aom.py`](sdk/tests/test_aom.py)). Live smoke: [`sdk/scripts/smoke_aom_portfolio_chain.py`](sdk/scripts/smoke_aom_portfolio_chain.py). Verified end-to-end against prod 2026-05-01 (warm latency ~3s).

- **`POST /api/snapshot`** — Canonical JSON-only portfolio snapshot (`type: "portfolio"`): L3 variance decomposition, hedge ratios, frozen-weight daily attribution (`returns_gross`, `l1_fr`–`l3_fr` strips + `l3_rr`), cumulative return and drawdown over `lookback_days`, concentration-style `risk_summary`. Weights-only or shares-only positions (converted via latest `price_close`). Reuses `runPortfolioRiskComputation` + `fetchBatchHistory`; bills as **`portfolio-risk-snapshot`** ($0.25). Route: [`app/api/snapshot/route.ts`](app/api/snapshot/route.ts), builder [`lib/portfolio/canonical-snapshot.ts`](lib/portfolio/canonical-snapshot.ts), Zod [`SnapshotRequestSchema`](lib/api/schemas.ts). OpenAPI `CanonicalSnapshotPortfolioRequest` / `CanonicalSnapshotResponse`, MCP schema [`mcp/data/schemas/canonical-snapshot-v1.json`](mcp/data/schemas/canonical-snapshot-v1.json). Coexists with GET [`/api/snapshot/{ticker}`](app/api/snapshot/[ticker]/route.ts) (DD assets).

- **`/ticker-returns` now accepts ETFs.** Previously the route was stocks-only and `/etf-returns` was a planned 404 route. Since the zarr reader already falls through to `ds_etf.zarr` for daily-role keys, the route now detects `asset_type === "etf"` and returns a slim payload (`date`, `returns_gross`, `price_close` only — L1/L2/L3 hedge/ER columns are **omitted** from ETF rows rather than returned as null, since ETFs are not factor-decomposed). Response now includes a top-level `asset_type` field so clients can branch. The deprecated SDK wrappers `get_returns()` and `get_etf_returns()` both forward to `get_ticker_returns()` with a `DeprecationWarning` (existing notebooks keep working); `asset_type` also flows through to `df.attrs`. CLI `returns stock` / `returns etf` subcommands are deprecated aliases that print a notice and route to `/ticker-returns`. `OPENAPI_SPEC.yaml` updated (+ regenerated `public/openapi.json` and `mcp/data/openapi.json`). One endpoint, two asset classes.

- **`POST /decompose` — agent-friendly four-bet wrapper over the metrics DAL.** Returns a simplified `exposure` object with four additive layers (`market`, `sector`, `subsector`, `residual`) — each tradable layer carrying its own `er`, `hr`, and `hedge_etf` (`SPY` / sector ETF / subsector ETF from `ticker_metadata`) — plus a top-level `hedge` map of ETF → dollar ratio (negative of the layer `hr`, with duplicate ETFs across layers summed). Same billing profile as `GET /metrics/{ticker}` ($0.001, `billing_code: metrics_v3`). Added: route at [`app/api/decompose/route.ts`](app/api/decompose/route.ts), capability `decompose-position` in [`lib/agent/capabilities.ts`](lib/agent/capabilities.ts), Zod schema `DecomposeRequestSchema` in [`lib/api/schemas.ts`](lib/api/schemas.ts), OpenAPI entry + `DecomposeRequest` / `DecomposeResponse` / `DecomposeLayer` components in [`OPENAPI_SPEC.yaml`](OPENAPI_SPEC.yaml), MCP schema [`mcp/data/schemas/decompose-v1.json`](mcp/data/schemas/decompose-v1.json) (+ `schema-paths.json`, `capabilities.json`, regenerated `openapi.json`), Python SDK method `RiskModelsClient.decompose()` in [`sdk/riskmodels/client.py`](sdk/riskmodels/client.py) + discover entry, examples `examples/python/decompose_nvda.py` and `decompose_nvda_vs_aapl.py`, unit tests `tests/decompose.test.ts` (Zod + hedge-map sign invariant) and `sdk/tests/test_decompose.py`. Cross-repo: schema copied to `Risk_Models/riskmodels_com/mcp-server/data/schemas/` and registered in its `schema-paths.json`.

- **API key expiry reminder emails** — Daily Vercel Cron (`vercel.json` → `GET /api/cron/notify-expiring-keys` with `CRON_SECRET`) sends at most three emails per key (14 / 7 / 1 day before `expires_at`), deduped via `agent_api_keys.expiry_notified_*_at`. New React Email template `key-expiring`; uses `lib/email-service` / Resend (same pipeline as low-balance). Migration `20260417180000_agent_api_keys_expiry_notification_flags.sql`.

- **CLI `riskmodels mcp`** — Runs the stdio MCP server (`mcp/dist/index.js`) with path resolution from `RISKMODELS_MCP_SERVER_PATH`, `--mcp-server-path`, cwd `mcp/dist/index.js`, or monorepo layout. [mcp/README.md](mcp/README.md) documents Claude Desktop pitfalls (`npx … mcp` / missing subcommand).

- **Hosted MCP — `GET/POST /api/mcp/sse`** — Streamable HTTP (stateless) over Next.js App Router (Node runtime, `maxDuration=60`). Shared factory at [`mcp/src/server.ts`](mcp/src/server.ts) reused by the stdio binary and the route at [`app/api/mcp/sse/route.ts`](app/api/mcp/sse/route.ts) via a Next-side copy at [`lib/mcp/server.ts`](lib/mcp/server.ts) (zod-v4 compatible; registers the same nine SDK-backed tools from `registerRiskModelsTools` + 5 resources). Auth in [`lib/mcp/auth.ts`](lib/mcp/auth.ts) accepts `Authorization: Bearer <key>` or `?api_key=<key>` query-param fallback (for `EventSource`). Tool calls bill per-invocation at the underlying REST endpoint (no double-charge at the MCP layer). OpenAPI `/mcp/sse` un-deprecated and updated to describe Streamable HTTP semantics.

- **Pure Zarr history path** — `fetchHistory` / `fetchBatchHistory` read consolidated GCS Zarr (`ds_daily`, `ds_erm3_returns_*`, `ds_erm3_hedge_weights_*` via `ZARR_GCS_PREFIX` / `ZARR_FACTOR_SET_ID`) for eligible daily V3 keys; Supabase remains for latest tables, rankings, monthly betas, and unknown keys. New modules [`lib/zarr-config.ts`](lib/zarr-config.ts), [`lib/dal/zarr-metric-registry.ts`](lib/dal/zarr-metric-registry.ts), [`lib/dal/zarr-reader.ts`](lib/dal/zarr-reader.ts) (`zarrita` + `@google-cloud/storage`, Upstash cache). `_metadata.data_source` + `_metadata.range` on `/ticker-returns`, `/l3-decomposition`, and data-plane security-history history responses; [`OPENAPI_SPEC.yaml`](OPENAPI_SPEC.yaml) `RiskMetadata` extended; [`RESPONSE_METADATA.md`](RESPONSE_METADATA.md); approved spec [`docs/API_HISTORY_SUPABASE_AND_ZARR.md`](docs/API_HISTORY_SUPABASE_AND_ZARR.md). Node.js runtime on affected routes.

- **V3 returns decomposition** — New optional metrics `l1_cfr`, `l1_rr`, `l2_cfr`, `l2_rr`, `l3_cfr`, `l3_rr` in `security_history` (from `ds_erm3_returns`) and optional `security_history_latest` wide columns via idempotent migration; sync state key `security_history_returns_decomp` on `erm3_sync_state_v3`. Wired through DAL, `GET /metrics/{ticker}`, data-plane `L123_METRIC_KEYS` backfill, OpenAPI `MetricsV3`, Python SDK `METRICS_V3_TO_SEMANTIC` + hints, [SEMANTIC_ALIASES.md](SEMANTIC_ALIASES.md), [SUPABASE_TABLES.md](SUPABASE_TABLES.md), portal [returns-decomposition-metrics](content/docs/returns-decomposition-metrics.mdx), and [README_API.md](README_API.md) (ERM3 `--returns-decomp-tickers` / `run_sync` pointer). Regenerated `public/openapi.json` and `mcp/data/openapi.json`.

### Changed

- **P1 waterfall — sign-coded bars for negative contributions** — `_make_cum_waterfall` (shared by R1 snapshot, Part 1 opening chart, and `_compare_waterfall.render_waterfall_compare`) now flips negative bars to `pal.red` with a diagonal-hatch pattern (Plotly `marker.pattern.shape="/"`) and places the per-bar value annotation **below** the bar's ending edge in the bar's own red, so a descending step is unambiguous. Residual bars specifically use pal.green for positives and pal.red-hatched for negatives (sign-coded α story). Systematic-layer bars (SPY / Sector / Subsector) keep their factor palette when positive and turn red-hatched when negative. Bar-value labels are now emitted as explicit annotations (previously `go.Bar(text=..., textposition=...)`), which is why downstream consumers that deep-copy the Bar trace no longer need to special-case `text`/`textposition` (it's gone); they do need to carry `marker.pattern.shape` through any trace rewriting.

- **P1 daily layer attribution uses CFR instead of variance-share × gross** — `P1Data.l3_er_series` (daily 4-tuple `(mkt, sec, sub, res)` consumed by Section I waterfall, Section II cumulative-attribution chart, `_make_cum_waterfall`, `_make_cum_chart`, and all article-side waterfall renderers) now sources per-layer daily returns from the CFR columns (`l1_combined_factor_return`, `l2_combined_factor_return`, `l3_combined_factor_return`) rather than from `l3_*_er × returns_gross`. This fixes a correctness bug where per-layer magnitudes reflected **variance-share slicing** (ER fractions are variance decompositions, not return attribution weights) and therefore did not reconcile with the CFR line terminals shown in the same chart. Telescoped waterfall bars now match `cum_spy / cum_sector / cum_subsector` by construction and sum to gross. Falls back to the legacy ER-based formula (with a `UserWarning`) when CFR columns are missing or sparse so old snapshots still render. Shipped R1 snapshots will re-generate with different per-layer numbers; the total gross is unchanged.

- **Vendor-neutral health + SDK paths** — `GET /api/health` `teo_coverage` renames the sparse latest-session boolean to `latest_session_returns_pending` and drops vendor naming from OpenAPI/schema copy. **Breaking:** `zarr_context` no longer infers a zarr root or vendor data paths under `ERM3_ROOT`; **`ERM3_ZARR_ROOT` is required** for default zarr resolution, and optional **`ERM3_SECURITY_MASTER_DB`** / **`ERM3_TICKER_LIST_CSV`** supply full paths for offline company names (see `docs/ERM3_ZARR_API_PARITY.md` — Local zarr paths). `default_erm3_zarr_path()` and bulk/mag7 scripts use the same rules.

- **Documentation precision** — [SEMANTIC_ALIASES.md](SEMANTIC_ALIASES.md) adds a short **hedge ratios vs classical betas** note (L2/L3 hierarchy, `dollar_ratio`). [OPENAPI_SPEC.yaml](OPENAPI_SPEC.yaml) `info.description` now describes Supabase **V3** tables (`security_history`, `security_history_latest`, `symbols`, supporting surfaces) and rankings from `security_history` metric keys (not legacy `erm3_betas` / `erm3_rankings`). [SUPABASE_TABLES.md](SUPABASE_TABLES.md) metric_key row no longer equates HR with betas without qualification. [README_API.md](README_API.md) endpoint table matches behavior (`/api/ticker-returns` is L3 HR/ER in the time series; `/api/metrics/{ticker}` omits Sharpe), and documents the `/api/data/*` data plane vs OpenAPI. [docs/SNAPSHOT_CONTENT_MAP.md](docs/SNAPSHOT_CONTENT_MAP.md) uses HR wording consistently. Regenerated `public/openapi.json` and `mcp/data/openapi.json` from the spec.

- **Portal & email copy** — Landing/pricing alignment: [components/UseCases.tsx](components/UseCases.tsx), [components/AgenticSection.tsx](components/AgenticSection.tsx), [components/TerminalShowcase.tsx](components/TerminalShowcase.tsx), [app/pricing/page.tsx](app/pricing/page.tsx), [emails/low-balance.tsx](emails/low-balance.tsx), [lib/chat/system-prompt.ts](lib/chat/system-prompt.ts). [README_API.md](README_API.md) quickstart examples use the nested `metrics` object and wire HR/ER keys. Removes incorrect **Sharpe** claim from the low-balance email; clarifies **L3** vs full snapshot on ticker returns.

- **OpenAPI MCP tool copy** — `analyze_portfolio` description no longer claims **Sharpe** (not returned by batch/metrics routes). Regenerated JSON; mirrored to **Risk_Models** `riskmodels_com/mcp-server/data/openapi.json`.

## [0.3.0] — 2026-04-07

### Added

- **Python SDK (`riskmodels-py` 0.3.0)** — 3D-style namespaces on `RiskModelsClient` (`.stock`, `.portfolio`, `.pri`, `.insights`) with `.current` / `.historical` facades; `PerformanceResult` for tabular + `.plot()` dispatch; `riskmodels.visuals` (Plotly) for L3 horizontal decomposition and portfolio risk/attribution cascades; optional **`pip install riskmodels-py[viz]`** (plotly, matplotlib, seaborn, kaleido); PDF transport helpers `get_metrics_snapshot_pdf` / `post_portfolio_risk_snapshot_pdf`; `positions_to_weights` accepts `{"ticker","weight"}` lists. See `sdk/README.md` and `sdk/pyproject.toml`.

- **Docs** — `docs/CHAT_MANUAL_QA.md` §8: manual QA checklist for the **Risk_Models** portal (`/chat` proxy, anonymous vs JWT, tier caps, streaming note).

- **POST /api/chat agentic tools** — OpenAI function calling with eight internal tools (DAL-backed): metrics snapshot, L3 decomposition, ticker returns, rankings, factor correlation, macro factors, free ticker search, portfolio risk index. Per-tool billing via `deductBalance`; response includes `tool_calls_summary` and `_agent.llm_cost_usd` / `tool_cost_usd` / `tool_calls`. New modules under `lib/chat/`; `lib/dal/ticker-search.ts` shared with `GET /api/tickers?search=`. Cost preflight: `POST /api/estimate` with `endpoint: "chat"` returns `available_tools` and an LLM-only token estimate.

- **Transactional email (developer portal)** — **`lib/email-service.ts`** sends via **Resend** + **React Email** (templates under **`emails/`**, aligned with Risk_Models). **`RESEND_API_KEY`** required; **`RESEND_FROM_EMAIL`** / **`RESEND_BCC_EMAIL`** optional (audit BCC defaults to **`resend@riskmodels.app`** per **`lib/resend-audit.ts`**). Low-balance alerts from **`lib/agent/billing.ts`** log to **`email_logs`** when **`userId`** is provided. Vercel allowlist updated in **`scripts/doppler-vercel-allowlist.txt`**.

- **Portfolio risk snapshot (Phase 7)** — **`POST /api/portfolio/risk-snapshot`** returns structured JSON or a one-page PDF (`format=pdf`); capability **`portfolio-risk-snapshot`** ($0.25, **`risk_snapshot_pdf_v1`**). **`GET /api/metrics/{ticker}/snapshot.pdf`** reuses the same capability for a single-name PDF. Responses are cached ~24h per user (Redis or in-memory); cache hits bill **`$0`** and set **`X-Cache: HIT`**. PNG export returns **501** until implemented. Shared computation lives in **`lib/portfolio/portfolio-risk-core.ts`**; PDF layout in **`lib/portfolio/risk-snapshot-pdf.ts`** (**`pdf-lib`**).

- **OpenAPI `x-pricing`** — Metered operations in **`OPENAPI_SPEC.yaml`** include `x-pricing` (`capability_id`, `tier`, `model`, `cost_usd`, `billing_code`, optional `min_charge` / per-token fields) aligned with **`lib/agent/capabilities.ts`**. Documented public **`GET /pricing`** in the spec (matches **`app/api/pricing/route.ts`**).

- **`GET /api/macro-factors`** — Read-only long-format daily macro factor returns from `macro_factors` (`factor_key`, `teo`, `return_gross`) with optional `start` / `end` / `factors`; capability **`macro-factor-series`**, OAuth scope **`macro-factor-series`**, JSON Schema **`mcp/data/schemas/macro-factors-series-v1.json`**. Python SDK **`get_macro_factor_series`**, CLI **`riskmodels macro-factors`**, portal doc **`content/docs/macro-factors.mdx`**.

- **CI** — Root **`npm test`** (Vitest) covers **`FactorCorrelationRequestSchema`** and **`parseMacroFactorsSeriesQuery`**.

- **Public Python SDK hints** — `GET /api/sdk/python` returns JSON (`package`, `min_version`, `upgrade_message`, `docs_url`) for notebooks and CLIs; no auth. Override copy with `RISKMODELS_PY_UPGRADE_MESSAGE` and minimum version with `RISKMODELS_PY_MIN_VERSION` (see `app/api/sdk/python/route.ts`).

- **Python SDK** — `format_metrics_snapshot(row)` for human-readable L3 metrics text from a `get_metrics` dict row; `examples/quickstart.py` CLI demo. See [packages/riskmodels/README.md](packages/riskmodels/README.md).

### Changed

- **Premium endpoint pricing (Phase 2)** — Raised `cost_usd` and bumped `billing_code` versions for: `risk-decomposition` / `l3-decomposition` ($0.02), `portfolio-risk-index` ($0.03), `batch-analysis` ($0.005/position, min $0.01), `portfolio-returns` ($0.004/position, min $0.01), `plaid-holdings` ($0.02). See `PREMIUM_TIER_DESIGN.md`. `OPENAPI_SPEC.yaml` billing copy and `mcp/data/capabilities.json` aligned with `lib/agent/capabilities.ts`.

- **`GET /api/sdk/python`** — Default `min_version` and bundled `upgrade_message` now target **`riskmodels-py` ≥ 0.3.0** and the editable path **`RiskModels_API/sdk`** (aligned with `sdk/pyproject.toml`).

- **MCP data sync** — Ran `sync-mcp-from-risk-models.sh`; `mcp-server/data/capabilities.json`, `schema-paths.json`, and `schemas/*.json` mirrored from Risk_Models `riskmodels_com` generator output.

### Added

- **Python SDK (`packages/riskmodels`)** — `riskmodels-py` on PyPI layout: `RiskModelsClient` (Bearer + OAuth2 client credentials, optional `httpx` injection for tests), batch portfolio weighted hedge ratios, Parquet/CSV tabular paths, optional `[xarray]` `get_dataset`, agent helpers (`discover` Markdown/JSON, `to_llm_context`, attrs + ERM3 legend, ticker alias map e.g. GOOGL→GOOG, `validate=warn|error|off`). See [packages/riskmodels/README.md](packages/riskmodels/README.md).

- **Agentic API landing page integration** — Homepage now features agentic-first messaging with new sections:
  - `AgenticSection` component with "Stop Querying. Start Delegating." value proposition
  - `UseCases` component highlighting four agentic patterns (Pre-Trade Risk Check, Drift Monitoring, Hedge Recommendations, Rebalance Triggers)
  - `ComparisonTable` component with competitive pricing vs MSCI Barra and Northfield
  - Updated `Hero` with "First Agentic Risk API" badge and new headline
  - Quickstart page now includes Agentic API examples (Python/TypeScript)
  - Cross-linking between traditional REST API and agentic delegation workflows

- **`GET /api/health` T coverage** — Response includes `teo_coverage` (`latest_teo`, `latest_teo_coverage_pct`, `non_null_returns_symbol_count`, `universe_stock_count`, plus a boolean for sparse latest-session gross returns) derived from `security_history` `returns_gross` vs `symbols` (stocks), using a 10% sparse threshold. `health-v1.json` schema updated; copy synced to Risk_Models.

### Changed

- **OpenAPI tabular exports** — Finalized Parquet/CSV documentation: `application/vnd.apache.parquet` (matches runtime `Content-Type`), shared `FormatQueryTabular` parameter, row schemas `GrossReturnDailyRow` and `BatchAnalyzeExportRow`, `TickerReturnsDailyRow.price_close`, batch export semantics (returns-only long table), CSV examples, and `build:openapi` now mirrors `mcp-server/data/openapi.json`.

## [0.2.0] — 2026-03-24

### Added

- **Developer portal** — Global search over documentation and primary routes (Fuse.js, ⌘K / Ctrl+K). Persistent **Live Demo** control in the top bar that opens a panel with the public demo API key (when `NEXT_PUBLIC_DEMO_API_KEY` is set), one-click copy, and a link to Quickstart; without the env var, Live Demo links to Quickstart. Navbar uses backdrop blur, subtle shadow, gradient primary CTA, and active-route highlighting for clearer hierarchy.

### Changed

- **`riskmodels-py` 0.2.0** (package `packages/riskmodels`) — Version and `__version__` bumped from 0.1.0. **`RiskModelsClient.analyze`** is a documented alias for **`analyze_portfolio`**. **`get_dataset`** (aliases **`get_cube`**, **`get_panel`**) returns an **`xarray.Dataset`** from batch Parquet/CSV long tables when the **`[xarray]`** extra is installed. PyPI trove classifier **Development Status :: 4 - Beta** (was Alpha).

## [2026-03-23] — Phase 2–4 migration: self-contained API

### Added

- **Full agent middleware stack** (`lib/agent/`) — billing, billing-middleware, api-keys, capabilities, cost-estimator, errors, free-tier, rate-limiter, response-utils, schemas, telemetry. All `createAdminClient` calls use `@/lib/supabase/admin`; module-scope singleton anti-patterns removed throughout.
- **DAL layer** (`lib/dal/`) — `risk-engine-v3`, `risk-metadata`, `response-headers`, `secmaster`; direct Supabase queries replacing former gateway HTTP calls.
- **Format response helper** (`lib/api/format-response.ts`) — JSON/Parquet/CSV output.
- **L3 service** (`lib/risk/l3-decomposition-service.ts`) — shared decomposition logic used by route and MCP tools.
- **Redis cache** (`lib/cache/redis.ts`) — Upstash Redis client with in-memory fallback.
- **13 API routes** — `/ticker-returns`, `/l3-decomposition`, `/batch/analyze`, `/metrics/[ticker]`, `/tickers`, `/estimate`, `/health`, `/balance`, `/telemetry`, `/cli/query`, `/auth/provision`, `/auth/provision-free`, `/auth/free-tier-status`.
- **OpenAPI spec** — server URL updated to `https://riskmodels.app/api`; added `/auth/provision-free`, `/auth/free-tier-status`, `/cli/query` path entries.

### Added

- **ERM3 zarr ↔ API ER/HR mapping** — [docs/ERM3_ZARR_API_PARITY.md](docs/ERM3_ZARR_API_PARITY.md) documents zarr-style `L*_ER` / `L*_HR` names vs `POST /batch/analyze` keys (`full_metrics` / `hedge_ratios`), `metrics` whitelist behavior, lineage headers, tolerances, and an example JSON. OpenAPI `BatchFullMetrics` / `BatchHedgeRatios` now describe the full L1/L2/L3 surface and zarr aliases; `BatchAnalyzeResponse` may include `_metadata`.
- **Developer Portal (riskmodels.app)** — Next.js site with auth (GitHub + magic link), Stripe Setup for $20 free credits, API key generation with one-time reveal, methodology docs with KaTeX, API reference, quickstart, examples. Get keys at riskmodels.app/get-key.
- **Vercel deployment** — `DEPLOYMENT.md` with env vars, Supabase/Stripe config; `vercel.json`, `.env.example`; `getAppUrl()` fallback to `VERCEL_URL` for preview deployments.
- **Parquet/CSV format support** — `?format=parquet` or `?format=csv` on `/ticker-returns`, `/returns`, `/etf-returns`; POST body `format` on `/batch/analyze`. Returns binary Parquet or text CSV for bulk export. (Note: `/returns` and `/etf-returns` were later deprecated — `/ticker-returns` now serves both stocks and ETFs. See the Unreleased section.)
- **Cost estimation endpoint** — `POST /api/estimate` returns predicted cost before a request. Authenticated, free.

### Changed

- **Lineage metadata** — All data responses include `_metadata` (model_version, data_as_of, factor_set_id, universe_size, wiki_uri, factors) and headers `X-Risk-Model-Version`, `X-Data-As-Of`, `X-Factor-Set-Id`, `X-Universe-Size`.
- **Billing** — Four previously unbilled endpoints now use `withBilling()`: `metrics/[ticker]` ($0.001), `l3-decomposition` ($0.005), `portfolio/returns` ($0.002/position), `portfolio/risk-index` ($0.005).
- **CORS** — ticker-returns and etf-returns now include CORS headers for browser requests.
- **ETag / 304** — ticker-returns supports `If-None-Match`; returns 304 Not Modified when cached data is fresh.
- **CLI** — `riskmodels estimate` subcommand for pre-flight cost estimates.
