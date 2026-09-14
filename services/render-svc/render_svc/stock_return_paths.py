"""Load observed stock return paths through the existing RiskModels API."""
from __future__ import annotations

from datetime import date, datetime, timezone
import math
import os

from fastapi import HTTPException
import requests

FIELDS = ("gross_return", "l1_combined_factor_return", "l2_combined_factor_return",
          "l3_combined_factor_return", "l3_residual_return")
WINDOW_DAYS = {"3m": 92, "6m": 183, "1y": 366, "2y": 731, "max": 15 * 366}


def load_return_paths(ticker: str, as_of: str, window: str = "1y") -> tuple[dict, str]:
    if window not in WINDOW_DAYS:
        raise HTTPException(status_code=422, detail=f"Unsupported return-path window: {window}")
    today = datetime.now(timezone.utc).date()
    try:
        cutoff = today if as_of == "latest" else date.fromisoformat(as_of)
        if as_of != "latest" and cutoff.isoformat() != as_of:
            raise ValueError("Noncanonical date")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="as_of must be latest or YYYY-MM-DD") from exc
    # Pull sufficient history for the requested cutoff, then trim by actual
    # observation dates. These are reality-time paths, not knowledge-time reads.
    days_needed = WINDOW_DAYS[window] + max(0, (today - cutoff).days) + 7
    years = min(15, math.ceil(days_needed / 365.25))
    key = (os.environ.get("RISKMODELS_API_KEY") or os.environ.get("RENDER_SVC_RISKMODELS_API_KEY") or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="Stock returns API credentials are not configured")
    base = os.environ.get("RISKMODELS_BASE_URL", "https://riskmodels.app/api").rstrip("/")
    try:
        response = requests.get(f"{base}/returns-decomposition", params={"ticker": ticker, "years": years},
                                headers={"Authorization": f"Bearer {key}"}, timeout=45)
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Stock daily returns could not be loaded") from exc
    if not isinstance(payload, dict) or payload.get("ticker") != ticker:
        raise HTTPException(status_code=502, detail="Stock returns response has the wrong ticker")
    metadata = payload.get("_metadata") or {}
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=502, detail="Stock returns metadata is invalid")
    dates = payload.get("dates")
    if not isinstance(dates, list):
        raise HTTPException(status_code=502, detail="Stock return dates are missing")
    previous = ""
    for day in dates:
        try:
            valid = isinstance(day, str) and date.fromisoformat(day).isoformat() == day and day > previous
        except ValueError:
            valid = False
        if not valid:
            raise HTTPException(status_code=502, detail="Stock return dates are invalid or duplicated")
        previous = day
    if any(not isinstance(payload.get(field), list) or len(payload[field]) != len(dates) for field in FIELDS):
        raise HTTPException(status_code=502, detail="Stock return layers are missing or misaligned")
    indices = [i for i, day in enumerate(dates) if day <= cutoff.isoformat()]
    if len(indices) < 2:
        raise HTTPException(status_code=404, detail=f"Insufficient observed returns for {ticker} at or before {as_of}")
    trimmed = {field: [payload[field][i] for i in indices] for field in FIELDS}
    selected_dates = [dates[i] for i in indices]
    for field, values in trimmed.items():
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v <= -1 for v in values):
            raise HTTPException(status_code=502, detail=f"Stock return layer {field} contains unavailable observations")
    return {
        **trimmed, "dates": selected_dates, "ticker": ticker,
        "data_source": payload.get("data_source"), "_metadata": metadata,
    }, selected_dates[-1]
