# RiskModels API — Agent Instructions

## Project Identity
This is the **RiskModels API** — a Next.js + Supabase platform serving institutional equity risk analytics. The Python SDK (`sdk/riskmodels/`) provides the programmatic client and visualization layer.

## Snapshot Suite (Primary Focus)
We are building an **Institutional PDF Snapshot Suite** — four quadrant reports that cover every combination of current/history × stock/portfolio analysis.

### The 4 Quadrants
| ID | Combo | Deliverable | Data Source |
|:---|:---|:---|:---|
| **S1** | Current × Stock | Forensic Deep-Dive | `GET /api/metrics/{ticker}` + PeerGroupProxy |
| **S2** | History × Stock | Attribution Waterfall | `POST /api/batch/analyze` (time series) |
| **S3** | Current × Portfolio | Concentration Mekko | PeerGroupProxy.compare() per holding |
| **S4** | History × Portfolio | Style Drift Trend | PeerGroupProxy + returns panel |

### Design Standards (Consultant Navy)
```python
PALETTE = {
    "primary":   "#002a5e",  # Navy
    "secondary": "#006f8e",  # Teal
    "alpha":     "#00AA00",  # Green (positive)
    "warning":   "#E07000",  # Orange (negative/warning)
}
LAYOUT = "Letter Landscape"  # 11×8.5 in, 300 DPI
ENGINE = "WeasyPrint + Matplotlib"
```

### Identity Rules
- **`symbol`** (FactSet ID) = internal join key. Never expose to users.
- **`ticker`** = human-facing label on charts, axes, legends, PDF titles.
- Resolution: `resolveSymbolByTicker()` in `lib/dal/risk-engine-v3.ts`.

## PeerGroupProxy (Intermediary Object)
**Location:** `sdk/riskmodels/peer_group.py`

The PeerGroupProxy bridges a single stock to a synthetic portfolio of its **subsector** peers (default). Subsector is the right granularity — comparing NVDA against all of XLK (MSFT, AAPL, etc.) is too broad to isolate selection skill. The default `subsector_etf` gives you semiconductors (SMH), not broad tech.

**Usage:**
```python
from riskmodels.peer_group import PeerGroupProxy

pg = PeerGroupProxy.from_ticker(client, "NVDA")          # → subsector peers (SMH)
comparison = pg.compare(client)                            # → PeerComparison
comparison.selection_spread                                # → target - peer avg residual ER
```

**Architecture:**
- `from_ticker()` → resolves subsector_etf (default), filters universe, cap-weights peers. Falls back to sector_etf if subsector unavailable.
- `compare()` → calls `analyze_portfolio()` on peers, computes spreads (THIS IS THE FETCH/RENDER BOUNDARY)
- Returns `PeerComparison` dataclass — renderers consume this, never call the API directly

**Fetch/Render Rule:** Every snapshot has two functions:
```python
get_data_for_sN(ticker, client) → dict | dataclass   # calls API + PeerGroupProxy
render_sN_to_pdf(data, path)    → Path                # Jinja2 + Matplotlib only
```
When the Supabase schema changes, only `get_data` is touched. Renderers stay stable.

## Data Contract (V3)
- **`symbols`** — identity registry (symbol PK, ticker, sector_etf, subsector_etf, market_cap)
- **`security_history`** — long-form temporal (symbol, teo, periodicity, metric_key → value)
- **`security_history_latest`** — materialized latest metrics per symbol
- **`erm3_landing_chart_cache`** — pre-computed cumulative returns
- **`macro_factors`** — daily macro factor returns

See `SUPABASE_TABLES.md` for full schema. Source of truth is `Risk_Models` repo.

## Discovery Protocol
Before building any API client or adding new HTTP/SDK calls:
1. Check `OPENAPI_SPEC.yaml` and `mcp/data/openapi.json`
2. Read `SUPABASE_TABLES.md` and `SEMANTIC_ALIASES.md`
3. If MCP tools available: `riskmodels_list_endpoints` → `riskmodels_get_capability`

## Key Directories
- `app/api/` — Next.js API routes
- `sdk/riskmodels/` — Python SDK (client, visuals, performance)
- `sdk/riskmodels/peer_group.py` — PeerGroupProxy (stock → portfolio bridge)
- `sdk/riskmodels/portfolio_math.py` — Portfolio aggregation (weights, HR/ER)
- `sdk/riskmodels/visuals/_mag7.py` — Cap-weighting pattern (reference for PeerGroupProxy)
- `lib/dal/` — Data access layer (TypeScript)
- `lib/risk/` — Risk computation services
- `scripts/` — Utility scripts (visual gallery, preview, etc.)
- `figures/` — Generated chart outputs
- `supabase/migrations/` — Schema migrations
- `docs/SNAPSHOT_ROADMAP.md` — Full planning doc with ADRs and implementation order

## Conventions
- All chart scripts import the shared palette — never hardcode colors
- PDF templates extend a base HTML layout with Consultant Navy branding
- New snapshots must declare which quadrant (S1–S4) they target
- Commit messages: imperative mood, reference quadrant if applicable (e.g., "S2: add 3yr waterfall chart")
- Fetch/render separation: `get_data_for_sN()` and `render_sN_to_pdf()` are always separate functions
- PeerGroupProxy is the shared dependency for S1 footer, S3, and S4 — always use `peer_group.py`, never rebuild the logic inline
