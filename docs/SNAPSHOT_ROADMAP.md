# Snapshot Roadmap: Institutional PDF Suite

> Working document for the 4-quadrant snapshot system. Updated as implementation progresses.

## Status

| ID | Name | Status | Script | Notes |
|:---|:---|:---|:---|:---|
| S1 | Forensic Deep-Dive (Current × Stock) | **Planning** | TBD | Single-stock L3 + peer context row |
| S2 | Attribution Waterfall (History × Stock) | **Planning** | `visuals/waterfall.py` exists | Needs PDF wrapper + Consultant Navy |
| S3 | Concentration Mekko (Current × Portfolio) | **Planning** | TBD | Uses PeerGroupProxy.compare() |
| S4 | Style Drift Trend (History × Portfolio) | **Planning** | TBD | Uses PeerGroupProxy + returns panel |
| -- | **PeerGroupProxy** | **✅ Stub complete** | `sdk/riskmodels/peer_group.py` | Intermediary object: stock → portfolio |

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

## ADR-002: Fetch/Render Separation (from Gemini, adopted)

**Decision:** Every snapshot has two clearly separated functions.

```
get_data_for_sN(ticker_or_portfolio, client) → dict | dataclass
render_sN_to_pdf(data, output_path)          → Path
```

**Why:** When the Supabase schema evolves (it does frequently — see migration count), only `get_data` changes. The complex Jinja2 + Matplotlib layouts in `render` stay untouched.

**Implementation:** The `PeerGroupProxy.compare()` method IS the `get_data` step. It returns a `PeerComparison` dataclass that renderers consume.

---

## Global Design Standards (Consultant Navy)

```python
# To be added to sdk/riskmodels/visuals/styles.py
CONSULTANT_NAVY = {
    "primary":   "#002a5e",  # Navy — titles, headers, borders
    "secondary": "#006f8e",  # Teal — secondary charts, annotations
    "alpha":     "#00AA00",  # Green — positive returns, alpha signals
    "warning":   "#E07000",  # Orange — negative returns, risk warnings
}
PDF_LAYOUT = {
    "size": "Letter Landscape",  # 11 × 8.5 in
    "dpi": 300,
    "engine": "WeasyPrint",
    "chart_engine": "Matplotlib",
}
```

These constants join the existing palettes in `styles.py` (alongside `L3_MARKET`, `TERMINAL_*`, `GITHUB_*`). All snapshot scripts import from there.

## Identity Convention

| Context | Use | Example |
|:---|:---|:---|
| Internal keys, DB joins, API params | `symbol` (FactSet ID) | `NVDA-US` |
| Chart labels, PDF titles, legends | `ticker` | `NVDA` |
| Peer resolution | `subsector_etf` from `symbols` table (default) | `SMH` |

---

## PeerGroupProxy — Architecture

**Location:** `sdk/riskmodels/peer_group.py`

**What it is:** An intermediary object that bridges a single stock to a synthetic portfolio of its **subsector** peers (default). Given `NVDA`, it produces a cap-weighted portfolio of all Semiconductor stocks (SMH universe), enabling relative context tables on every snapshot. Subsector is the default because sector-level (XLK) is too broad to isolate selection skill.

**Object graph:**
```
Ticker ("NVDA")
  → PeerGroupProxy.from_ticker(client, "NVDA")
    → resolves subsector_etf = "SMH" via GET /metrics/NVDA (subsector is default)
    → filters universe for SMH peers via GET /tickers?include_metadata=true
    → cap-weights via GET /metrics/{peer} for each peer
    → PeerGroupProxy(target="NVDA", peers=["AMD","INTC",...], weights={...})

PeerGroupProxy.compare(client)
  → calls client.analyze_portfolio(weights) — reuses existing SDK pipeline
  → returns PeerComparison(target_metrics, peer_portfolio, selection_spread)
```

**Key design choices:**
- Reuses `analyze_portfolio()` — no new aggregation math
- `compare()` is the fetch/render boundary — returns data, no charts
- `as_positions()` makes it pluggable into any existing SDK portfolio method
- Cap-weight fallback to equal-weight when < 3 peers have market_cap (same as `_mag7.py`)

---

## S1: Forensic Deep-Dive (Current × Stock)

**Data function:** `get_data_for_s1(ticker, client)`
- `client.get_metrics(ticker)` → L3 decomposition, hedge ratios, ER
- `PeerGroupProxy.from_ticker(client, ticker).compare(client)` → relative context

**Layout:**
- Header: ticker, company name, as-of date, sector_etf badge
- Left panel: L3 explainability stacked bar (Market / Sector / Subsector / Residual)
- Right panel: Hedge ratio table with conditional formatting (green/orange vs peer avg)
- Footer: peer comparison row — target vs peer avg for vol, L3 residual ER, selection spread

**Peer context enrichment:** The footer row is what makes S1 more than just a raw metric dump. Showing "NVDA residual ER = 42% vs. XLK peer avg = 31%" immediately tells the reader this stock has unusually high idiosyncratic risk.

**Open questions:**
- [ ] Include mini sparkline of last 60 days' residuals?
- [ ] Show L1/L2 alongside L3, or L3 only?
- [ ] Peer comparison: sector_etf only, or both sector + subsector rows?

## S2: Attribution Waterfall (History × Stock)

**Data function:** `get_data_for_s2(ticker, client, years=1)`
- `client.batch_analyze([ticker], ["returns", "full_metrics"], years=years)` → time series
- Optional: `PeerGroupProxy.compare(client, include_returns=True)` for relative waterfall

**Layout:**
- Waterfall chart: cumulative return decomposed into Market + Sector + Subsector + Residual
- Existing `visuals/waterfall.py` has core chart logic — retheme to Consultant Navy
- Optional overlay: peer-group cumulative return as dotted benchmark line

**Open questions:**
- [ ] Default window: 1Y or 3Y?
- [ ] Overlay total return line on waterfall?
- [ ] Add peer benchmark overlay or keep single-stock only?

## S3: Concentration Mekko (Current × Portfolio)

**Data function:** `get_data_for_s3(tickers_or_portfolio, client)`
- Uses `PeerGroupProxy.compare(client)` for each holding, OR
- Uses `client.analyze_portfolio(positions)` for a user-defined portfolio
- Enriches with sector_etf per holding for color coding

**Layout:**
- Mekko/Marimekko chart: X = weight, Y = L3 residual ER
- Each block = one holding, colored by sector_etf
- Sidebar: top 5 concentration risks (highest weight × residual ER)

**Dependencies:**
- [x] PeerGroupProxy (stub complete)
- [ ] Mekko chart function in `visuals/`
- [ ] Portfolio definition object (Mag8 default, custom via API)

## S4: Style Drift Trend (History × Portfolio)

**Data function:** `get_data_for_s4(ticker, client, years=3)`
- `PeerGroupProxy.from_ticker(client, ticker)` (defaults to `subsector_etf`)
- `proxy.compare(client, include_returns=True, years=3)` → returns panel
- Compute rolling 63d hedge ratios from returns panel

**Layout:**
- Area chart: stacked rolling L3 hedge ratios (Market / Sector / Subsector) over time
- Overlay: residual ER band showing selection skill trend
- Annotation layer: regime markers (if available from macro_factors)

**Dependencies:**
- [x] PeerGroupProxy (stub complete)
- [ ] Rolling HR computation from returns panel
- [ ] Area chart function in `visuals/`

---

## Implementation Order

```
Phase 1 — Foundation
  1. Add CONSULTANT_NAVY + PDF_LAYOUT to styles.py
  2. Wire PeerGroupProxy into sdk __init__.py exports
  3. Write test: PeerGroupProxy.from_ticker("NVDA") end-to-end

Phase 2 — S1 (proves pipeline)
  4. get_data_for_s1() → returns dict
  5. Jinja2 HTML template (Letter Landscape, Consultant Navy)
  6. render_s1_to_pdf() via WeasyPrint
  7. Compare output against NVDA_Forensic.pdf reference

Phase 3 — S2 (extends existing charts)
  8. Retheme visuals/waterfall.py to Consultant Navy
  9. get_data_for_s2() + render_s2_to_pdf()

Phase 4 — S3/S4 (portfolio quadrants)
  10. Mekko chart function + get_data_for_s3()
  11. Rolling HR computation + get_data_for_s4()
  12. Full 4-page combined snapshot option
```

---

## Agent Workflow (Opus / Sonnet Split)

**Opus 4.6** handles:
- Architecture decisions (ADRs above)
- Planning updates (this file)
- PeerGroupProxy design + review
- Cross-repo coordination (ERM3 ↔ Risk_Models ↔ RiskModels_API)

**Sonnet 4.6** handles:
- Module implementation (the `get_data` + `render` functions)
- Chart styling and Matplotlib code
- Jinja2 template iteration
- Test writing

**Rule:** Never let a single agent write fetch + render in the same block. The `get_data` function returns a clean dict/dataclass. The `render` function takes that dict and populates the template. This separation is enforced by the `PeerComparison` dataclass boundary.
