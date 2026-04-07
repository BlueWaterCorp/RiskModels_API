"""JSON serialization helpers for snapshot data contracts.

Handles the tricky bits: pd.DataFrame ↔ records, PortfolioAnalysis ↔ dict,
PeerComparison ↔ dict, NaN/None safety, and date coercion.

Usage
-----
    from riskmodels.snapshots._json_io import dump_json, load_json

    # Serialize any snapshot data object
    dump_json(s1_data, "nvda_s1.json")

    # Reconstruct it
    s1_data = load_json("nvda_s1.json", S1Data)
"""

from __future__ import annotations

import dataclasses
import datetime
import json
import math
from pathlib import Path
from typing import Any

import pandas as pd


# ---------------------------------------------------------------------------
# Encoder — handles pd.DataFrame, dataclasses, numpy, dates, NaN
# ---------------------------------------------------------------------------

def _make_serializable(obj: Any) -> Any:
    """Recursively convert an object tree into JSON-safe primitives."""

    # None passthrough
    if obj is None:
        return None

    # NaN → null
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None

    # numpy scalar → python scalar
    try:
        import numpy as np
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            v = float(obj)
            return None if math.isnan(v) or math.isinf(v) else v
        if isinstance(obj, np.ndarray):
            return [_make_serializable(x) for x in obj.tolist()]
        if isinstance(obj, np.bool_):
            return bool(obj)
    except ImportError:
        pass

    # Timestamps / dates
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()

    # DataFrame → list of record dicts
    if isinstance(obj, pd.DataFrame):
        # Convert to records, cleaning NaN
        records = obj.where(obj.notna(), None).to_dict(orient="records")
        return [_make_serializable(r) for r in records]

    # Series → list
    if isinstance(obj, pd.Series):
        return [_make_serializable(x) for x in obj.tolist()]

    # Dataclass → dict (recursive)
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        d = {}
        for f in dataclasses.fields(obj):
            d[f.name] = _make_serializable(getattr(obj, f.name))
        return d

    # Dict
    if isinstance(obj, dict):
        return {str(k): _make_serializable(v) for k, v in obj.items()}

    # List / tuple
    if isinstance(obj, (list, tuple)):
        return [_make_serializable(x) for x in obj]

    # Path
    if isinstance(obj, Path):
        return str(obj)

    # Primitives pass through
    if isinstance(obj, (str, int, float, bool)):
        return obj

    # Fallback: str()
    return str(obj)


# ---------------------------------------------------------------------------
# Dump / Load
# ---------------------------------------------------------------------------

def dump_json(data: Any, path: str | Path, *, indent: int = 2) -> Path:
    """Serialize a snapshot data object to a JSON file.

    Parameters
    ----------
    data   : Any dataclass (S1Data, S2Data, StockContext, etc.)
    path   : Output file path.
    indent : JSON indentation (default 2).

    Returns
    -------
    Path to the written file.
    """
    out = Path(path)
    payload = {
        "schema_version": "1.0",
        "snapshot_type": type(data).__name__,
        "generated_utc": datetime.datetime.utcnow().isoformat() + "Z",
        "data": _make_serializable(data),
    }
    out.write_text(json.dumps(payload, indent=indent, ensure_ascii=False))
    return out


def load_json(path: str | Path) -> dict[str, Any]:
    """Load a snapshot JSON file and return the raw dict.

    The caller is responsible for reconstructing the target dataclass
    from ``result["data"]``. This keeps the loader simple and avoids
    import cycles — each snapshot module provides its own ``from_json()``
    classmethod that knows how to rebuild DataFrames, PeerComparison, etc.

    Returns
    -------
    Dict with keys: schema_version, snapshot_type, generated_utc, data.
    """
    p = Path(path)
    return json.loads(p.read_text())
