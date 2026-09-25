"""Live integration tests — PortfolioTimeSeries against the real RiskModels API.

These hit ``riskmodels.app`` and need working credentials, so they SKIP cleanly
when the SDK / creds aren't wired (``importorskip`` + a probe call). They are the
verification Conrad asked for: that ``from_cik``/``as_of``/``concentration`` behave
against the shipped 0.3.11 endpoints.

**SDK-version gate:** the migrated code requires ``riskmodels`` 0.3.11
(server-side ``as_of`` on ``get_filer_holdings`` + ``get_filer_concentration``).
This repo also vendors ``sdk/riskmodels/`` at 0.3.10, which shadows the
pip-installed 0.3.11 whenever ``sdk/`` is first on ``sys.path`` (pytest's rootdir).
When the *imported* client lacks ``as_of`` these tests SKIP with a loud reason
rather than fail — the code is validated against real 0.3.11 (see SESSION_NOTES.md),
and the skip flags the stale vendored copy, which needs a cross-repo sync. This is
the same "environment can't run these" pattern as the creds-based skip, not a
mask over a code defect.

Contract facts pinned here (see SESSION_NOTES.md for the full discrepancy list):
- 0.3.11 resolves ``as_of`` server-side on ``filing_date`` — historical queries
  return the real vintage; dates before the holdings floor raise ``APIError``,
  which ``as_of`` maps to an empty snapshot.
- ``filing_date`` (available_date) is real and recovered from the portfolio series
  when the holdings envelope omits it.
"""

from __future__ import annotations

import inspect
from datetime import date, timedelta

import pytest

pytest.importorskip("xarray")

import numpy as np

riskmodels = pytest.importorskip("riskmodels")

# Gate: skip the whole module unless the *imported* client exposes the 0.3.11
# server-side `as_of` on get_filer_holdings (else the local 0.3.10 is shadowing).
if "as_of" not in inspect.signature(
    riskmodels.RiskModelsClient.get_filer_holdings
).parameters:
    pytest.skip(
        "requires riskmodels>=0.3.11 (get_filer_holdings as_of); the imported "
        f"riskmodels {getattr(riskmodels, '__version__', '?')} at "
        f"{getattr(riskmodels, '__file__', '?')} lacks it — the vendored "
        "sdk/riskmodels 0.3.10 is shadowing the pip 0.3.11. See SESSION_NOTES.md.",
        allow_module_level=True,
    )

from portfolio_timeseries import MarketNeutralOverlay, PortfolioTimeSeries

BERKSHIRE = "0001067983"


@pytest.fixture(scope="module")
def client():
    """A live client, or skip the whole module if creds/network aren't available."""
    try:
        c = riskmodels.RiskModelsClient.from_env()
        # Cheap probe that also confirms the API answers.
        c.search_filers(q="Berkshire", limit=1)
    except Exception as e:  # noqa: BLE001 - any failure => skip, not fail
        pytest.skip(f"live RiskModels API unavailable: {type(e).__name__}: {e}")
    return c


@pytest.fixture(scope="module")
def berkshire(client):
    return PortfolioTimeSeries.from_cik(BERKSHIRE, client=client)


def test_from_cik_builds_bitemporal_dataset_with_real_filing_date(berkshire):
    ds = berkshire._holdings
    assert set(ds.dims) == {"report_date", "available_date", "ticker"}
    assert ds.sizes["ticker"] > 0
    # Real, non-null bi-temporal dates.
    report = ds["report_date"].values[0]
    avail = ds["available_date"].values[0]
    assert not np.isnat(report)
    assert not np.isnat(avail)
    # A 13F becomes public AFTER the quarter it reports — never before.
    assert avail >= report
    # Filer id resolved to the SDK's bw_filer_id form.
    assert berkshire._bw_filer_id.startswith("BW-FILER")


def test_holdings_are_figi_keyed_never_cusip(berkshire):
    # security_id must be a FIGI (BW-BBG...), and no CUSIP-shaped id leaks in.
    secids = [str(s) for s in berkshire._holdings["security_id"].values]
    assert secids, "expected at least one holding"
    assert all(s.startswith("BW-") for s in secids)


def test_as_of_current_returns_latest_PUBLIC_snapshot(berkshire):
    """``as_of(T)`` resolves to the newest vintage that was already public at T.

    Deliberately date-independent. An earlier version pinned ``as_of(2026-07-01)``
    against ``_holdings["report_date"][0]`` (the newest vintage the API knows about
    *today*) and asserted they were equal. That broke as soon as a newer 13F landed:
    on 2026-07-01 the 2026-06-30 book was not yet public, so ``as_of`` correctly
    returned the 2026-03-31 vintage. Returning the older book is the anti-look-ahead
    guarantee working — the assertion was wrong, not the code.

    What is actually invariant: the vintage returned describes a quarter that has
    already ended, and moving the query date forward can only move the vintage
    forward (monotonicity), never backward.
    """
    query = date.today()
    snap = berkshire.as_of(query)
    assert snap["dollars"].size > 0

    got = str(snap["report_date"].values)[:10]
    # never a quarter that has not ended by the query date
    assert got < query.isoformat()

    # monotone in the query date: a later T can only advance the vintage
    later = berkshire.as_of(query + timedelta(days=200))
    assert str(later["report_date"].values)[:10] >= got


def test_as_of_historical_returns_that_vintage(berkshire):
    # 0.3.11 resolves as_of server-side on filing_date, so mid-2020 returns the
    # real Q1-2020 book (report 2020-03-31, filed 2020-05-15) — NOT the latest,
    # and NOT empty. This is the capability that replaced the 0.3.10 workaround.
    snap = berkshire.as_of(date(2020, 6, 30))
    assert snap["dollars"].size > 0
    assert str(snap["report_date"].values)[:10] == "2020-03-31"


def test_as_of_before_earliest_vintage_is_empty(berkshire):
    # Holdings vintages begin at report 2013-09-30; a query before any filing was
    # known raises APIError upstream, which as_of maps to an empty snapshot
    # (anti-look-ahead preserved — never fabricates or looks ahead).
    snap = berkshire.as_of(date(2013, 1, 1))
    assert snap["dollars"].size == 0


def test_concentration_uses_sdk_and_matches_precomputed_hhi(berkshire):
    # concentration('hhi') is now SDK-backed; it should equal sdk_weight_hhi()
    # (both read get_filer_concentration's latest.weight_hhi).
    hhi = berkshire.concentration("hhi")
    api = berkshire.sdk_weight_hhi()
    assert 0.0 < hhi <= 1.0
    if api is not None:
        assert hhi == pytest.approx(float(api), abs=1e-3)
    # top-5 is the API's precomputed top5_weight_sum, a valid weight sum in (0, 1].
    top5 = berkshire.concentration("top_n", 5)
    assert 0.0 < top5 <= 1.0 + 1e-9


def test_sdk_concentration_matches_hand_computed(berkshire):
    # Permanent regression guard: the SDK's precomputed HHI must stay in lockstep
    # with hand-computed HHI on the same disclosed-weight snapshot. If the API's
    # concentration math ever drifts from Σ w_i², this fails.
    sdk_hhi = berkshire.concentration("hhi")            # get_filer_concentration
    hand_hhi = berkshire._local_concentration("hhi")    # Σ w_i² on disclosed weights
    assert sdk_hhi == pytest.approx(hand_hhi, abs=1e-3)


def test_factor_decomposition_series_shape_and_fields(berkshire):
    # Decompose only the top few names to keep the test fast.
    ds = berkshire.factor_decomposition_series(max_positions=3)
    assert set(ds.dims) == {"report_date", "ticker", "factor_layer"}
    assert list(ds["factor_layer"].values) == [
        "market",
        "sector",
        "subsector",
        "style",
        "stock_specific",
    ]
    # Industry layers carry hedge ratios; measurement layers carry explained var.
    hr_industry = ds["hr"].sel(factor_layer=["market", "sector", "subsector"]).values
    assert np.isfinite(hr_industry).any()
    ev_measure = ds["explained_variance"].sel(
        factor_layer=["style", "stock_specific"]
    ).values
    assert np.isfinite(ev_measure).any()


def test_market_neutral_overlay_zeros_industry_exposure(berkshire, client):
    # Trim to the top 3 positions by dollars to keep the decompose fan-out fast.
    snap = berkshire.as_of(date(2026, 7, 1))
    dollars = np.asarray(snap["dollars"].values, dtype=float)
    top3 = np.argsort(np.nan_to_num(dollars, nan=-np.inf))[::-1][:3]
    snap3 = snap.isel(ticker=top3)

    overlay = MarketNeutralOverlay(snap3).construct(client)
    # Real ETF shorts came back and SPY (the market hedge) is among them.
    assert overlay.etf_shorts
    assert "SPY" in overlay.etf_shorts
    # Every industry factor maps to an ETF, so no residual should survive.
    assert all(abs(v) < 1e-6 for v in overlay.residual_exposure.values())
    # A long-only 13F book shorts the market ETF (positive SPY notional).
    assert overlay.etf_shorts["SPY"] > 0


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
