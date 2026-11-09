"""_open_consolidated_first: published stores may carry .zmetadata only."""

import numpy as np
import pytest
import zarr

from riskmodels.snapshots._fund_data import _open_consolidated_first


@pytest.fixture()
def store(tmp_path):
    path = tmp_path / "ds_nav.zarr"
    g = zarr.open_group(str(path), mode="w")
    g.create_dataset("nav", data=np.arange(3, dtype="f8"))
    return path


def test_opens_store_with_zmetadata_only(store):
    zarr.consolidate_metadata(str(store))
    # the publish keeps chunks + .zmetadata and drops per-array metadata
    for name in (".zgroup", ".zattrs"):
        (store / name).unlink(missing_ok=True)
    (store / "nav" / ".zarray").unlink(missing_ok=True)
    (store / "nav" / ".zattrs").unlink(missing_ok=True)
    g = _open_consolidated_first(str(store))
    np.testing.assert_array_equal(g["nav"][:], [0.0, 1.0, 2.0])


def test_falls_back_without_zmetadata(store):
    g = _open_consolidated_first(str(store))
    np.testing.assert_array_equal(g["nav"][:], [0.0, 1.0, 2.0])
