"""Live integration tests against production (or RISKMODELS_BASE_URL).

Excluded from default `pytest` runs via `-m \"not integration\"` in pyproject.toml.
Run explicitly: `pytest -m integration` with RISKMODELS_API_KEY set.

CI: `.github/workflows/sdk-integration.yml` (uses secret TEST_API_KEY as RISKMODELS_API_KEY).
"""

from __future__ import annotations

import os

import pandas as pd
import pytest

from riskmodels import RiskModelsClient

pytestmark = pytest.mark.integration


def _require_api_key() -> None:
    if not (os.environ.get("RISKMODELS_API_KEY") or "").strip():
        pytest.skip("Set RISKMODELS_API_KEY for live integration tests")


@pytest.fixture(scope="module")
def live_client() -> RiskModelsClient:
    _require_api_key()
    return RiskModelsClient.from_env()


def test_live_search_tickers_includes_aapl(live_client: RiskModelsClient) -> None:
    out = live_client.search_tickers(search="AAPL", as_dataframe=True)
    assert isinstance(out, pd.DataFrame)
    assert not out.empty
    col = "ticker" if "ticker" in out.columns else out.columns[0]
    tickers = {str(x).upper() for x in out[col].astype(str)}
    assert "AAPL" in tickers


def test_live_get_metrics_aapl_shape(live_client: RiskModelsClient) -> None:
    row = live_client.get_metrics("AAPL", validate="warn")
    assert isinstance(row, dict)
    assert row.get("ticker")
    # Flattened semantic / wire mix: at least one L3 HR or ER present when data exists
    keys = {k.lower() for k in row}
    assert keys & {
        "l3_market_hr",
        "l3_mkt_hr",
        "l3_market_er",
        "l3_mkt_er",
    }, f"expected L3 metric keys in row, got {sorted(keys)[:20]}..."


def test_live_get_fundamentals_aapl_shape(live_client: RiskModelsClient) -> None:
    """H.89.6: client.get_fundamentals() against the live H.89.5 endpoint."""
    df = live_client.get_fundamentals("AAPL", periods=4, as_dataframe=True)
    assert isinstance(df, pd.DataFrame)
    assert not df.empty
    assert {"period_end_date", "filed_date", "roe_ttm", "cost_of_equity", "wacc"} <= set(df.columns)
    last = df.iloc[-1]
    assert last["roe_ttm"] is not None
    assert df.attrs.get("riskmodels_fundamentals_disclosures") is not None
    # Never a held-back raw field, even if the reader were to leak one.
    for held_back in ("revenue", "net_income", "eps_actual", "earnings_surprise"):
        assert held_back not in df.columns


def test_live_get_fundamentals_sensitivity_grid_aapl(live_client: RiskModelsClient) -> None:
    """H.89.6: sensitivity-grid variant — real erp x rf_tenor grid for the latest quarter.

    The `grid=true` query param and `sensitivity_grid` response field are new
    (this PR) and may not be deployed to the endpoint `RISKMODELS_BASE_URL`
    points at yet — an older server silently ignores the unknown param and
    omits the field, which the parser turns into an empty DataFrame (verified
    directly against the DAL in tests/fundamentals-live.test.ts on the API
    side). This test always exercises the client call end-to-end and asserts
    the full grid shape once the field is present.
    """
    df = live_client.get_fundamentals_sensitivity_grid(
        "AAPL", erp_grid=[0.04, 0.05, 0.06], rf_tenor_grid=["1y", "10y"], as_dataframe=True
    )
    assert isinstance(df, pd.DataFrame)
    if df.empty:
        pytest.skip(
            "sensitivity_grid not present in the response — the grid=true variant "
            "is not deployed yet at this RISKMODELS_BASE_URL."
        )
    assert len(df) == 6  # 3 erp values x 2 tenors
    assert set(df["erp"]) == {0.04, 0.05, 0.06}
    assert set(df["rf_tenor"]) == {"1y", "10y"}
    # Higher erp -> higher cost_of_equity at a fixed tenor (positive beta_market for AAPL).
    at_10y = df[df["rf_tenor"] == "10y"].sort_values("erp")
    coe = at_10y["cost_of_equity"].tolist()
    assert coe == sorted(coe)


def test_live_next_earnings_aapl_projects_a_cadence(live_client: RiskModelsClient) -> None:
    """H.89.6: cadence-based next-earnings estimate, not a confirmed calendar date."""
    out = live_client.next_earnings("AAPL")
    assert out["ticker"] == "AAPL"
    assert out["basis"] == "filed_date_cadence"
    assert out["n_periods_observed"] >= 2
    assert out["estimated_next_filed_date"] is not None
    # AAPL reports quarterly — cadence should be in the ~75-110 day band.
    assert 75 <= out["median_cadence_days"] <= 110


def test_live_aom_with_fundamentals_end_to_end(live_client: RiskModelsClient) -> None:
    """H.89.6: AOM `.with_fundamentals()` end-to-end against the live client."""
    from riskmodels import rm, run
    from riskmodels.aom import stock

    req = rm().subject(stock("AAPL")).scope(date_range_preset="1y").with_fundamentals().structured()
    out = run(live_client, req)
    assert not out["errors"]
    fetch_result = out["steps_out"][-1]["result"]
    assert isinstance(fetch_result, pd.DataFrame)
    assert "roe_ttm" in fetch_result.columns
