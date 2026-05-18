"""``_decode_teo_array`` — shared TEO decoder tests (MASTER_BACKLOG P.7).

Per-fund zarr stores written by Funds_DAG over time settled on three
different ``teo`` encodings, and four read sites in ``_fund_data.py``
historically each decoded inline with subtly different logic. The
worst was ``ds_nav``'s naive ``[str(t) for t in nav_teo[finite]]`` —
if a writer started emitting CF int-days here, the stringify silently
produced raw integers (``"12345"``) instead of dates, and those rotted
forward as if they were dates. Silent date misalignment in the F1's
NAV-vs-attribution comparison (the central narrative).

This module centralizes the decoding decision so all four stores
produce the same ``datetime64[D]`` output regardless of writer flavor.
"""

from __future__ import annotations

import numpy as np

from riskmodels.snapshots._fund_data import _decode_teo_array


class _FakeTeoArr:
    """Minimal zarr-array stand-in: subscriptable + ``.attrs`` dict."""

    def __init__(self, data: np.ndarray, attrs: dict | None = None) -> None:
        self._data = data
        self.attrs = attrs or {}

    def __getitem__(self, idx):
        return self._data[idx]


# ---------------------------------------------------------------------------
# Encoding 1: CF int days (post-2026-05 ds_ph writers)
# ---------------------------------------------------------------------------


def test_decodes_days_since_epoch():
    """``units = "days since 1970-01-01"`` + int64 days → datetime64[D]."""
    arr = _FakeTeoArr(
        data=np.array([0, 366, 20454], dtype=np.int64),
        attrs={"units": "days since 1970-01-01"},
    )
    out = _decode_teo_array(arr)
    assert out.dtype == np.dtype("datetime64[D]")
    assert str(out[0]) == "1970-01-01"
    assert str(out[1]) == "1971-01-02"  # 1970 wasn't a leap year, 366 days later
    assert str(out[2]) == "2026-01-01"  # 20454 days = ~56 years


def test_decodes_days_since_non_epoch_origin():
    """``units = "days since 2000-01-01"`` with a non-Unix origin
    still decodes correctly."""
    arr = _FakeTeoArr(
        data=np.array([0, 1, 366], dtype=np.int64),
        attrs={"units": "days since 2000-01-01"},
    )
    out = _decode_teo_array(arr)
    assert str(out[0]) == "2000-01-01"
    assert str(out[1]) == "2000-01-02"
    assert str(out[2]) == "2001-01-01"  # 2000 was a leap year (366 days)


def test_decodes_days_since_with_trailing_time_component():
    """``units = "days since YYYY-MM-DD HH:MM:SS"`` (xarray sometimes
    writes the full timestamp) — the helper strips after the first space."""
    arr = _FakeTeoArr(
        data=np.array([100], dtype=np.int64),
        attrs={"units": "days since 1970-01-01 00:00:00"},
    )
    out = _decode_teo_array(arr)
    assert str(out[0]) == "1970-04-11"


# ---------------------------------------------------------------------------
# Encoding 2: CF int seconds (less common but covered)
# ---------------------------------------------------------------------------


def test_decodes_seconds_since_epoch_via_units():
    """``units = "seconds since 1970-01-01"`` → datetime64[D] via the
    explicit seconds-since branch."""
    arr = _FakeTeoArr(
        data=np.array([0, 86400, 86400 * 366], dtype=np.int64),
        attrs={"units": "seconds since 1970-01-01"},
    )
    out = _decode_teo_array(arr)
    assert str(out[0]) == "1970-01-01"
    assert str(out[1]) == "1970-01-02"
    assert str(out[2]) == "1971-01-02"


# ---------------------------------------------------------------------------
# Encoding 3: legacy int seconds-since-Unix-epoch (no units attr)
# ---------------------------------------------------------------------------


def test_decodes_legacy_seconds_when_no_units_attr():
    """``ds_portfolio.zarr`` historically wrote int seconds-since-Unix-epoch
    with no ``units`` attr — the helper falls back to that interpretation."""
    arr = _FakeTeoArr(
        data=np.array([0, 86400, 1_700_000_000], dtype=np.int64),
        attrs={},  # no units → legacy seconds-since-epoch path
    )
    out = _decode_teo_array(arr)
    assert str(out[0]) == "1970-01-01"
    assert str(out[1]) == "1970-01-02"
    # 2023-11-14 UTC ≈ 1700000000 unix seconds.
    assert str(out[2]) == "2023-11-14"


def test_decodes_legacy_seconds_when_units_unrelated():
    """An unrelated ``units`` attr (not 'days since' nor 'seconds since')
    falls back to legacy seconds-since-epoch — defensive."""
    arr = _FakeTeoArr(
        data=np.array([0], dtype=np.int64),
        attrs={"units": "something_else"},
    )
    out = _decode_teo_array(arr)
    assert str(out[0]) == "1970-01-01"


# ---------------------------------------------------------------------------
# Encoding 4: native datetime64 already on disk
# ---------------------------------------------------------------------------


def test_passes_through_native_datetime64_day():
    """An array already of dtype ``datetime64[D]`` passes through unchanged."""
    raw = np.array(["2025-11-30", "2025-12-31"], dtype="datetime64[D]")
    arr = _FakeTeoArr(data=raw)
    out = _decode_teo_array(arr)
    assert out.dtype == np.dtype("datetime64[D]")
    assert str(out[0]) == "2025-11-30"
    assert str(out[1]) == "2025-12-31"


def test_casts_native_datetime64_seconds_to_day_precision():
    """A native ``datetime64[s]`` array gets cast down to day precision —
    so consumers always see ``datetime64[D]`` regardless of input precision."""
    raw = np.array(["2025-11-30T14:30:00", "2025-12-31T23:59:59"], dtype="datetime64[s]")
    arr = _FakeTeoArr(data=raw)
    out = _decode_teo_array(arr)
    assert out.dtype == np.dtype("datetime64[D]")
    assert str(out[0]) == "2025-11-30"
    assert str(out[1]) == "2025-12-31"


def test_casts_native_datetime64_nanoseconds_to_day():
    """``datetime64[ns]`` (xarray's default) also casts cleanly to day
    precision — confirms the helper handles the precision range we see
    in practice."""
    raw = np.array(["2025-11-30"], dtype="datetime64[ns]")
    arr = _FakeTeoArr(data=raw)
    out = _decode_teo_array(arr)
    assert out.dtype == np.dtype("datetime64[D]")
    assert str(out[0]) == "2025-11-30"


# ---------------------------------------------------------------------------
# Shape preservation + the bug this helper exists to prevent
# ---------------------------------------------------------------------------


def test_output_shape_matches_input():
    arr = _FakeTeoArr(
        data=np.array([0, 100, 200, 300], dtype=np.int64),
        attrs={"units": "days since 1970-01-01"},
    )
    out = _decode_teo_array(arr)
    assert out.shape == (4,)


def test_the_p7_silent_misalignment_regression():
    """**The P.7 fix.** Before this helper, ``ds_nav``'s decoder was:

        nav_teo_all = [str(t) for t in nav_teo[finite]]

    If a writer started emitting CF int days here, ``str(int64_scalar)``
    produces ``"12345"`` not ``"2025-12-08"``. That value then flowed
    into nav_teo_all and was used as if it were a date string, causing
    silent misalignment between the NAV chart and the attribution
    waterfall in the F1.

    This test verifies the helper produces real date strings for CF int
    days input — what the naive decoder would have silently corrupted."""
    arr = _FakeTeoArr(
        data=np.array([20454], dtype=np.int64),  # would naively stringify to "20454"
        attrs={"units": "days since 1970-01-01"},
    )
    out = _decode_teo_array(arr)
    decoded = str(out[0])
    # The naive str(int64) bug would yield "20454"; the helper yields a real date.
    assert decoded != "20454"
    assert decoded.startswith("20")  # 4-digit ISO year
    assert decoded.count("-") == 2   # YYYY-MM-DD shape
