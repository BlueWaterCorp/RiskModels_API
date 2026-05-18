"""CLI gate for the GCS canonical-snapshot pre-render batch.

Validates that a P1Data cache can be turned into a canonical snapshot,
serialized, and rendered deterministically. Exits 0 on success, 1 on
failure. The nightly job invokes this before publishing to the
``rm_api_public`` bucket — a failure rejects the ticker without
overwriting yesterday's good artifacts.

Mirrors the assertions in ``tests/test_canonical_snapshot_contract.py``,
in a form that runs without pytest (so the batch image stays minimal).

Usage
-----
    python -m riskmodels.snapshots.contract_check NVDA AAPL
    python -m riskmodels.snapshots.contract_check --all
    python -m riskmodels.snapshots.contract_check --all --composition f1
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path

from . import (
    AomProvenance,
    CanonicalStockSnapshot,
    FundData,
    OBSERVATION_MODES,
    P1Data,
    TemporalContext,
    from_components,
    from_fund_components,
    render_canonical_to_png_bytes,
)
from .canonical import CANONICAL_ONTOLOGY_VERSION, CANONICAL_SCHEMA_VERSION
from .canonical_fund import CANONICAL_FUND_SCHEMA_VERSION, CanonicalFundSnapshot
from ..interpretation import judgment_narrative_violations


# AOM_SPEC v1 string vocabulary.
_AOM_LENSES = {"return_attribution", "risk_decomposition", "exposure"}
_AOM_RESOLUTIONS = {"market_only", "market_sector", "full_stack"}
_AOM_VIEWS = {"snapshot", "timeseries", "distribution"}
_AOM_ATTRIBUTION_MODES = {"incremental", "cumulative"}


# Pinned default — production batches should pass --generated-utc with the
# trading-day close so artifacts are byte-stable on re-runs.
DEFAULT_GENERATED_UTC = "2026-01-01T00:00:00+00:00"

DEFAULT_FIXTURE_DIR = Path(__file__).resolve().parent / "output"


def check_one(p1_cache: Path, *, generated_utc: str) -> tuple[bool, list[str]]:
    """Run all contract checks against one P1Data cache.

    Returns ``(ok, failures)`` where each failure is one diagnostic line.
    Order matches ``test_canonical_snapshot_contract.py``.
    """
    failures: list[str] = []

    p1 = P1Data.from_json(p1_cache)

    # 1. Adapter idempotence
    snap_a = from_components(p1, generated_utc=generated_utc)
    snap_b = from_components(p1, generated_utc=generated_utc)
    if snap_a != snap_b:
        failures.append("from_components is non-deterministic on identical input")

    # 2. JSON serialization stability
    a = json.dumps(asdict(snap_a), sort_keys=True, default=str)
    b = json.dumps(asdict(snap_a), sort_keys=True, default=str)
    if a != b:
        failures.append("json.dumps drifts on identical snapshot")

    # 3. JSON round-trip on real data
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "snap.json"
        snap_a.to_json(out)
        reloaded = CanonicalStockSnapshot.from_json(out)
    if reloaded != snap_a:
        failures.append("JSON dump → reload != original")

    # 4. Schema version + ontology version + identity
    if snap_a.schema_version != CANONICAL_SCHEMA_VERSION:
        failures.append(
            f"schema_version={snap_a.schema_version!r} (want {CANONICAL_SCHEMA_VERSION!r})"
        )
    if snap_a.ontology_version != CANONICAL_ONTOLOGY_VERSION:
        failures.append(
            f"ontology_version={snap_a.ontology_version!r} "
            f"(want {CANONICAL_ONTOLOGY_VERSION!r})"
        )
    if snap_a.identity.ticker != p1.ticker:
        failures.append(
            f"identity.ticker={snap_a.identity.ticker!r} != p1.ticker={p1.ticker!r}"
        )
    if snap_a.identity.as_of != p1.teo:
        failures.append(
            f"identity.as_of={snap_a.identity.as_of!r} != p1.teo={p1.teo!r}"
        )

    # 5. Variance-share invariant (when populated)
    cm = snap_a.core_metrics
    shares = [cm.market_share, cm.sector_share, cm.subsector_share, cm.residual_share]
    if all(s is not None for s in shares):
        total = sum(shares)
        if not 0.99 <= total <= 1.01:
            failures.append(f"variance shares sum to {total:.4f} (expected ≈ 1.0)")

    # 6. PNG render determinism
    png_a = render_canonical_to_png_bytes(snap_a)
    png_b = render_canonical_to_png_bytes(snap_a)
    if png_a != png_b:
        failures.append(
            f"PNG bytes drift between renders (len_a={len(png_a)}, len_b={len(png_b)})"
        )
    if not png_a.startswith(b"\x89PNG\r\n\x1a\n"):
        failures.append("PNG output missing PNG magic header")
    if len(png_a) < 1000:
        failures.append(f"PNG output suspiciously small ({len(png_a)} bytes)")

    # 7. AOM provenance — populated, AOM_SPEC v1 vocabulary, JSON round-trips.
    prov = snap_a.aom
    if prov is None:
        failures.append("canonical missing aom provenance")
    else:
        if prov.composition != "P1":
            failures.append(f"aom.composition={prov.composition!r} (expected 'P1')")
        if prov.subject_type != "stock":
            failures.append(f"aom.subject_type={prov.subject_type!r} (expected 'stock')")
        if prov.subject_id != p1.ticker:
            failures.append(
                f"aom.subject_id={prov.subject_id!r} != p1.ticker={p1.ticker!r}"
            )
        if prov.as_of != p1.teo:
            failures.append(
                f"aom.as_of={prov.as_of!r} != p1.teo={p1.teo!r}"
            )
        for lens in prov.lenses:
            if lens not in _AOM_LENSES:
                failures.append(f"aom.lenses contains unknown lens {lens!r}")
        if prov.view not in _AOM_VIEWS:
            failures.append(f"aom.view={prov.view!r} not in AOM_SPEC v1 vocabulary")
        if prov.resolution is not None and prov.resolution not in _AOM_RESOLUTIONS:
            failures.append(
                f"aom.resolution={prov.resolution!r} not in AOM_SPEC v1 vocabulary"
            )
        if prov.attribution_mode is not None and prov.attribution_mode not in _AOM_ATTRIBUTION_MODES:
            failures.append(
                f"aom.attribution_mode={prov.attribution_mode!r} not in AOM_SPEC v1 vocabulary"
            )
        if prov.ontology_version != snap_a.ontology_version:
            failures.append(
                f"aom.ontology_version={prov.ontology_version!r} "
                f"!= snapshot.ontology_version={snap_a.ontology_version!r}"
            )

    # 8. Temporal context — bi-temporal observational frame.
    t = snap_a.temporal
    if t is None:
        failures.append("canonical missing temporal context")
    else:
        if t.observation_mode not in OBSERVATION_MODES:
            failures.append(
                f"temporal.observation_mode={t.observation_mode!r} "
                f"not in {OBSERVATION_MODES}"
            )
        if t.report_date != snap_a.identity.as_of:
            failures.append(
                f"temporal.report_date={t.report_date!r} "
                f"!= identity.as_of={snap_a.identity.as_of!r}"
            )
        # Stocks: filing_date collapses to report_date. Funds (F1) will diverge.
        if snap_a.aom is not None and snap_a.aom.composition == "P1":
            if t.filing_date != t.report_date:
                failures.append(
                    f"P1 temporal.filing_date={t.filing_date!r} "
                    f"!= report_date={t.report_date!r} (stocks should collapse)"
                )
        # Provenance and temporal must agree on observation_mode.
        if snap_a.aom is not None and snap_a.aom.observation_mode != t.observation_mode:
            failures.append(
                f"aom.observation_mode={snap_a.aom.observation_mode!r} "
                f"!= temporal.observation_mode={t.observation_mode!r}"
            )

        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "snap.json"
            snap_a.to_json(out)
            reloaded = CanonicalStockSnapshot.from_json(out)
        if not isinstance(reloaded.aom, AomProvenance):
            failures.append("reloaded snapshot lost aom provenance type")
        elif reloaded.aom != snap_a.aom:
            failures.append("aom provenance drifted across JSON round-trip")

    # 9. Editorial narrative — no recommendation language (THE_ANALYST §2).
    #    Only fires when an editorial Judgment is attached; the pre-render batch
    #    runs without one today, but a violating Judgment must never ship.
    if snap_a.judgment is not None:
        for v in judgment_narrative_violations(snap_a.judgment):
            failures.append(f"judgment recommendation language: {v}")

    return len(failures) == 0, failures


def check_one_fund(f1_cache: Path, *, generated_utc: str) -> tuple[bool, list[str]]:
    """Run F1 contract checks against one FundData cache (no render gates)."""
    failures: list[str] = []

    fd = FundData.from_json(f1_cache)

    snap_a = from_fund_components(fd, generated_utc=generated_utc)
    snap_b = from_fund_components(fd, generated_utc=generated_utc)
    if snap_a != snap_b:
        failures.append("from_fund_components is non-deterministic on identical input")

    ser_a = json.dumps(asdict(snap_a), sort_keys=True, default=str)
    ser_b = json.dumps(asdict(snap_a), sort_keys=True, default=str)
    if ser_a != ser_b:
        failures.append("json.dumps drifts on identical fund snapshot")

    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "fund_snap.json"
        snap_a.to_json(out)
        reloaded = CanonicalFundSnapshot.from_json(out)
    if reloaded != snap_a:
        failures.append("JSON dump → reload != original (F1)")

    if snap_a.schema_version != CANONICAL_FUND_SCHEMA_VERSION:
        failures.append(
            f"schema_version={snap_a.schema_version!r} "
            f"(want {CANONICAL_FUND_SCHEMA_VERSION!r})"
        )
    if snap_a.ontology_version != CANONICAL_ONTOLOGY_VERSION:
        failures.append(
            f"ontology_version={snap_a.ontology_version!r} "
            f"(want {CANONICAL_ONTOLOGY_VERSION!r})"
        )
    if snap_a.identity.symbol_id != fd.symbol_id:
        failures.append(
            f"identity.symbol_id={snap_a.identity.symbol_id!r} != "
            f"fund_data.symbol_id={fd.symbol_id!r}"
        )
    if snap_a.identity.as_of != fd.teo:
        failures.append(
            f"identity.as_of={snap_a.identity.as_of!r} != fund_data.teo={fd.teo!r}"
        )

    cm = snap_a.core_metrics
    shares = [cm.market_share, cm.sector_share, cm.subsector_share, cm.residual_share]
    if all(s is not None for s in shares):
        total = sum(shares)
        if not 0.99 <= total <= 1.01:
            failures.append(f"variance shares sum to {total:.4f} (expected ~1.0)")

    prov = snap_a.aom
    if prov is None:
        failures.append("F1 canonical missing aom provenance")
    else:
        if prov.composition != "F1":
            failures.append(f"aom.composition={prov.composition!r} (expected 'F1')")
        if prov.subject_type != "fund":
            failures.append(f"aom.subject_type={prov.subject_type!r} (expected 'fund')")
        if prov.subject_id != fd.symbol_id:
            failures.append(
                f"aom.subject_id={prov.subject_id!r} != fund_data.symbol_id={fd.symbol_id!r}"
            )
        if prov.as_of != fd.teo:
            failures.append(f"aom.as_of={prov.as_of!r} != fund_data.teo={fd.teo!r}")
        for lens in prov.lenses:
            if lens not in _AOM_LENSES:
                failures.append(f"aom.lenses contains unknown lens {lens!r}")
        if prov.view not in _AOM_VIEWS:
            failures.append(f"aom.view={prov.view!r} not in AOM_SPEC v1 vocabulary")
        if prov.resolution is not None and prov.resolution not in _AOM_RESOLUTIONS:
            failures.append(
                f"aom.resolution={prov.resolution!r} not in AOM_SPEC v1 vocabulary"
            )
        if prov.attribution_mode is not None and prov.attribution_mode not in _AOM_ATTRIBUTION_MODES:
            failures.append(
                f"aom.attribution_mode={prov.attribution_mode!r} "
                "not in AOM_SPEC v1 vocabulary"
            )
        if prov.ontology_version != snap_a.ontology_version:
            failures.append(
                f"aom.ontology_version={prov.ontology_version!r} "
                f"!= snapshot.ontology_version={snap_a.ontology_version!r}"
            )

    t = snap_a.temporal
    if t is None:
        failures.append("F1 canonical missing temporal context")
    else:
        if t.observation_mode not in OBSERVATION_MODES:
            failures.append(
                f"temporal.observation_mode={t.observation_mode!r} not in {OBSERVATION_MODES}"
            )
        if t.report_date != snap_a.identity.as_of:
            failures.append(
                f"temporal.report_date={t.report_date!r} "
                f"!= identity.as_of={snap_a.identity.as_of!r}"
            )
        expect_filing = fd.filing_date if fd.filing_date else fd.teo
        if t.filing_date != expect_filing:
            failures.append(
                f"temporal.filing_date={t.filing_date!r} != expected {expect_filing!r}"
            )
        if snap_a.aom is not None and snap_a.aom.observation_mode != t.observation_mode:
            failures.append(
                f"aom.observation_mode={snap_a.aom.observation_mode!r} "
                f"!= temporal.observation_mode={t.observation_mode!r}"
            )
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "fund_snap.json"
            snap_a.to_json(out)
            reloaded_f = CanonicalFundSnapshot.from_json(out)
        if not isinstance(reloaded_f.aom, AomProvenance):
            failures.append("reloaded F1 snapshot lost aom provenance type")
        elif reloaded_f.aom != snap_a.aom:
            failures.append("F1 aom provenance drifted across JSON round-trip")

    port = snap_a.portfolio
    if port.coverage_pct is not None:
        if not 0.0 <= port.coverage_pct <= 1.0:
            failures.append(f"portfolio.coverage_pct={port.coverage_pct!r} not in [0,1]")
    for h in port.holdings:
        if not 0.0 <= h.weight <= 1.0:
            failures.append(f"holding weight out of range: {h.ticker!r} {h.weight!r}")
    if len(port.holdings) > port.total_holdings_count:
        failures.append(
            f"len(holdings)={len(port.holdings)} > total_holdings_count={port.total_holdings_count}"
        )

    # Editorial narrative — no recommendation language (THE_ANALYST §2).
    if snap_a.judgment is not None:
        for v in judgment_narrative_violations(snap_a.judgment):
            failures.append(f"judgment recommendation language: {v}")

    return len(failures) == 0, failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Contract gate for the GCS canonical-snapshot pre-render batch."
    )
    parser.add_argument(
        "tickers",
        nargs="*",
        help=(
            "Symbols to check: <TICKER>_p1_cache.json (composition p1) or "
            "<SYMBOL>_f1_cache.json (composition f1) under --fixture-dir."
        ),
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Check every *_p1_cache.json or *_f1_cache.json per --composition.",
    )
    parser.add_argument(
        "--composition",
        choices=("p1", "f1"),
        default="p1",
        help="Snapshot composition: stock P1 caches vs fund F1 caches (default: p1).",
    )
    parser.add_argument(
        "--fixture-dir",
        type=Path,
        default=DEFAULT_FIXTURE_DIR,
        help=f"Directory of cache JSON fixtures (default: {DEFAULT_FIXTURE_DIR}).",
    )
    parser.add_argument(
        "--generated-utc",
        default=DEFAULT_GENERATED_UTC,
        help=(
            "ISO-8601 UTC timestamp pinned into snapshots. Production "
            "batches should pass the trading-day close so artifacts are "
            "byte-stable on re-runs."
        ),
    )
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help=(
            "Exit 0 when the fixture set is empty instead of 1. Default "
            "(without this flag) is exit 1 — the right behavior for "
            "production batches where missing fixtures indicate a real "
            "problem. CI / fresh clones may want this flag to avoid "
            "spurious failures when caches are gitignored."
        ),
    )
    args = parser.parse_args(argv)

    if args.composition == "p1":
        suffix, checker = "_p1_cache.json", check_one
    else:
        suffix, checker = "_f1_cache.json", check_one_fund

    if args.all:
        targets = sorted(args.fixture_dir.glob(f"*{suffix}"))
    else:
        if not args.tickers:
            parser.error("Provide tickers or use --all")
        targets = [
            args.fixture_dir / f"{t.upper()}{suffix}" for t in args.tickers
        ]

    if not targets:
        print(
            f"No {args.composition.upper()} fixtures found in {args.fixture_dir}",
            file=sys.stderr,
        )
        return 0 if args.allow_empty else 1

    n_pass = 0
    n_fail = 0
    for path in targets:
        if not path.exists():
            print(f"FAIL  {path.name}: fixture not found", file=sys.stderr)
            n_fail += 1
            continue
        ok, failures = checker(path, generated_utc=args.generated_utc)
        if ok:
            print(f"PASS  {path.name}")
            n_pass += 1
        else:
            print(f"FAIL  {path.name}", file=sys.stderr)
            for f in failures:
                print(f"        - {f}", file=sys.stderr)
            n_fail += 1

    print(f"\n{n_pass} passed, {n_fail} failed", file=sys.stderr)
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
