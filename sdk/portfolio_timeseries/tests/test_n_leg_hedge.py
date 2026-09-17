"""Unit tests for portfolio_timeseries.market_neutral_overlay.n_leg_hedge.

Covers: empty portfolio, single-leg single/multi-factor, 2-leg equivalence with
riskmodels.pair_trade, ten-leg hand-computed, unmapped factor → residual, and
negative loadings (sign math).
"""

from __future__ import annotations

import pytest

from portfolio_timeseries import HedgeOverlay, LegExposure, n_leg_hedge
from riskmodels.pair_trade import compute_pair_neutralization


# --------------------------------------------------------------------------
# 1. Empty portfolio
# --------------------------------------------------------------------------

def test_empty_portfolio_yields_no_shorts_no_residuals():
    overlay = n_leg_hedge([], {"mkt": "SPY"})
    assert isinstance(overlay, HedgeOverlay)
    assert overlay.etf_shorts == {}
    assert overlay.residual_exposure == {}


# --------------------------------------------------------------------------
# 2. Single leg, single factor
# --------------------------------------------------------------------------

def test_single_leg_single_factor():
    legs = [LegExposure("AAPL", 100.0, {"mkt": 1.0})]
    overlay = n_leg_hedge(legs, {"mkt": "SPY"})
    # $100 loaded 1.0 on market -> short $100 of SPY.
    assert overlay.etf_shorts == {"SPY": pytest.approx(100.0)}
    # Market is fully hedged by a pure ETF.
    assert overlay.residual_exposure["mkt"] == pytest.approx(0.0)


# --------------------------------------------------------------------------
# 3. Single leg, multiple factors
# --------------------------------------------------------------------------

def test_single_leg_multiple_factors():
    legs = [LegExposure("AAPL", 100.0, {"mkt": 1.0, "sector": 0.5})]
    overlay = n_leg_hedge(legs, {"mkt": "SPY", "sector": "XLK"})
    # Shorts are proportional to each loading: $100*1.0 and $100*0.5.
    assert overlay.etf_shorts["SPY"] == pytest.approx(100.0)
    assert overlay.etf_shorts["XLK"] == pytest.approx(50.0)
    assert overlay.residual_exposure["mkt"] == pytest.approx(0.0)
    assert overlay.residual_exposure["sector"] == pytest.approx(0.0)


# --------------------------------------------------------------------------
# 4. Two legs — numerical equivalence with pair_trade's L3 netting
# --------------------------------------------------------------------------

def test_two_legs_match_pair_trade():
    """n_leg_hedge on 2 legs reproduces pair_trade's L3 netted ETF legs.

    Uses the INTC/AMD L3 hedge ratios (engine, 2026-05-26 — same figures as
    test_pair_trade). Cross-checks against the real ``compute_pair_neutralization``
    L3 level so the two implementations are pinned to each other, not to
    transcribed constants.
    """
    D = 10_000.0
    # L3 hedge ratios (per-dollar factor loadings) for each leg.
    intc_l3 = {"market": 0.217164278030396, "sector": 0.15669858455658,
               "subsector": -1.27551519870758}
    amd_l3 = {"market": 1.28914213180542, "sector": -0.865158319473267,
              "subsector": -1.0567878484726}
    factor_to_etf = {"market": "SPY", "sector": "XLK", "subsector": "SMH"}

    legs = [
        LegExposure("INTC", +D, dict(intc_l3)),   # long
        LegExposure("AMD", -D, dict(amd_l3)),     # short (negative dollars)
    ]
    overlay = n_leg_hedge(legs, factor_to_etf)

    # Reference: pair_trade's own L3 netting on equivalent metrics bodies.
    def _body(tkr, l3):
        return {
            "ticker": tkr, "teo": "2026-05-26",
            "metrics": {"leverage_cap_applied": 2},
            "hedge_levels": {
                "L3": {"market_hr": l3["market"], "sector_hr": l3["sector"],
                       "subsector_hr": l3["subsector"],
                       "hedge_etfs": {"market": "SPY", "sector": "XLK", "subsector": "SMH"}},
                "statistical_lstar": "L3",
            },
        }

    res = compute_pair_neutralization(_body("INTC", intc_l3), _body("AMD", amd_l3), D)
    pt_hedges = {l.ticker: l.dollars for l in res.level("L3").legs if l.role == "hedge"}

    assert set(overlay.etf_shorts) == set(pt_hedges)
    for etf in ("SPY", "XLK", "SMH"):
        assert overlay.etf_shorts[etf] == pytest.approx(pt_hedges[etf], abs=0.01)
    # And the closed form the pair_trade test itself asserts: D*(hr_long - hr_short).
    assert overlay.etf_shorts["SPY"] == pytest.approx(
        D * (intc_l3["market"] - amd_l3["market"]), abs=0.01
    )


# --------------------------------------------------------------------------
# 5. Ten legs, hand-computed
# --------------------------------------------------------------------------

def test_ten_legs_hand_computed():
    """Two blocks of five legs, chosen so the netted shorts are round numbers.

    Block A (legs 1-5): $100 each, loadings {mkt: 1.0, sector: 1.0}
    Block B (legs 6-10): $200 each, loadings {mkt: 0.5, sector: -1.0}

    SPY  = 5*100*1.0 + 5*200*0.5  = 500 + 500  = 1000
    XLK  = 5*100*1.0 + 5*200*-1.0 = 500 - 1000 = -500  (net long the sector ETF)
    """
    legs = []
    for i in range(5):
        legs.append(LegExposure(f"A{i}", 100.0, {"mkt": 1.0, "sector": 1.0}))
    for i in range(5):
        legs.append(LegExposure(f"B{i}", 200.0, {"mkt": 0.5, "sector": -1.0}))

    overlay = n_leg_hedge(legs, {"mkt": "SPY", "sector": "XLK"})

    assert overlay.etf_shorts["SPY"] == pytest.approx(1000.0)
    assert overlay.etf_shorts["XLK"] == pytest.approx(-500.0)
    assert overlay.residual_exposure["mkt"] == pytest.approx(0.0)
    assert overlay.residual_exposure["sector"] == pytest.approx(0.0)


# --------------------------------------------------------------------------
# 6. Factor without an ETF mapping -> residual, no short
# --------------------------------------------------------------------------

def test_unmapped_factor_becomes_residual():
    legs = [LegExposure("X", 100.0, {"mkt": 1.0, "style_value": 0.8})]
    # Only market is mapped; style_value has no ETF.
    overlay = n_leg_hedge(legs, {"mkt": "SPY"})

    assert overlay.etf_shorts == {"SPY": pytest.approx(100.0)}
    # No ETF short is created for the unmapped factor...
    assert "style_value" not in overlay.etf_shorts
    # ...and its raw exposure ($100 * 0.8) surfaces as un-hedged residual.
    assert overlay.residual_exposure["style_value"] == pytest.approx(80.0)
    assert overlay.residual_exposure["mkt"] == pytest.approx(0.0)


# --------------------------------------------------------------------------
# 7. Negative loading -> long ETF (negative short)
# --------------------------------------------------------------------------

def test_negative_loading_yields_long_etf_position():
    legs = [LegExposure("Y", 100.0, {"mkt": -0.5})]
    overlay = n_leg_hedge(legs, {"mkt": "SPY"})
    # A negative loading means the book is *short* market exposure here, so the
    # overlay goes LONG the ETF: a negative "short" amount.
    assert overlay.etf_shorts["SPY"] == pytest.approx(-50.0)
    assert overlay.residual_exposure["mkt"] == pytest.approx(0.0)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
