"""Parse API JSON / tabular bodies into DataFrames."""

from __future__ import annotations

from io import BytesIO
from typing import Any

import pandas as pd

from .lineage import RiskLineage
from .legends import RANKINGS_SMALL_COHORT_THRESHOLD
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


def factor_correlation_body_to_row(body: dict[str, Any]) -> dict[str, Any]:
    """Flatten a successful factor-correlation JSON body to one wide row (semantic column names)."""
    row: dict[str, Any] = {}
    if "ticker" in body:
        row["ticker"] = body["ticker"]
    corr = body.get("correlations")
    if isinstance(corr, dict):
        for k, v in sorted(corr.items()):
            row[f"macro_corr_{k}"] = v
    if "return_type" in body:
        row["macro_return_type"] = body["return_type"]
    if "window_days" in body:
        row["macro_window_days"] = body["window_days"]
    if "method" in body:
        row["macro_corr_method"] = body["method"]
    if "overlap_days" in body:
        row["macro_overlap_days"] = body["overlap_days"]
    w = body.get("warnings")
    if isinstance(w, list):
        row["macro_warnings"] = "; ".join(str(x) for x in w) if w else ""
    return row


def rankings_grid_to_dataframe(body: dict[str, Any]) -> pd.DataFrame:
    """Per-ticker GET /rankings/{ticker} → long table with semantic ``ranking_key`` column."""
    rows = body.get("rankings") or []
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df = df.copy()
    df["ranking_key"] = (
        df["window"].astype(str) + "_" + df["cohort"].astype(str) + "_" + df["metric"].astype(str)
    )
    return df


def rankings_top_to_dataframe(body: dict[str, Any]) -> pd.DataFrame:
    """GET /rankings/top → leaderboard table."""
    rows = body.get("rankings") or []
    return pd.DataFrame(rows)


def build_rankings_small_cohort_warnings(df: pd.DataFrame) -> list[str]:
    """Warn when cohort_size is below a minimal threshold (percentile noise)."""
    if df.empty or "cohort_size" not in df.columns:
        return []
    out: list[str] = []
    for _, row in df.iterrows():
        cs = row.get("cohort_size")
        if cs is None or (isinstance(cs, float) and pd.isna(cs)):
            continue
        try:
            n = int(cs)
        except (TypeError, ValueError):
            continue
        if n < RANKINGS_SMALL_COHORT_THRESHOLD:
            rk = row.get("ranking_key")
            if rk is None or (isinstance(rk, float) and pd.isna(rk)):
                parts = [
                    str(row.get("window", "")),
                    str(row.get("cohort", "")),
                    str(row.get("metric", "")),
                ]
                rk = "_".join(p for p in parts if p)
            out.append(
                f"Small cohort (N={n}) for {rk}: rank_percentile may be uninformative "
                f"(threshold N>={RANKINGS_SMALL_COHORT_THRESHOLD}).",
            )
    return list(dict.fromkeys(out))


def rankings_grid_headline(df: pd.DataFrame) -> str:
    """One-line highlight of the best rank_percentile in the grid (for LLM / repr hints)."""
    if df.empty or "rank_percentile" not in df.columns:
        return ""
    sub = df.dropna(subset=["rank_percentile"])
    if sub.empty:
        return ""
    idx = sub["rank_percentile"].idxmax()
    r = sub.loc[idx]
    cs = r.get("cohort_size", "")
    return (
        f"Best rank_percentile={float(r['rank_percentile']):.2f} "
        f"({r.get('window')}_{r.get('cohort')}_{r.get('metric')}, cohort_size={cs})"
    )


def rankings_leaderboard_headline(
    *,
    teo: Any,
    metric: str,
    cohort: str,
    window: str,
    limit: int,
    row_count: int,
) -> str:
    """One-line summary for GET /rankings/top tables (teo + slice size)."""
    return (
        f"Leaderboard teo={teo} rows={row_count}/{limit} "
        f"({window}_{cohort}_{metric}); rank_percentile 100=best."
    )


def factor_correlation_batch_item_to_row(item: dict[str, Any]) -> dict[str, Any]:
    """One row from POST /correlation batch `results[]` entry (success or error)."""
    if "error" in item and "status" in item and "correlations" not in item:
        return {
            "ticker": item.get("ticker"),
            "macro_batch_error": item.get("error"),
            "macro_batch_status": item.get("status"),
        }
    return factor_correlation_body_to_row(item)
