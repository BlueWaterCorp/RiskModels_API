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
    assert [[h["ticker"], h["level"], h["residual_share"]] for h in got["hedge_added_variance"]] == exp["hedge_added_variance"]


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


def test_daily_rows_use_the_latest_month_end_covariance() -> None:
    days = ["2024-02-28", "2024-02-29", "2024-03-01", "2024-03-04"]
    names = pd.DataFrame([
        {"teo": d, "ticker": "NVDA", "symbol": "S-NVDA", "sector_etf": "XLK", "subsector_etf": "SMH",
         "l1_mkt_beta": 1.5, "l1_mkt_hr": -1.5, "l1_res_er": 0.6, "stock_var": 9e-4, "lstar_level": 1.0}
        for d in days
    ])
    cov = pd.DataFrame([
        {"teo": "2024-01-31", "etf_i": "SPY", "etf_j": "SPY", "cov": 1e-4},
        {"teo": "2024-02-29", "etf_i": "SPY", "etf_j": "SPY", "cov": 4e-4},
    ])
    pack = ExposureHistoryPack(names=names, cov=cov)
    assert pack.covariance_at("2024-02-28")[1][0, 0] == pytest.approx(1e-4)  # January month-end
    assert pack.covariance_at("2024-03-04")[1][0, 0] == pytest.approx(4e-4)  # February month-end
    assert pack.covariance_at("2023-12-29") == ([], pytest.approx(np.zeros((0, 0))))

    series = pack.exposure({"2024-02-01": {"NVDA": 100_000}})
    assert series["teo"].tolist() == days
    sys_vol = series.set_index("teo")["systematic_daily_vol_usd"]
    # x = -H = 150k of SPY; vol = 150k * sqrt(cov)
    assert sys_vol["2024-02-28"] == pytest.approx(150_000 * 1e-2)
    assert sys_vol["2024-03-01"] == pytest.approx(150_000 * 2e-2)


def test_load_pack_combines_yearly_files() -> None:
    a = pd.DataFrame([{"teo": "2023-12-29", "ticker": "X"}])
    b = pd.DataFrame([{"teo": "2024-01-02", "ticker": "X"}])
    c = pd.DataFrame([{"teo": "2023-12-29", "etf_i": "SPY", "etf_j": "SPY", "cov": 1e-4}])
    bufs = []
    for df in (a, b, c):
        buf = io.BytesIO()
        df.to_parquet(buf)
        bufs.append(buf.getvalue())
    pack = load_pack([bufs[0], bufs[1]], bufs[2])
    assert pack.teos == ["2023-12-29", "2024-01-02"]


def test_load_pack_reraises_served_history_warnings() -> None:
    pack = _pack()
    b1, b2 = io.BytesIO(), io.BytesIO()
    pack.names.to_parquet(b1)
    pack.cov.to_parquet(b2)
    meta = {
        "history_available_from": {"l1_mkt_hr": "2010-12-08", "l3_res_er": "2011-12-07", "lstar_level": "2013-01-01"},
        "warnings": [
            {"code": "before_served_history", "available_from": "2013-01-01", "columns": ["lstar_level"],
             "message": "lstar_level served from 2013-01-01; null before."},
        ],
    }
    with pytest.warns(UserWarning, match="lstar_level served from 2013-01-01"):
        again = load_pack(b1.getvalue(), b2.getvalue(), meta)
    assert again.history_available_from["lstar_level"] == "2013-01-01"

    with warnings.catch_warnings():
        warnings.simplefilter("error")
        quiet = load_pack(b1.getvalue(), b2.getvalue(), {"warnings": []})
    assert quiet.history_available_from == {}


# ---- ERM3-73: point-in-time ticker resolution by holding date -------------------------------
# Windows are the API's output for the reviewed fixtures (regenerated and pinned by
# tests/exposure-history-pit.test.ts). SPCX was an ETF until 2026-04-07 (now SPCK) and is SpaceX
# today; FB was Meta until 2022-06-09.
WINDOWS = json.loads((Path(__file__).parent / "fixtures" / "ticker_windows_erm3_73.json").read_text())["ticker_windows"]
META_ID, SPACEX_ID = "BW-BBG000MM2P62", "BW-BBG000NQF3Z5"
PIT_TEOS = ("2021-12-31", "2026-03-31", "2026-09-30")


def _pit_pack() -> ExposureHistoryPack:
    rows = [
        {"teo": t, "ticker": "META", "symbol": META_ID, "sector_etf": "XLC", "subsector_etf": None,
         "l1_mkt_beta": 1.2, "l1_mkt_hr": -1.2, "l1_res_er": 0.5, "stock_var": 4e-4, "lstar_level": 1.0}
        for t in PIT_TEOS
    ]
    # Today's SPCX (SpaceX) has model history only at the last month-end.
    rows.append({"teo": "2026-09-30", "ticker": "SPCX", "symbol": SPACEX_ID, "sector_etf": "XLI", "subsector_etf": None,
                 "l1_mkt_beta": 1.4, "l1_mkt_hr": -1.4, "l1_res_er": 0.7, "stock_var": 9e-4, "lstar_level": 1.0})
    cov = []
    for t in PIT_TEOS:
        cov += [
            {"teo": t, "etf_i": "SPY", "etf_j": "SPY", "cov": 1e-4},
            {"teo": t, "etf_i": "SPCK", "etf_j": "SPY", "cov": 0.5e-4},
            {"teo": t, "etf_i": "SPCK", "etf_j": "SPCK", "cov": 2e-4},
        ]
    return ExposureHistoryPack(names=pd.DataFrame(rows), cov=pd.DataFrame(cov), meta={"ticker_windows": WINDOWS})


def test_spcx_held_before_the_rename_joins_the_etf_not_spacex() -> None:
    series = _pit_pack().exposure({"2026-03-31": {"SPCX": 10_000}})
    assert series["teo"].tolist() == ["2026-03-31", "2026-09-30"]
    for teo in ("2026-03-31", "2026-09-30"):
        d = series.attrs["detail"][teo]
        assert d["stock_beta_usd"] == 0.0  # SpaceX's row is never used
        assert d["direct_etf_beta_usd"] == pytest.approx(10_000 * 0.5)  # SPCK beta = 0.5e-4 / 1e-4
        assert d["not_in_feed"] == []
        assert d["transitions"] == [{
            "ticker": "SPCX", "held_on": "2026-03-31", "priced_as": "SPCK", "bw_sym_id": "BW-BBG00YJ8L8T5",
            "status": "rewritten", "event_ids": ["SPCK-SPCX-20260407"],
        }]


def test_spcx_held_after_the_rename_joins_todays_holder() -> None:
    series = _pit_pack().exposure({"2026-09-30": {"SPCX": 10_000}})
    d = series.attrs["detail"]["2026-09-30"]
    assert d["stock_beta_usd"] == pytest.approx(10_000 * 1.4)
    assert d["transitions"] == []


def test_fb_and_meta_held_in_2021_net_into_one_meta_name() -> None:
    series = _pit_pack().exposure({"2021-12-31": {"FB": 6_000, "META": 4_000}})
    d = series.attrs["detail"]["2021-12-31"]
    assert d["stock_beta_usd"] == pytest.approx(10_000 * 1.2)
    # One name: residual variance is (6k + 4k)^2, not 6k^2 + 4k^2.
    assert d["residual_daily_variance"] == pytest.approx(10_000**2 * 4e-4 * 0.5)
    assert [t["ticker"] for t in d["transitions"]] == ["FB"]


def test_undated_book_is_todays_book_and_uses_todays_registry() -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        series = _pit_pack().exposure({"SPCX": 10_000})
    detail = series.attrs["detail"]
    assert detail["2026-03-31"]["not_in_feed"] == ["SPCX"]  # SpaceX has no row then
    assert detail["2026-09-30"]["stock_beta_usd"] == pytest.approx(10_000 * 1.4)


def test_window_for_uses_inclusive_start_and_exclusive_end() -> None:
    pack = _pit_pack()
    assert pack.window_for("spcx", "2026-04-06")["priced_as"] == "SPCK"
    assert pack.window_for("SPCX", "2026-04-07")["priced_as"] == "SPCX"
    assert pack.window_for("AAPL", "2020-01-02") is None
