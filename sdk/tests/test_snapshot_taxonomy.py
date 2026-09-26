"""SDK-local sector/industry table: ids, hedge ETFs, and rejection of other numberings."""
from __future__ import annotations

import numpy as np

from riskmodels.snapshots import _taxonomy as T
from riskmodels.snapshots.zarr_context import _sector_etf, _sector_name, _subsector_etf


def test_ranges_and_sizes():
    assert set(T.SECTORS) == set(range(71, 82))
    assert len(T.INDUSTRIES) == 59 and all(101 <= k <= 159 for k in T.INDUSTRIES)
    assert all(v[2] in T.SECTORS for v in T.INDUSTRIES.values())


def test_lookups():
    assert _sector_etf(76) == "XLV" and _sector_etf(76.0) == "XLV"
    assert _subsector_etf(131) == "XBI" and _subsector_etf(132) == "XPH"
    assert _sector_name(76) == "Health"
    assert T.industry_code(131) == "HLTH.DEV"


def test_other_numberings_are_unclassified():
    assert _sector_etf(6) is None and _subsector_etf(2320) is None
    assert _sector_etf(None) is None and _subsector_etf(float("nan")) is None
    a = T.clean_ids(np.array([131, -1, 2320, np.nan]), kind="industry")
    assert a[0] == 131 and np.isnan(a[1:]).all()
