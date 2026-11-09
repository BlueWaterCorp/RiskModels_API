"""Store freshness check for the zarr stores the API reads (RMAPI-30 follow-up).

RMAPI-30 had two causes. The hedge-basket route opened a store the pipeline no longer
published, and the cohort store it moved to had been stuck at 2026-10-23 behind an
ERM3 gate warning. Neither the release gates nor the API smoke tests could see this,
because both check that a request succeeds, not what data it read.

The check, store by store, against gs://rm_api_data/eodhd (or ZARR_GCS_PREFIX):
  1. .zmetadata and .zattrs exist.
  2. The newest value on the store's time axis is within the store's cadence of the
     release session. The release session is the newest teo of ds_daily.zarr, the
     store every release writes.
  3. The store has a current ERM3 writer (the static table below; ERM3 records the
     writers in erm3/shared/store_dependencies.py and erm3/shared/zarr_layout.py).
     A store listed as retired fails if it is still published.

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
    {"name": "ds_fundamentals.zarr", "cadence": ("days", 7), "writer": "build_ds_fundamentals",
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


def _open(fs, name: str):
    import zarr  # local import: tests of evaluate() need no GCS stack

    return zarr.open_consolidated(fs.get_mapper(f"{PREFIX}/{name}"), mode="r")


def latest_date(fs, name: str, time_source: str | None = None,
                not_after: dt.date | None = None) -> dt.date | None:
    """Newest date of a store: its time axis, a root attribute ("attr:<key>") or the
    maximum of a date array ("max:<var>"). For "max:", dates after ``not_after`` are
    ignored: ds_fundamentals approximates a missing filing date as period end + 45 days,
    which can lie in the future and would otherwise mask a stale store."""
    grp = _open(fs, name)
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


def run(fs) -> list[Result]:
    session = latest_date(fs, "ds_daily.zarr")
    if session is None:
        raise SystemExit("ds_daily.zarr has no readable teo; cannot set the release session")
    out: list[Result] = []
    for row in STORES:
        name, cadence = row["name"], row["cadence"]
        base = f"{PREFIX}/{name}"
        has_meta, has_attrs = fs.exists(f"{base}/.zmetadata"), fs.exists(f"{base}/.zattrs")
        latest = None
        if has_meta and has_attrs:
            try:
                latest = latest_date(fs, name, row.get("time"), not_after=session)
            except Exception as exc:  # a store that will not open is a failure, not a crash
                out.append(Result(name, "FAIL", f"open failed: {exc}", None, cadence_label(cadence)))
                continue
        out.append(evaluate(name, cadence, latest, session, has_meta, has_attrs))
    listed = {r["name"] for r in STORES}
    for name in RETIRED:
        if name in listed:
            out.append(Result(name, "FAIL", "retired store is still listed in STORES", None, "retired"))
        elif fs.exists(f"{PREFIX}/{name}/.zmetadata"):
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
