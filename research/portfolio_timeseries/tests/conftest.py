"""Shared fixtures for the portfolio_timeseries test suite.

History note: this file used to carry a `sys.path` shim that dropped `sdk/` from the path so
`import riskmodels` reached the installed wheel instead of an older in-tree copy. It is gone
(PR #373 review, hygiene): the module now lives under `research/`, so `sdk/` is never on
pytest's path, and the in-tree SDK is 0.4.0 with every method this suite uses. See
HANDOFF.md §7.7. Do not re-add it.
"""

from __future__ import annotations

import pytest

pytest.importorskip("xarray")

from portfolio_timeseries import make_mock_holdings

# Three quarterly filings, each (report_date, available_date). The lag between a
# quarter-end and its public 13F date is the whole point of the bi-temporal
# layout, so the two dates are deliberately far apart.
_QUARTERS = [
    ("2024-03-31", "2024-05-15"),  # Q1
    ("2024-06-30", "2024-08-14"),  # Q2
    ("2024-09-30", "2024-11-14"),  # Q3
]

@pytest.fixture
def quarters():
    return list(_QUARTERS)

@pytest.fixture
def mock_holdings():
    """A deterministic 3-filing, 2-ticker mock book for one filer."""
    return make_mock_holdings("0001067983", _QUARTERS, ["AAA", "BBB"], seed=0)
