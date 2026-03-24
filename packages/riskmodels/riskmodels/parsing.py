"""Parse API JSON / tabular bodies into DataFrames."""

from __future__ import annotations

from io import BytesIO
from typing import Any

import pandas as pd

from .lineage import RiskLineage
from .mapping import BATCH_RETURNS_LONG_RENAME, TICKER_RETURNS_COLUMN_RENAME
from .metadata_attach import attach_sdk_metadata


def parquet_bytes_to_dataframe(content: bytes) -> pd.DataFrame:
    return pd.read_parquet(BytesIO(content))


def csv_bytes_to_dataframe(content: bytes) -> pd.DataFrame:
    return pd.read_csv(BytesIO(content))


def ticker_returns_json_to_dataframe(body: dict[str, Any]) -> pd.DataFrame:
    rows = body.get("data") or []
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df = df.rename(columns=TICKER_RETURNS_COLUMN_RENAME)
    return df


def l3_decomposition_json_to_dataframe(body: dict[str, Any]) -> pd.DataFrame:
    n = len(body.get("dates") or [])
    if n == 0:
        return pd.DataFrame()
    cols = {
        "date": body["dates"],
        "l3_market_hr": body.get("l3_market_hr", [None] * n),
        "l3_sector_hr": body.get("l3_sector_hr", [None] * n),
        "l3_subsector_hr": body.get("l3_subsector_hr", [None] * n),
        "l3_market_er": body.get("l3_market_er", [None] * n),
        "l3_sector_er": body.get("l3_sector_er", [None] * n),
        "l3_subsector_er": body.get("l3_subsector_er", [None] * n),
        "l3_residual_er": body.get("l3_residual_er", [None] * n),
    }
    return pd.DataFrame(cols)


def batch_returns_long_normalize(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.rename(columns=BATCH_RETURNS_LONG_RENAME)
    if "date" in out.columns:
        out["date"] = pd.to_datetime(out["date"]).dt.date.astype(str)
    return out


def attach_df_metadata(
    df: pd.DataFrame,
    lineage: RiskLineage | None,
    kind: str,
) -> pd.DataFrame:
    attach_sdk_metadata(df, lineage, kind=kind)
    return df
