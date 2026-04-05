"""σ helpers for L3 visuals (snapshot vol + returns backfill)."""

from __future__ import annotations

import math

import numpy as np

from riskmodels.visuals.utils import annualized_vol_from_returns_values


def test_annualized_vol_from_returns_values_trailing_window():
    rng = np.random.default_rng(0)
    daily = rng.normal(0, 0.02, size=60).tolist()
    v = annualized_vol_from_returns_values(daily, window=23)
    assert v is not None
    manual = float(np.std(np.asarray(daily[-23:], dtype=float), ddof=1) * np.sqrt(252.0))
    assert math.isclose(v, manual, rel_tol=1e-9)


def test_annualized_vol_from_returns_values_none_when_short():
    assert annualized_vol_from_returns_values(None) is None
    assert annualized_vol_from_returns_values([]) is None
    assert annualized_vol_from_returns_values([0.01]) is None
