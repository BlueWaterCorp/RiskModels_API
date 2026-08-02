"""G.45 — ``holdings_active_panel@v1`` renderer contract.

The panel wraps a benchmark-fit payload; the tests pin the JSON contract,
the visible benchmark-provenance label (ADR 2026-08-01), the param
validation (ValueError → render-svc 422), and the honest empty state.
"""

from __future__ import annotations

import plotly.graph_objects as go
import pytest

from riskmodels.snapshots.artifacts.holdings_active_panel import v1


FIT = {
    "fit_schema_version": "benchmark-fit/1.1",
    "subject_id": "BW-FUND-S000000008",
    "subject_source_kind": "fund",
    "benchmark_context_id": "ff_own",
    "benchmark_name": "Own-holdings free-float cap benchmark",
    "benchmark_kind": "ff_own",
    "subject_teo": "2026-06-30",
    "benchmark_teo": "2026-06-30",
    "n_subject_holdings": 25,
    "n_benchmark_constituents": 25,
    "n_overlap": 25,
    "active_share": 0.227,
    "active_weight_rms": 0.1266,
    "weight_in_benchmark": 1.0,
    "benchmark_coverage": 1.0,
    "top_overweights": [
        {"bw_sym_id": "BW-A", "subject_weight": 0.03, "benchmark_weight": 0.003, "active_weight": 0.027},
        {"bw_sym_id": "BW-B", "subject_weight": 0.031, "benchmark_weight": 0.008, "active_weight": 0.023},
    ],
    "top_underweights": [
        {"bw_sym_id": "BW-C", "subject_weight": 0.098, "benchmark_weight": 0.177, "active_weight": -0.079},
    ],
    "benchmark_provenance": {"cap_var": "ff_own_cap", "cap_coverage": 0.996, "caps_as_of": "2026-06-30"},
}


@pytest.fixture(autouse=True)
def _no_supabase(monkeypatch):
    """Label resolution soft-fails deterministically in tests."""
    monkeypatch.setattr(
        "riskmodels.snapshots._fund_data._resolve_holdings_metadata",
        lambda syms: {"BW-A": {"ticker": "AAA", "name": "Alpha Inc"}},
    )


def test_render_data_contract_and_label():
    out = v1.render_data(FIT)
    assert out["slug"] == "holdings_active_panel"
    assert out["active_share"] == 0.227
    assert out["benchmark"]["id"] == "ff_own"
    # The provenance label is part of the payload, visibly naming the
    # benchmark and its as-of.
    assert out["benchmark"]["label"] == (
        "vs ff_own — Own-holdings free-float cap benchmark · benchmark as of 2026-06-30"
    )
    # Resolved ticker where Supabase answered; bw_sym_id kept where not.
    over = out["overweights"]
    assert over[0]["ticker"] == "AAA"
    assert over[1]["ticker"] is None and over[1]["bw_sym_id"] == "BW-B"
    assert out["underweights"][0]["active_weight"] == -0.079


def test_static_spy_label_discloses_default():
    fit = {**FIT, "benchmark_context_id": "BW-BENCH-SPY", "benchmark_name": "S&P 500", "benchmark_kind": "static"}
    out = v1.render_data(fit)
    assert out["benchmark"]["label"].startswith("vs SPY (default)")


def test_top_n_narrows_rows():
    out = v1.render_data(FIT, top_n=1)
    assert len(out["overweights"]) == 1
    assert len(out["underweights"]) == 1


def test_benchmark_param_mismatch_raises():
    with pytest.raises(ValueError, match="does not match"):
        v1.render_data(FIT, benchmark="cell_large-growth")


def test_benchmark_param_match_accepts():
    out = v1.render_data(FIT, benchmark="ff_own")
    assert out["benchmark"]["id"] == "ff_own"


def test_render_figure_carries_label_and_bars():
    fig = v1.render_figure(FIT)
    assert isinstance(fig, go.Figure)
    assert len(fig.data) == 1
    assert len(fig.data[0].x) == 3  # 2 over + 1 under
    title = fig.layout.title.text
    assert "vs ff_own — Own-holdings free-float cap benchmark" in title
    assert "Active share 22.7%" in title
    assert "subject as of 2026-06-30" in title


def test_render_figure_empty_state():
    fit = {**FIT, "top_overweights": [], "top_underweights": []}
    fig = v1.render_figure(fit)
    # Honest placeholder, not an invented shape.
    assert len(fig.data) == 0
    assert any(
        "No active-weight data" in (a.text or "")
        for a in fig.layout.annotations or []
    )


def test_module_registry_contract():
    assert v1.APPLICABLE_SUBJECT_KINDS == ("fund",)
    assert set(v1.RENDER_PARAMS) == {"benchmark", "top_n"}
    assert v1.ARTIFACT_SLUG == "holdings_active_panel"
