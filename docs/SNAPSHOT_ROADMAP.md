# Snapshot Roadmap: Institutional PDF Suite

> Working document for the snapshot system. Updated 2026-04-07.
>
> **Naming:** The original S1–S4 grid has been superseded by a 2×4 matrix:
> Risk (R1–R4) and Performance (P1–P4). S1 and S2 remain as shipped legacy
> implementations; R1/R2 will rebuild them on the new SnapshotPage engine.

## Status

| ID | Name | Status | Script | Notes |
|:---|:---|:---|:---|:---|
| S1 | Forensic Deep-Dive (Current × Stock) | **✅ Shipped** | `snapshots/s1_forensic.py` | Full get_data + render + JSON serialization |
| S2 | Attribution Waterfall (History × Stock) | **✅ Shipped** | `snapshots/s2_waterfall.py` | Full get_data + render + JSON serialization |
| -- | **JSON-First Pipeline** | **✅ Shipped** | `snapshots/_json_io.py` | `to_json()` / `from_json()` + CLI `fetch` / `render` |
| -- | **Design System (Phase A)** | **✅ Shipped** | `snapshots/_theme.py` | THEME, Palette, Typography, Layout, Strokes |
| -- | **Chart Primitives (Phase A)** | **✅ Shipped** | `snapshots/_charts.py` | 9 reusable chart functions |
| -- | **Layout Engine (Phase A)** | **✅ Shipped** | `snapshots/_page.py` | SnapshotPage — GridSpec-based, pure Matplotlib |
| -- | **Data Layer** | **✅ Shipped** | `snapshots/_data.py` | StockContext, fetch_stock_context, return helpers |
| -- | **PeerGroupProxy** | **✅ Shipped** | `peer_group.py` | Stock → synthetic peer portfolio bridge |
| R1 | Factor Risk Profile (Current × Stock) | **✅ Shipped** | `snapshots/r1_risk_profile.py` | Pure Matplotlib, 20×12 grid, peer table + AI narrative |
| -- | **Iterative Refinement CLI** | **✅ Shipped** | `snapshots/refine.py` | Hot-reload + re-render loop (~0.1s), JSON cache, version log |
| R2 | Risk Attribution Drift (History × Stock) | Planned | — | Rebuild S2 on SnapshotPage + narrative |
| R3 | Concentration Mekko (Current × Portfolio) | Planned | — | Needs portfolio-mode batch analyze |
| R4 | Style Drift (History × Portfolio) | Planned | — | Heaviest data lift |
| P1 | Return & Relative Performance (Current × Stock) | Planned | — | Uses fetch_stock_context |
| P2 | Cumulative Performance (History × Stock) | Planned | — | All helpers exist in _data.py |
| P3 | Return Contribution (Current × Portfolio) | Planned | — | Waterfall + hit-rate donut |
| P4 | Portfolio vs Benchmark (History × Portfolio) | Planned | — | Active return + rolling IR |

---

## Architecture: JSON-First Snapshot Pipeline

Every snapshot follows a 3-step pipeline with a JSON handshake point:

```
fetch(ticker, client)  →  {TICKER}_r1.json  →  render(json)  →  PDF
     [needs API]            [handshake]          [offline]
```

**Why:** The JSON file is a self-contained artifact. An agent (Sonnet, Cursor)
can iterate on chart layouts by consuming only the JSON + render code — zero API
keys, zero Supabase context, sub-second feedback loops.

**Content map:** See `docs/SNAPSHOT_CONTENT_MAP.md` for the full 8-page spec
with wireframes, JSON schemas, and AI narrative templates.

**CLI (per-page):**
```bash
python -m riskmodels.snapshots.r1_risk_profile fetch NVDA -o nvda_r1.json
python -m riskmodels.snapshots.r1_risk_profile render nvda_r1.json -o NVDA_R1.pdf
python -m riskmodels.snapshots.r1_risk_profile run NVDA -o NVDA_R1.pdf --json nvda_r1.json
```

**Iterative refinement CLI:**
```bash
# First run fetches from API and caches JSON; subsequent runs use cache (~0.1s renders)
python -m riskmodels.snapshots.refine NVDA --page r1

# One-shot with inline prompt:
python -m riskmodels.snapshots.refine NVDA -p "thinner bars, larger table font" --once

# Force re-fetch from API:
python -m riskmodels.snapshots.refine NVDA --refetch
```

---

## ADR-001: PeerGroupProxy lives in the SDK, not BWMACRO

**Decision:** `sdk/riskmodels/peer_group.py` (RiskModels_API repo).

**Context:** Gemini proposed `BWMACRO/src/funds_dag/reporting/peers.py`. After auditing all four repos:

| Factor | BWMACRO | RiskModels_API SDK |
|:---|:---|:---|
| Portfolio aggregation | None | `portfolio_math.py` (exact pattern) |
| Cap-weighting | None | `_mag7.py` (exact pattern) |
| Sector filtering | None | `client.get_ticker_rankings(cohort="sector")` |
| `analyze_portfolio()` | None | Already wired: batch → weighted HR/ER |
| WeasyPrint/Matplotlib | Not installed | Target rendering layer |

BWMACRO is a **Dagster pipeline repo** for ETF_Hedges SaaS — wrong dependency graph. The SDK already has every building block. PeerGroupProxy is a client-side construction that queries the API, not a pipeline job.

**Consequences:**
- PeerGroupProxy reuses `analyze_portfolio()` for weighted aggregation (no new math)
- Snapshots can run from any Python env with `pip install riskmodels`
- BWMACRO orchestrates *when* snapshots run (Dagster); the SDK defines *what* they compute

---

## ADR-002: Fetch/Render Separation

**Decision:** Every snapshot has two clearly separated functions.

```
get_data_for_XX(ticker_or_portfolio, client) → dataclass
render_XX_to_pdf(data, output_path)          → Path
```

**Why:** When the Supabase schema evolves (it does frequently — see migration count), only `get_data` changes. The complex chart layouts in `render` stay untouched. The JSON file is the boundary between them.

**Implementation:** The `PeerComparison` dataclass and `StockContext` dataclass are the canonical boundary objects. Both support `to_json()` / `from_json()`.

---

## ADR-003: JSON-First Architecture (adopted 2026-04-07)

**Decision:** Every snapshot serializes its data contract to a JSON intermediate file before rendering.

**Why:**
1. Creates a "handshake" point — agents iterate on charts without API access
2. Enables golden-file testing (version-control the JSON, diff chart regressions)
3. Separates slow fetch (~10s, N API calls) from fast render (<1s, pure Matplotlib)
4. Each JSON includes an AI narrative string — the "so what" paragraph

**Implementation:** `_json_io.py` provides `dump_json()` / `load_json()`. Each data
contract (`S1Data`, `S2Data`, future `R1Data`, etc.) has `to_json()` / `from_json()` classmethods.

---

## Global Design Standards (Consultant Navy)

```python
PALETTE = {
    "primary":   "#002a5e",  # Navy — titles, headers, borders
    "secondary": "#006f8e",  # Teal — secondary charts, annotations
    "alpha":     "#00AA00",  # Green — positive returns, alpha signals
    "warning":   "#E07000",  # Orange — negative returns, risk warnings
}
PDF_LAYOUT = {
    "size": "Letter Landscape",  # 11 × 8.5 in
    "dpi": 300,
    "engine": "Matplotlib + SnapshotPage (GridSpec)",
    "chart_engine": "Matplotlib",
}
```

All constants live in `_theme.py` (THEME singleton). Charts import from `_charts.py`.

## Identity Convention

| Context | Use | Example |
|:---|:---|:---|
| Internal keys, DB joins, API params | `symbol` (FactSet ID) | `NVDA-US` |
| Chart labels, PDF titles, legends | `ticker` | `NVDA` |
| Peer resolution | `subsector_etf` from `symbols` table (default) | `SMH` |

---

## Implementation Phases

```
Phase 0 (done):  Fix /api/tickers subsector gap, wire SDK exports
Phase 1 (done):  Consultant Navy palette, design system, chart primitives, layout engine
Phase 2 (done):  S1 Forensic + S2 Waterfall (end-to-end get_data + render)
Phase 3 (done):  JSON-first pipeline (_json_io, to_json/from_json, CLI fetch/render)
Phase 4 (done):  Content map for all 8 pages (docs/SNAPSHOT_CONTENT_MAP.md)

Phase 5 (done):  R1 — Factor Risk Profile
                   - Built on SnapshotPage (pure Matplotlib, no WeasyPrint) ✅
                   - StockContext + PeerGroupProxy.compare() → R1Data ✅
                   - AI narrative block (3 sentences: peer context, dominant driver, vol frame) ✅
                   - Proves the new rendering architecture end-to-end ✅
                   - PeerGroupProxy rewritten to query Supabase ticker_metadata directly ✅
                   - Iterative refinement CLI: refine.py (hot-reload, JSON cache, ~0.1s renders) ✅
                   - Architecture doc: docs/SNAPSHOT_FRONTEND_ARCH.md ✅

Phase 6 (next):  P1 + P2 — easiest performance pages
                   - P1 uses fetch_stock_context → trailing_returns + relative_returns
                   - P2 uses cumulative_returns + max_drawdown_series + rolling_sharpe
                   - All helper functions already exist in _data.py

Phase 7:         R2 — Risk Attribution Drift (S2 rebuilt on SnapshotPage)

Phase 8:         R3 + P3 — portfolio pages (need batch/portfolio mode)
                   - Run subsector_etf coverage SQL first
                   - May need batch market_cap endpoint for cap-weighting at scale

Phase 9:         R4 + P4 — portfolio history (heaviest data lift)
```

---

## Known Risks / Blockers

- `subsector_etf` coverage: 2,812/3,729 tickers (75%) populated in `ticker_metadata`. The 877 missing are OTC/foreign stubs (F-suffix). 40 XLY tickers missing subsector — only real gap to backfill.
- Cap-weighting now uses `ticker_metadata.market_cap` in a single query — the N+1 API problem is **resolved**.
- Architecture fork: S1/S2 use WeasyPrint HTML pipeline; R-series uses pure Matplotlib via SnapshotPage. **R1 proved the pure approach works.**
- alpha_forensic.py (BWMACRO) uses raw httpx, not SDK client → deprecate after R1 matches quality

---

## Agent Workflow

**Opus 4.6** handles:
- Architecture decisions (ADRs)
- Planning updates (this file)
- Content map / JSON schema design
- Cross-repo coordination

**Sonnet 4.6** handles:
- Module implementation (get_data + render functions)
- Chart styling and Matplotlib code
- Template iteration (hand it JSON + render code, nothing else)
- Test writing

**Rule:** The JSON file is the boundary between agents. Opus designs the schema, Sonnet implements the renderer. Neither needs the other's context.

---

*Last updated: 2026-04-07*
