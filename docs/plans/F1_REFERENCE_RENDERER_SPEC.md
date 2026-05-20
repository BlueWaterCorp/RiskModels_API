# F1 Reference Renderer — implementation spec for Cursor Composer

**Status:** Ready to implement (after `F1_CANONICAL_SPEC.md` lands)
**Owner:** Cursor Composer 2 fast (or any agent picking this up)
**Reviewer:** Conrad Gann
**Estimated:** ~3 hours mechanical
**Prerequisite:** `F1_CANONICAL_SPEC.md` complete — `CanonicalFundSnapshot` and `from_fund_components` exist in `riskmodels.snapshots`

This spec is **prescriptive**. Don't redesign. Don't add visual flourishes beyond what's listed. The P1 reference renderer is the template — your job is to mirror it for F1, with the differences spelled out below.

---

## Goal

Add the public reference renderer for `CanonicalFundSnapshot`. Single-page institutional layout, deterministic, no narrative, no curated peer presentation, no inference at render time. Mirrors the architectural role of `reference_renderer.py` for stocks: a trustworthy baseline that the GCS pre-render pipeline runs without importing from BWMACRO.

When this lands: F1 PDFs / PNGs are renderable from the public canonical; Cloud Run can serve them; the BWMACRO institutional renderer can be built on top of the same canonical without bypassing this layer.

---

## Read these first (mandatory)

1. **`sdk/riskmodels/snapshots/reference_renderer.py`** — the P1 reference renderer. Section structure, helper functions, panel layout, theme usage. **Mirror this; don't invent a new pattern.**
2. **`sdk/riskmodels/snapshots/_page.py`** — `SnapshotPage` layout engine. The page geometry (rows × cols, panel slicing) is what you compose against.
3. **`sdk/riskmodels/snapshots/_charts.py`** — chart primitives (`chart_hbar`, `chart_table`, etc.). Use these; do not call matplotlib directly except inside helper functions that wrap the primitives.
4. **`sdk/riskmodels/snapshots/_theme.py`** — `THEME` palette, typography, strokes. Read all panel-painting code through `THEME`, not hard-coded colors.
5. **`sdk/riskmodels/snapshots/canonical_fund.py`** — the F1 canonical contract. Read the field shapes you'll be drawing from.
6. **`docs/architecture/CANONICAL_INTELLIGENCE_OBJECTS.md`** (BWMACRO) — particularly §1 (reference vs institutional renderer) so you understand the layering. **The reference renderer is deliberately less opinionated than the institutional renderer.** No narrative, no Judgment, no peer benchmarking artwork. You're not building the AGTHX tearsheet.

---

## Constraints

- **Do not import from `bwmacro.*`.** The reference renderer is self-sufficient on the public canonical contract.
- **Do not invoke inference (LLM calls) at render time.** Narrative is `Judgment` data, populated by BWMACRO during canonical assembly. The renderer reads narrative as data, never generates it.
- **Do not modify `reference_renderer.py` or P1 code.** P1 is contract-frozen; F1 lives in a parallel module.
- **Do not extract a `_base_renderer.py`.** Premature deduplication. Copy the helper functions you need (`_fmt_pct`, `_fmt_num`, the chip builder) and adjust for F1.
- **Do not render Sharpe / drawdown panels for F1.** Per the F1 vs M1 design, those metrics are NAV-derived and we don't anchor F1 on NAV. Use the same `CoreMetrics` chips P1 uses (beta, vol_23d, max_drawdown_pct if present, sharpe_252d if present, residual_er) — but if any are `None`, render an em-dash, do not error.
- **Do not assume holdings is populated.** Synthetic fixtures may have holdings; real-data F1 may have empty `FundPortfolio.holdings` until the per-fund zarr reader ships. Render a graceful placeholder ("Holdings reconstruction pending") when empty.

---

## Deliverables

### 1. New file: `sdk/riskmodels/snapshots/reference_renderer_fund.py`

Three public entry points, mirroring `reference_renderer.py`:

```python
def render_canonical_fund_to_pdf(
    snap: CanonicalFundSnapshot,
    output_path: str | Path,
) -> Path: ...

def render_canonical_fund_to_png(
    snap: CanonicalFundSnapshot,
    output_path: str | Path,
) -> Path: ...

def render_canonical_fund_to_png_bytes(
    snap: CanonicalFundSnapshot,
) -> bytes: ...
```

Internal `_build_page(snap)` function that returns a `SnapshotPage`; the three public entry points all delegate to it.

### 2. Layout — single landscape page, 12×12 grid

Mirror the P1 layout structure with these section assignments:

| Region | Rows × Cols | Content |
|---|---|---|
| Header band | 0:2 × 0:12 | `{symbol_id} — {name}` title; "Fund Snapshot · As of {as_of}" subtitle; chips on the right |
| Left rail | 2:12 × 0:3 | Identity + decomposition summary (mirrors P1's `_render_left_rail` style) |
| Section I — Performance | 2:6 × 3:12 | Cumulative return curves (`performance.cumulative_curves`) |
| Section II — Risk | 8:12 × 3:7 | Variance-share horizontal bar (`risk.components`) |
| Section III — Holdings | 8:12 × 7:12 | Top-N holdings table (or empty-state placeholder) |

### 3. Section renderers (mirror P1 patterns)

#### `_render_left_rail(page, snap)`

Identity spine — text-only summary in the left columns. Lines to render, in order:

```
IDENTITY
Symbol         {snap.identity.symbol_id}
Family         {snap.identity.fund_family or "—"}
Inception      {snap.identity.inception_date or "—"}
Expense        {fmt_pct(snap.identity.expense_ratio)}
AUM            {fmt_aum(snap.identity.aum_usd)}   # e.g. "$118.4B"

DECOMPOSITION
Market         {fmt_pct(snap.core_metrics.market_share)}
Sector         {fmt_pct(snap.core_metrics.sector_share)}
Subsector      {fmt_pct(snap.core_metrics.subsector_share)}
Residual       {fmt_pct(snap.core_metrics.residual_share)}
```

If `snap.identity.filer_metadata is not None` (M1 case — we're rendering a 13F filer), substitute the IDENTITY block with:

```
IDENTITY
Filer          {snap.identity.symbol_id}
Type           {filer_metadata.filer_type or "—"}
CIK            {filer_metadata.cik}
AUM Tier       {filer_metadata.aum_tier or "—"}
Coverage       {filer_metadata.coverage}
```

The DECOMPOSITION block stays identical — same `core_metrics` shape applies.

If `snap.macro` is populated, append a MACRO ρ block (mirroring P1's left rail).

#### `_render_section_i_performance(page, snap)`

Cumulative-return curves. Same structure as P1's:

- Pull stable label order: target (`snap.identity.symbol_id`) → "SPY" → benchmark (if any in `cumulative_curves`) → others
- Use `THEME.palette` for color order
- Title: `f"I. Performance Attribution · {perf.window_label}"`
- Y-axis: percent format
- Sparse x-tick labels (~6 max)

If `performance.cumulative_curves` is empty, render the same "Performance series unavailable" placeholder P1 uses. (Synthetic F1 fixtures may have empty curves.)

#### `_render_section_ii_risk(page, snap)`

Variance-share horizontal bar. Mirror P1's `_render_section_ii_risk` exactly — same `chart_hbar` call, same labels (Market / Sector / Subsector / Residual), same color palette. The data shape is identical.

#### `_render_section_iii_holdings(page, snap)`

Top-N holdings table. F1-specific (P1's Section III is peer context — different content, same panel slot).

```python
def _render_section_iii_holdings(page, snap):
    ax = page.panel(row_slice=slice(8, 12), col_slice=slice(7, 12))
    ax.set_title("III. Top Holdings",
                 loc="left",
                 fontsize=THEME.type.panel_title,
                 fontweight=THEME.type.weight_bold,
                 color=THEME.palette.navy,
                 pad=6)
    ax.set_xticks([]); ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)

    portfolio = snap.portfolio
    if not portfolio.holdings:
        ax.text(0.5, 0.5, "Holdings reconstruction pending",
                ha="center", va="center",
                color=THEME.palette.text_light,
                transform=ax.transAxes)
        return

    # Top-N by weight, descending
    top = sorted(portfolio.holdings, key=lambda h: h.weight, reverse=True)[:8]

    rows = [
        [
            h.ticker,
            _fmt_pct(h.weight),
            _fmt_pct(h.residual_share) if h.residual_share is not None else "—",
        ]
        for h in top
    ]

    chart_table(ax, rows=rows, headers=["Ticker", "Wt", "Resid"])

    # Caption: total holdings count + coverage
    coverage_str = (
        f"{portfolio.total_holdings_count} holdings · "
        f"{_fmt_pct(portfolio.coverage_pct)} coverage"
    )
    page.fig.text(
        0.83, 0.115,
        coverage_str,
        fontsize=THEME.type.footer,
        color=THEME.palette.text_light,
        ha="center", va="top",
    )
```

### 4. Helpers

Top of the file, mirror P1's helpers:

```python
def _fmt_pct(v, *, decimals=1, sign=False): ...   # exact copy from reference_renderer.py
def _fmt_num(v, *, decimals=2): ...               # exact copy
def _fmt_aum(v):                                  # F1-specific, new
    """Format AUM in USD with B/M suffix."""
    if v is None:
        return "—"
    if v >= 1e9:
        return f"${v/1e9:.1f}B"
    if v >= 1e6:
        return f"${v/1e6:.0f}M"
    return f"${v:,.0f}"

def _build_chips(snap):
    """Mirror P1's _build_chips but adapted for F1.

    F1 chips: AUM, Holdings count, Beta, Vol 23d, Resid ER.
    Hides any chip whose value is None.
    """
    cm = snap.core_metrics
    chips = [
        ("AUM",         _fmt_aum(snap.identity.aum_usd)),
        ("Holdings",    str(snap.portfolio.total_holdings_count) if snap.portfolio else "—"),
        ("Beta",        _fmt_num(cm.beta)),
        ("Vol 23d",     _fmt_pct(cm.vol_23d)),
        ("Resid ER",    _fmt_pct(cm.residual_er, sign=True)),
    ]
    return chips
```

### 5. Page assembly

Mirror P1's `_build_page`:

```python
def _build_page(snap: CanonicalFundSnapshot) -> SnapshotPage:
    title = f"{snap.identity.symbol_id} — {snap.identity.name}"
    subtitle = f"Fund Snapshot · As of {snap.identity.as_of}"
    if snap.identity.filer_metadata is not None:
        subtitle = f"13F Filer Snapshot · As of {snap.identity.as_of}"

    page = SnapshotPage(
        title=title,
        subtitle=subtitle,
        ticker=snap.identity.symbol_id,
        teo=snap.identity.as_of,
        chips=_build_chips(snap),
    )

    _render_left_rail(page, snap)
    _render_section_i_performance(page, snap)
    _render_section_ii_risk(page, snap)
    _render_section_iii_holdings(page, snap)

    return page
```

### 6. Exports

Update `sdk/riskmodels/snapshots/__init__.py` to add the three F1 render entry points alongside the P1 ones:

```python
from .reference_renderer_fund import (
    render_canonical_fund_to_pdf,
    render_canonical_fund_to_png,
    render_canonical_fund_to_png_bytes,
)
```

Add to `__all__`.

### 7. Tests

Append to `sdk/tests/test_canonical_fund_snapshot.py` (already exists from F1 canonical task):

```python
def test_render_pdf_produces_valid_pdf(tmp_path):
    snap = _build_test_fund_snapshot()  # the synthetic fixture builder from prior task
    out = tmp_path / "test_fund.pdf"
    render_canonical_fund_to_pdf(snap, out)
    assert out.exists()
    assert out.stat().st_size > 1000
    assert out.read_bytes()[:5] == b"%PDF-"

def test_render_png_bytes_deterministic():
    snap = _build_test_fund_snapshot()
    a = render_canonical_fund_to_png_bytes(snap)
    b = render_canonical_fund_to_png_bytes(snap)
    assert a == b
    assert a[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(a) > 1000

def test_render_handles_empty_holdings(tmp_path):
    """Empty FundPortfolio.holdings renders the placeholder, not an error."""
    snap = _build_test_fund_snapshot_no_holdings()
    out = tmp_path / "empty.png"
    render_canonical_fund_to_png(snap, out)
    assert out.exists()

def test_render_handles_filer_identity(tmp_path):
    """When FilerMetadata is populated, header/left-rail switch to filer mode."""
    snap = _build_test_filer_snapshot()  # M1-style synthetic
    out = tmp_path / "filer.png"
    render_canonical_fund_to_png(snap, out)
    assert out.exists()
```

You'll need to add `_build_test_fund_snapshot_no_holdings()` and `_build_test_filer_snapshot()` helpers to the test module — small variations on the existing synthetic builder.

### 8. Update F1 contract test

The `test_canonical_fund_snapshot_contract.py` contract test currently has a placeholder `test_pdf_renders` skipped with `@pytest.mark.skip(reason="F1 reference renderer not yet implemented")`. Remove the skip; the test should now pass as written (mirrors the P1 PDF test).

---

## Acceptance criteria

```bash
cd RiskModels_API

# Existing P1 + F1 tests still pass
python -m pytest sdk/tests/test_canonical_snapshot.py \
                  sdk/tests/test_canonical_snapshot_contract.py \
                  sdk/tests/test_canonical_fund_snapshot.py \
                  sdk/tests/test_canonical_fund_snapshot_contract.py \
                  -p no:ethereum -q

# Imports work
python -c "from riskmodels.snapshots import (
    render_canonical_fund_to_pdf,
    render_canonical_fund_to_png,
    render_canonical_fund_to_png_bytes,
)"

# Manually render the synthetic fixture and inspect the PDF
python -c "
from pathlib import Path
from riskmodels.snapshots import (
    CanonicalFundSnapshot,
    render_canonical_fund_to_pdf,
)
# build the test snapshot and render
"
# Output PDF should be readable, single page, landscape, with all four sections visible
```

The new tests added in deliverable (7) should all pass. The previously-skipped `test_pdf_renders` in `test_canonical_fund_snapshot_contract.py` should now pass without skip.

---

## Out of scope

- BWMACRO institutional F1 renderer (`f1_tearsheet.py` enrichment) — separate task
- C1 reference renderer — separate task
- Plotly variant of the F1 renderer (web-native interactive) — separate task
- Snapshot caching / GCS publication — that's the Dagster + Cloud Run layer, separate
- Charts beyond the four panels listed — no Sharpe panel, no drawdown curve, no benchmark fit, no concentration plot. The reference renderer is deliberately minimal; richer presentation lives in the institutional renderer
- AOM provenance display in the rendered output — provenance is data, not visual content

---

## Handoff back

When done:
1. Paste the output of the pytest command from acceptance criteria.
2. List new files created and existing files modified (one line each).
3. Attach (or link) one rendered example PDF + PNG of the synthetic fixture so the visual layout can be eyeballed.
4. Note any places where the P1 pattern didn't translate cleanly.
5. Stop. Don't proceed to BWMACRO institutional render or C1 — those are separate tasks with separate specs.

---

## Style notes

- Match the existing renderer code style: short helper functions, frozen-dataclass reads, no inline matplotlib styling — use `THEME` everywhere.
- No comments explaining what code does. Comments only for non-obvious "why."
- No emojis. Institutional voice.
- Keep the file under ~400 lines. P1's renderer is ~350 — F1 should be similar.
