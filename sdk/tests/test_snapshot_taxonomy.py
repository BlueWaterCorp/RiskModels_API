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


def test_store_class_vars_picks_new_then_older_pair():
    assert T.store_class_vars(["bw_sector_id", "bw_industry_id", "x"]) == (
        "bw_sector_id", "bw_industry_id", False)
    assert T.store_class_vars(["bw_sector_code", "fs_industry_code"]) == (
        "bw_sector_code", "fs_industry_code", True)
    import pytest

    with pytest.raises(KeyError):
        T.store_class_vars(["close"])


def test_older_sector_codes_translate_to_ids():
    a = T.sector_ids(np.array([1, 6, 11, 0, -1, np.nan, 12]), legacy=True)
    assert a[:3].tolist() == [71, 76, 81] and np.isnan(a[3:]).all()
    assert all(_sector_etf(x) == etf for x, etf in zip(a[:3], ["XLE", "XLV", "XLRE"]))
    b = T.sector_ids(np.array([76, 6]), legacy=False)
    assert b[0] == 76 and np.isnan(b[1])


def test_older_industry_codes_are_grouping_keys():
    k = T.industry_keys(np.array([2320, 0, -1, np.nan]), legacy=True)
    assert k[0] == 2320 and np.isnan(k[1:]).all()
    assert np.isnan(T.industry_keys(np.array([2320]), legacy=False)).all()
