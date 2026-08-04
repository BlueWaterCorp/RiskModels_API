"""SDK tests for the cohort store surface (ERM3 H.146).

The behaviour worth pinning down is :func:`demean`. ERM3 residuals are fitted
without an intercept and so are not zero-mean cross-sectionally; the whole
point of the helper is that the correction is applied at the right level, with
the right per-day cohort mean, and stays visible afterwards rather than being
folded silently into the residual.

Fixture values are real rows read from ds_erm3_cohorts_SPY_uni_mc_3000.zarr.
"""

from __future__ import annotations

import json

import httpx
import pandas as pd
import pytest

from riskmodels.client import RiskModelsClient
from riskmodels.cohorts import (
    PUBLIC_COHORTS,
    decompose_selection_vs_drift,
    demean,
    fetch_cohort_cross_section,
    fetch_cohort_series,
)

# Real residual_mean values, teo 2026-07-31 and 2026-07-30.
XLK_MEANS = {"2026-07-30": 0.0117212, "2026-07-31": 0.0068771}
XLC_MEANS = {"2026-07-30": 0.0043821, "2026-07-31": -0.0191149}

DISCLOSURES = {
    "no_intercept_contract": (
        "ERM3 residuals are estimated WITHOUT an intercept and therefore retain "
        "each stock's alpha. The cross-sectional mean is NOT zero. If you are "
        "building relative-ranking signals, demean first using residual_mean."
    ),
    "coverage": "Cohorts cover approximately 88% of eligible universe names.",
}


def _series_payload(request: httpx.Request) -> dict:
    """Serve /cohorts/series honouring the requested cohort subset."""
    requested = request.url.params.get("cohorts")
    wanted = requested.split(",") if requested else list(PUBLIC_COHORTS)
    table = {"XLK": XLK_MEANS, "XLC": XLC_MEANS}
    return {
        "cohorts": [
            {
                "ticker": t,
                "level": 2,
                "parent": "SPY",
                "points": [
                    {"date": d, "values": {"residual_mean": v}}
                    for d, v in table.get(t, {}).items()
                ],
                "proxied_fraction": 0.0 if t == "XLK" else 0.695,
            }
            for t in wanted
            if t in table
        ],
        "range": ["2026-07-30", "2026-07-31"],
        "variables": ["residual_mean"],
        "min_names": 0,
        "universe": "uni_mc_3000",
        "market_factor_etf": "SPY",
        "store_build": "2026-08-03T12:04:21",
        "disclosures": DISCLOSURES,
        "data_source": "zarr",
    }


def _client(handler):
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def _series_client(captured: list[httpx.Request] | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if captured is not None:
            captured.append(request)
        return httpx.Response(200, json=_series_payload(request))

    return _client(handler)


def test_fetch_cohort_series_is_long_form_with_proxy_disclosure():
    df = fetch_cohort_series(_series_client(), cohorts=["XLK", "XLC"])
    assert set(df.columns) >= {"date", "cohort", "level", "parent", "residual_mean"}
    assert len(df) == 4
    assert df["date"].dtype.kind == "M"
    # XLC is majority-proxied over long windows — the caller must be able to see it.
    assert df.attrs["proxied_fraction"]["XLC"] == pytest.approx(0.695)
    assert "WITHOUT an intercept" in df.attrs["disclosures"]["no_intercept_contract"]


def test_fetch_cohort_cross_section_indexes_by_cohort():
    payload = {
        "teo": "2026-07-31",
        "cohorts": [
            {
                "ticker": "SPY",
                "level": 1,
                "parent": None,
                "values": {
                    "residual_mean": -0.0099841,
                    "residual_sd": 0.0408115,
                    "n_names": 2776,
                    "n_effective": 80.674,
                },
            },
            {
                "ticker": "XLC",
                "level": 2,
                "parent": "SPY",
                "values": {
                    "residual_mean": -0.0191149,
                    "residual_sd": 0.0400293,
                    "n_names": 137,
                    "n_effective": 3.386,
                },
            },
        ],
        "disclosures": DISCLOSURES,
    }
    df = fetch_cohort_cross_section(
        _client(lambda r: httpx.Response(200, json=payload))
    )
    assert list(df.index) == ["SPY", "XLC"]
    assert df.attrs["teo"] == "2026-07-31"
    # n_effective far below n_names is the concentration signal worth preserving.
    assert df.loc["XLC", "n_effective"] < df.loc["XLC", "n_names"] / 10


def test_demean_subtracts_the_matching_cohort_and_day():
    frame = pd.DataFrame(
        {
            "date": ["2026-07-30", "2026-07-31", "2026-07-31"],
            "ticker": ["NVDA", "NVDA", "GOOGL"],
            "sector_etf": ["XLK", "XLK", "XLC"],
            "residual": [0.02, 0.03, -0.01],
        }
    )
    out = demean(frame, _series_client())

    assert out.loc[0, "residual_demeaned"] == pytest.approx(0.02 - XLK_MEANS["2026-07-30"])
    assert out.loc[1, "residual_demeaned"] == pytest.approx(0.03 - XLK_MEANS["2026-07-31"])
    assert out.loc[2, "residual_demeaned"] == pytest.approx(-0.01 - XLC_MEANS["2026-07-31"])
    # The correction stays auditable rather than vanishing into the number.
    assert out.loc[2, "cohort_residual_mean"] == pytest.approx(XLC_MEANS["2026-07-31"])
    # Original column is untouched.
    assert out["residual"].tolist() == [0.02, 0.03, -0.01]


def test_demean_requests_only_the_cohorts_and_window_it_needs():
    captured: list[httpx.Request] = []
    frame = pd.DataFrame(
        {
            "date": ["2026-07-31"],
            "sector_etf": ["XLK"],
            "residual": [0.03],
        }
    )
    demean(frame, _series_client(captured))

    params = captured[0].url.params
    assert params["cohorts"] == "XLK"
    assert params["start_date"] == "2026-07-31"
    assert params["end_date"] == "2026-07-31"
    assert params["variables"] == "residual_mean"


def test_demean_at_market_level_uses_the_market_cohort():
    captured: list[httpx.Request] = []
    frame = pd.DataFrame({"date": ["2026-07-31"], "residual": [0.03]})
    # No sector column needed — market-level demeaning is against SPY.
    demean(frame, _series_client(captured), level="market")
    assert captured[0].url.params["cohorts"] == "SPY"


def test_demean_rejects_cohorts_outside_the_addressable_set():
    frame = pd.DataFrame(
        {
            "date": ["2026-07-31"],
            "sector_etf": ["SOXX"],
            "residual": [0.03],
        }
    )
    with pytest.raises(ValueError, match="outside the addressable set"):
        demean(frame, _series_client())


def test_demean_requires_the_columns_it_names():
    frame = pd.DataFrame({"date": ["2026-07-31"], "resid": [0.03], "sector_etf": ["XLK"]})
    with pytest.raises(KeyError):
        demean(frame, _series_client())


def test_demean_leaves_a_null_when_the_cohort_mean_is_missing():
    """A day the store has no usable mean for must not silently pass through
    uncorrected — that would look like a demeaned number and not be one."""
    frame = pd.DataFrame(
        {
            "date": ["2020-01-02"],  # outside the fixture's returned window
            "sector_etf": ["XLK"],
            "residual": [0.03],
        }
    )
    out = demean(frame, _series_client())
    assert pd.isna(out.loc[0, "residual_demeaned"])
    assert pd.isna(out.loc[0, "cohort_residual_mean"])


# ── selection vs drift ──────────────────────────────────────────────────────

# Real shape returned by POST /cohorts/pnl-decomposition, with the totals from
# the six-name book measured over 2025-08-01..2026-07-31.
PNL_PAYLOAD = {
    "level": "sector",
    "basis": "sector-level residual, demeaned against each name's sector cohort",
    "range": ["2025-08-01", "2026-07-31"],
    "n_days": 251,
    "coverage": {"requested": 6, "included": 6, "dropped": []},
    # selection + drift == residual exactly, as the service guarantees.
    "totals": {
        "residual": -0.08116204,
        "selection": -0.09187204,
        "drift": 0.01071,
        "selection_share": 0.896,
    },
    "by_cohort": [
        {"cohort": "XLK", "net_weight": 0.35, "n_positions": 2,
         "drift": 0.00708, "selection": -0.10085},
    ],
    "net_weight": 0.45,
    "gross_weight": 0.75,
    "disclosures": {
        "interpretation": "Selection is what the book earned by holding names that beat their cohort's average residual.",
        "no_intercept_contract": DISCLOSURES["no_intercept_contract"],
        "constant_weights": "Weights are treated as constant across the window.",
        "not_advice": "Realized historical attribution at the sector level only. Not a forecast.",
    },
}


def _pnl_client(captured: list[httpx.Request] | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if captured is not None:
            captured.append(request)
        return httpx.Response(200, json=PNL_PAYLOAD)

    return _client(handler)


def test_decompose_accepts_a_dataframe_of_positions():
    captured: list[httpx.Request] = []
    book = pd.DataFrame(
        {"ticker": ["nvda", "pfe"], "weight": [0.2, -0.1]}
    )
    out = decompose_selection_vs_drift(
        book, _pnl_client(captured), start_date="2025-08-01", end_date="2026-07-31"
    )

    sent = json.loads(captured[0].content)
    # Tickers normalize; weights keep their sign and are NOT rescaled — the drift
    # term is proportional to net weight, so normalizing would change the answer.
    assert sent["positions"] == [
        {"ticker": "NVDA", "weight": 0.2},
        {"ticker": "PFE", "weight": -0.1},
    ]
    assert sent["level"] == "sector"
    assert sent["start_date"] == "2025-08-01"
    assert out["totals"]["selection"] == pytest.approx(-0.09187204)


def test_decompose_accepts_plain_mappings():
    out = decompose_selection_vs_drift(
        [{"ticker": "NVDA", "weight": 0.2}], _pnl_client()
    )
    assert out["totals"]["residual"] == pytest.approx(-0.08116204)


def test_decompose_returns_parts_that_sum_to_the_whole():
    out = decompose_selection_vs_drift([{"ticker": "NVDA", "weight": 0.2}], _pnl_client())
    t = out["totals"]
    assert t["selection"] + t["drift"] == pytest.approx(t["residual"], abs=1e-6)


def test_decompose_requires_the_expected_columns():
    bad = pd.DataFrame({"symbol": ["NVDA"], "weight": [0.2]})
    with pytest.raises(KeyError, match="ticker"):
        decompose_selection_vs_drift(bad, _pnl_client())


def test_decompose_omits_the_series_unless_asked():
    captured: list[httpx.Request] = []
    decompose_selection_vs_drift([{"ticker": "NVDA", "weight": 1.0}], _pnl_client(captured))
    assert json.loads(captured[0].content)["include_series"] is False
