# RiskModels API — Agent Instructions

## Claude Code quick path

Before adding SDK methods, HTTP clients, or MCP tools: run the **RiskModels API discovery** workflow — [`.cursor/skills/riskmodels-api-discovery/SKILL.md`](.cursor/skills/riskmodels-api-discovery/SKILL.md) (MCP resources `riskmodels:///capabilities`, `riskmodels:///schemas/list`, `riskmodels:///openapi` when the server is connected; else [OPENAPI_SPEC.yaml](./OPENAPI_SPEC.yaml) and [mcp/data/openapi.json](./mcp/data/openapi.json)).

| Doc | Use |
|-----|-----|
| [OPENAPI_SPEC.yaml](./OPENAPI_SPEC.yaml) | REST contract |
| [SEMANTIC_ALIASES.md](./SEMANTIC_ALIASES.md) | Metric names, batch column semantics |
| [docs/ERM3_ZARR_API_PARITY.md](./docs/ERM3_ZARR_API_PARITY.md) | Zarr vs API field parity |
| [SUPABASE_TABLES.md](./SUPABASE_TABLES.md) | DB tables used by DAL / SDK |
| [.cursor/skills/risk-judgment-shape/SKILL.md](./.cursor/skills/risk-judgment-shape/SKILL.md) | Interpretation boundary — qualifier wording lives in BWMACRO, not here |

**Cross-repo edits** (schemas, `schema-paths.json`, MCP copies, `current_state.md`): do not duplicate the checklist here — use **[docs/AGENTS_CROSS_REPO.md](./docs/AGENTS_CROSS_REPO.md)** (synced from BWMACRO). End-user / analyst-facing pointers stay in [AGENTS.md](./AGENTS.md).

---

## Project Identity
This is the **RiskModels API** — a Next.js + Supabase platform serving institutional equity risk analytics. The Python SDK (`sdk/riskmodels/`) provides the programmatic client, snapshot PDF pipeline, and visualization layer.

## Snapshot Suite (Primary Focus)
We are building an **Institutional PDF Snapshot Suite** — eight 1-page reports across a 2×4 matrix: Risk (R1–R4) × Performance (P1–P4).

### The R/P Matrix
| ID | Combo | Deliverable | Status |
|:---|:---|:---|:---|
| **R1** | Current × Stock | Factor Risk Profile | **✅ Shipped** |
| **R2** | History × Stock | Risk Attribution Drift | Planned |
| **R3** | Current × Portfolio | Concentration Mekko | Planned |
| **R4** | History × Portfolio | Style Drift | Planned |
| **P1** | Current × Stock | Return & Relative Perf | Planned (helpers ready) |
| **P2** | History × Stock | Cumulative Performance | Planned (helpers ready) |
| **P3** | Current × Portfolio | Return Contribution | Planned |
| **P4** | History × Portfolio | Portfolio vs Benchmark | Planned |

Legacy S1 (Forensic) and S2 (Waterfall) are shipped but use the older WeasyPrint pipeline.

### Rendering Architecture (Pure Matplotlib)
All R/P snapshots use the pure-Matplotlib pipeline — no WeasyPrint, no HTML. See `docs/SNAPSHOT_FRONTEND_ARCH.md`.

```
fetch_stock_context(ticker, client) → StockContext
PeerGroupProxy.from_ticker(client, ticker) → PeerGroupProxy
  ↓
get_data_for_XX(ticker, client) → XXData dataclass
  ↓ .to_json()
{TICKER}_XX_cache.json           ← JSON handshake point
  ↓ .from_json()
render_XX_to_pdf(data, path) → PDF   (< 0.3s, no API calls)
```

**Iterative refinement:** `python -m riskmodels.snapshots.refine NVDA` — caches JSON, hot-reloads modules, re-renders in ~0.1s per iteration.

### Design Standards (Consultant Navy)
All constants in `_theme.py` (THEME singleton). Never hardcode colors.
```python
PALETTE = {
    "navy":    "#002a5e",  # Headers, primary
    "teal":    "#006f8e",  # Sector, secondary
    "slate":   "#2a7fbf",  # Subsector, tertiary
    "green":   "#00AA00",  # Positive / residual
    "orange":  "#E07000",  # Negative / warning
}
LAYOUT = "Letter Landscape (11×8.5in), 300 DPI"
ENGINE = "Pure Matplotlib — SnapshotPage (GridSpec 20×12)"
FONT = "Inter (fallback: Liberation Sans → DejaVu → Arial)"
```

### Chart Primitives (`_charts.py`)
9 reusable functions: `chart_hbar`, `chart_grouped_vbar`, `chart_table`, `chart_stacked_area`, `chart_multi_line`, `chart_waterfall`, `chart_heatmap`, `chart_histogram`, `chart_bullet`. All use FancyBboxPatch rounded bars with subtle shadows.

The P1/DD waterfall uses **geometric (sequential compounding) attribution** — bars are telescoping differences between cumulative products at each ERM3 hierarchy level, summing exactly to compound gross. See `ENGINE_METHOD_NOTES.md` §6.

### Identity Rules
- **`symbol`** (internal BW symbol) = internal join key. Never expose to users.
- **`ticker`** = human-facing label on charts, axes, legends, PDF titles.
- Resolution: `resolveSymbolByTicker()` in `lib/dal/risk-engine-v3.ts`.

## PeerGroupProxy (Intermediary Object)
**Location:** `sdk/riskmodels/peer_group.py`

Bridges a single stock to a synthetic portfolio of its **subsector** peers. Today it reads the frozen Supabase `ticker_metadata` table (last_teo 2026-01-21, pre-ERM3-41 taxonomy) via `client.get_ticker_metadata()`; PRs #500/#506 move it to `symbols`. Do not use `ticker_metadata` for cohorts in new work — use `symbols.sector_etf/subsector_etf` or the cohort zarr (`ds_erm3_cohorts_*`).

```python
from riskmodels.peer_group import PeerGroupProxy

pg = PeerGroupProxy.from_ticker(client, "NVDA")  # → SOXX subsector peers
comparison = pg.compare(client)                    # → PeerComparison
comparison.selection_spread                        # → target - peer avg residual ER
```

**Key details:**
- `from_ticker()` resolves the target's subsector_etf and peers. Source of truth for sector/subsector labels is `symbols` (nightly), mirrored from `security_master`; `ticker_metadata` is frozen and being retired. `sector_etf_override` is fallback only.
- Falls back from subsector_etf → sector_etf if too few peers.
- Vol derived from `stock_var` when `vol_23d` unavailable: `sqrt(stock_var × 252)`.
- `compare()` calls `analyze_portfolio()` on peers → `PeerComparison` dataclass (the fetch/render boundary).

## Metric Key Mapping
The API returns abbreviated metric keys (`l3_mkt_hr`, `l3_res_er`, `l3_sec_hr`) but some code paths expect full names (`l3_market_hr`, `l3_residual_er`, `l3_sector_hr`). Use the `_g(full, abbr)` helper pattern:
```python
def _g(full: str, abbr: str) -> Any:
    return m.get(full) if m.get(full) is not None else m.get(abbr)
```

## Fetch/Render Rule
Every snapshot has two clearly separated functions:
```python
get_data_for_XX(ticker, client) → dataclass   # calls API + PeerGroupProxy
render_XX_to_pdf(data, path)    → Path         # pure Matplotlib, no network
```
When the Supabase schema changes, only `get_data` is touched. Renderers stay stable. The JSON file is the boundary between them.

## Data Contract (V3)
- **`ticker_metadata`** — STALE: FROZEN 2026-01-21, 877 rows with no sector, old taxonomy. Do not read. Being retired (ERM3 taxonomy spec §8.5; SDK migration in PRs #500/#506).
- **`symbols`** — identity registry and the authoritative sector/subsector labels (symbol PK, ticker, name, sector_etf, subsector_etf); nightly sync.
- **`security_history`** — STALE: FROZEN 2026-04-14 (~204M rows); all history is served from zarr (`lib/dal/zarr-reader.ts`). Do not read.
- **`security_history_latest`** — materialized latest metrics per symbol
- **`erm3_landing_chart_cache`** — STALE: empty (0 rows) since 2026-04; do not read.
- **`macro_factors`** — daily macro factor returns
- **`security_master`** (mirror), **`security_aliases`**, **`security_events`**, **`security_name_history`**, **`class_projections_current`** — live identity tables, nightly. Ticker history (e.g. FB→META) resolves through these.
- STALE, do not use: `ticker_change_history` (1 row), `ticker_history` (0 rows), `etf_metadata` (frozen 2026-03-28; ETFs come from `ds_etf.zarr` / `lib/dal/etf-register.ts`).
- Zarr stores in `gs://rm_api_data/eodhd/` are the source for all history: `ds_daily` (incl. `bw_sector_id` / `bw_industry_id`), `ds_erm3_cohorts_*`, `ds_market_cap`, `ds_masks`, `ds_erm3_hedge_weights_*`, `ds_erm3_returns_*`, `ds_rankings_*`.

See `SUPABASE_TABLES.md` for full schema. Writers: the ERM3 nightly sync (`ERM3/scripts/python/lib/supabase_schema_v3.py`); sync state in `erm3_sync_state_v4`; DDL in `BWMACRO/supabase/migrations/`.

## Discovery Protocol
Before building any API client or adding new HTTP/SDK calls:
1. Check `OPENAPI_SPEC.yaml` and `mcp/data/openapi.json`
2. Read `SUPABASE_TABLES.md` and `SEMANTIC_ALIASES.md`
3. If the RiskModels MCP server is connected: read the resources `riskmodels:///capabilities` → `riskmodels:///schemas/{path}` (the catalog tools were removed in tool set 2.0)

## Key Directories
```
sdk/riskmodels/
├── client.py              # RiskModelsClient + get_ticker_metadata()  (reads frozen ticker_metadata until #500 merges)
├── peer_group.py          # PeerGroupProxy + PeerComparison
├── portfolio_math.py      # Portfolio aggregation (weights, HR/ER)
├── snapshots/
│   ├── _theme.py          # THEME singleton (Consultant Navy design system)
│   ├── _page.py           # SnapshotPage layout engine (GridSpec)
│   ├── _charts.py         # 9 reusable chart primitives
│   ├── _data.py           # StockContext + return helpers
│   ├── _json_io.py        # dump_json / load_json
│   ├── r1_risk_profile.py # R1: Factor Risk Profile [✅ shipped]
│   ├── refine.py          # Iterative refinement CLI
│   ├── s1_forensic.py     # S1: Legacy Forensic (WeasyPrint)
│   └── s2_waterfall.py    # S2: Legacy Waterfall (WeasyPrint)

app/api/                   # Next.js API routes
lib/dal/                   # Data access layer (TypeScript)
lib/risk/                  # Risk computation services
docs/                      # Architecture docs, roadmap, content map
```

## Conventions
- All chart code imports THEME — never hardcode colors or font sizes
- New snapshots must declare which R/P quadrant they target
- Commit messages: imperative mood, reference quadrant (e.g., "R1: fix peer table vol derivation")
- Fetch/render separation: `get_data_for_XX()` and `render_XX_to_pdf()` are always separate
- PeerGroupProxy is the shared peer context for all stock snapshots — always use `peer_group.py`
- Files go inside `RiskModels_API/` repo tree, never loose under workspace root
