"""_open_consolidated_first: published stores may carry chunks, the root
.zgroup and .zmetadata only. Runs on zarr 2 and zarr 3."""
import numpy as np
import pytest
import zarr

from riskmodels.snapshots._fund_data import _open_consolidated_first

_Z3 = int(zarr.__version__.split(".")[0]) >= 3


@pytest.fixture()
def store(tmp_path):
    path = tmp_path / "ds_nav.zarr"
    if _Z3:
        g = zarr.open_group(str(path), mode="w", zarr_format=2)
        g.create_array("nav", data=np.arange(3, dtype="f8"))
    else:
        g = zarr.open_group(str(path), mode="w")
        g.create_dataset("nav", data=np.arange(3, dtype="f8"))
    return path


def test_opens_published_store(store):
    zarr.consolidate_metadata(str(store))
    # the publish drops every per-array metadata file
    for rel in (".zattrs", "nav/.zarray", "nav/.zattrs"):
        (store / rel).unlink(missing_ok=True)
    g = _open_consolidated_first(str(store))
    np.testing.assert_array_equal(g["nav"][:], [0.0, 1.0, 2.0])


def test_falls_back_without_zmetadata(store):
    g = _open_consolidated_first(str(store))
    np.testing.assert_array_equal(g["nav"][:], [0.0, 1.0, 2.0])
