"""Exposure history: Python port parity with signed-exposure.ts, and the local holdings join."""

from __future__ import annotations

import io
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from riskmodels.exposure_history import ExposureHistoryPack, compute_signed_exposure, load_pack

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "signed_exposure_parity.json").read_text())


def _run(basis: str) -> dict:
    inp = FIXTURE["inputs"]
    stocks = [
        {
            "ticker": s["tickers"][0],
            "value": s["value"],
            "sector_etf": s["sector_etf"],
            "subsector_etf": s["subsector_etf"],
            "metrics": s["metrics"],
        }
        for s in inp["stocks"]
    ]
    direct = {d["ticker"]: d["value"] for d in inp["direct_etfs"]}
    return compute_signed_exposure(
        stocks, direct, inp["input_gross_usd"], inp["etfs"], np.array(inp["S"], dtype=float), basis
    )


@pytest.mark.parametrize("basis", ["lstar", "l1", "l3"])
def test_parity_with_typescript(basis: str) -> None:
    exp = FIXTURE["expected"][basis]
    got = _run(basis)
    assert got["stock_beta_usd"] == pytest.approx(exp["stock_beta_usd"], abs=0.01)
    assert got["direct_etf_beta_usd"] == pytest.approx(exp["direct_etf_beta_usd"], abs=0.01)
    assert got["total_beta_usd"] == pytest.approx(exp["total_beta_usd"], abs=0.01)
    assert got["systematic_daily_variance"] == pytest.approx(exp["systematic_daily_variance"], rel=1e-9)
    assert got["residual_daily_variance"] == pytest.approx(exp["residual_daily_variance"], rel=1e-9)
    for k, v in exp["layer_contributions"].items():
        assert got["layer_contributions"][k] == pytest.approx(v, rel=1e-9, abs=1e-6)
    assert got["total_annual_vol_usd"] == pytest.approx(exp["total_annual_vol_usd"], abs=0.01)
    assert got["coverage"]["total_risk"] == pytest.approx(exp["coverage_total_risk"], abs=1e-4)
    if basis == "lstar":
        assert got["names_by_level"] == exp["names_by_level"]
        assert [[e["ticker"], e["reason"]] for e in got["excluded_from_lstar"]] == exp["excluded_from_lstar"]
        hedge = {k: v for k, v in got["stock_hedge_trade_usd"].items() if round(v, 2) != 0}
        assert hedge.keys() == exp["stock_hedge_trade_usd"].keys()
        for k, v in exp["stock_hedge_trade_usd"].items():
            assert hedge[k] == pytest.approx(v, abs=0.01)
        for k, v in exp["total_neutralizing_trade_usd"].items():
            assert got["total_neutralizing_trade_usd"][k] == pytest.approx(v, abs=0.01)
    assert [f["ticker"] for f in got["residual_flagged"]] == exp["residual_flagged"]


def _pack() -> ExposureHistoryPack:
    rows = []
    for teo, hr in (("2024-01-31", -1.8), ("2024-02-29", -1.6), ("2024-03-28", -1.5)):
        rows.append({
            "teo": teo, "ticker": "NVDA", "symbol": "S-NVDA", "sector_etf": "XLK", "subsector_etf": "SMH",
            "l1_mkt_beta": -hr, "l1_mkt_hr": hr, "l1_res_er": 0.6, "stock_var": 9e-4, "lstar_level": 1.0,
        })
    names = pd.DataFrame(rows)
    cov = pd.DataFrame(
        [{"teo": t, "etf_i": "SPY", "etf_j": "SPY", "cov": 1e-4} for t in ("2024-01-31", "2024-02-29", "2024-03-28")]
    )
    return ExposureHistoryPack(names=names, cov=cov)


def test_dated_holdings_use_the_latest_book_on_or_before_each_month_end() -> None:
    pack = _pack()
    series = pack.exposure({
        "2024-02-15": {"NVDA": 100_000},
        "2024-03-01": {"NVDA": -50_000, "SPY": 20_000},
    })
    # January precedes the first holdings date and is skipped.
    assert series["teo"].tolist() == ["2024-02-29", "2024-03-28"]
    assert series["total_beta_usd"].tolist() == pytest.approx([100_000 * 1.6, -50_000 * 1.5 + 20_000])
    detail = series.attrs["detail"]["2024-03-28"]
    assert detail["stock_hedge_trade_usd"]["SPY"] == pytest.approx(-50_000 * -1.5)
    assert detail["total_neutralizing_trade_usd"]["SPY"] == pytest.approx(75_000 - 20_000)


def test_fixed_book_warns_about_look_back_bias() -> None:
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        series = _pack().exposure({"NVDA": 10_000})
    assert len(series) == 3
    assert any("look-back bias" in str(x.message) for x in w)


def test_dataframe_holdings_and_names_not_in_the_feed() -> None:
    h = pd.DataFrame({"date": ["2024-03-01", "2024-03-01"], "ticker": ["nvda", "ZZZ"], "value": [10_000, 5_000]})
    series = _pack().exposure(h)
    assert series["teo"].tolist() == ["2024-03-28"]
    assert series.attrs["detail"]["2024-03-28"]["not_in_feed"] == ["ZZZ"]
    assert series["names_excluded"].iloc[0] == 1


def test_load_pack_round_trips_parquet() -> None:
    pack = _pack()
    b1, b2 = io.BytesIO(), io.BytesIO()
    pack.names.to_parquet(b1)
    pack.cov.to_parquet(b2)
    again = load_pack(b1.getvalue(), b2.getvalue(), {"names_delivered": 1})
    assert again.teos == pack.teos
    assert again.meta["names_delivered"] == 1
