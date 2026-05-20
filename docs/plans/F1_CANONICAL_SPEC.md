# F1 Canonical Snapshot — implementation spec for Cursor Composer

**Status:** Ready to implement
**Owner:** Cursor Composer 2 fast (or any agent picking this up)
**Reviewer:** Conrad Gann
**Estimated:** ~5 hours mechanical

This spec is **prescriptive**. Don't redesign. Don't add features beyond what's listed. The architecture has been settled in the conversation that produced this doc — your job is to mirror the existing P1 implementation onto F1, with the differences spelled out below. If you find yourself making a design choice that isn't in this spec, stop and surface it.

---

## Goal

Add `CanonicalFundSnapshot` to the public SDK at `RiskModels_API/sdk/riskmodels/snapshots/`, mirroring the existing `CanonicalStockSnapshot` (P1) pattern. Land contract tests and CLI-gate coverage that mirror the existing P1 9-gate contract. Use a synthetic fixture; do not attempt to read real fund zarr data (a per-fund zarr reader is a separate task).

When this lands: the F1 contract architecture exists, the schema is enforced by tests, and the moment a real per-fund zarr reader ships, AGTHX renders against an enforced contract from day one.

---

## Read these first (mandatory)

The P1 implementation is the template. Read all of these before writing anything:

1. **`sdk/riskmodels/snapshots/canonical.py`** — the `CanonicalStockSnapshot` dataclass + `from_components` adapter + JSON I/O. **Copy this structure for F1; do not invent a new pattern.**
2. **`sdk/riskmodels/snapshots/_stock_data.py`** — `P1Data` dataclass with `to_json` / `from_json`. The fund equivalent (`FundData`) will follow this exact shape.
3. **`sdk/tests/test_canonical_snapshot.py`** — synthetic round-trip test using `__TEST__` identity. Mirror this for F1 with `__TEST_FUND__` identity.
4. **`sdk/tests/test_canonical_snapshot_contract.py`** — real-fixture contract test parametrized over fixtures. Mirror the structure; the F1 version is parametrized over `*_f1_cache.json` fixtures (will only run when a fixture exists; gracefully skips otherwise).
5. **`sdk/riskmodels/snapshots/contract_check.py`** — CLI gate. Add an F1 mode (e.g. `--f1` flag or a separate entry point) that runs the same gate suite against F1 fixtures.
6. **`docs/architecture/CANONICAL_INTELLIGENCE_OBJECTS.md`** (in BWMACRO) — particularly §3 (Temporal perspective), §4 (Snapshot taxonomy), §5 (Ontology versioning), §8 (Round-trip contract testing). This locks the vocabulary.

You should also know: the BWMACRO repo has a private `FundData` and `f1_tearsheet.py` that produce the institutional render. **Do not import from `bwmacro.*`.** The public canonical layer is self-sufficient — it never imports from BWMACRO. Mirror P1's discipline.

---

## Constraints

- **Do not modify P1.** P1 is contract-frozen. Don't refactor `canonical.py` to "share more between P1 and F1" — copy the structure, keep them separate. Premature deduplication will create coupling that breaks the freeze.
- **Do not populate `Judgment` in F1.** The field exists on the canonical (forward-compatible), but stays `None`. Editorial overlays come from BWMACRO's `derive_judgment_for_fund` (not yet built); the public SDK consumer gets the data, not the prose.
- **Do not redesign the AOM provenance block.** Reuse `AomProvenance` as-is. F1's `composition="F1"`, `subject_type="fund"`. Lenses are the same as P1 (`return_attribution`, `risk_decomposition`, `exposure`).
- **Do not add `attribution_source` or `coverage` fields to `PerformanceAttribution`.** Earlier draft proposed these; the current design is that F1 and M1 share the analytics block verbatim and differ only on identity / peer cohort.
- **Do not implement M1.** M1 (13F filer composition) reuses the F1 dataclass with a different composition code and is deferred to taxonomy v2. Out of scope for this task.
- **Do not implement a real `FundData` adapter from zarr.** Synthetic only. The per-fund zarr reader is its own task.
- **Use `CANONICAL_ONTOLOGY_VERSION = "riskmodels-ontology/2.0"`.** F1 inherits the v2 ontology with `TemporalContext` populated.

---

## Deliverables

### 1. Schema

Create new file `sdk/riskmodels/snapshots/canonical_fund.py`. Mirror `canonical.py` structure:

```python
"""Canonical Fund Snapshot — public contract for F1 (and future M1) artifacts.

Mirrors :mod:`canonical` for stocks. The analytical heart (PerformanceAttribution,
RiskDecomposition, HedgeBasis, MacroBasis) is identical to the stock canonical —
both derive from a holdings-reconstructed portfolio. Funds and 13F filers diverge
only on identity, peer-cohort dimensions, and filing-lag semantics.
"""

CANONICAL_FUND_SCHEMA_VERSION = "canonical-fund/1.0"

@dataclass(frozen=True)
class FundIdentity:
    """Stable identity band for a fund or 13F filer.

    F1 (registered fund): populates fund_family, share_classes, expense_ratio.
    M1 (13F filer): populates filer_type, aum_tier, cik, adviser_relationships
                    via filer_metadata.
    """
    symbol_id: str                       # canonical fund / filer id (e.g. "BW-FUND-AGTHX")
    name: str                            # fund / filer display name
    as_of: str                           # ISO date
    fund_family: str | None = None       # F1 only
    share_class_count: int | None = None # F1 only
    expense_ratio: float | None = None   # F1 only
    aum_usd: float | None = None         # both
    inception_date: str | None = None    # F1 only
    filer_metadata: FilerMetadata | None = None  # M1 only

@dataclass(frozen=True)
class FilerMetadata:
    """13F filer-specific identity fields. Populated for M1, None for F1."""
    cik: str
    filer_type: str | None = None        # e.g. "investment_adviser", "bank", "insurance"
    aum_tier: str | None = None          # e.g. "small", "mid", "large", "mega"
    coverage: str = "equity_sleeve"      # M1 documents that 13F is equity-only

@dataclass(frozen=True)
class HoldingRow:
    """One position in a fund's reconstructed portfolio at as_of."""
    ticker: str
    weight: float                        # 0–1, fraction of equity sleeve
    market_value_usd: float | None = None
    shares: float | None = None

    # Decomposed contribution to portfolio variance/return
    market_share: float | None = None
    sector_share: float | None = None
    subsector_share: float | None = None
    residual_share: float | None = None

@dataclass(frozen=True)
class FundPortfolio:
    """Holdings detail block — top-N positions with decomposition."""
    holdings: list[HoldingRow] = field(default_factory=list)
    total_holdings_count: int = 0        # full universe; len(holdings) may be top-N truncated
    coverage_pct: float | None = None    # sum of weights covered by `holdings` (0–1)

@dataclass(frozen=True)
class CanonicalFundSnapshot:
    """Public contract for F1 / M1 fund-shape snapshots."""
    schema_version: str                  # "canonical-fund/1.0"
    generated_utc: str

    identity: FundIdentity
    core_metrics: CoreMetrics            # REUSE from canonical.py — import don't redefine
    performance: PerformanceAttribution  # REUSE
    risk: RiskDecomposition              # REUSE
    portfolio: FundPortfolio             # NEW for F1/M1

    peer: PeerContext | None = None      # REUSE; cohort dimension differs by composition
    hedge: HedgeBasis | None = None      # REUSE
    macro: MacroBasis | None = None      # REUSE

    judgment: Judgment | None = None     # REUSE; populated by BWMACRO, None in public SDK
    aom: AomProvenance | None = None     # REUSE; composition="F1" or "M1"
    temporal: TemporalContext | None = None  # REUSE

    ontology_version: str = CANONICAL_ONTOLOGY_VERSION

    def to_json(self, path): ...        # mirror CanonicalStockSnapshot.to_json
    @classmethod
    def from_json(cls, path): ...       # mirror CanonicalStockSnapshot.from_json
```

**Reuse rules:**
- Import `CoreMetrics`, `PerformanceAttribution`, `AttributionPoint`, `RiskDecomposition`, `DecompositionPoint`, `PeerContext`, `PeerRow`, `HedgeBasis`, `MacroBasis`, `TemporalContext`, `OBSERVATION_MODES`, `AomProvenance`, `CANONICAL_ONTOLOGY_VERSION` from `canonical.py`.
- New types only: `FundIdentity`, `FilerMetadata`, `HoldingRow`, `FundPortfolio`, `CanonicalFundSnapshot`.
- New constant: `CANONICAL_FUND_SCHEMA_VERSION = "canonical-fund/1.0"`.

### 2. Adapter

Create `from_fund_components(fund_data, *, generated_utc=None, judgment=None, aom_provenance=None, temporal=None) -> CanonicalFundSnapshot` adapter, mirroring `from_components(p1, ...)` for P1.

Until a real `FundData` exists in the public SDK, define a minimal stub `FundData` dataclass in the same file (or in a new `_fund_data.py` next to `_stock_data.py`). It needs the fields the adapter reads — for the synthetic fixture, just enough to populate the canonical: `symbol_id`, `name`, `teo`, `aum_usd`, `holdings: list[dict]`, `portfolio_metrics: dict`. Mark the stub class with a docstring noting that it'll be replaced when the per-fund zarr reader ships.

**Default AOM provenance for F1:**

```python
aom = aom_provenance or AomProvenance(
    composition="F1",
    subject_type="fund",
    subject_id=fund_data.symbol_id,
    as_of=fund_data.teo,
    lenses=["return_attribution", "risk_decomposition", "exposure"],
    resolution="full_stack",
    view="snapshot",
    attribution_mode="incremental",
    observation_mode=temporal_context.observation_mode,
)
```

**Default temporal context for F1** (N-PORT typical: ~60d filing lag):

```python
temporal_context = temporal or TemporalContext(
    observation_mode="knowledge",
    report_date=fund_data.teo,
    filing_date=fund_data.filing_date_or_teo,  # accept either; default to teo if filing_date absent
    extracted_at=None,
)
```

If `fund_data` doesn't carry `filing_date`, default `filing_date = report_date` and document the assumption in the docstring (synthetic fixture has them equal). Real F1 fund data will carry both.

### 3. Exports

Update `sdk/riskmodels/snapshots/__init__.py` to export:
- `CanonicalFundSnapshot`, `FundIdentity`, `FilerMetadata`, `HoldingRow`, `FundPortfolio`
- `CANONICAL_FUND_SCHEMA_VERSION`
- `from_fund_components`
- `FundData` (the stub for now)

Add to `__all__`.

### 4. Synthetic-data round-trip test

New file `sdk/tests/test_canonical_fund_snapshot.py`. Mirror `test_canonical_snapshot.py`. Build a `__TEST_FUND__` synthetic snapshot with realistic-shaped fields:

- `FundIdentity(symbol_id="__TEST_FUND__", name="Test Fund, Inc.", as_of="2026-05-08", fund_family="Test Family", expense_ratio=0.005, aum_usd=1.0e10)`
- `FundPortfolio(holdings=[HoldingRow("AAPL", 0.08, ...), HoldingRow("MSFT", 0.07, ...), ...], total_holdings_count=120, coverage_pct=0.85)` — five or so holdings is enough.
- All other blocks populated with sensible synthetic values (variance shares sum to ~1.0, performance window over 1Y, etc.).

Tests:
1. **`test_schema_round_trip`** — dump → reload → equal. Mirrors P1's identical test.
2. **`test_optional_sections_can_be_absent`** — peer / hedge / macro / judgment / aom / temporal can all be `None`; round-trip preserves.
3. **`test_filer_metadata_optional`** — when `filer_metadata` is None (F1 case) round-trip preserves None; when populated (M1 case) round-trips equal.

### 5. Real-fixture contract test

New file `sdk/tests/test_canonical_fund_snapshot_contract.py`. Mirror `test_canonical_snapshot_contract.py` shape exactly:

- Discover fixtures via glob pattern `*_f1_cache.json` in the same `sdk/riskmodels/snapshots/output/` directory the P1 fixtures live in. (No real F1 fixtures exist yet; the test will skip cleanly via the existing `pytest.skip(allow_module_level=True)` pattern.)
- Parametrized over fixtures (will just be empty initially).
- For each fixture: 9 gates, mirroring the P1 list:
  1. `test_adapter_idempotent` — `from_fund_components` deterministic with pinned `generated_utc`.
  2. `test_json_serialization_stable`
  3. `test_json_round_trip`
  4. `test_invariants` — schema_version, ontology_version, identity preservation, variance shares sum check
  5. `test_aom_provenance_populated_and_valid` — composition="F1", subject_type="fund", lenses in vocabulary
  6. `test_aom_provenance_round_trip`
  7. `test_temporal_context_populated_and_valid`
  8. `test_temporal_round_trip`
  9. `test_pdf_renders` — *skip this one for now*. Render path is reference renderer for funds, not yet built. Add a `@pytest.mark.skip(reason="F1 reference renderer not yet implemented")` placeholder so the slot exists.

Plus one F1-specific gate:

10. `test_portfolio_invariants` — `coverage_pct` is in [0,1], all holding weights in [0,1], `len(holdings) <= total_holdings_count`.

### 6. CLI gate extension

Update `sdk/riskmodels/snapshots/contract_check.py` to add a `--composition` flag (or auto-detect from fixture filename pattern):
- `python -m riskmodels.snapshots.contract_check --all` continues to check P1 fixtures (current behavior, unchanged).
- `python -m riskmodels.snapshots.contract_check --all --composition f1` discovers `*_f1_cache.json` fixtures and runs the F1 gate suite.
- Auto-detection by suffix is also acceptable — `*_p1_cache.json` → P1 path, `*_f1_cache.json` → F1 path.

Reuse the existing `check_one(...)` structure. Define `check_one_fund(...)` in parallel that runs the F1 gate set. Don't try to unify the two — copy-paste with adjustments is the right call.

### 7. Synthetic fixture (optional, only if useful for round-tripping)

You may write `__TEST_FUND___f1_cache.json` to the output directory if it makes the contract test more useful. Otherwise leave the contract test skipping cleanly when no fixtures exist; real fixtures will land when the per-fund zarr reader ships.

---

## Acceptance criteria

When you're done, all of these must hold. Run them and paste the output into your handoff.

```bash
cd RiskModels_API

# Existing P1 tests still pass — no regressions
python -m pytest sdk/tests/test_canonical_snapshot.py \
                  sdk/tests/test_canonical_snapshot_contract.py \
                  -p no:ethereum -q
# Expected: 74 passed (or whatever the current count is — must not decrease)

# New F1 synthetic round-trip tests pass
python -m pytest sdk/tests/test_canonical_fund_snapshot.py \
                  -p no:ethereum -q
# Expected: 3 tests pass (round-trip, optional-sections, filer-metadata-optional)

# F1 contract test runs, skips cleanly with no fixtures
python -m pytest sdk/tests/test_canonical_fund_snapshot_contract.py \
                  -p no:ethereum -q
# Expected: skip message about no F1 fixtures present, exit 0

# CLI P1 path unchanged
python -m riskmodels.snapshots.contract_check --all
# Expected: 9 fixtures pass (current behavior)

# CLI F1 path runs (no fixtures, exits 1 with "no fixtures found" — that's the right
# behavior; the gate exists but has nothing to check yet)
python -m riskmodels.snapshots.contract_check --all --composition f1
# Expected: "No fixtures found in ..." stderr, exit 1
```

Imports work cleanly:

```python
from riskmodels.snapshots import (
    CanonicalFundSnapshot,
    FundIdentity,
    FilerMetadata,
    HoldingRow,
    FundPortfolio,
    CANONICAL_FUND_SCHEMA_VERSION,
    from_fund_components,
)
```

---

## Out of scope (don't do these)

- BWMACRO institutional renderer for F1 (private, separate task)
- `derive_judgment_for_fund` editorial engine (BWMACRO, not yet specced)
- Real per-fund zarr reader (separate task; the F1 canonical works with synthetic fixtures until that lands)
- M1 implementation (deferred to taxonomy v2)
- `reference_renderer` for funds (separate task; F1 PDF/PNG render is needed but not required for this milestone)
- Modifying P1's `canonical.py`, `_stock_data.py`, or contract test (P1 is frozen)
- Refactoring shared blocks into a base file. Copy-paste the imports; don't extract a `canonical_base.py`. Premature abstraction.
- Schema field additions to `PerformanceAttribution` (e.g. `attribution_source`, `coverage`). Earlier draft proposed these; final decision is *do not add*.

---

## Handoff back

When done:
1. Paste the output of the four pytest commands and two CLI commands above.
2. List the new files created and the existing files modified (one line each).
3. Note any places where the P1 pattern didn't translate cleanly — those are conversation points, not failures.
4. Stop. Don't proceed to F1 with real data, M1, or the BWMACRO render — those need design conversations the next round.

---

## Style notes

- Match the existing code style in the SDK: type hints, frozen dataclasses, docstrings on every dataclass and public function.
- Single-line module docstring. Short field-level comments (~10 chars) where the meaning isn't obvious.
- No comments explaining what the code does — names should carry it. Comments only for non-obvious "why."
- No emojis. No marketing language in docstrings — institutional voice.
- Don't write a CHANGELOG entry; this lands as part of the F1 milestone, the wider PR will handle it.
