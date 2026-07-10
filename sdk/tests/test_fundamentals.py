"""Fundamentals SDK surface (H.89.6): client.get_fundamentals /
client.get_fundamentals_sensitivity_grid / client.next_earnings, plus the
pure parsing/estimation helpers in riskmodels.fundamentals.

Mocked-HTTP coverage mirrors test_client_filers.py: URL/param construction,
as_of pass-through, DataFrame shape, and the sensitivity-grid variant.
"""

from __future__ import annotations

import httpx
import pytest

from riskmodels.client import RiskModelsClient
from riskmodels.fundamentals import (
    estimate_next_earnings,
    fundamentals_json_to_dataframe,
    sensitivity_grid_json_to_dataframe,
)

TICKER = "AAPL"

ROWS = [
    {
        "period_end_date": "2025-06-30",
        "filed_date": "2025-08-01",
        "filed_date_source": "exact",
        "gross_margin": None,
        "operating_margin": None,
        "roe_ttm": 1.5,
        "roa_ttm": 0.3,
        "leverage_ratio": 1.2,
        "fcf_margin": 0.25,
        "beta_market": 1.1,
        "beta_sector": -0.1,
        "beta_subsector": -0.05,
        "beta_source": "in-universe",
        "rf_rate": 0.04,
        "cost_of_equity": 0.095,
        "cost_of_debt": 0.03,
        "wacc": 0.08,
        "economic_profit": 12.0,
    },
    {
        "period_end_date": "2025-09-30",
        "filed_date": "2025-10-31",
        "filed_date_source": "exact",
        "gross_margin": None,
        "operating_margin": None,
        "roe_ttm": 1.6,
        "roa_ttm": 0.33,
        "leverage_ratio": 1.27,
        "fcf_margin": 0.26,
        "beta_market": 1.2,
        "beta_sector": -0.2,
        "beta_subsector": -0.1,
        "beta_source": "in-universe",
        "rf_rate": 0.04,
        "cost_of_equity": 0.10,
        "cost_of_debt": 0.03,
        "wacc": 0.085,
        "economic_profit": 13.0,
    },
]


def _client(handler) -> RiskModelsClient:
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


# ── client.get_fundamentals ─────────────────────────────────────────────────


def test_get_fundamentals_builds_params_and_returns_raw_dict_by_default():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "ticker": TICKER,
                "as_of": "2026-03-31",
                "periods_returned": 2,
                "rows": ROWS,
                "market_cap": {"value": 3.5e12, "basis": "current_snapshot"},
                "disclosures": {"parameters": {"erp": 0.06}},
            },
        )

    out = _client(handler).get_fundamentals(
        TICKER, as_of="2026-03-31", periods=4, erp=0.06, tax_rate=0.25, rf_tenor="1y"
    )
    assert f"/fundamentals/{TICKER}" in captured["url"]
    assert captured["params"] == {
        "periods": "4",
        "erp": "0.06",
        "tax_rate": "0.25",
        "rf_tenor": "1y",
        "as_of": "2026-03-31",
    }
    assert isinstance(out, dict)
    assert out["rows"] == ROWS


def test_get_fundamentals_omits_as_of_when_not_given():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["params"] = dict(request.url.params)
        return httpx.Response(200, json={"ticker": TICKER, "rows": []})

    _client(handler).get_fundamentals(TICKER)
    assert "as_of" not in captured["params"]
    # Defaults echoed even when not explicitly passed.
    assert captured["params"]["periods"] == "8"
    assert captured["params"]["rf_tenor"] == "10y"


def test_get_fundamentals_as_dataframe_carries_sdk_attrs():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "ticker": TICKER,
                "as_of": "2026-03-31",
                "rows": ROWS,
                "market_cap": {"value": 3.5e12},
                "disclosures": {"realized_historical_only": "..."},
            },
        )

    df = _client(handler).get_fundamentals(TICKER, as_dataframe=True)
    assert list(df["period_end_date"]) == ["2025-06-30", "2025-09-30"]
    assert (df["market_cap"] == 3.5e12).all()
    assert df.attrs.get("riskmodels_semantic_cheatsheet") is not None
    assert df.attrs.get("riskmodels_fundamentals_disclosures") == {
        "realized_historical_only": "..."
    }


def test_get_fundamentals_dataframe_never_carries_held_back_columns():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ticker": TICKER, "rows": ROWS})

    df = _client(handler).get_fundamentals(TICKER, as_dataframe=True)
    for held_back in ("revenue", "net_income", "eps_actual", "earnings_surprise"):
        assert held_back not in df.columns


# ── client.get_fundamentals_sensitivity_grid ────────────────────────────────


def test_get_fundamentals_sensitivity_grid_builds_grid_params():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "ticker": TICKER,
                "rows": ROWS,
                "sensitivity_grid": {
                    "period_end_date": "2025-09-30",
                    "filed_date": "2025-10-31",
                    "erp_values": [0.04, 0.06],
                    "rf_tenor_values": ["1y", "10y"],
                    "tax_rate": 0.21,
                    "cells": [
                        [
                            {"cost_of_equity": 0.08, "wacc": 0.07, "economic_profit": 10.0},
                            {"cost_of_equity": 0.09, "wacc": 0.075, "economic_profit": 11.0},
                        ],
                        [
                            {"cost_of_equity": 0.10, "wacc": 0.08, "economic_profit": 12.0},
                            {"cost_of_equity": 0.11, "wacc": 0.085, "economic_profit": 13.0},
                        ],
                    ],
                },
            },
        )

    out = _client(handler).get_fundamentals_sensitivity_grid(
        TICKER, erp_grid=[0.04, 0.06], rf_tenor_grid=["1y", "10y"], tax_rate=0.21
    )
    assert captured["params"]["grid"] == "true"
    assert captured["params"]["erp_grid"] == "0.04,0.06"
    assert captured["params"]["rf_tenor_grid"] == "1y,10y"
    assert out["sensitivity_grid"]["erp_values"] == [0.04, 0.06]


def test_get_fundamentals_sensitivity_grid_as_dataframe_is_long_form():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "ticker": TICKER,
                "rows": ROWS,
                "sensitivity_grid": {
                    "period_end_date": "2025-09-30",
                    "filed_date": "2025-10-31",
                    "erp_values": [0.04, 0.06],
                    "rf_tenor_values": ["1y", "10y"],
                    "tax_rate": 0.21,
                    "cells": [
                        [
                            {"cost_of_equity": 0.08, "wacc": 0.07, "economic_profit": 10.0},
                            {"cost_of_equity": 0.09, "wacc": 0.075, "economic_profit": 11.0},
                        ],
                        [
                            {"cost_of_equity": 0.10, "wacc": 0.08, "economic_profit": 12.0},
                            {"cost_of_equity": 0.11, "wacc": 0.085, "economic_profit": 13.0},
                        ],
                    ],
                },
            },
        )

    df = _client(handler).get_fundamentals_sensitivity_grid(TICKER, as_dataframe=True)
    assert len(df) == 4
    assert set(df["erp"]) == {0.04, 0.06}
    assert set(df["rf_tenor"]) == {"1y", "10y"}
    row = df[(df["erp"] == 0.06) & (df["rf_tenor"] == "10y")].iloc[0]
    assert row["cost_of_equity"] == pytest.approx(0.11)
    assert row["wacc"] == pytest.approx(0.085)


def test_get_fundamentals_sensitivity_grid_null_when_no_pit_period():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ticker": TICKER, "rows": [], "sensitivity_grid": None})

    df = _client(handler).get_fundamentals_sensitivity_grid(TICKER, as_dataframe=True)
    assert df.empty
    raw = _client(handler).get_fundamentals_sensitivity_grid(TICKER)
    assert raw["sensitivity_grid"] is None


# ── client.next_earnings ────────────────────────────────────────────────────


def test_next_earnings_projects_from_median_filing_cadence():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ticker": TICKER, "rows": ROWS})

    out = _client(handler).next_earnings(TICKER)
    assert out["ticker"] == TICKER
    assert out["last_filed_date"] == "2025-10-31"
    # Median gap between 2025-08-01 and 2025-10-31 is 91 days.
    assert out["median_cadence_days"] == 91
    assert out["estimated_next_filed_date"] == "2026-01-30"
    assert out["basis"] == "filed_date_cadence"
    assert "not a confirmed earnings-calendar date" in out["note"]


def test_next_earnings_null_with_fewer_than_two_filed_quarters():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ticker": TICKER, "rows": ROWS[:1]})

    out = _client(handler).next_earnings(TICKER)
    assert out["estimated_next_filed_date"] is None
    assert out["n_periods_observed"] == 1


# ── pure helpers (no HTTP) ──────────────────────────────────────────────────


def test_fundamentals_json_to_dataframe_empty_rows_keeps_full_columns():
    df = fundamentals_json_to_dataframe({"rows": []})
    assert df.empty
    assert "roe_ttm" in df.columns
    assert "wacc" in df.columns


def test_estimate_next_earnings_never_reconstructs_held_back_fields():
    # Only filed_date (an allowlisted PIT stamp) drives the estimate — no
    # revenue/eps/surprise field is read even if present on the row.
    dirty_rows = [
        {"filed_date": "2025-01-30", "revenue": 999, "eps_estimate": 1.23},
        {"filed_date": "2025-05-01", "revenue": 999, "eps_estimate": 1.23},
        {"filed_date": "2025-08-01", "revenue": 999, "eps_estimate": 1.23},
    ]
    est = estimate_next_earnings(TICKER, dirty_rows)
    assert est.estimated_next_filed_date == "2025-11-01"
    assert "revenue" not in est.to_dict()
    assert "eps_estimate" not in est.to_dict()


def test_sensitivity_grid_json_to_dataframe_handles_missing_grid():
    df = sensitivity_grid_json_to_dataframe({"rows": []})
    assert df.empty
    assert list(df.columns) == [
        "period_end_date",
        "filed_date",
        "erp",
        "rf_tenor",
        "cost_of_equity",
        "wacc",
        "economic_profit",
    ]


def test_fundamentals_dataframe_carries_sec_facts_ratios_and_bridge():
    """The new surface: sec_facts (nested raw), capital-return ratios, and the equity bridge
    are columns; raw line items still never appear as FLAT columns (they live inside sec_facts)."""
    from riskmodels.fundamentals import fundamentals_json_to_dataframe

    df = fundamentals_json_to_dataframe(
        {
            "rows": [
                {
                    "period_end_date": "2026-03-31",
                    "sec_facts": {"revenue": {"value": 111184000000, "source": "us_gaap"}},
                    "payout_ratio": 0.13,
                    "retention_ratio": 0.87,
                    "buyback_ratio": 0.8,
                    "total_payout_ratio": 0.76,
                    "sustainable_growth": 1.36,
                    "equity_bridge_residual": -1995998720,
                    "equity_bridge_inputs": ["net_income", "share_repurchases"],
                }
            ]
        }
    )
    for col in (
        "sec_facts", "payout_ratio", "retention_ratio", "buyback_ratio",
        "total_payout_ratio", "sustainable_growth",
        "equity_bridge_residual", "equity_bridge_inputs",
    ):
        assert col in df.columns, col
    # raw line items are nested, never flat columns
    for flat in ("revenue", "net_income", "total_equity"):
        assert flat not in df.columns
    assert df["sec_facts"].iloc[0]["revenue"]["source"] == "us_gaap"
    assert df["equity_bridge_inputs"].iloc[0] == ["net_income", "share_repurchases"]
