"""G.45 — benchmark proxy resolution + realized-return overlay math.

The overlay must be the proxy ETF's own compounded returns on the fund
series' date grid (value equality is the acceptance bar — a plausible
curve is not verification), and every unbuildable case must come back as
an honest empty overlay, never an approximation.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from riskmodels.snapshots._benchmark import resolve_benchmark_proxy
from riskmodels.snapshots._fund_data import _benchmark_overlay_series


# ---------------------------------------------------------------------------
# Proxy resolution shim
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("alias", ["SPY", "spy", "BW-BENCH-SPY", "bw-bench-spy", "IVV", "SP500", "s&p 500"])
def test_spy_aliases_resolve_to_ivv_proxy(alias):
    p = resolve_benchmark_proxy(alias)
    assert p is not None
    assert p.bw_bench_id == "BW-BENCH-SPY"
    assert p.proxy_ticker == "IVV"
    assert p.default_label == "SPY (default)"


@pytest.mark.parametrize("bench", [None, "", "BW-BENCH-EQ70-30", "70/30", "MSCI-WORLD"])
def test_unproxied_benchmarks_resolve_to_none(bench):
    # Blends have no single proxy ETF; unknown ids have no honest source.
    assert resolve_benchmark_proxy(bench) is None


# ---------------------------------------------------------------------------
# Overlay math
# ---------------------------------------------------------------------------

class _FakeClient:
    def __init__(self, dates: list[str], rets: list[float]):
        self._df = pd.DataFrame(
            {"date": dates, "returns_gross": np.array(rets, dtype=np.float32)}
        )
        self.calls: list[dict] = []

    def get_ticker_returns(self, ticker, *, years, validate):
        self.calls.append({"ticker": ticker, "years": years, "validate": validate})
        return self._df


def _daily_dates(start: str, n: int) -> list[str]:
    d0 = np.datetime64(start)
    return [str(d0 + np.timedelta64(i, "D")) for i in range(n)]


def test_anchored_series_matches_manual_cumprod():
    # Bench daily data over the fund's window + history before it.
    dates = _daily_dates("2026-01-01", 40)
    rets = [0.001 * ((i % 5) - 2) for i in range(40)]  # mixed signs
    client = _FakeClient(dates, rets)

    cum_nav = [
        ("2026-01-10", 0.0),        # anchored at 0
        ("2026-01-20", 0.05),
        ("2026-02-05", 0.02),
    ]
    cum_bench, tr_bench = _benchmark_overlay_series(cum_nav, "IVV", client)

    assert [d for d, _ in cum_bench] == [d for d, _ in cum_nav]
    # Manual: C(d)/C(anchor) - 1 with C = cumprod over float32-loaded rets.
    r = np.array(rets, dtype=np.float32).astype(np.float64)
    C = np.cumprod(1.0 + r)
    d_arr = np.array(dates, dtype="datetime64[D]")

    def c_at(d):
        idx = np.searchsorted(d_arr, np.datetime64(d), side="right") - 1
        return C[idx]

    expected = [c_at(d) / c_at("2026-01-10") - 1.0 for d, _ in cum_nav]
    got = [v for _, v in cum_bench]
    assert got == pytest.approx(expected, abs=1e-15)
    assert cum_bench[0][1] == 0.0
    # Window shorter than a year → no trailing-1y figure invented.
    assert "1y" not in tr_bench
    # The proxy ticker, not the benchmark name, is what gets fetched.
    assert client.calls[0]["ticker"] == "IVV"


def test_non_anchored_monthly_series_compounds_from_prior_month_end():
    # Fund monthly series whose first point carries January's return.
    dates = _daily_dates("2025-12-15", 75)
    rets = [0.002] * 75
    client = _FakeClient(dates, rets)

    cum_nav = [("2026-01-31", 0.03), ("2026-02-27", 0.05)]
    cum_bench, _ = _benchmark_overlay_series(cum_nav, "IVV", client)

    r = np.array(rets, dtype=np.float32).astype(np.float64)
    C = np.cumprod(1.0 + r)
    d_arr = np.array(dates, dtype="datetime64[D]")

    def c_at(d):
        idx = np.searchsorted(d_arr, np.datetime64(d), side="right") - 1
        return C[idx]

    # Anchor = 2025-12-31 (end of the month before the first fund period).
    expected0 = c_at("2026-01-31") / c_at("2025-12-31") - 1.0
    assert cum_bench[0] == ("2026-01-31", pytest.approx(expected0, abs=1e-15))


def test_proxy_history_starting_after_anchor_omits_overlay():
    dates = _daily_dates("2026-01-15", 30)  # starts AFTER the fund anchor
    client = _FakeClient(dates, [0.001] * 30)
    cum_nav = [("2026-01-10", 0.0), ("2026-02-05", 0.02)]
    cum_bench, tr_bench = _benchmark_overlay_series(cum_nav, "IVV", client)
    assert cum_bench == [] and tr_bench == {}


def test_proxy_history_ending_early_omits_overlay():
    # Bench ends >7 days before the fund window's end — a flat tail
    # would misstate the comparison, so the overlay is refused.
    dates = _daily_dates("2026-01-01", 20)  # ends 2026-01-20
    client = _FakeClient(dates, [0.001] * 20)
    cum_nav = [("2026-01-05", 0.0), ("2026-02-27", 0.04)]
    cum_bench, tr_bench = _benchmark_overlay_series(cum_nav, "IVV", client)
    assert cum_bench == [] and tr_bench == {}


def test_no_client_and_no_env_key_omits_overlay(monkeypatch):
    monkeypatch.delenv("RISKMODELS_API_KEY", raising=False)
    cum_bench, tr_bench = _benchmark_overlay_series(
        [("2026-01-10", 0.0)], "IVV", None
    )
    assert cum_bench == [] and tr_bench == {}


def test_trailing_1y_present_when_covered():
    dates = _daily_dates("2024-01-01", 900)
    rets = [0.0005] * 900
    client = _FakeClient(dates, rets)
    cum_nav = [("2025-06-30", 0.0), ("2026-05-29", 0.10)]
    _, tr_bench = _benchmark_overlay_series(cum_nav, "IVV", client)
    assert "1y" in tr_bench

    r = np.array(rets, dtype=np.float32).astype(np.float64)
    C = np.cumprod(1.0 + r)
    d_arr = np.array(dates, dtype="datetime64[D]")

    def c_at(d):
        idx = np.searchsorted(d_arr, np.datetime64(d), side="right") - 1
        return C[idx]

    expected = c_at("2026-05-29") / c_at(np.datetime64("2026-05-29") - np.timedelta64(365, "D")) - 1.0
    assert tr_bench["1y"] == pytest.approx(expected, abs=1e-15)


def test_endpoint_failure_omits_overlay():
    class _Boom:
        def get_ticker_returns(self, *a, **k):
            raise RuntimeError("upstream down")

    cum_bench, tr_bench = _benchmark_overlay_series(
        [("2026-01-10", 0.0)], "IVV", _Boom()
    )
    assert cum_bench == [] and tr_bench == {}
