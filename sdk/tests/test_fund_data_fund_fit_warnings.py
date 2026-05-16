"""``get_data_for_f1`` — fund_fit.parquet warning tests (MASTER_BACKLOG P.3).

Three silent-downgrade paths when the ERM3 fit data is unavailable:

  1. **file missing**       — entire fit card renders blank for every fund
                              (typical Cloud Run cause: FUNDS_DAG_DATA_ROOT
                              unset → fallback path doesn't resolve)
  2. **fund not in parquet** — fit card renders blank for one fund only
                              (typical cause: fund-fit asset hasn't covered
                              this id yet)
  3. **read fails**          — corrupt parquet or pyarrow error; same
                              blank-fit-card visual result

All three previously fell through to ``fit_kw = {}`` with no log signal.
The fix WARNs at each path so operators can distinguish a deploy-config
gap from a real data-coverage gap.
"""

from __future__ import annotations

import logging
from pathlib import Path

from riskmodels.snapshots import _fund_data


def _stub_loader_internals(monkeypatch, *, funds_latest_path: Path) -> None:
    """Make all zarr stores soft-fail + force _funds_latest_path to point
    at a controlled tmp path. The tests only care about the fund_fit.parquet
    path; everything else is a no-op."""
    monkeypatch.setattr(
        _fund_data,
        "_open_fund_zarr",
        lambda *_a, **_kw: (_ for _ in ()).throw(FileNotFoundError("test")),
    )
    monkeypatch.setattr(_fund_data, "_fund_identity", lambda _id: {})
    monkeypatch.setattr(_fund_data, "_funds_latest_path", lambda: funds_latest_path)


# ---------------------------------------------------------------------------
# Path 1 — file missing entirely (the Cloud Run / FUNDS_DAG_DATA_ROOT case)
# ---------------------------------------------------------------------------


def test_warns_when_fund_fit_parquet_missing(caplog, tmp_path, monkeypatch):
    """The headline P.3 fix: missing parquet → WARN that names the path
    AND points to the operational cause (FUNDS_DAG_DATA_ROOT)."""
    funds_latest = tmp_path / "funds_latest.json"  # parent dir exists; file doesn't matter
    _stub_loader_internals(monkeypatch, funds_latest_path=funds_latest)

    with caplog.at_level(logging.WARNING, logger="riskmodels.snapshots._fund_data"):
        _fund_data.get_data_for_f1("BW-FUND-TEST", enrich=False)

    fit_warnings = [
        r for r in caplog.records
        if "fund_fit.parquet missing" in r.message
    ]
    assert len(fit_warnings) == 1
    msg = fit_warnings[0].message
    assert "BW-FUND-TEST" in msg
    assert "FUNDS_DAG_DATA_ROOT" in msg  # operator hint
    assert "render-svc" in msg.lower()    # context for the operator
    assert fit_warnings[0].levelno == logging.WARNING


def test_warning_message_mentions_section_iii_consequence(caplog, tmp_path, monkeypatch):
    """The WARN must name WHAT will visually break — operators reading
    logs shouldn't have to know the Section III mapping by heart."""
    _stub_loader_internals(monkeypatch, funds_latest_path=tmp_path / "funds_latest.json")

    with caplog.at_level(logging.WARNING, logger="riskmodels.snapshots._fund_data"):
        _fund_data.get_data_for_f1("BW-FUND-X", enrich=False)

    msg = next(
        r.message for r in caplog.records if "fund_fit.parquet missing" in r.message
    )
    assert "Section III" in msg
    assert "blank" in msg.lower()


# ---------------------------------------------------------------------------
# Path 2 — file present but no row for this fund
# ---------------------------------------------------------------------------


def test_warns_when_fund_fit_parquet_lacks_fund_row(caplog, tmp_path, monkeypatch):
    """Parquet exists but this fund isn't in it — different operator
    triage (asset-coverage gap, not deploy-config gap). The WARN must
    distinguish from the file-missing case."""
    import pandas as pd

    # Build a real empty parquet so the read path executes; the fund
    # we query won't have a matching row.
    parent = tmp_path
    fit_path = parent / "fund_fit.parquet"
    pd.DataFrame({"bw_fund_id": ["BW-FUND-OTHER"]}).to_parquet(fit_path)

    funds_latest = parent / "funds_latest.json"
    _stub_loader_internals(monkeypatch, funds_latest_path=funds_latest)

    with caplog.at_level(logging.WARNING, logger="riskmodels.snapshots._fund_data"):
        _fund_data.get_data_for_f1("BW-FUND-MISSING", enrich=False)

    coverage_warnings = [
        r for r in caplog.records
        if "contains no row" in r.message
    ]
    assert len(coverage_warnings) == 1
    msg = coverage_warnings[0].message
    assert "BW-FUND-MISSING" in msg
    # The "no row" message should distinguish from the file-missing one
    # by mentioning that other funds are presumably fine.
    assert "this fund only" in msg
    assert "asset" in msg.lower()


# ---------------------------------------------------------------------------
# Path 3 — read failure (corrupt parquet, missing pyarrow, etc.)
# ---------------------------------------------------------------------------


def test_warns_when_fund_fit_parquet_read_fails(caplog, tmp_path, monkeypatch):
    """Any unexpected exception during the parquet read path WARNs and
    falls through — preserves the f1 render even when fit data is broken."""
    parent = tmp_path
    fit_path = parent / "fund_fit.parquet"
    # Write garbage so pandas raises on read.
    fit_path.write_bytes(b"not a parquet file")

    _stub_loader_internals(monkeypatch, funds_latest_path=parent / "funds_latest.json")

    with caplog.at_level(logging.WARNING, logger="riskmodels.snapshots._fund_data"):
        # Should NOT raise — the WARN-and-fall-through preserves the render.
        _fund_data.get_data_for_f1("BW-FUND-CORRUPT", enrich=False)

    read_warnings = [
        r for r in caplog.records
        if "fund_fit.parquet read failed" in r.message
    ]
    assert len(read_warnings) == 1
    msg = read_warnings[0].message
    assert "BW-FUND-CORRUPT" in msg
    # The WARN must mention that the render continues so operators don't
    # over-react to the warning.
    assert "preserve" in msg.lower() or "falling through" in msg.lower()


# ---------------------------------------------------------------------------
# Negative — no warning when fit data resolves correctly
# ---------------------------------------------------------------------------


def test_no_warning_when_fund_fit_parquet_has_fund_row(caplog, tmp_path, monkeypatch):
    """Happy path: parquet exists and has a row for this fund → no
    WARN, fit_kw populated. Confirms the warnings are gated on actual
    fallback firing, not noisy at every render."""
    import pandas as pd

    parent = tmp_path
    fit_path = parent / "fund_fit.parquet"
    # Minimal row with the bw_fund_id we query.
    pd.DataFrame({
        "bw_fund_id": ["BW-FUND-COVERED"],
        "weight_coverage_mean": [0.973],
        "correlation_monthly": [0.98],
    }).to_parquet(fit_path)

    funds_latest = parent / "funds_latest.json"
    _stub_loader_internals(monkeypatch, funds_latest_path=funds_latest)

    with caplog.at_level(logging.WARNING, logger="riskmodels.snapshots._fund_data"):
        fd = _fund_data.get_data_for_f1("BW-FUND-COVERED", enrich=False)

    fit_warnings = [
        r for r in caplog.records
        if "fund_fit" in r.message
    ]
    assert fit_warnings == []
    # And the fit data made it onto FundData.
    assert fd.fit_correlation_monthly == 0.98
