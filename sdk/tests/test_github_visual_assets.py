"""GitHub-oriented static charts (matplotlib)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

pytest.importorskip("matplotlib")

from riskmodels.visual_refinement import (
    save_macro_heatmap,
    save_macro_sensitivity_matrix,
    save_ranking_chart,
    save_ranking_percentile_bar_chart,
    save_risk_intel_inspiration_figure,
)


def test_save_ranking_chart_writes_png(tmp_path: Path):
    out = tmp_path / "r.png"
    save_ranking_chart("TEST", {"rank_percentile": 91.2}, str(out), theme="github_light")
    assert out.is_file() and out.stat().st_size > 200


def test_save_ranking_chart_accepts_percentile_alias(tmp_path: Path):
    out = tmp_path / "r2.png"
    save_ranking_chart("X", {"percentile": 50.0}, str(out), theme="transparent", transparent=True)
    assert out.stat().st_size > 200


def test_save_macro_heatmap_writes_png(tmp_path: Path):
    df = pd.DataFrame(
        {
            "AAPL": [0.01, 0.02, -0.01],
            "macro_vix": [-0.2, 0.1, 0.05],
            "macro_btc": [0.0, 0.15, -0.1],
        },
    )
    out = tmp_path / "h.png"
    save_macro_heatmap(df, str(out), title="Test")
    assert out.stat().st_size > 200


def test_save_macro_sensitivity_matrix_writes_png(tmp_path: Path):
    df = pd.DataFrame(
        {"VIX": [-0.1, 0.2, 0.0], "Gold": [0.05, -0.15, 0.08], "BTC": [0.12, 0.0, -0.2]},
        index=["AAA", "BBB", "CCC"],
    )
    out = tmp_path / "m.png"
    save_macro_sensitivity_matrix(df, str(out), title="Test matrix")
    assert out.stat().st_size > 400


def test_save_risk_intel_inspiration_writes_png(tmp_path: Path):
    macro = pd.DataFrame(
        {"VIX": [-0.1, 0.2], "Gold": [0.05, -0.15], "BTC": [0.12, 0.0]},
        index=["AAA", "BBB"],
    )
    out = tmp_path / "hero.png"
    save_risk_intel_inspiration_figure(
        macro,
        "AAA",
        {"rank_percentile": 72.0},
        str(out),
        ranking_subtitle="252d · subsector · subsector_residual",
    )
    assert out.stat().st_size > 800


def test_save_ranking_percentile_bar_transparent(tmp_path: Path):
    df = pd.DataFrame(
        {
            "cohort": ["universe", "sector"],
            "rank_percentile": [80.0, 70.0],
            "metric": ["er_l3", "er_l3"],
            "window": ["252d", "252d"],
        },
    )
    out = tmp_path / "b.png"
    save_ranking_percentile_bar_chart(df, str(out), transparent=True)
    assert out.stat().st_size > 200
