"""Optional xarray Dataset from long batch/ticker panels."""

from __future__ import annotations

from typing import Any

import pandas as pd

from .lineage import RiskLineage
from .metadata_attach import attach_sdk_metadata

try:
    import xarray as xr
except ImportError:
    xr = None  # type: ignore[assignment]


def _require_xarray() -> Any:
    if xr is None:
        raise ImportError("Install the xarray extra: pip install riskmodels-py[xarray]")
    return xr


def long_df_to_dataset(df: pd.DataFrame, lineage: RiskLineage | None) -> Any:
    """Build Dataset with dimensions (ticker, date) from long-format DataFrame."""
    xarray = _require_xarray()
    if df.empty:
        ds = xarray.Dataset()
    else:
        work = df.copy()
        if "date" in work.columns:
            work["date"] = pd.to_datetime(work["date"])
        idx = work.set_index(["ticker", "date"])
        ds = idx.to_xarray()
    attach_sdk_metadata(ds, lineage, kind="batch_returns_xarray")
    return ds


def weighted_sum(ds: Any, weights_da: Any, dim: str = "ticker") -> Any:
    """(ds * weights).sum(dim) — requires xarray."""
    _require_xarray()
    return (ds * weights_da).sum(dim=dim)
