"""PyArrow parquet roundtrip smoke (§2C)."""

from __future__ import annotations

from io import BytesIO

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


def test_parquet_roundtrip_preserves_columns():
    df = pd.DataFrame([{"a": 1, "b": "x"}])
    buf = BytesIO()
    pq.write_table(pa.Table.from_pandas(df), buf)
    back = pq.read_table(BytesIO(buf.getvalue())).to_pandas()
    assert list(back.columns) == ["a", "b"]
    assert int(back["a"].iloc[0]) == 1
