"""Bench-active signals SDK methods (bench_active_signals.md).

Mocked-HTTP coverage for ``get_benchmark_fit`` / ``list_benchmarks``:
URL/param construction, custom-bench pass-through (ff_own / cell_<slug> /
all), provenance surfacing, ``as_dataframe=True`` flattening (single fit and
the ``all`` fan-out), and the client-side bench registry shape.
"""

from __future__ import annotations

import httpx
import pandas as pd

from riskmodels.client import RiskModelsClient

FUND_ID = "BW-FUND-S000004310"


def _client(handler) -> RiskModelsClient:
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


FIT = {
    "fit_schema_version": "benchmark-fit/1.1",
    "subject_id": FUND_ID,
    "subject_source_kind": "fund",
    "benchmark_context_id": "ff_own",
    "benchmark_name": "Own-holdings free-float cap benchmark",
    "benchmark_kind": "ff_own",
    "subject_teo": "2026-04-30",
    "benchmark_teo": "2026-04-29",
    "n_subject_holdings": 3,
    "n_benchmark_constituents": 3,
    "n_overlap": 3,
    "active_share": 0.1,
    "active_weight_rms": 0.05,
    "weight_in_benchmark": 1.0,
    "benchmark_coverage": 1.0,
    "top_overweights": [
        {
            "bw_sym_id": "BW-A",
            "subject_weight": 0.5,
            "benchmark_weight": 0.4,
            "active_weight": 0.1,
        }
    ],
    "top_underweights": [
        {
            "bw_sym_id": "BW-B",
            "subject_weight": 0.2,
            "benchmark_weight": 0.3,
            "active_weight": -0.1,
        }
    ],
    "benchmark_provenance": {
        "cap_var": "free_float_market_cap",
        "cap_coverage": 0.97,
        "caps_as_of": "2026-04-29",
        "n_cap_dropped": 1,
    },
}


def test_get_benchmark_fit_builds_params_and_surfaces_provenance():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json=FIT)

    out = _client(handler).get_benchmark_fit(
        FUND_ID, benchmark="ff_own", as_of="2026-05-31", top=5
    )
    assert "/data/benchmark-fit" in captured["url"]
    assert f"subject={FUND_ID}" in captured["url"]
    assert "benchmark=ff_own" in captured["url"]
    assert "as_of=2026-05-31" in captured["url"]
    assert "top=5" in captured["url"]
    assert out["benchmark_kind"] == "ff_own"
    prov = out["benchmark_provenance"]
    assert prov["cap_var"] == "free_float_market_cap"
    assert prov["cap_coverage"] == 0.97
    assert prov["n_cap_dropped"] == 1


def test_get_benchmark_fit_defaults():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json=FIT)

    _client(handler).get_benchmark_fit(FUND_ID)
    assert "benchmark=SPY" in captured["url"]
    assert "top=10" in captured["url"]
    assert "as_of" not in captured["url"]


def test_get_benchmark_fit_all_returns_fits_payload():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "fit_schema_version": "benchmark-fit/1.1",
                "subject_id": FUND_ID,
                "subject_source_kind": "fund",
                "subject_teo": "2026-04-30",
                "fits": [FIT, {**FIT, "benchmark_context_id": "BW-BENCH-SPY"}],
                "omitted": [
                    {"benchmark": "cell_*", "reason": "no declared style cell"}
                ],
            },
        )

    out = _client(handler).get_benchmark_fit(FUND_ID, benchmark="all")
    assert len(out["fits"]) == 2
    assert out["omitted"][0]["benchmark"] == "cell_*"


def test_get_benchmark_fit_as_dataframe_flattens_over_under():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=FIT)

    df = _client(handler).get_benchmark_fit(FUND_ID, benchmark="ff_own", as_dataframe=True)
    assert isinstance(df, pd.DataFrame)
    assert list(df.columns) == [
        "benchmark_context_id",
        "direction",
        "bw_sym_id",
        "subject_weight",
        "benchmark_weight",
        "active_weight",
    ]
    assert len(df) == 2
    over = df[df["direction"] == "over"].iloc[0]
    assert over["bw_sym_id"] == "BW-A"
    assert over["active_weight"] == 0.1
    assert over["benchmark_context_id"] == "ff_own"


def test_get_benchmark_fit_as_dataframe_stacks_all_fits():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "fits": [FIT, {**FIT, "benchmark_context_id": "cell_large-growth"}],
                "omitted": [],
            },
        )

    df = _client(handler).get_benchmark_fit(FUND_ID, benchmark="all", as_dataframe=True)
    assert set(df["benchmark_context_id"]) == {"ff_own", "cell_large-growth"}
    assert len(df) == 4


def test_list_benchmarks_registry_shape():
    reg = _client(lambda r: httpx.Response(500)).list_benchmarks()
    assert "SPY" in reg["static_aliases"]
    assert reg["static_aliases"]["SPY"] == "BW-BENCH-SPY"
    assert "ff_own" in reg["custom"]
    assert "all" in reg["custom"]
    assert len(reg["style_cells"]) == 9
    assert "cell_large-growth" in reg["style_cells"]
    assert all(s.startswith("cell_") for s in reg["style_cells"])
    assert reg["pricing"]["static"].startswith("free")
    assert "0.005" in reg["pricing"]["custom"]


def test_list_benchmarks_readiness_statuses():
    """Readiness gate mirror: development benches shown, marked."""
    reg = _client(lambda r: httpx.Response(500)).list_benchmarks()
    readiness = reg["readiness"]
    # static benches blocked on hollow/shallow history
    assert readiness["BW-BENCH-SPY"]["status"] == "development"
    assert "hollow" in readiness["BW-BENCH-SPY"]["notes"]
    assert readiness["BW-BENCH-EQ70-30"]["status"] == "development"
    assert readiness["BW-BENCH-EQ-LARGE-VALUE-60-40"]["status"] == "development"
    # verified-live custom benches
    assert readiness["ff_own"]["status"] == "live"
    assert readiness["cell_large-blend"]["status"] == "live"
    assert readiness["cell_small-growth"]["status"] == "live"
    # mid cells blocked on the Mid-Cap_* naming mismatch
    for slug in ("mid-value", "mid-blend", "mid-growth"):
        assert readiness[f"cell_{slug}"]["status"] == "development"


def test_get_benchmark_fit_surfaces_409_readiness_gate():
    """A development bench raises APIError status 409 with the gate message."""
    import pytest

    from riskmodels.exceptions import APIError

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={
                "error": "benchmark 'BW-BENCH-SPY' is under development",
                "status": "development",
            },
        )

    with pytest.raises(APIError) as exc_info:
        _client(handler).get_benchmark_fit(FUND_ID, benchmark="SPY")
    assert exc_info.value.status_code == 409
    assert "under development" in str(exc_info.value)
    assert exc_info.value.body["status"] == "development"
