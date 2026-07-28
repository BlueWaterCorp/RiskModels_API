# riskmodels.app — repo review (2026-07-28)

Companion to the `.net` design review (`Risk_Models` 04f19386) and the `.org` review
(`RM_ORG` #33/#34). Same method as `.org`: findings come from **inspecting served
output and the published contract**, not from reading source and guessing.

Baseline **before** review: `npm test` → 574 passed / 10 skipped, `cli:openapi-check` → OK,
`tsc --noEmit` failing on one file (L4).

> **Status: every finding below is fixed in #285.** The finding bodies are left in their
> pre-fix, present-tense form on purpose — the diagnosis is the durable part. What was
> actually applied, and where it differed from the proposed fix, is in the two tables at
> the end.

Scope note: `.org` was ~13 research pages and got equal-depth full coverage. `.app` is
129 API routes at review time (128 after H2) + Python SDK + MCP + OAuth + billing. This pass prioritised the
machine-facing contract surface (auth, cost, spec fidelity, agent discovery). Every
route without a recognised auth wrapper was opened and classified. **Not** covered:
the MCP tool layer, OpenBB widgets, the Playwright PDF/PNG workers, Plaid internals,
the `(print)` render routes, and the correctness of the risk math itself.

Everything below was verified against production or the working tree. Nothing is a guess.
Hypotheses that tested negative are recorded in "Checked and clean" rather than dropped.

---

## High

### H1 — The EODHD Exhibit B(g) anti-scraping safeguard is a single fail-open control

Public read on `/api/data/*` is **deliberate** — the soft-auth comment in
`lib/gateway-auth.ts:6-11` says so explicitly, and that is the product. The finding is
not "this should be authenticated." It is that the licensing safeguard which justifies
that openness has no depth.

The only enforcement on those 22 routes is the per-IP throttle in `middleware.ts:18-32`.
It fails open in three independent ways (`lib/ratelimit/data-gateway-rate-limit.ts`):

1. Upstash unconfigured → `getLimiter()` returns `null` → `{ ok: true }`
2. Upstash erroring → `catch { console.error(...); return { ok: true } }`
3. IP spoofing/rotation → the key is `ip:${x-forwarded-for[0]}`, and the limit is
   per-IP, not per-key (there is no key)

Nothing sits behind it. If Upstash is down, the derived surface is harvestable
symbol-by-symbol at full speed, which is the exact scenario Exhibit B(g) exists to
prevent. Given that this is a **licensing** obligation rather than an availability
tradeoff, "availability over enforcement" is arguably the wrong default here — at
minimum the fail-open path should be alarmed so an outage is visible rather than silent.

**Fix:** alarm on the fail-open branches (they currently only `console.error`), and
consider a cheap second layer that does not depend on Upstash — e.g. a per-instance
in-memory ceiling as a floor when Redis is unavailable, so the safeguard degrades
instead of disappearing.

### H1b — `verifyGatewayAuth()` cannot deny anything, and 24 routes branch on a dead value

Hygiene, not a vulnerability — but it is what made H1 hard to see. Every path through
`lib/gateway-auth.ts:23-36` returns `null`:

```ts
if (!key) return null;
if (!authHeader) return null;
if (token === key) return null;
return null;   // "User keys, JWTs, or any other Bearer: allow public read"
```

24 `/api/data/*` routes call it as `const denied = verifyGatewayAuth(request)` and branch
on `denied`, which is unreachable. The name asserts a check the function does not
perform, and the call sites read as an access-control gate — so the surface looks
defended when the actual defence is entirely in middleware.

`requireGatewayAuth()` (the strict variant) has **zero call sites**, and also returns
`null` when `RISKMODELS_API_SERVICE_KEY` is unset.

**Fix:** rename to `resolveGatewayRole() → 'service' | 'public'`, return the role, and
delete the dead `denied` branches. Delete `requireGatewayAuth` or wire it up.

### H2 — `/api/pdf/{symbol}/latest` is an unauthenticated door to a billed artifact (latent)

`app/api/pdf/[symbol]/latest/route.ts`. No API key, no `withBilling`, no rate limit. It
mints a **1-hour signed URL** into the `reports` Supabase Storage bucket for any ticker.
The equivalent product path, `/api/metrics/{ticker}/snapshot.pdf`, is `withBilling`.

Verified live:

| Request (no key) | Result |
|---|---|
| `GET /api/pdf/NVDA/latest` | 404 |
| `GET /api/pdf/{AAPL,MSFT,TSLA}/latest` | 404 |
| `GET /api/metrics/NVDA/snapshot.pdf` | **401** |

**The bucket is currently empty, so this is latent, not a live leak.** It becomes a real
bypass the moment anything populates `reports/tickers/<TICKER>/` — at which point paid
Deep Dive PDFs are downloadable with no key. The route is also absent from the OpenAPI
spec, so it is an unadvertised path that nothing would flag on the way in.

Secondary: `symbol` is interpolated into the storage path (`tickers/${symbol.toUpperCase()}`)
with no validation.

**Fix:** wrap in `withBilling` (or delete it if `/api/metrics/{ticker}/snapshot.pdf`
supersedes it), and validate `symbol` against `^[A-Z][A-Z.-]{0,9}$`.

### H4 — `/api/funds/search` is public, unthrottled, and bulk-readable over licensed fund data

**Found while documenting it for M4** — I had written the spec entry as "Authentication:
Required", then probed it to confirm. It returns **200 with no key**.

`skipBilling: true` does not merely waive the charge — in
`lib/agent/billing-middleware.ts:318-368` it returns before any key validation, invoking
the handler with `userId: ""`. So `withBilling(..., { skipBilling: true })` means *no
auth at all*, not "authenticated but free". The route's own doc comment
(`app/api/funds/search/route.ts:11-12`) says the opposite: "uses user-key auth via
`withBilling`, so an `rm_agent_live_*` token resolves a `bw_fund_id`."

Verified live, no `Authorization` header:

```
GET /api/funds/search?limit=500   → 200, 500 rows × 19 fields
```

Fields include `cik`, `net_expense_ratio` (EODHD-sourced), and derived analytics
(`latest_total_adj_mv`, `latest_n_holdings`, `latest_effective_n`). Varying `q` walks
the universe.

There is **no rate limit**: the route sets no `publicIpRateLimitPerMinute` (the
`skipBilling` branch only throttles when that option is present), and the middleware
throttle matches `/api/data/` only (`middleware.ts:18`) — this path is `/api/funds/`.
So unlike H1, where a fail-open control at least exists, here there is no control at all.

This is the same EODHD Exhibit B(g) exposure as H1 on a surface that safeguard was never
extended to. Worth auditing every other `skipBilling: true` route on the same basis —
that flag reads as "free" but means "public".

**Fix:** decide whether this is intentionally public. If yes, add
`publicIpRateLimitPerMinute` and cap `limit` well below 500. If no, drop `skipBilling`
and keep `cost_usd: 0` so the key is still validated. Either way, correct the route's
doc comment. The spec entry written in PR 1 now documents the endpoint as public with
no rate limit — accurate today, and should be updated with whatever is decided.

### H3 — The shipped Python SDK's OAuth auth mode calls the endpoint that does not exist

**Found while fixing M1.** Not spec drift — a live, reachable defect in the published
`riskmodels` PyPI package.

`sdk/riskmodels/auth.py:66` posts a `client_credentials` grant to
`{base_url}/auth/token`. That path 404s (M1), so `raise_for_status()` throws on the
first call. It is reachable from the public constructor:

```python
RiskModelsClient(client_id=..., client_secret=...)   # client.py:154-162
RiskModelsClient.from_env()                          # client.py:213-214, via env vars
```

`api_key=` users are unaffected — that path uses `StaticBearerAuth` and never touches
the token endpoint. So the blast radius is anyone who followed the OAuth instructions
in the spec rather than using an API key.

The SDK's own tests pass because `tests/test_auth.py:45` **mocks** `/auth/token` and
asserts the SDK calls it — the test encodes the bug as the expectation. That is why
this survived: the contract, the client, and the test all agreed with each other and
all disagreed with the server.

**Fix (not applied — needs a product decision):** either implement a `client_credentials`
grant at `/api/oauth/token`, or remove `OAuthClientCredentialsAuth` from the SDK and
make `client_id`/`client_secret` raise a clear "use an API key, or the MCP OAuth flow"
error. The second is cheaper and matches what the authorization server actually
advertises (`grant_types_supported: [authorization_code, refresh_token]`). Either way
the mocked test must be rewritten — the current one would keep passing against a
still-broken endpoint.

---

## Medium

### M1 — The published spec advertises an OAuth2 *grant type the API does not implement*

> **Revised while fixing.** The original finding was "the `tokenUrl` points at a 404."
> That is true but understates it: `/api/oauth/token` supports **only**
> `authorization_code` and `refresh_token` (`route.ts:214` returns
> `unsupported_grant_type` for anything else), so the entire `clientCredentials` flow
> the spec documents does not exist anywhere in the codebase. Repointing `tokenUrl`
> would have replaced one false contract with another.


`OPENAPI_SPEC.yaml:115` declares:

```yaml
OAuth2ClientCredentials:
  flows:
    clientCredentials:
      tokenUrl: https://riskmodels.app/api/auth/token
```

and documents `/auth/token` as a path (`OPENAPI_SPEC.yaml:3300`). That scheme is attached
to operations at lines 3406, 3461, 3719, 3760, 3826, 3936+.

Verified live:

| Endpoint | Result |
|---|---|
| `POST /api/auth/token` (the documented one) | **404** |
| `POST /api/oauth/token` (the real one) | 400 on bad body — alive |

No `app/api/auth/token/route.ts` exists on disk. Any client that drives auth from the
spec — Swagger UI's Authorize button, generated SDKs, an agent reading
`riskmodels.app/openapi.json` — fails at the first step.

**Fix:** point `tokenUrl` at `/api/oauth/token` and move the documented path to match.

### M2 — `ERROR_SCHEMA.md` sends 402 clients to a route that does not exist

The documented recovery for `INSUFFICIENT_BALANCE` is `POST /api/billing/top-up`.
Live: **404**. There is no `app/api/billing/` directory. This is the documented recovery
path for the one error that directly gates revenue.

The other endpoints referenced by `ERROR_SCHEMA.md` all resolve (`/api/balance`,
`/api/health`, `/api/tickers?search=`, `/api/tickers?array=teo`, `/api/auth/provision`).

### M3 — `llms.txt` points agents at a 404

`llms.txt:67`: `- OpenAPI: https://riskmodels.app/openapi (or /api-docs in the portal)`

| URL | Result |
|---|---|
| `/openapi` | **404** |
| `/openapi.json` | 200 |
| `/api-docs` | 308 → `/api-reference` (fine) |

`llms.txt` is the agent entry document — this is the link an LLM is most likely to follow.

### M4 — 47 routes undocumented in the spec, including billed ones customers cannot discover

Set difference between the 86 spec paths and the 129 route files is **47** (not 129−86;
the spec also documents 4 paths that aren't `/api` routes). Most gaps are intentional
(internal, admin, cron, Stripe). These are not — all carry a `capabilityId` and require
a key, so they are products that exist but are invisible to anyone reading the spec.
Prices from `lib/agent/capabilities.ts`:

| Route | Capability | Price |
|---|---|---|
| `/v4/decompose` | `decompose-position` | $0.001 |
| `/hedge-basket/{ticker}` | `hedge-basket` | $0.001 |
| `/batch/latest-metrics` | `metrics-snapshot` | $0.001 |
| `/metrics/{ticker}/snapshot.png` | `portfolio-risk-snapshot` | $0.25 (premium) |
| `/snapshot/{entity_kind}` | `portfolio-risk-snapshot` | $0.25 (premium) |
| `/funds/search` | `fund-search` | **free and public** — see H4 |

The five billed routes were each confirmed to return 401 unauthenticated. `/funds/search`
returns 200 with no key — `skipBilling: true` bypasses authentication, not just charging.
That became **H4**.

Also undocumented: `/oauth/token`, `/oauth/register`, `/oauth/revoke` — the working OAuth
trio that `.well-known/mcp.json` depends on (see M1).

### M5 — The unauthenticated LLM endpoint's spend cap is per-instance

`app/api/landing/chat/route.ts`. `MAX_MSGS_PER_HOUR = 10`, enforced through a
`globalThis` `Map`. The code says so ("good enough for MVP on a single Vercel instance").
On Vercel the effective ceiling is 10 × live instances, and this is the **only** limit on
an unauthenticated endpoint that spends real LLM tokens — `middleware.ts` throttles
`/api/data/*` only.

Upstash is already wired and there is a working per-IP limiter to copy
(`lib/ratelimit/data-gateway-rate-limit.ts`). Cheap fix, and the blast radius is a
metered vendor bill.

---

## Low

### L1 — 18 routes return raw `error.message` to the client on 500

Same class as the `.org` newsletter fix ("generic message on server error, no env
leakage"). Notably `app/api/auth/provision/route.ts` and `provision-free/route.ts`,
where the leaked string is a Supabase **admin-client** error.

Full list: `metrics/[ticker]`, `fundamentals/[ticker]`, `landing/mag7-hero`,
`landing/walkthrough-chart`, `landing/concentration`, `landing/decompose`,
`auth/provision`, `auth/provision-free`, `balance`, `hedge-basket/[ticker]`,
`ticker-returns`, `tickers`, `v4/decompose`, `batch/analyze`, `telemetry`, `decompose`.

### L2 — 14 zero-importer modules

Verified by scanning every import/require specifier across `app`, `components`, `lib`,
`packages`, `scripts`, `tests`, then re-confirming each by name across the whole tree
(0 references, excluding the file's own definition):

```
components/AgentBootstrapBar.tsx        components/landing/BuiltForAgents.tsx
components/HeroGetStartedPulse.tsx      components/landing/CoreInsightFourBets.tsx
components/PortfolioSnapshotChart.tsx   components/landing/OneFunction.tsx
components/ThemeByPath.tsx              components/landing/WhyThisExists.tsx
components/TrustTechBar.tsx             components/landing/landing-preview.ts
components/UseCases.tsx                 lib/quickstart-examples.ts
lib/agent/middleware.ts                 lib/agent/managed-agent-billing-design.ts
```

`lib/agent/middleware.ts` is worth a second look before deleting — an unused auth
middleware next to the one that *is* used (`billing-middleware.ts`) is a footgun.

### L3 — `_g()` metric-key helper is triplicated in the SDK

`riskmodels/interpretation.py:74`, `snapshots/canonical.py:477`,
`snapshots/canonical_fund.py:247` — three copies of the same
full-name/abbreviated-name fallback that `CLAUDE.md` calls out as fragile. Should be one
helper in `mapping.py`, which already owns both key tables.

Checked and **not** a finding: `peer_group.py:363` reads `l3_residual_er` without the
fallback, but `client.get_metrics()` returns normalised full-name keys, so it is correct.

### L4 — `exceljs` declared but not installed; `tsc --noEmit` fails

`exceljs` is in `package.json:61` but absent from `node_modules`, so
`app/api/fundamentals/[ticker]/model-scaffold/route.ts:2` fails typecheck locally. CI/Vercel
install from the manifest and are unaffected — this is local environment drift, not a
code defect, but it means `npm run typecheck` is currently red for anyone working here.

---

## Checked and clean

Worth recording so the next pass doesn't redo it:

- **The H2 pattern does not generalise — tested explicitly.** The obvious worry is that
  "unauthenticated route shadowing a billed one" repeats across the surface. It does not:
  - `POST /api/landing/decompose` (no key) returns full L3 decomposition for **MAG7 only**
    — `JPM`, `XOM`, `KO`, `CAT`, `SMCI`, `PLTR` all → 403 "This preview only supports MAG7".
    Its billed twin `POST /api/decompose` → 401. The gate works.
  - `/api/landing/concentration` and `/api/landing/mag7-hero` → 200 but MAG7-only, by design.
  - `/api/returns` and `/api/etf-returns` → **410 Gone** with a `replacement` pointer to
    the billed `/api/ticker-returns`. Deliberate deprecation, cleanly done.
- **The served spec is byte-identical to the repo spec.** `riskmodels.app/openapi.json`
  and `mcp/data/openapi.json` have the same 86 paths, diff-clean — so M1 and M4 are
  claims about production, not about a stale local file. `/auth/token` is present in the
  *served* document.
- **Exposing `symbol` in API responses is contractual, not a leak.** `/api/landing/*`
  returns `symbol: BW-BBG…`, which looks like it violates the CLAUDE.md "never expose
  `symbol`" rule — but `symbol` is a documented response field in `OPENAPI_SPEC.yaml`
  (lines 675, 1090, 1256, 4738, 5409) and the billed `/api/decompose` returns it too
  (`route.ts:229`). The CLAUDE.md rule governs user-facing chart/PDF labelling, not
  payloads. The `sym-id-scrub` layer targets a different problem (ISIN-flavoured ids,
  a licensing concern); FIGI-flavoured ids pass through by design.
- **OAuth is in good shape.** `/oauth/register` implements RFC 7591 DCR with a per-IP cap
  (30/hr), rejects non-loopback `http://` redirect URIs per RFC 8252, and issues public
  clients only (PKCE, no secret). `/oauth/token` is PKCE-bound with single-use codes;
  `/oauth/revoke` is rate-limited. `/api/agent/branding` is authenticated via
  `requireAuth`. `/api/telemetry` is GET-only aggregate stats, no writes.
- **Session-cookie auth is correct** on `/api/keys`, `/api/agent-keys`, `/api/account`,
  `/api/usage`, `/api/affiliate/*`, `/api/stripe/{payment-method,payment-methods,setup-session}`,
  `/api/webhooks/subscribe` — all call `supabase.auth.getUser()` and scope queries by `user.id`.
- **`/api/auth/provision-free` is properly guarded** — per-IP cap of 3/24h, auth-user
  rollback on partial failure, referral code length-capped.
- **`/api/stripe/webhook`** verifies the Stripe signature via `constructEventAsync`.
- **`/api/stripe/setup-success`** derives `user_id` from Stripe session metadata (not
  client input) and guards each credit independently for idempotency.
- **Billing middleware** (`lib/agent/billing-middleware.ts`) gates per-key rate limit →
  free-tier cap → balance → idempotency in the right order.
- **Agent discovery surface is healthy** — all 200: `/openapi.json`,
  `/.well-known/{mcp,ai-plugin,agent-manifest,agentic-disclosure}.json`,
  `/.well-known/{oauth-protected-resource,oauth-authorization-server}`, `/llms.txt`,
  `/docs/agent-integration`. `GET /api/mcp/sse` → 405 is correct (POST-only).
- **The four untracked root docs** (`AGENTS_INTERNAL.md`, `PREMIUM_TIER_*.md`,
  `PRICING_STRATEGY_ANALYSIS.md`) are all in `.gitignore` — intentional, not drift.

---

## Suggested landing order

Mirrors `.org` (#33 quick wins → #34 second pass):

**PR 1 — contract fixes. ✅ APPLIED (2026-07-28).** M1, M2, M3, M4. Detail below.

**PR 2 — auth and cost. ✅ APPLIED.** H1, H1b, H2, H4, M5, L1.

**PR 3 — hygiene. ✅ APPLIED.** L2, L3, L4.

**H3 — ✅ APPLIED** (SDK `client_credentials` removed; see below).

Everything in this review is now fixed. Detail in the two tables below.

---

## PR 1 — what was applied (2026-07-28)

| # | Change | Files |
|---|---|---|
| M1 | Replaced the fictional `OAuth2ClientCredentials` scheme with `OAuth2AuthorizationCode`, copied verbatim from `/.well-known/oauth-authorization-server`. Deleted the `/auth/token` path; documented the real `/oauth/{register,token,revoke}`. Rewrote 14 operation-level security entries to `- OAuth2AuthorizationCode: [mcp:read]`. Replaced the 3 stale OAuth schemas with 5 accurate ones. | `OPENAPI_SPEC.yaml` |
| M2 | `/api/billing/top-up` does not exist. Fixed the docs **and the live 402 responses** — `top_up_url`, `_agent.top_up_url`, and the `X-Top-Up-URL` header all pointed at a 404 on every insufficient-balance reply. Now `${appUrl}/get-key`, per `balance/route.ts:110-112`. | `ERROR_SCHEMA.md`, `AUTHENTICATION_GUIDE.md`, `lib/agent/errors.ts`, `lib/agent/response-utils.ts` |
| M3 | `/openapi` → `/openapi.json`, `/api-docs` → `/api-reference` (the redirect target). Fixed in the generator, not the served output. | `lib/llms-txt.ts` |
| M1b | The dead `client_credentials` flow was documented in **five** places beyond the spec, three of them copy-pasteable. Replaced `AUTHENTICATION_GUIDE.md` "Mode 2" (212 lines that *recommended* the nonexistent flow) with the real authorization-code + PKCE flow; annotated the two `MIGRATION_V3.md` examples; struck the claims in the two historical records rather than rewriting them. | `AUTHENTICATION_GUIDE.md`, `MIGRATION_V3.md`, `V3_UPDATE_SUMMARY.md`, `RELEASE_NOTES.md` |
| M4 | Documented all 6 routes with real prices from `lib/agent/capabilities.ts`, `x-pricing` blocks matching house style, and non-JSON response content types for the two image endpoints. | `OPENAPI_SPEC.yaml` |
| — | Dropped `/auth/token` from the CLI coverage list — it was tracked as CLI-implemented but the CLI never called it. | `scripts/cli-openapi-check.mjs` |

**Scope note:** M2 turned out to be more than a docs fix. The dead URL was being
emitted at runtime in the paid-tier error path, so correcting it changes response
*values* (not shapes). That is still a contract fix — the old value was unreachable —
but it is the one item in PR 1 that touches served output.

`public/openapi.json` is gitignored and regenerated by `npm run build`, so the served
spec picks these up at deploy.

**Verification:** `npm test` 574 passed / 10 skipped · `tsc --noEmit` clean (after
installing the declared-but-absent `exceljs` per L4; `--no-save`, no manifest change) ·
`cli:openapi-check` OK, 94 paths · spec re-parsed with 0 dangling `$ref`s · both
generated JSON artifacts confirmed free of `/auth/token` and carrying `/oauth/token`.

Spec is OpenAPI **3.0.3**, where `nullable: true` is correct syntax — the file already
used it 394 times before this change, so the new entries match house style.

Each newly documented route was probed unauthenticated rather than assumed:

| Route | No-key result |
|---|---|
| `/metrics/{ticker}/snapshot.png` | 401 |
| `/snapshot/{entity_kind}` (png and pdf) | 401 |
| `/hedge-basket/{ticker}` | 401 |
| `/batch/latest-metrics` | 401 |
| `POST /v4/decompose` | 401 |
| `/funds/search` | **200** → became H4 |

**Caveats on this verification:** `npm test` covers the TypeScript suite only — it does
not run `sdk/tests/`, where the mocked `/auth/token` assertion behind H3 lives. No Python
was changed, so there is no regression, but that number is not SDK coverage. Separately,
`lib/agent/errors.ts:55` falls back to `https://riskmodels.net` when
`NEXT_PUBLIC_APP_URL` is unset, so under that fallback the corrected 402 now points at
`riskmodels.net/get-key` — the wrong property. Not a regression (the old value 404'd
either way), but the fix is only fully correct where the env var is set. Worth confirming
in prod, or changing the default to the `.app` origin.

---

## PR 2 + PR 3 — what was applied (2026-07-28)

| # | Change | Files |
|---|---|---|
| H1 | The EODHD safeguard now **degrades instead of failing open**. Added `lib/ratelimit/memory-fallback.ts`, a per-instance ceiling used when Upstash is unconfigured or throws, so a Redis outage bounds the surface rather than removing the control. Both fallback paths log a greppable `FAIL_OPEN` token (once per instance for the static "unconfigured" case, so the signal isn't buried in its own noise). | `lib/ratelimit/{memory-fallback,data-gateway-rate-limit}.ts` |
| H1b | `verifyGatewayAuth` → `resolveGatewayRole()`, which returns `'service' \| 'public'` instead of an unreachable `NextResponse`. Deleted the dead `const denied = …; if (denied) return denied;` guard from **24** route files and removed `requireGatewayAuth` (zero call sites). | `lib/gateway-auth.ts` + 24 `app/api/data/*` routes |
| H2 | **Deleted** `/api/pdf/{symbol}/latest`. Zero callers in this repo, `.net`, or `.org`; undocumented in the spec; superseded by the billed `/api/metrics/{ticker}/snapshot.pdf`. Deleting removes the latent bypass outright rather than gating a route nothing uses. | `app/api/pdf/` (removed) |
| H4 | Kept both discovery routes public — that is the clear design intent — but added per-IP throttles (`FUND_SEARCH_IP_RPM` / `FILER_SEARCH_IP_RPM`, default 60/min) and cut the public row cap from 500 → 100. Corrected both routes' doc comments, which claimed key auth they never had. | `app/api/funds/search`, `app/api/13f/filers/search` |
| H4b | **Found while fixing H4:** the `skipBilling` throttle response was hardcoded to a Shields.io badge payload at **HTTP 200**. Correct for the badge route, wrong for a JSON API — a throttled search caller would have seen a 200 that looks like an empty result. Added `publicRateLimitResponse: "json" \| "badge"`, defaulting to a real `429`; the badge route opts into the 200 shape explicitly. | `lib/agent/billing-middleware.ts`, `app/api/rankings/[ticker]/badge` |
| H3 | Removed `OAuthClientCredentialsAuth` from the SDK, plus the now-dead 401-retry branch in `transport.py` (which flattened a pointless `while True`) and the unused `DEFAULT_SCOPE`. `client_id`/`client_secret` and their env vars now raise immediately with instructions. **SDK 0.3.11 → 0.4.0** (breaking removal of a public symbol). Rewrote `tests/test_auth.py`: the old tests mocked `/auth/token` and asserted the SDK called it, so they passed while the feature was broken for every real user. | `sdk/riskmodels/{auth,transport,client}.py`, `sdk/tests/test_auth.py`, `sdk/pyproject.toml`, `sdk/README.md` |
| H4c | **Caught in review of this PR:** the throttle added for H4 fails open the same way H1 did — `getRatelimiter()` returns null when Upstash is unconfigured and `tryRatelimit()` swallows errors, so both public routes would have been unthrottled during a Redis outage *while the spec I had just written claimed a 60/min limit*. Routed the `skipBilling` public-throttle branch through the memory fallback so the documented limit stays true. 3 tests. | `lib/agent/billing-middleware.ts`, `tests/public-ip-rate-limit-degrades.test.ts` |
| M5 | Landing-chat throttle moved to Upstash so the cap is global, not `10/hr × live instances`. Kept the in-memory limiter as the **fallback** rather than replacing it — swapping outright would have left an unauthenticated LLM-spend endpoint with zero cap during a Redis outage. | `app/api/landing/chat/route.ts` |
| L1 | 18 sites across 16 routes no longer return raw `error.message`. Two `tickers/route.ts` catches had **no logging at all**, so genericising them alone would have destroyed the diagnostic — added `console.error` there before changing the response. | 16 `app/api/**` routes |
| L2 | Deleted the 14 zero-importer modules after re-verifying each. `lib/agent/middleware.ts` needed a second look: it appeared to have 4 references, all of which were prose in comments, and its `createAgentResponse` export is a name collision with a live function in `response-utils.ts`. | 14 files removed |
| L3 | Three byte-identical `_g()` copies replaced by `mapping.first_present()`, imported as `_g` so call sites are untouched. `mapping.py` already owns both key tables. | `sdk/riskmodels/{mapping,interpretation}.py`, `sdk/riskmodels/snapshots/{canonical,canonical_fund}.py` |
| — | `lib/agent/errors.ts` no longer falls back to `https://riskmodels.net` when `NEXT_PUBLIC_APP_URL` is unset — the 402 top-up URL now points at the correct property in every environment. | `lib/agent/errors.ts` |

### Verification

| Check | Result |
|---|---|
| `npm test` | 580 passed / 10 skipped (was 574 — 6 new degraded-mode tests) |
| `sdk` pytest (`sdk/.venv`, Python 3.12) | 503 passed / 3 skipped — same as baseline |
| `tsc --noEmit` | clean |
| `eslint app components lib` | clean |
| `npm run build` | succeeds; `/api/pdf` gone from the route table, 128 routes |
| `cli:openapi-check` | OK, 94 paths |
| `ruff` on touched SDK files | 30 errors, down from 32 at baseline — no new ones |

Note: the repo's system Python is 3.9, which cannot even collect the SDK suite (`X | Y`
annotations). Use `sdk/.venv/bin/python` (3.12) — plain `python3 -m pytest` reports 55
collection errors that are an interpreter artefact, not real failures.

### Deliberately not done

- **Wiring an actual alert** on the `FAIL_OPEN` token. There is no Sentry/Datadog/OTel
  dependency in this repo, so the honest fix was to make the condition greppable and
  leave the alerting decision to whoever owns the log drain. Building a monitoring stack
  is not a review fix.
- **Documenting `FUND_SEARCH_IP_RPM` / `FILER_SEARCH_IP_RPM` in `.env.example`.** That
  file documents no rate-limit knob today — not `DATA_GATEWAY_RPM`, not
  `RANKINGS_BADGE_IP_RPM` — and all of them are optional with working defaults. Adding
  only the two new ones would be inconsistent; documenting the set is a separate cleanup.
- **Auditing the remaining `skipBilling` routes** beyond the three public ones. The two
  Plaid routes (`link-token`, `exchange-public-token`) were checked and are safe — they
  call `authenticateOrRespond` inside the handler, which is the correct way to get
  "authenticated but free". Worth a standing rule: `skipBilling` means *public* unless
  the handler authenticates itself.
