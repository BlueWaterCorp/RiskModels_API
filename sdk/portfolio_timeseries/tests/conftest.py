"""Shared fixtures for the portfolio_timeseries test suite.

Also resolves the riskmodels import shadow (see the block below) so the live
integration module actually runs instead of skipping every session.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# --------------------------------------------------------------------------
# Resolve the riskmodels version shadow BEFORE anything imports riskmodels.
#
# The repo builds the `riskmodels-py` wheel from `sdk/riskmodels/`, and that
# checked-in source trails the installed wheel (0.3.10 in-tree vs 0.3.11 in
# site-packages). Because `sdk/portfolio_timeseries/tests/` and
# `sdk/portfolio_timeseries/` both carry an `__init__.py` but `sdk/` does not,
# pytest computes the package root as `sdk/` and does `sys.path.insert(0, sdk)`
# during collection. `import riskmodels` then resolves to the in-tree 0.3.10,
# which has no `as_of` on get_filer_holdings and no get_filer_concentration —
# so the live module's version gate skipped the entire module, every run.
#
# The "import riskmodels first" shim used by build_lagged.py and friends does
# NOT work here: those are scripts that run before `sdk/` is ever on the path,
# whereas pytest has already prepended it before this conftest executes.
#
# Fix: drop the `sdk/` entry, import riskmodels so the installed distribution
# wins and is cached in sys.modules, then restore the path. Caching is what
# makes it stick — pytest re-prepends the package root for every collected
# module, but an already-imported module is not re-resolved.
#
# This is a workaround for a packaging problem, not a fix for it. The real fix
# is to sync `sdk/riskmodels/` to 0.3.11, which is a cross-repo release action
# outside this module's scope. See HANDOFF.md "Known limitations".
# --------------------------------------------------------------------------
_SDK_DIR = str(Path(__file__).resolve().parents[2])


def _import_riskmodels_unshadowed():
    saved = list(sys.path)
    sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != Path(_SDK_DIR)]
    try:
        import riskmodels  # noqa: F401  (cached in sys.modules from here on)
    except Exception:  # pragma: no cover - absent install is handled by importorskip
        pass
    finally:
        sys.path[:] = saved


_import_riskmodels_unshadowed()

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
