"""Store freshness check for the zarr stores the API reads (RMAPI-30 follow-up).

RMAPI-30 had two causes. The hedge-basket route opened a store the pipeline no longer
published, and the cohort store it moved to had been stuck at 2026-10-23 behind an
ERM3 gate warning. Neither the release gates nor the API smoke tests could see this,
because both check that a request succeeds, not what data it read.

The check, store by store, against gs://rm_api_data/eodhd (or ZARR_GCS_PREFIX):
  1. .zmetadata and .zattrs exist.
  2. The newest value on the store's time axis is within the store's cadence of the
     expected session. That is the later of the newest release manifest's session
     and the last completed NYSE session, so a stale daily store cannot validate
     itself.
  3. The store has a current ERM3 writer (the static table below; ERM3 records the
     writers in erm3/shared/store_dependencies.py and erm3/shared/zarr_layout.py).
     A store listed as retired fails if it is still published.

When ZARR_GCS_RELEASE_SLOTS is enabled, CURRENT is resolved to slots/a or slots/b
before any store is checked. With the switch off, the fixed prefix is used unchanged.

Usage:
  python scripts/audit/store_freshness.py           # human report, exit 1 on failure
  python scripts/audit/store_freshness.py --json    # machine-readable report

Reads GCS with the caller's Google credentials (application default). It is read-only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from dataclasses import dataclass, asdict
from zoneinfo import ZoneInfo

FACTOR_SET = os.environ.get("ZARR_FACTOR_SET_ID", "SPY_uni_mc_3000")
PREFIX = os.environ.get("ZARR_GCS_PREFIX", "rm_api_data/eodhd").strip("/")

# Cadence: "session" = must equal the release session; ("days", N) = at most N calendar
# days behind it. Writer = the ERM3 step that produces the store (see store_dependencies.py).
STORES: list[dict] = [
    {"name": "ds_daily.zarr", "cadence": "session", "writer": "eodhd_daily"},
    {"name": "ds_etf.zarr", "cadence": "session", "writer": "eodhd_etf"},
    {"name": "ds_masks.zarr", "cadence": "session", "writer": "build_mask_zarr"},
    {"name": "ds_market_cap.zarr", "cadence": "session", "writer": "eodhd_daily"},
    {"name": "ds_macro_factor.zarr", "cadence": "session", "writer": "macro_factor"},
    # Newest filing date stored, not the quarter axis (period_end_date lags by a quarter).
    {"name": "ds_fundamentals.zarr", "cadence": ("days", 14), "writer": "build_ds_fundamentals",
     "time": "max:filed_date"},
    {"name": f"ds_erm3_returns_{FACTOR_SET}.zarr", "cadence": "session", "writer": "1d"},
    {"name": f"ds_erm3_hedge_weights_{FACTOR_SET}.zarr", "cadence": "session", "writer": "1d"},
    {"name": f"ds_erm3_industry_{FACTOR_SET}.zarr", "cadence": "session", "writer": "1d"},
    {"name": f"ds_erm3_residual_signal_{FACTOR_SET}.zarr", "cadence": "session", "writer": "1d"},
    {"name": f"ds_rankings_{FACTOR_SET}.zarr", "cadence": "session", "writer": "rankings"},
    # The cohort store is emitted at the end of every 1d pass (risk_decomposition.emit_cohort_store).
    {"name": f"ds_erm3_cohorts_{FACTOR_SET}.zarr", "cadence": "session", "writer": "1d"},
    # A single snapshot with no time axis; its root attribute records the week it was fitted through.
    {"name": f"ds_erm3_weekly_hedge_{FACTOR_SET}.zarr", "cadence": ("days", 10), "writer": "weekly_hedge",
     "time": "attr:computed_through"},
    {"name": f"ds_exposure_month_end_{FACTOR_SET}.zarr", "cadence": ("days", 35), "writer": "exposure_month_end"},
]

# Stores ERM3 no longer writes. Still being published, or still listed in STORES, is a failure.
RETIRED: list[str] = [
    "ds_erm3_link_betas_SPY.zarr",  # replaced by the cohort store (erm3/core/cohort_store.py)
]

TIME_AXES = ("teo", "date", "time", "month_end", "week")
TRUE_VALUES = {"1", "true", "yes", "on"}
MANIFEST_SESSION_KEYS = {
    "session",
    "release_session",
    "teo",
    "latest_teo",
    "max_teo",
    "as_of",
    "data_as_of",
}


@dataclass
class Result:
    store: str
    status: str  # OK | FAIL
    reason: str
    latest: str | None
    cadence: str


def decode_time(values, units: str | None) -> list[dt.date]:
    """Decode a CF-style integer time axis ('days since YYYY-MM-DD ...') to dates."""
    if units and units.startswith("days since "):
        base = dt.date.fromisoformat(units.split("since ", 1)[1].strip()[:10])
        return [base + dt.timedelta(days=int(v)) for v in values]
    if units and units.startswith("seconds since "):
        base = dt.datetime.fromisoformat(units.split("since ", 1)[1].strip()[:19])
        return [(base + dt.timedelta(seconds=int(v))).date() for v in values]
    raise ValueError(f"unsupported time units: {units!r}")


def cadence_label(cadence) -> str:
    return cadence if isinstance(cadence, str) else f"<= {cadence[1]} days"


def evaluate(name: str, cadence, latest: dt.date | None, session: dt.date,
             has_meta: bool, has_attrs: bool) -> Result:
    """Judge one store from its metadata flags and newest time-axis date."""
    label = cadence_label(cadence)
    if not has_meta or not has_attrs:
        missing = [n for n, ok in ((".zmetadata", has_meta), (".zattrs", has_attrs)) if not ok]
        return Result(name, "FAIL", f"missing {', '.join(missing)}", None, label)
    if latest is None:
        return Result(name, "FAIL", "no readable time axis", None, label)
    if cadence == "session":
        ok = latest >= session
        reason = "current" if ok else f"{(session - latest).days} days behind release session {session}"
    else:
        lag = (session - latest).days
        ok = lag <= cadence[1]
        reason = "current" if ok else f"{lag} days behind release session {session} (limit {cadence[1]})"
    return Result(name, "OK" if ok else "FAIL", reason, latest.isoformat(), label)


def release_slots_enabled() -> bool:
    return os.environ.get("ZARR_GCS_RELEASE_SLOTS", "").strip().lower() in TRUE_VALUES


def _read_text(fs, path: str) -> str:
    data = fs.cat(path)
    return data.decode("utf-8") if isinstance(data, bytes) else str(data)


def resolve_prefix(fs, fixed_prefix: str = PREFIX) -> str:
    """Resolve the configured base exactly once through CURRENT when slots are on.

    The API falls back to the fixed, mirrored prefix when CURRENT is absent,
    unreadable or invalid. This command is one-shot, so there is no prior cached
    slot to retain on a transient read error.
    """
    fixed = fixed_prefix.strip("/")
    if not release_slots_enabled():
        return fixed
    try:
        raw = json.loads(_read_text(fs, f"{fixed}/CURRENT"))
    except Exception:  # the API also falls back on any CURRENT read/parse failure
        return fixed
    slot = raw.get("slot") if isinstance(raw, dict) else None
    return f"{fixed}/slots/{slot}" if slot in ("a", "b") else fixed


def _manifest_date_values(value, key: str | None = None) -> list[dt.date]:
    dates: list[dt.date] = []
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            dates.extend(_manifest_date_values(child_value, str(child_key).lower()))
    elif isinstance(value, list):
        for child in value:
            dates.extend(_manifest_date_values(child, key))
    elif key in MANIFEST_SESSION_KEYS and isinstance(value, str):
        try:
            dates.append(dt.date.fromisoformat(value[:10]))
        except ValueError:
            pass
    return dates


def newest_manifest_session(fs, prefix: str) -> dt.date | None:
    """Return the session recorded by the newest release manifest."""
    paths = list(fs.glob(f"{prefix}/_manifests/*"))
    if not paths:
        raise ValueError(f"no release manifests under {prefix}/_manifests")

    def newest_key(path: str):
        try:
            info = fs.info(path)
        except (FileNotFoundError, OSError):
            info = {}
        stamp = info.get("updated") or info.get("mtime") or info.get("created") or ""
        return str(stamp), path

    path = max(paths, key=newest_key)
    try:
        manifest = json.loads(_read_text(fs, path))
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError(f"newest release manifest is not readable JSON: {path}") from exc
    dates = _manifest_date_values(manifest)
    # ERM3 manifests record publish timestamps, not a session; the calendar then decides alone.
    return max(dates) if dates else None


def _observed(d: dt.date) -> dt.date:
    if d.weekday() == 5:
        return d - dt.timedelta(days=1)
    if d.weekday() == 6:
        return d + dt.timedelta(days=1)
    return d


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    first = dt.date(year, month, 1)
    return first + dt.timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> dt.date:
    if month == 12:
        last = dt.date(year + 1, 1, 1) - dt.timedelta(days=1)
    else:
        last = dt.date(year, month + 1, 1) - dt.timedelta(days=1)
    return last - dt.timedelta(days=(last.weekday() - weekday) % 7)


def _easter_sunday(year: int) -> dt.date:
    """Gregorian Easter (Meeus/Jones/Butcher), used for Good Friday."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    ell = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ell) // 451
    month, day = divmod(h + ell - 7 * m + 114, 31)
    return dt.date(year, month, day + 1)


def nyse_holidays(year: int) -> set[dt.date]:
    holidays = {
        _observed(dt.date(year, 1, 1)),
        _nth_weekday(year, 1, 0, 3),
        _nth_weekday(year, 2, 0, 3),
        _easter_sunday(year) - dt.timedelta(days=2),
        _last_weekday(year, 5, 0),
        _observed(dt.date(year, 7, 4)),
        _nth_weekday(year, 9, 0, 1),
        _nth_weekday(year, 11, 3, 4),
        _observed(dt.date(year, 12, 25)),
    }
    if year >= 2022:
        holidays.add(_observed(dt.date(year, 6, 19)))
    # A Saturday New Year's Day is observed on the prior calendar year.
    next_new_year = dt.date(year + 1, 1, 1)
    if next_new_year.weekday() == 5:
        holidays.add(next_new_year - dt.timedelta(days=1))
    return holidays


def _is_nyse_session(day: dt.date) -> bool:
    return day.weekday() < 5 and day not in nyse_holidays(day.year)


def nyse_early_closes(year: int) -> set[dt.date]:
    """13:00 ET closes: the day before Independence Day, the day after Thanksgiving, Christmas Eve."""
    out: set[dt.date] = set()
    july3 = dt.date(year, 7, 3)
    if _is_nyse_session(july3) and _observed(dt.date(year, 7, 4)) != july3:
        out.add(july3)
    out.add(_nth_weekday(year, 11, 3, 4) + dt.timedelta(days=1))
    dec24 = dt.date(year, 12, 24)
    if _is_nyse_session(dec24):
        out.add(dec24)
    return out


def _close_time(day: dt.date) -> dt.time:
    return dt.time(13, 0) if day in nyse_early_closes(day.year) else dt.time(16, 0)


def last_completed_nyse_session(now: dt.datetime | None = None) -> dt.date:
    """Most recent NYSE session whose close (16:00 ET, or 13:00 ET on an early close) has passed."""
    eastern = ZoneInfo("America/New_York")
    if now is None:
        now = dt.datetime.now(eastern)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=eastern)
    else:
        now = now.astimezone(eastern)
    day = now.date()
    if not (_is_nyse_session(day) and now.time() >= _close_time(day)):
        day -= dt.timedelta(days=1)
    while not _is_nyse_session(day):
        day -= dt.timedelta(days=1)
    return day


def expected_session(fs, prefix: str, now: dt.datetime | None = None) -> dt.date:
    """Independent expected session from both release metadata and the calendar."""
    calendar = last_completed_nyse_session(now)
    manifest = newest_manifest_session(fs, prefix)
    return max(manifest, calendar) if manifest else calendar


def _open(fs, name: str, prefix: str = PREFIX):
    import zarr  # local import: tests of evaluate() need no GCS stack

    return zarr.open_consolidated(fs.get_mapper(f"{prefix}/{name}"), mode="r")


def latest_date(fs, name: str, time_source: str | None = None,
                not_after: dt.date | None = None, prefix: str = PREFIX) -> dt.date | None:
    """Newest date of a store: its time axis, a root attribute ("attr:<key>") or the
    maximum of a date array ("max:<var>"). For "max:", dates after ``not_after`` are
    ignored: ds_fundamentals approximates a missing filing date as period end + 45 days,
    which can lie in the future and would otherwise mask a stale store."""
    grp = _open(fs, name, prefix)
    if time_source and time_source.startswith("attr:"):
        raw = grp.attrs.get(time_source[5:])
        return dt.date.fromisoformat(str(raw)[:10]) if raw else None
    if time_source and time_source.startswith("max:"):
        import numpy as np

        arr = grp[time_source[4:]]
        vals = np.asarray(arr[...], dtype="float64")
        # Drop NaN and the int64 missing-value sentinel (about -9.2e18), which is not a date.
        vals = vals[np.isfinite(vals) & (np.abs(vals) < 1e6)]
        dates = decode_time(np.unique(vals), arr.attrs.get("units"))
        if not_after is not None:
            dates = [d for d in dates if d <= not_after]
        return max(dates) if dates else None
    for axis in TIME_AXES:
        if axis in grp:
            arr = grp[axis]
            vals = arr[-1:]
            return decode_time(vals, arr.attrs.get("units"))[-1]
    return None


def run(fs, now: dt.datetime | None = None) -> list[Result]:
    prefix = resolve_prefix(fs, PREFIX)
    try:
        # Release manifests are an append-only log under the fixed base; only
        # the served store tree moves under slots/<a|b>.
        session = expected_session(fs, PREFIX, now)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    out: list[Result] = []
    for row in STORES:
        name, cadence = row["name"], row["cadence"]
        base = f"{prefix}/{name}"
        has_meta, has_attrs = fs.exists(f"{base}/.zmetadata"), fs.exists(f"{base}/.zattrs")
        latest = None
        if has_meta and has_attrs:
            try:
                latest = latest_date(fs, name, row.get("time"), not_after=session, prefix=prefix)
            except Exception as exc:  # a store that will not open is a failure, not a crash
                out.append(Result(name, "FAIL", f"open failed: {exc}", None, cadence_label(cadence)))
                continue
        out.append(evaluate(name, cadence, latest, session, has_meta, has_attrs))
    listed = {r["name"] for r in STORES}
    for name in RETIRED:
        if name in listed:
            out.append(Result(name, "FAIL", "retired store is still listed in STORES", None, "retired"))
        elif fs.exists(f"{prefix}/{name}/.zmetadata"):
            out.append(Result(name, "FAIL", "retired store is still published", None, "retired"))
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--json", action="store_true")
    args = p.parse_args(argv)
    import gcsfs

    results = run(gcsfs.GCSFileSystem())
    if args.json:
        print(json.dumps([asdict(r) for r in results], indent=2))
    else:
        for r in results:
            print(f"{r.status:4}  {r.store:48} latest={r.latest or '-':10}  {r.cadence:11}  {r.reason}")
        fails = [r for r in results if r.status == "FAIL"]
        print(f"\n{len(results) - len(fails)} OK, {len(fails)} FAIL")
    return 1 if any(r.status == "FAIL" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
