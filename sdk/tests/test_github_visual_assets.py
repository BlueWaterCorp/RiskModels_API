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


def test_save_macro_sensitivity_matrix_coerces_object_columns(tmp_path: Path):
    """API/SDK may deliver macro_corr_* as object dtype; plotting must still work."""
    df = pd.DataFrame(
        {
            "VIX": ["-0.1", "0.2", "0.0"],
            "Gold": ["0.05", "-0.15", "0.08"],
            "BTC": ["0.12", "0.0", "-0.2"],
        },
        index=["AAA", "BBB", "CCC"],
    )
    out = tmp_path / "m_obj.png"
    save_macro_sensitivity_matrix(df, str(out), title="Object dtype matrix")
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


def test_readme_dark_theme_pngs(tmp_path: Path):
    """GitHub dark README style: solid #0d1117, high DPI."""
    needle = tmp_path / "needle.png"
    save_ranking_chart("NVDA", {"rank_percentile": 82.0}, str(needle), theme="readme_dark", dpi=120)
    assert needle.stat().st_size > 400

    macro = pd.DataFrame(
        {"VIX": [-0.1, 0.2], "Gold": [0.05, -0.15]},
        index=["AAA", "BBB"],
    )
    heat = tmp_path / "macro_rd.png"
    save_macro_sensitivity_matrix(macro, str(heat), title="Test", dpi=120, style="readme_dark")
    assert heat.stat().st_size > 400

    hero = tmp_path / "hero_rd.png"
    save_risk_intel_inspiration_figure(
        macro,
        "AAA",
        {"rank_percentile": 72.0},
        str(hero),
        theme="readme_dark",
        dpi=120,
    )
    assert hero.stat().st_size > 800


def test_readme_dark_needle_extreme_percentiles(tmp_path: Path):
    """Needle annotation shouldn't overflow at 0 or 100."""
    for pct in (2.0, 98.5):
        out = tmp_path / f"n_{pct}.png"
        save_ranking_chart("X", {"rank_percentile": pct}, str(out), theme="readme_dark", dpi=72)
        assert out.stat().st_size > 300


def test_readme_dark_bar_chart_with_value_labels(tmp_path: Path):
    df = pd.DataFrame({
        "cohort": ["universe", "sector", "subsector"],
        "rank_percentile": [85.0, 72.3, 91.0],
        "metric": ["er_l3"] * 3,
        "window": ["252d"] * 3,
    })
    out = tmp_path / "bars_rd.png"
    save_ranking_percentile_bar_chart(
        df, str(out), metric="er_l3", window="252d", ticker="NVDA", readme_dark=True,
    )
    assert out.stat().st_size > 500


def test_readme_dark_3factor_heatmap(tmp_path: Path):
    """Full 7x3 matrix like the real MAG7 output."""
    df = pd.DataFrame(
        {
            "VIX": [-0.12, 0.08, -0.05, 0.15, -0.10, 0.20, 0.03],
            "Gold": [0.05, -0.08, 0.12, -0.03, 0.07, 0.14, -0.06],
            "BTC": [0.34, 0.41, 0.34, 0.31, 0.44, 0.42, 0.44],
        },
        index=["AAPL", "AMZN", "GOOG", "META", "MSFT", "NVDA", "TSLA"],
    )
    out = tmp_path / "macro_7x3.png"
    save_macro_sensitivity_matrix(df, str(out), title="MAG7 test", dpi=120, style="readme_dark")
    assert out.stat().st_size > 1000


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
