"""Tests for scripts/audit/store_freshness.py on the values observed in production 2026-11-08."""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "audit"))

import store_freshness as sf  # noqa: E402

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "store_freshness_prod_20261108.json").read_text())
SESSION = dt.date.fromisoformat(FIXTURE["session"])


def _cadence(raw):
    return raw if isinstance(raw, str) else tuple(raw)


def test_decode_time_matches_ds_daily_axis():
    assert sf.decode_time([FIXTURE["ds_daily_last_teo_raw"]], FIXTURE["teo_units"]) == [SESSION]


def test_prod_stores_classified_as_observed():
    for row in FIXTURE["stores"]:
        res = sf.evaluate(row["name"], _cadence(row["cadence"]), dt.date.fromisoformat(row["latest"]),
                          SESSION, True, True)
        assert res.status == row["expect"], (row["name"], res.reason)


def test_cohort_store_reports_lag_in_days():
    res = sf.evaluate("ds_erm3_cohorts_SPY_uni_mc_3000.zarr", "session", dt.date(2026, 10, 23), SESSION, True, True)
    assert res.status == "FAIL" and "13 days behind" in res.reason


def test_missing_metadata_fails_before_time_check():
    res = sf.evaluate("ds_erm3_link_betas_SPY.zarr", "session", None, SESSION, False, False)
    assert res.status == "FAIL" and ".zmetadata" in res.reason and ".zattrs" in res.reason


def test_unreadable_time_axis_fails():
    res = sf.evaluate("ds_daily.zarr", "session", None, SESSION, True, True)
    assert res.status == "FAIL" and "time axis" in res.reason


def test_retired_store_not_listed_as_current():
    assert not set(sf.RETIRED) & {r["name"] for r in sf.STORES}


def test_cohort_store_has_session_cadence():
    row = next(r for r in sf.STORES if r["name"].startswith("ds_erm3_cohorts_"))
    assert row["cadence"] == "session" and row["writer"] == "1d"
