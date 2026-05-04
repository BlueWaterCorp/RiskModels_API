# Funds API Build Status

> Working document for the funds-side API surface. Pairs with
> `Funds_DAG/docs/ARCHITECTURE_FUNDS_API.md` (the canonical design doc,
> sibling repo) which defines Stages A–F. This file tracks what's
> actually shipped vs planned in *this* repo.
>
> Last updated: 2026-05-04.

## Status

| Stage | Endpoint(s) | Status | PRs | Notes |
|:---|:---|:---|:---|:---|
| **A** | `GET /api/data/funds/{bw_fund_id}` | **✅ Shipped** | #22 | Data plane (raw shape) — public, free, soft Bearer auth |
| A | `POST /api/data/funds/batch` | **✅ Shipped** | #22 | ≤1000 ids per call |
| A | `GET /api/data/funds/search` | **✅ Shipped** | #22 | q + style + primary filters |
| A | `GET /api/data/funds/style/{slug}/members` | **✅ Shipped** | #22 | fund_ids in a 9-box cell |
| A | `GET /api/data/funds-latest/{bw_fund_id}` | **✅ Shipped** | #22 | just the funds_latest row |
| **B.1** | `GET /api/funds/{bw_fund_id}` | **✅ Shipped** | #23 | Latest metrics, $0.005 |
| **B.2.a** | `GET /api/funds/{bw_fund_id}/portfolio` | **✅ Shipped** | #23 | Per-fund time series from `ds_portfolio.zarr`, $0.005 |
| **B.2.b** | `GET /api/funds/{bw_fund_id}/holdings` | **✅ Shipped** | #23 | Top-N from `ds_ph.zarr`, $0.005 |
| **B.2.c** | `GET /api/funds/{bw_fund_id}/hedge` | **✅ Shipped** | #23 | L1/L2/L3 from `ds_hr.zarr`, $0.005 |
| **C.0** | `GET /api/funds/style/{slug}` | **✅ Shipped** | #24 | Latest cohort metrics (EW + MV), $0.005 |
| **C.1** | `GET /api/funds/style/{slug}/rankings/{cohort_type}` | **✅ Shipped** | #24 | Top-N rankings, $0.005 |
| **C.2** | `GET /api/funds/style/{slug}/portfolio` | **✅ Shipped** | #26 | Per-cell time series from Slice 6 zarr, $0.005 |
| **C.3** | `GET /api/funds/style/{slug}/holdings` | **✅ Shipped** | #26 | Top-N cohort holdings from Slice 5b zarr, $0.005 |
| **D.1** | `GET /api/funds/snapshot/{bw_fund_id}` | **✅ Shipped** | #28 | Composed JSON tearsheet, $0.01 |
| D.1 | `GET /api/funds/style/{slug}/snapshot` | **✅ Shipped** | #28 | Composed cohort JSON, $0.005 — the differentiated wedge |
| **B.2.d** | `GET /api/funds/{bw_fund_id}/nav` | **✅ Shipped** | RiskModels_API #31 | Per-fund yfinance NAV time series from `ds_nav.zarr`, $0.005. Pairs with `/portfolio` — the gap surfaces intra-quarter trading + fees not in 13F. |
| B.2.d | `nav_history` block on `D.1` snapshot response | **✅ Shipped** | RiskModels_API #32 | Optional 12-month NAV rows on the composed fund snapshot |
| B.2.d | OpenAPI: `/nav` + `nav_history` schema | **✅ Shipped** | RiskModels_API #33, Risk_Models #35 (mirror) | Cross-repo mirror landed |
| B.2.d | Funds_DAG `fund_nav_zarr` v3 asset | **✅ Shipped** | Funds_DAG #2, #3 (yfinance MultiIndex hotfix) | Per-fund `ds_nav.zarr` keyed by `bw_fund_id` (replaces step_1b's factset-keyed multi-fund zarr at the API surface) |
| **D.2.a** | F1 fund tearsheet HTML template (Playwright route) | **✅ Shipped** | RiskModels_API #34 | Letter landscape, pure SVG. 4 zones: identity rail, AI summary, I. Cumulative Returns (line + waterfall, with NAV overlay), II. Cohort Rank Card, III. Top Holdings. `app/(print)/render-snapshot/funds/[bw_fund_id]/page.tsx` |
| **D.2.b** | `GET /api/funds/snapshot.pdf/{bw_fund_id}` | Planned | — | Wires the D.2.a template into Playwright PDF render. Mirrors `app/api/metrics/[ticker]/snapshot.pdf/route.ts`. Capability `fund-snapshot-pdf` @ $0.25, content-keyed Redis cache on `(bw_fund_id, report_date)`. |
| **D.2.c** | C1 cohort tearsheet HTML template | Planned | — | Sibling of D.2.a for the 9-box cell. EW vs MV cumulative + 4 zones (identity rail, top holdings in cell, top performing funds, top symbols concentration). |
| **D.2.d** | `GET /api/funds/style/{slug}/snapshot.pdf` | Planned | — | C1 PDF route. Capability `style-cohort-snapshot-pdf` @ $0.10. |
| **D.2.e** | OpenAPI for both PDF endpoints + mirror PR | Planned | — | Closes Stage D.2. |
| **D.3** | SDK `riskmodels.snapshots.f1_fund_tearsheet` | Planned | — | Public Python renderer (mirrors `r1_risk_profile.py`) |
| D.3 | SDK `riskmodels.snapshots.c1_cohort_report` | Planned | — | Public Python cohort renderer |
| **E** | AOM extensions: `subject:fund:*`, `subject:style:*` | Planned | — | New public intent presets (`compare_to_cohort`, `analyze_fund_attribution`, `screen_fund_universe`, `decompose_cohort_return`) |
| E | MCP tool registrations | Planned | — | `post_fund_snapshot`, `post_cohort_snapshot` |
| E | SDK `funds.py` (TypeScript + Python) | Planned | — | Convenience wrappers around primitives + snapshots |
| **F** | `GET /api/13f/filers/{bw_filer_id}` + family | Planned | — | Mirrors funds; depends on Funds_DAG Slice 13c+ filer panels |

## Cross-repo mirror convention

`mcp/data/openapi.json` is canonical here. **Every** PR that touches
`OPENAPI_SPEC.yaml` requires a paired byte-for-byte copy on
`Risk_Models/riskmodels_com/mcp-server/data/openapi.json`. The
`detect-drift` CI workflow blocks the RiskModels_API PR until the
mirror is on Risk_Models main.

Convention used so far:

```
1. RiskModels_API: feat/<branch> with code + spec changes
2. Risk_Models:   mirror/<branch>-openapi  with just openapi.json
3. CI on RiskModels_API blocks on detect-drift until step 2 merges
4. Re-run detect-drift after step 2's merge → step 1 can merge
```

Mirror PRs landed during the funds build: #27 (A), #28 (B.1+B.2.a),
#30 (B.2.b+B.2.c), #31 (C.0+C.1), #32 (C.2+C.3), #33 (D.1), #35 (B.2.d).

If `mcp/data/schemas/*.json` changes too, those must be mirrored
similarly. See `BWMACRO/docs/AGENTS_CROSS_REPO.md` §1–3.

## Known cross-repo CI hazards (history)

The Risk_Models e2e job blocks mirror PRs and has had pre-existing
flakes during this build. Failures observed:

- `redirects.spec.ts:11` — `/cli` redirects to `/installation`, not
  `/quickstart`, after the CLI install rename on RiskModels_API
  (#21–22 era). **Fixed in Risk_Models#29** (the `/cli` regex was
  updated and the broken signup tests were `test.skip()`'d with
  TODOs).
- `auth.spec.ts:81/93/106` and `forms.spec.ts:91/137` — five Signup
  form tests timing out at 30s on `locator.click`. Suspected DOM /
  modal restructure from the landing-attribution rollout. Skipped
  with TODOs in #29; needs a live signup-page selector audit before
  re-enable.

Future mirror PRs should expect these to stay skipped until someone
audits the live signup page.

## Effort estimates for remaining stages

These are agent-time estimates assuming the same fixture-driven,
PR-per-slice cadence used for A–D.1.

| Stage | Effort | Notes |
|:---|:---|:---|
| D.2.b–e | 2–3 hours | F1 PDF route (~30 min — straight clone of `metrics/[ticker]/snapshot.pdf/route.ts` pointed at the new template), C1 cohort template (~1 h, mirrors D.2.a layout for the per-cell view), C1 PDF route (~30 min), OpenAPI + mirror (~30 min). D.2.a (the heavy template work) already shipped. |
| D.3 | 6–8 hours | SDK Python F1 + C1 (~600 LOC each), Plotly compositions, fetch/render separation, tests using cached JSON, new pip release. The "differentiated wedge" cohort tearsheet visual is the meatiest part. |
| E | 4–5 hours | AOM `subject` extensions, 4 new public intent presets, MCP tool registrations, TS/Python SDK convenience wrappers. Mostly mechanical; the AOM compiler already handles new subject types. |
| F | 6–8 hours | 13F endpoints. Mirrors funds with `bw_filer_id` instead of `bw_fund_id`. **Blocked on Funds_DAG Slice 13c+** materializing filer panels (registry exists; per-filer ds_portfolio + ds_ph + rankings still pending per Funds_DAG main). |

Total to reach feature-complete public funds API + 13F: **~18–24 hours
of focused work** remaining (B.2.d + D.2.a complete), naturally splitting
across 3–5 sessions.

## Pickup recipe for the next session

1. Read `Funds_DAG/docs/ARCHITECTURE_FUNDS_API.md` §6 (public/private
   boundary) and §7.2 (Stage list).
2. Read this file's status table to confirm what's on `main`.
3. **Before D.2.b can ship**: Funds_DAG zarr v2 GCS sync needs to
   resume. See `Funds_DAG/docs/ZARR_V2_MIGRATION_RESUME.md` — the local
   v2 universe is materialized but the GCS push was paused for
   correctness verification. Production is unaffected (existing 86-fund
   GCS baseline still serves), but new funds (incl. FCNTX sample target)
   need their zarrs pushed before the API can render snapshots for them.
4. For Stage D.2.b–e: D.2.a's template already mounts at
   `/render-snapshot/funds/[bw_fund_id]`. The new D.2.b route is a clone
   of `app/api/metrics/[ticker]/snapshot.pdf/route.ts` with the path
   swapped — `lib/portfolio/playwright-pdf-worker.ts` is the worker. Do
   D.2.c (cohort template) before D.2.d (cohort PDF route).
5. For Stage D.3: mirror `sdk/riskmodels/snapshots/r1_risk_profile.py`
   one-to-one. Both R1 and the new F1 follow the same fetch/render
   separation + JSON handshake pattern.
6. Real fixtures for tests live at `tests/fixtures/funds/*.json` —
   extend with a 13F sample when Stage F starts.

## Cross-cutting work parked elsewhere

- **`Funds_DAG/docs/ZARR_V2_MIGRATION_RESUME.md`** — local v2 zarr
  universe is materialized; GCS sync paused mid-flight pending
  correctness verification. Read top-to-bottom on resume; sequenced
  6-step checklist. Blocks D.2 sample renders for funds outside the
  86-fund GCS baseline.
- **`BWMACRO/docs/ceo/FUNDS_DAG_CLEANUP_QUEUE.md`** — low-priority
  retire-legacy-`step_*.py` queue. Surfaces in `/gstack-plan-ceo-review`.
  Frees ~3.7 GB of legacy zarr data on ext_2t once both PRs land.

## Constraints to remember (lessons from A–D.1)

- **No synthetic test data when real fixtures exist** — pull from
  `Funds_DAG/data/sync/funds/*.json`.
- **No absolute home-directory paths in committed files** — the
  `Public safety audit` CI step greps the working tree for the literal
  substring `/Users` (and the Windows equivalent) and fails on a hit.
  Reference paths relative to repo root or by repo name only — even in
  comments and docs.
- **`app/api/data/...` route files require `git add -f`** — the
  `data/` glob in `.gitignore:100` (intended for Zarr stores) catches
  them. Existing `app/api/data/symbols/*` follows this pattern too.
- **Bitemporal headers** — every endpoint returning a `funds_latest`
  row must set `X-Data-As-Of` (= `report_date`) and `X-Data-Filing-Date`
  (= `filing_date`). Per arch doc §3.5.
- **No `?as_of=` / `?mode=` query params yet** — deferred to v2 even
  though the columns exist.
- **Sync writer behavior** — Slice 11b reads zarrs ~6 min then bursts
  upserts ~25s; mid-sync polls look stuck but aren't. The
  `funds_sync_state_v1` row is stamped *after* the burst, so it's
  authoritative.
