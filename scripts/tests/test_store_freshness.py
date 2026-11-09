"""Tests for scripts/audit/store_freshness.py on the values observed in production 2026-11-08."""

from __future__ import annotations

import datetime as dt
import fnmatch
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "audit"))

import store_freshness as sf  # noqa: E402

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "store_freshness_prod_20261108.json").read_text())
SESSION = dt.date.fromisoformat(FIXTURE["session"])


class FakeFS:
    def __init__(self, objects: dict[str, str], metadata: dict[str, dict] | None = None):
        self.objects = objects
        self.metadata = metadata or {}
        self.cat_calls: list[str] = []

    def cat(self, path: str):
        self.cat_calls.append(path)
        if path not in self.objects:
            raise FileNotFoundError(path)
        return self.objects[path].encode()

    def glob(self, pattern: str):
        return [path for path in self.objects if fnmatch.fnmatch(path, pattern)]

    def info(self, path: str):
        return self.metadata.get(path, {})

    def exists(self, path: str):
        return path in self.objects


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


def test_fundamentals_has_fourteen_day_cadence():
    row = next(r for r in sf.STORES if r["name"] == "ds_fundamentals.zarr")
    assert row["cadence"] == ("days", 14)


def test_fixed_prefix_does_not_read_current_when_slots_are_off(monkeypatch):
    monkeypatch.delenv("ZARR_GCS_RELEASE_SLOTS", raising=False)
    fs = FakeFS({"bucket/base/CURRENT": '{"slot":"b"}'})
    assert sf.resolve_prefix(fs, "bucket/base") == "bucket/base"
    assert fs.cat_calls == []


def test_release_slot_resolves_current_like_the_api(monkeypatch):
    monkeypatch.setenv("ZARR_GCS_RELEASE_SLOTS", "1")
    fs = FakeFS({"bucket/base/CURRENT": '{"slot":"b","release_id":"2593c682"}'})
    assert sf.resolve_prefix(fs, "bucket/base") == "bucket/base/slots/b"
    assert fs.cat_calls == ["bucket/base/CURRENT"]


def test_expected_session_uses_manifest_and_completed_exchange_session():
    path = "bucket/base/_manifests/2593c682.json"
    fs = FakeFS({path: json.dumps({"release_id": "2593c682", "session": FIXTURE["session"]})})
    observed = dt.datetime(2026, 11, 8, 12, tzinfo=dt.timezone.utc)
    assert sf.expected_session(fs, "bucket/base", observed) == dt.date(2026, 11, 6)


def test_run_fails_when_daily_store_lags_independent_session(monkeypatch):
    monkeypatch.delenv("ZARR_GCS_RELEASE_SLOTS", raising=False)
    monkeypatch.setattr(sf, "STORES", [{"name": "ds_daily.zarr", "cadence": "session", "writer": "daily"}])
    monkeypatch.setattr(sf, "RETIRED", [])
    path = f"{sf.PREFIX}/_manifests/2593c682.json"
    fs = FakeFS({
        path: json.dumps({"release_id": "2593c682", "session": FIXTURE["session"]}),
        f"{sf.PREFIX}/ds_daily.zarr/.zmetadata": "{}",
        f"{sf.PREFIX}/ds_daily.zarr/.zattrs": "{}",
    })
    monkeypatch.setattr(sf, "latest_date", lambda *args, **kwargs: SESSION)
    observed = dt.datetime(2026, 11, 8, 12, tzinfo=dt.timezone.utc)
    results = sf.run(fs, now=observed)
    assert results[0].status == "FAIL"
    assert "1 days behind" in results[0].reason


def test_run_audits_the_slot_named_by_current(monkeypatch):
    monkeypatch.setenv("ZARR_GCS_RELEASE_SLOTS", "1")
    monkeypatch.setattr(sf, "STORES", [{"name": "ds_daily.zarr", "cadence": "session", "writer": "daily"}])
    monkeypatch.setattr(sf, "RETIRED", [])
    slot_prefix = f"{sf.PREFIX}/slots/b"
    manifest_path = f"{sf.PREFIX}/_manifests/2593c682.json"
    fs = FakeFS({
        f"{sf.PREFIX}/CURRENT": '{"slot":"b","release_id":"2593c682"}',
        manifest_path: json.dumps({"release_id": "2593c682", "session": FIXTURE["session"]}),
        f"{slot_prefix}/ds_daily.zarr/.zmetadata": "{}",
        f"{slot_prefix}/ds_daily.zarr/.zattrs": "{}",
    })
    opened_prefixes = []

    def latest(*args, **kwargs):
        opened_prefixes.append(kwargs["prefix"])
        return dt.date(2026, 11, 6)

    monkeypatch.setattr(sf, "latest_date", latest)
    observed = dt.datetime(2026, 11, 8, 12, tzinfo=dt.timezone.utc)
    results = sf.run(fs, now=observed)
    assert results[0].status == "OK"
    assert opened_prefixes == [slot_prefix]
