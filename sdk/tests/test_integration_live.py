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
