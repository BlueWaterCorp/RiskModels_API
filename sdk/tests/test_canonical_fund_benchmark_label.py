"""G.45 — the canonical fund snapshot keys the benchmark curve by the
loader's disclosed label ("SPY (default)"), never an implied prospectus
benchmark."""

from __future__ import annotations

from riskmodels.snapshots import FundData, from_fund_components


def _fund_data(**kw) -> FundData:
    return FundData(
        bw_fund_id="BW-FUND-BENCH",
        ticker_primary="XT",
        fund_name="Bench Label Test Fund",
        teo="2026-06-30",
        equity_style_9box=None,
        aum_usd=1e9,
        cum_nav_return=[("2026-05-29", 0.0), ("2026-06-30", 0.02)],
        **kw,
    )


def test_bench_curve_keyed_by_disclosed_default_label():
    fd = _fund_data(
        cum_bench_return=[("2026-05-29", 0.0), ("2026-06-30", 0.015)],
        tr_bench={"1y": 0.11},
        benchmark_label="SPY (default)",
    )
    snap = from_fund_components(fd)
    curves = snap.performance.cumulative_curves
    assert "SPY (default)" in curves
    assert "SPY" not in curves  # no undisclosed-benchmark key
    assert curves["SPY (default)"][-1] == ("2026-06-30", 0.015)
    assert snap.performance.trailing_returns["SPY (default)"] == 0.11


def test_legacy_payload_without_label_keeps_spy_key():
    fd = _fund_data(
        cum_bench_return=[("2026-05-29", 0.0), ("2026-06-30", 0.015)],
    )
    snap = from_fund_components(fd)
    assert "SPY" in snap.performance.cumulative_curves


def test_empty_overlay_adds_no_bench_curve():
    fd = _fund_data(benchmark_label="SPY (default)")
    snap = from_fund_components(fd)
    assert list(snap.performance.cumulative_curves) == ["XT"] or (
        "SPY (default)" not in snap.performance.cumulative_curves
    )
