"""RMAPI-30: null items in POST /batch/analyze ``returns`` arrays stay missing in the SDK.

Cells are real values for IEP from the 2026-11-05 release (L3 hedge ratios from
the hedge-weights store, masked on 2026-08-17; gross returns from the daily store).
"""

from __future__ import annotations

import math

from riskmodels.parsing import batch_returns_long_normalize
from riskmodels.portfolio_math import batch_json_to_returns_long

IEP_RETURNS = {
    "dates": ["2026-08-14", "2026-08-17", "2026-08-18"],
    "values": [-0.01066537, 0.02745665, -0.03938115],
    "l1": [-0.39608508, None, -0.37989295],
    "l2": [-0.17521368, None, -0.21547057],
    "l3": [-0.10401509, None, -0.00165738],
    "l3_market_hr": [-0.39608508, None, -0.37989295],
    "l3_sector_hr": [-0.17521368, None, -0.21547057],
    "l3_subsector_hr": [-0.10401509, None, -0.00165738],
}


def test_masked_hedge_ratio_session_is_missing_not_zero() -> None:
    df = batch_json_to_returns_long({"IEP": {"status": "success", "ticker": "IEP", "returns": IEP_RETURNS}})
    assert df is not None
    df = batch_returns_long_normalize(df)
    masked = df[df["date"] == "2026-08-17"].iloc[0]
    for col in ("l3_market_hr", "l3_sector_hr", "l3_subsector_hr"):
        assert masked[col] is None or math.isnan(masked[col]), col
    assert math.isclose(float(masked["returns_gross"]), 0.02745665)
    first = df[df["date"] == "2026-08-14"].iloc[0]
    assert math.isclose(float(first["l3_market_hr"]), -0.39608508)
