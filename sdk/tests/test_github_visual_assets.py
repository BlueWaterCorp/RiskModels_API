"""GitHub-oriented static charts (matplotlib)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

pytest.importorskip("matplotlib")

from riskmodels.visual_refinement import save_macro_heatmap, save_ranking_chart, save_ranking_percentile_bar_chart


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
