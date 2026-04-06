# PeerGroupProxy Deployment Plan

> Cross-repo deployment of the PeerGroupProxy intermediary object and its integration into the snapshot suite. This plan covers RiskModels_API, BWMACRO, ERM3, and Risk_Models.

## Current State (2026-04-06)

| Item | Status | Location |
|:---|:---|:---|
| `PeerGroupProxy` + `PeerComparison` | ✅ Stub complete | `sdk/riskmodels/peer_group.py` (406 lines) |
| SDK `__init__.py` exports | ✅ Wired | `from riskmodels import PeerGroupProxy` works |
| `/api/tickers` → `subsector_etf` | ✅ Fixed | `app/api/tickers/route.ts` (3 locations patched) |
| `/api/metrics/{ticker}` → `subsector_etf` | ✅ Already works | Returns in `meta` object |
| `POST /api/batch/analyze` → `subsector_etf` | ✅ Already works | Returns in `meta` object |
| `alpha_forensic.py` prototype | ✅ Exists | `BWMACRO/src/funds_dag/reporting/alpha_forensic.py` |
| Consultant Navy palette in `styles.py` | ❌ Not yet | `sdk/riskmodels/visuals/styles.py` |
| Unit tests for `peer_group.py` | ❌ Not yet | `sdk/tests/` |
| WeasyPrint in SDK deps | ❌ Not declared | Only installed in BWMACRO venv |
| Snapshot renderers (S1–S4) | ❌ Not yet | Planning stage |

---

## Critical Path

```
Phase 0: Unblock            ✅ DONE
  ├─ Fix /api/tickers subsector_etf gap ✅
  └─ Wire SDK exports ✅

Phase 1: Foundation          ✅ DONE
  ├─ Add CONSULTANT_NAVY to styles.py ✅
  ├─ Add weasyprint to SDK optional deps [pdf] ✅
  ├─ Write peer_group unit tests (9 passing) ✅
  └─ _base_template.py shared Jinja2 HTML/CSS ✅

Phase 2: S1 Snapshot         ✅ DONE
  ├─ get_data_for_s1() in SDK ✅
  ├─ Jinja2 base template (Letter Landscape) ✅
  └─ render_s1_to_pdf() ✅

Phase 3: S2 + Refactor       ✅ DONE (2026-04-06)
  ├─ get_data_for_s2() + render_s2_to_pdf() ✅
  ├─ 3-panel layout: stacked ER area / HR time series / cumulative bar ✅
  ├─ Unit tests (19 passing) ✅
  └─ Wired into riskmodels.__init__ ✅
  NOTE: visuals/waterfall.py is Plotly-based (portfolio level).
        S2 uses Matplotlib for PDF consistency — intentional design decision.

Phase 4: S3/S4 Portfolio     [next]
  ├─ Mekko chart function → visuals/
  ├─ Rolling HR computation from returns panel
  ├─ get_data_for_s3() + render_s3_to_pdf()
  ├─ get_data_for_s4() + render_s4_to_pdf()
  └─ Combined 4-page snapshot option
```

---

## Phase 1: Foundation (detailed)

### 1A. Add Consultant Navy palette to `styles.py`

**File:** `sdk/riskmodels/visuals/styles.py`

Add alongside the existing `L3_MARKET`, `TERMINAL_*`, `GITHUB_*` palettes:

```python
# ---------------------------------------------------------------------------
# Consultant Navy (institutional PDF snapshots)
# ---------------------------------------------------------------------------
CONSULTANT_NAVY = {
    "primary":   "#002a5e",
    "secondary": "#006f8e",
    "slate":     "#2a7fbf",
    "alpha":     "#00AA00",
    "warning":   "#E07000",
    "gray":      "#888888",
    "light_bg":  "#f5f7fb",
}

PDF_LAYOUT = {
    "size": "letter landscape",
    "dpi": 300,
    "engine": "weasyprint",
    "chart_engine": "matplotlib",
}
```

**Why slate (#2a7fbf)?** The `alpha_forensic.py` prototype already uses this for subsector bars. Keeping it preserves visual continuity with the existing NVDA_Forensic.pdf output.

### 1B. Add WeasyPrint to SDK optional deps

**File:** `sdk/pyproject.toml`

Add a new `[pdf]` extra:

```toml
[project.optional-dependencies]
viz = ["plotly", "matplotlib", "seaborn", "kaleido"]
xarray = ["xarray>=2024.1"]
pdf = ["weasyprint>=60", "jinja2>=3.1"]
all = ["riskmodels-py[viz,xarray,pdf]"]
```

**Cross-repo note:** BWMACRO already has weasyprint installed in its venv but NOT declared in requirements. Add `weasyprint>=60` to BWMACRO's `requirements.txt` too.

### 1C. Unit tests for `peer_group.py`

**File:** `sdk/tests/test_peer_group.py`

Follow the pattern from `test_portfolio_math.py` — mock the client, don't hit the API:

```python
# Test cases needed:
# 1. from_ticker() with mocked client → correct subsector_etf filtering
# 2. from_ticker() subsector fallback → when subsector_etf is None, falls to sector_etf
# 3. _cap_weight_peers() with valid caps → correct weights
# 4. _cap_weight_peers() with < 3 caps → equal-weight fallback
# 5. compare() → selection_spread = target_res_er - peer_avg_res_er
# 6. as_positions() → correct format for analyze_portfolio()
# 7. to_dict() → serializable, all fields present
```

### 1D. End-to-end verification

Run against live API (integration test, marked `@pytest.mark.integration`):

```python
@pytest.mark.integration
def test_peer_group_nvda_live():
    client = RiskModelsClient()
    pg = PeerGroupProxy.from_ticker(client, "NVDA")
    assert pg.group_by == "subsector_etf"
    assert pg.n_peers >= 3
    assert "AMD" in pg.peer_tickers or "INTC" in pg.peer_tickers

    comparison = pg.compare(client)
    assert comparison.selection_spread is not None
    assert comparison.peer_avg_l3_residual_er is not None
```

---

## Phase 2: S1 Snapshot (detailed)

### Architecture

```
sdk/riskmodels/
  snapshots/
    __init__.py
    _base_template.py    # Shared Jinja2 HTML base (Consultant Navy)
    s1_forensic.py       # get_data_for_s1() + render_s1_to_pdf()
```

### get_data_for_s1()

```python
def get_data_for_s1(ticker: str, client: RiskModelsClient) -> S1Data:
    """Fetch everything needed for the Forensic Deep-Dive snapshot."""
    # 1. Target metrics
    metrics = client.get_metrics(ticker, as_dataframe=True)

    # 2. Peer context (the key innovation)
    proxy = PeerGroupProxy.from_ticker(client, ticker)
    comparison = proxy.compare(client)

    # 3. Macro correlation (optional enrichment)
    macro = client.get_metrics_with_macro_correlation(ticker)

    return S1Data(
        ticker=ticker,
        metrics=metrics.iloc[0].to_dict(),
        peer_comparison=comparison,
        macro_correlation=macro,
    )
```

### Relationship to alpha_forensic.py

The existing `alpha_forensic.py` in BWMACRO is a **prototype** that:
- Hardcodes raw httpx calls instead of using the SDK client
- Hardcodes Mag8 universe instead of using PeerGroupProxy
- Mixes fetch + render in `generate_alpha_forensic()`

**Migration path:** Don't rewrite alpha_forensic.py — it works and produces the reference PDF. Instead, build S1 in the SDK as the clean version, then gradually deprecate alpha_forensic.py once S1 matches or exceeds its output quality.

---

## Phase 3: S2 + Template Refactor

### Extract shared template base

The HTML/CSS in `alpha_forensic.py` lines 517–622 is the proven Consultant Navy template. Extract it into a shared Jinja2 base in the SDK:

```
_base_template.py:
  - @page { size: letter landscape; margin: 0.45in; }
  - Header with ticker, date, universe, CONFIDENTIAL badge
  - Metrics chip bar
  - Footer with ERM3 data contract attribution
  - Block slots for quadrant content
```

### S2 uses existing waterfall

`visuals/waterfall.py` already has variance waterfall logic. The S2 snapshot wraps it:
1. Retheme to Consultant Navy (import palette from `styles.py`)
2. `get_data_for_s2()` calls `client.batch_analyze([ticker], ["returns", "full_metrics"], years=3)`
3. `render_s2_to_pdf()` embeds the rethemed waterfall chart into the base template

---

## Cross-Repo Responsibilities

| Repo | Role | Changes Needed |
|:---|:---|:---|
| **RiskModels_API** | SDK + API layer | peer_group.py (done), tickers endpoint (done), snapshots/ module (Phase 2+), styles.py palette (Phase 1) |
| **BWMACRO** | Orchestration + prototype | Add weasyprint to requirements.txt, deprecate alpha_forensic.py after SDK S1 matches quality |
| **Risk_Models** | Schema source of truth | Ensure `subsector_etf` populated in `symbols` table for full universe (verify coverage) |
| **ERM3** | Factor model engine | No changes needed — data already flows through `security_history` |

### Data flow for snapshot generation:

```
ERM3 engine (Zarr)
  → sync_erm3_to_supabase_v3.py (Risk_Models)
    → security_history, symbols tables (Supabase)
      → /api/metrics/{ticker}, /api/batch/analyze (RiskModels_API)
        → RiskModelsClient (SDK)
          → PeerGroupProxy.from_ticker() + .compare()
            → get_data_for_sN()
              → render_sN_to_pdf()
```

### subsector_etf coverage check

Before Phase 1 is complete, verify that `subsector_etf` is populated for the working universe:

```sql
-- Run against Supabase
SELECT
  COUNT(*) as total,
  COUNT(subsector_etf) as has_subsector,
  COUNT(*) - COUNT(subsector_etf) as missing_subsector
FROM symbols
WHERE asset_type = 'stock';
```

If coverage is low, the `Risk_Models` pipeline may need a backfill from the `sector-etf-mapper.ts` mapping table (which has extensive subsector→ETF mappings).

---

## Risk Register

| Risk | Impact | Mitigation |
|:---|:---|:---|
| `subsector_etf` NULL for many symbols | PeerGroupProxy falls back to sector_etf (too broad) | Run coverage query, backfill from sector-etf-mapper.ts |
| WeasyPrint rendering differences across envs | PDF layout breaks | Pin weasyprint>=60, test on CI |
| Too many peers in subsector → slow cap-weighting | N×API calls for GET /metrics per peer | Add batch endpoint for market_cap, or cache in security_history_latest |
| API rate limits on peer resolution | from_ticker() makes N+2 API calls | Add client-side caching, consider `/api/data/symbols/batch` for peer discovery |

---

## Immediate Next Actions (for next session)

1. **Add CONSULTANT_NAVY + PDF_LAYOUT to `styles.py`**
2. **Add `[pdf]` extra to `sdk/pyproject.toml`**
3. **Write `sdk/tests/test_peer_group.py`** (7 test cases above)
4. **Run integration test:** `PeerGroupProxy.from_ticker(client, "NVDA")` live
5. **Run subsector coverage SQL** against Supabase
