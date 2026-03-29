"""Rankings endpoints: parsing + client (mocked HTTP)."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from riskmodels.client import RiskModelsClient
from riskmodels.llm import to_llm_context
from riskmodels.parsing import (
    build_rankings_small_cohort_warnings,
    rankings_grid_headline,
    rankings_grid_to_dataframe,
    rankings_leaderboard_headline,
    rankings_top_to_dataframe,
)
from riskmodels.visual_refinement import save_ranking_percentile_bar_chart

pytest.importorskip("matplotlib")


def _client(handler: httpx.MockTransport) -> RiskModelsClient:
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=handler),
    )


def test_rankings_grid_to_dataframe_ranking_key():
    body = {
        "rankings": [
            {
                "metric": "er_l3",
                "cohort": "universe",
                "window": "252d",
                "rank_ordinal": 10,
                "cohort_size": 3000,
                "rank_percentile": 99.5,
            },
        ],
    }
    df = rankings_grid_to_dataframe(body)
    assert list(df["ranking_key"]) == ["252d_universe_er_l3"]


def test_small_cohort_warnings_deduped():
    df = pd.DataFrame(
        [
            {"cohort_size": 3, "ranking_key": "252d_subsector_er_l3"},
            {"cohort_size": 3, "ranking_key": "252d_subsector_er_l3"},
        ],
    )
    w = build_rankings_small_cohort_warnings(df)
    assert len(w) == 1


def test_get_rankings_mock():
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "rankings": [
                    {
                        "metric": "subsector_residual",
                        "cohort": "subsector",
                        "window": "252d",
                        "rank_ordinal": 1,
                        "cohort_size": 4,
                        "rank_percentile": 100.0,
                    },
                ],
            },
        )

    client = _client(httpx.MockTransport(handler))
    df = client.get_rankings("NVDA")
    assert isinstance(df, pd.DataFrame)
    assert "/rankings/NVDA" in captured["url"]
    assert df.attrs.get("riskmodels_rankings_headline")
    assert df.attrs.get("riskmodels_warnings")
    assert "n=4" in str(df.attrs["riskmodels_warnings"][0]).lower()


def test_get_top_rankings_mock():
    def handler(request: httpx.Request) -> httpx.Response:
        assert "/rankings/top" in str(request.url)
        assert "metric=subsector_residual" in str(request.url)
        return httpx.Response(
            200,
            json={
                "teo": "2026-03-01",
                "metric": "subsector_residual",
                "cohort": "subsector",
                "window": "252d",
                "limit": 10,
                "rankings": [
                    {
                        "symbol": "s1",
                        "ticker": "AAA",
                        "rank_ordinal": 1,
                        "cohort_size": 5,
                        "rank_percentile": 100.0,
                    },
                ],
            },
        )

    client = _client(httpx.MockTransport(handler))
    df = client.get_top_rankings(
        metric="subsector_residual",
        cohort="subsector",
        window="252d",
        limit=10,
    )
    assert isinstance(df, pd.DataFrame)
    assert df.iloc[0]["ticker"] == "AAA"
    assert df.iloc[0]["ranking_key"] == "252d_subsector_subsector_residual"
    q = json.loads(str(df.attrs["riskmodels_rankings_query"]))
    assert q["teo"] == "2026-03-01"
    assert df.attrs.get("riskmodels_rankings_headline")


def test_filter_universe_alias_matches_by_ranking():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "teo": "2026-03-01",
                "metric": "er_l3",
                "cohort": "universe",
                "window": "252d",
                "limit": 100,
                "rankings": [
                    {
                        "symbol": "s1",
                        "ticker": "ONLY",
                        "rank_ordinal": 1,
                        "cohort_size": 10,
                        "rank_percentile": 95.0,
                    },
                ],
            },
        )

    client = _client(httpx.MockTransport(handler))
    a = client.filter_universe_by_ranking(
        metric="er_l3", cohort="universe", window="252d", min_percentile=90, limit=100
    )
    b = client.filter_universe(
        metric="er_l3", cohort="universe", window="252d", min_percentile=90, limit=100
    )
    pd.testing.assert_frame_equal(a.reset_index(drop=True), b.reset_index(drop=True))


def test_filter_universe_by_ranking_mock():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "teo": "2026-03-01",
                "metric": "er_l3",
                "cohort": "universe",
                "window": "252d",
                "limit": 100,
                "rankings": [
                    {
                        "symbol": "s1",
                        "ticker": "HIGH",
                        "rank_ordinal": 1,
                        "cohort_size": 100,
                        "rank_percentile": 99.0,
                    },
                    {
                        "symbol": "s2",
                        "ticker": "LOW",
                        "rank_ordinal": 50,
                        "cohort_size": 100,
                        "rank_percentile": 50.0,
                    },
                ],
            },
        )

    client = _client(httpx.MockTransport(handler))
    out = client.filter_universe_by_ranking(
        metric="er_l3",
        cohort="universe",
        window="252d",
        min_percentile=90,
        limit=100,
    )
    assert list(out["ticker"]) == ["HIGH"]
    assert "Filtered" in str(out.attrs.get("riskmodels_filter_note", ""))


def test_to_llm_context_rankings_headline():
    df = rankings_grid_to_dataframe(
        {
            "rankings": [
                {
                    "metric": "er_l3",
                    "cohort": "universe",
                    "window": "252d",
                    "rank_ordinal": 1,
                    "cohort_size": 100,
                    "rank_percentile": 99.9,
                },
            ],
        },
    )
    df.attrs["riskmodels_rankings_headline"] = rankings_grid_headline(df)
    df.attrs["riskmodels_warnings"] = ["Small cohort test"]
    df.attrs["legend"] = "rankings legend"
    text = to_llm_context(df, include_lineage=False)
    assert "Rankings" in text or "rank_percentile" in text
    assert "Small cohort" in text


def test_save_ranking_percentile_bar_chart_writes_png(tmp_path: Path):
    df = pd.DataFrame(
        {
            "cohort": ["universe", "sector", "subsector"],
            "rank_percentile": [80.0, 70.0, 90.0],
            "metric": ["er_l3"] * 3,
            "window": ["252d"] * 3,
        },
    )
    out = tmp_path / "r.png"
    save_ranking_percentile_bar_chart(df, str(out), metric="er_l3", window="252d", ticker="NVDA")
    assert out.is_file()
    assert out.stat().st_size > 100


def test_rankings_leaderboard_headline_string():
    h = rankings_leaderboard_headline(
        teo="2026-01-01",
        metric="mkt_cap",
        cohort="universe",
        window="252d",
        limit=10,
        row_count=5,
    )
    assert "252d" in h and "rows=5/10" in h


def test_rankings_top_to_dataframe_empty():
    assert rankings_top_to_dataframe({"rankings": []}).empty
