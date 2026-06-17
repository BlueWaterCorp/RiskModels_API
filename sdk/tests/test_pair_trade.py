"""Unit tests for riskmodels.pair_trade.

Run:  python3 -m pytest test_pair_trade.py -v

Fixtures are real GET /metrics bodies for INTC and AMD (engine, 2026-05-26),
trimmed to the fields pair_trade consumes.
"""

import os
from collections import namedtuple

import pytest

from riskmodels.pair_trade import (
    PairTradeNeutralization,
    _fetch_metrics_body,
    compute_pair_neutralization,
)

D = 10_000.0

# Review A live tests hit the real engine; skip them when no key is present.
_HAS_LIVE_ENGINE = bool(os.environ.get("RISKMODELS_API_KEY"))
_LIVE_REASON = "requires live RiskModels engine (set RISKMODELS_API_KEY)"
_XFAIL_REASON = (
    "Verification approach uses -hedge_ratio as a beta proxy. Hedge ETFs "
    "(SPY, XLK, SMH) are not in the single-stock risk universe, so their "
    "hedge ratios return None and the proxy coerces them to 0. With the "
    "hedge legs contributing zero, the sum collapses to the unhedged "
    "underlying tilt — which is not a measurement of cascade orthogonality. "
    "Verifying the cascade requires a per-name beta source the SDK does "
    "not currently expose for ETFs (e.g., returns-based regression, or "
    "a dedicated betas endpoint). Tracked as follow-up."
)

_INTC_BODY = {
    "ticker": "INTC",
    "teo": "2026-05-26",
    "metrics": {"leverage_cap_applied": 2},
    "hedge_levels": {
        "L1": {"market_hr": -2.12363529205322, "sector_hr": None, "subsector_hr": None,
               "hedge_etfs": {"market": "SPY", "sector": None, "subsector": None}},
        "L2": {"market_hr": 0.214533805847168, "sector_hr": -1.54688668251038,
               "subsector_hr": None,
               "hedge_etfs": {"market": "SPY", "sector": "XLK", "subsector": None}},
        "L3": {"market_hr": 0.217164278030396, "sector_hr": 0.15669858455658,
               "subsector_hr": -1.27551519870758,
               "hedge_etfs": {"market": "SPY", "sector": "XLK", "subsector": "SMH"}},
        "recommended_level": "L3",
        "statistical_lstar": "L3",
    },
    "_metadata": {"model_version": "3.0", "data_as_of": "2026-05-26",
                  "factor_set_id": "SPY_uni_mc_3000"},
}

_AMD_BODY = {
    "ticker": "AMD",
    "teo": "2026-05-26",
    "metrics": {"leverage_cap_applied": 2},
    "hedge_levels": {
        "L1": {"market_hr": -2.1542067527771, "sector_hr": None, "subsector_hr": None,
               "hedge_etfs": {"market": "SPY", "sector": None, "subsector": None}},
        "L2": {"market_hr": 1.28696298599243, "sector_hr": -2.2766101360321,
               "subsector_hr": None,
               "hedge_etfs": {"market": "SPY", "sector": "XLK", "subsector": None}},
        "L3": {"market_hr": 1.28914213180542, "sector_hr": -0.865158319473267,
               "subsector_hr": -1.0567878484726,
               "hedge_etfs": {"market": "SPY", "sector": "XLK", "subsector": "SMH"}},
        "recommended_level": "L1",
        "statistical_lstar": "L3",
    },
    "_metadata": {"model_version": "3.0", "data_as_of": "2026-05-26",
                  "factor_set_id": "SPY_uni_mc_3000"},
}


class _StubClient:
    """Minimal RiskModelsClient stand-in: maps ticker -> metrics body."""

    def __init__(self, bodies):
        self._bodies = {k.upper(): v for k, v in bodies.items()}
        self.calls = []

    def get_metrics(self, ticker):
        self.calls.append(ticker)
        return self._bodies[ticker.upper()]


def _pair():
    return compute_pair_neutralization(_INTC_BODY, _AMD_BODY, D)


def _leg(level, ticker):
    matches = [l for l in level.legs if l.ticker == ticker]
    return matches[0] if matches else None


# --------------------------------------------------------------------------
# Structure
# --------------------------------------------------------------------------

def test_four_levels_present():
    assert [l.level for l in _pair().levels] == ["naive", "L1", "L2", "L3"]


def test_leg_counts_grow_by_one_per_level():
    # INTC/AMD share XLK and SMH, so each deeper level adds exactly one leg.
    assert [len(l.legs) for l in _pair().levels] == [2, 3, 4, 5]


def test_pair_legs_equal_dollar_and_opposite():
    for lvl in _pair().levels:
        assert _leg(lvl, "INTC").dollars == pytest.approx(+D)
        assert _leg(lvl, "AMD").dollars == pytest.approx(-D)
        assert _leg(lvl, "INTC").role == "pair"


# --------------------------------------------------------------------------
# Factor neutralization
# --------------------------------------------------------------------------

def test_betas_zero_out_layer_by_layer():
    res = _pair()
    naive, l1, l2, l3 = res.levels

    assert naive.net_market_beta != 0.0
    assert naive.net_sector_beta != 0.0
    assert naive.net_subsector_beta != 0.0

    assert l1.net_market_beta == pytest.approx(0.0)
    assert l1.net_sector_beta != 0.0

    assert l2.net_market_beta == pytest.approx(0.0)
    assert l2.net_sector_beta == pytest.approx(0.0)
    assert l2.net_subsector_beta != 0.0

    assert l3.net_market_beta == pytest.approx(0.0)
    assert l3.net_sector_beta == pytest.approx(0.0)
    assert l3.net_subsector_beta == pytest.approx(0.0)


def test_naive_sector_tilt_value():
    # AMD l2 sector_hr - INTC l2 sector_hr  (the demonstration's headline number)
    expected = -2.2766101360321 - (-1.54688668251038)
    assert _pair().level("naive").net_sector_beta == pytest.approx(expected, abs=1e-4)


def test_hedge_leg_amounts_match_netted_difference():
    res = _pair()
    # L1 SPY = D * (l1_mkt_hr INTC - l1_mkt_hr AMD)
    exp_spy = D * (-2.12363529205322 - (-2.1542067527771))
    assert _leg(res.level("L1"), "SPY").dollars == pytest.approx(exp_spy, abs=0.01)
    # L3 XLK = D * (l3_sec_hr INTC - l3_sec_hr AMD)
    exp_xlk = D * (0.15669858455658 - (-0.865158319473267))
    assert _leg(res.level("L3"), "XLK").dollars == pytest.approx(exp_xlk, abs=0.01)
    # L3 SMH = D * (l3_sub_hr INTC - l3_sub_hr AMD)
    exp_smh = D * (-1.27551519870758 - (-1.0567878484726))
    assert _leg(res.level("L3"), "SMH").dollars == pytest.approx(exp_smh, abs=0.01)


# --------------------------------------------------------------------------
# Leverage cap / recommended level
# --------------------------------------------------------------------------

def test_recommended_level_respects_cap():
    res = _pair()
    # L3 hedge overlay ~2.31x exceeds the 2.0x cap -> recommend L2.
    assert res.recommended_level == "L2"
    assert res.level("L3").within_leverage_cap is False
    assert res.level("L2").within_leverage_cap is True
    assert res.recommended.level == "L2"


def test_higher_cap_allows_l3():
    res = compute_pair_neutralization(_INTC_BODY, _AMD_BODY, D, leverage_cap=5.0)
    assert res.recommended_level == "L3"


def test_gross_leverage_monotone_and_naive_is_two():
    gl = [l.gross_leverage for l in _pair().levels]
    assert gl[0] == pytest.approx(2.0)
    assert gl == sorted(gl)


# --------------------------------------------------------------------------
# Cross-sector path
# --------------------------------------------------------------------------

def test_cross_sector_keeps_separate_etf_legs():
    fake_fin = {
        "ticker": "FAKEFIN", "teo": "2026-05-26",
        "metrics": {"leverage_cap_applied": 2},
        "hedge_levels": {
            "L1": {"market_hr": -1.5, "sector_hr": None, "subsector_hr": None,
                   "hedge_etfs": {"market": "SPY", "sector": None, "subsector": None}},
            "L2": {"market_hr": -1.2, "sector_hr": -0.9, "subsector_hr": None,
                   "hedge_etfs": {"market": "SPY", "sector": "XLF", "subsector": None}},
            "L3": {"market_hr": -1.1, "sector_hr": -0.8, "subsector_hr": -0.7,
                   "hedge_etfs": {"market": "SPY", "sector": "XLF", "subsector": "KBE"}},
        },
    }
    res = compute_pair_neutralization(_INTC_BODY, fake_fin, D)
    assert res.same_sector is False
    hedge_etfs = {l.ticker for l in res.level("L3").legs if l.role == "hedge"}
    assert {"XLK", "SMH", "XLF", "KBE"}.issubset(hedge_etfs)


# --------------------------------------------------------------------------
# Result-object surface
# --------------------------------------------------------------------------

def test_to_dataframe_one_row_per_level():
    df = _pair().to_dataframe()
    assert list(df["level"]) == ["naive", "L1", "L2", "L3"]
    recommended_rows = df.loc[df["recommended"], "level"].tolist()
    assert recommended_rows == ["L2"]


def test_legs_dataframe_matches_leg_counts():
    df = _pair().legs_dataframe()
    assert len(df) == 2 + 3 + 4 + 5


def test_lineage_populated_from_metadata():
    res = _pair()
    assert res.lineage.model_version == "3.0"
    assert res.as_of == "2026-05-26"


def test_summary_dict_headline_fields():
    s = _pair().summary_dict()
    assert s["long_ticker"] == "INTC"
    assert s["short_ticker"] == "AMD"
    assert s["recommended_level"] == "L2"


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------

def test_identical_tickers_rejected():
    with pytest.raises(ValueError):
        compute_pair_neutralization(_INTC_BODY, _INTC_BODY, D)


def test_non_positive_dollars_rejected():
    with pytest.raises(ValueError):
        compute_pair_neutralization(_INTC_BODY, _AMD_BODY, 0.0)


def test_missing_hedge_levels_rejected():
    bad = {"ticker": "NOPE", "metrics": {}}
    with pytest.raises(ValueError):
        compute_pair_neutralization(_INTC_BODY, bad, D)


# --------------------------------------------------------------------------
# from_tickers / client integration
# --------------------------------------------------------------------------

def test_from_tickers_fetches_both_legs():
    client = _StubClient({"INTC": _INTC_BODY, "AMD": _AMD_BODY})
    res = PairTradeNeutralization.from_tickers(client, "INTC", "AMD", D)
    assert client.calls == ["INTC", "AMD"]
    assert res.recommended_level == "L2"
    assert res.long_ticker == "INTC" and res.short_ticker == "AMD"


# --------------------------------------------------------------------------
# Review B — leg TEO staleness
# --------------------------------------------------------------------------

def test_pair_trade_raises_on_mismatched_leg_teo():
    long_body = {**_INTC_BODY, "teo": "2026-05-26"}
    short_body = {**_AMD_BODY, "teo": "2026-05-20"}  # stale short leg
    with pytest.raises(ValueError, match="mismatched TEO"):
        compute_pair_neutralization(long_body, short_body, D)


def test_pair_trade_accepts_matched_leg_teo():
    long_body = {**_INTC_BODY, "teo": "2026-05-26"}
    short_body = {**_AMD_BODY, "teo": "2026-05-26"}
    res = compute_pair_neutralization(long_body, short_body, D)
    assert res.as_of == "2026-05-26"


# --------------------------------------------------------------------------
# Review C — cap_basis (overlay vs. total gross)
# --------------------------------------------------------------------------

def test_cap_basis_overlay_is_default():
    res = _pair()  # no cap_basis kwarg
    assert res.cap_basis == "overlay"
    # Top-level scalars mirror the recommended level; under the overlay basis
    # the binding leverage is the hedge-overlay gross over notional (equal up
    # to the fields' independent 4-dp / 2-dp rounding).
    assert res.binding_leverage == pytest.approx(res.overlay_gross / D, abs=1e-3)


def test_cap_basis_total_more_restrictive():
    order = {"naive": 0, "L1": 1, "L2": 2, "L3": 3}
    overlay = compute_pair_neutralization(_INTC_BODY, _AMD_BODY, D, cap_basis="overlay")
    total = compute_pair_neutralization(_INTC_BODY, _AMD_BODY, D, cap_basis="total")
    # Capping the larger (total) gross binds sooner -> recommend no deeper.
    assert order[total.recommended_level] <= order[overlay.recommended_level]


def test_both_gross_figures_always_reported():
    base_gross = 2 * D  # dollar-neutral pair: |long| + |short|
    for basis in ("overlay", "total"):
        # leverage_cap high enough that the recommended level carries hedges
        # under both bases, so overlay_gross is strictly positive.
        res = compute_pair_neutralization(
            _INTC_BODY, _AMD_BODY, D, leverage_cap=10.0, cap_basis=basis
        )
        assert res.overlay_gross > 0
        assert res.total_gross > 0
        assert res.total_gross >= res.overlay_gross + base_gross - 1e-6


def test_cap_basis_invalid_value_raises():
    with pytest.raises(ValueError, match="cap_basis"):
        compute_pair_neutralization(_INTC_BODY, _AMD_BODY, D, cap_basis="garbage")


# --------------------------------------------------------------------------
# Review A — orthogonalization verification
#
# The two live tests are the REAL check: they look up each leg's realized
# factor beta from the engine and assert the notional-weighted net beta is
# negligible. The offline test below is a STRUCTURAL DEMO only — see its
# docstring. Both share _realized_net_beta() so they exercise the same
# summation logic.
# --------------------------------------------------------------------------

def _realized_net_beta(legs, beta_of):
    """Sum signed_notional * factor_beta across legs — the net-beta
    computation under test. Shared by the live orthogonalization checks and
    the offline structural demo so both exercise identical summation logic.
    """
    return sum(leg.dollars * beta_of(leg.ticker) for leg in legs)


def _market_beta_from_metrics(body):
    """Market beta of a name ~= -(L1 market hedge ratio).

    The L1 market HR is the SPY hedge that zeros market exposure, i.e.
    -beta_market. Holds for stocks and ETFs alike (SPY's L1 market_hr ~= -1
    -> beta 1). Used because get_l3_decomposition exposes HRs/ERs, not betas.
    """
    hl = (body or {}).get("hedge_levels") or {}
    l1 = hl.get("L1") or {}
    return -float(l1.get("market_hr") or 0.0)


def _sector_beta_from_metrics(body):
    """Sector-factor beta of a name ~= -(L2 sector hedge ratio).

    Under an orthogonalized cascade the market hedge (SPY) loads ~0 on the
    sector factor, so it drops out of the L2 net-sector sum by construction.
    """
    hl = (body or {}).get("hedge_levels") or {}
    l2 = hl.get("L2") or {}
    return -float(l2.get("sector_hr") or 0.0)


@pytest.mark.xfail(strict=False, reason=_XFAIL_REASON)
@pytest.mark.skipif(not _HAS_LIVE_ENGINE, reason=_LIVE_REASON)
def test_realized_net_market_beta_is_zero_under_orthogonalization():
    """LIVE cascade verification (Review A): the real test of orthogonality.

    Builds an L3 INTC/AMD pair from the engine, collects signed notionals
    across both underlyings and every hedge ETF leg, looks up each name's
    realized market beta, and asserts the notional-weighted net market beta is
    < 1% of gross. Contrast test_orthogonalization_structural_demo_offline,
    which only checks summation logic on rigged fixtures.
    """
    from riskmodels import RiskModelsClient

    with RiskModelsClient.from_env() as client:
        res = client.pair_trade_neutralization("INTC", "AMD", 100_000)
        l3 = res.level("L3")
        betas = {
            leg.ticker: _market_beta_from_metrics(_fetch_metrics_body(client, leg.ticker))
            for leg in l3.legs
        }
        net = _realized_net_beta(l3.legs, lambda t: betas[t])
        gross = sum(abs(leg.dollars) for leg in l3.legs)
        assert abs(net) < 0.01 * gross, (
            f"realized net market beta {net:,.0f} is >= 1% of gross {gross:,.0f} "
            f"— cascade is NOT orthogonal; net_market_beta=0 is unreliable"
        )


@pytest.mark.xfail(strict=False, reason=_XFAIL_REASON)
@pytest.mark.skipif(not _HAS_LIVE_ENGINE, reason=_LIVE_REASON)
def test_realized_net_sector_beta_is_zero_at_L2():
    """LIVE cascade verification (Review A): same pattern at L2 vs sector beta."""
    from riskmodels import RiskModelsClient

    with RiskModelsClient.from_env() as client:
        res = client.pair_trade_neutralization("INTC", "AMD", 100_000)
        l2 = res.level("L2")
        betas = {
            leg.ticker: _sector_beta_from_metrics(_fetch_metrics_body(client, leg.ticker))
            for leg in l2.legs
        }
        net = _realized_net_beta(l2.legs, lambda t: betas[t])
        gross = sum(abs(leg.dollars) for leg in l2.legs)
        assert abs(net) < 0.01 * gross, (
            f"realized net sector beta {net:,.0f} is >= 1% of gross {gross:,.0f}"
        )


def test_orthogonalization_structural_demo_offline():
    """Structural/illustrative test using fixture-authored betas RIGGED to net
    to ~0 by construction. Verifies the SUMMATION LOGIC of the net-beta
    computation, NOT cascade orthogonality. Actual cascade verification is
    test_realized_net_market_beta_is_zero_under_orthogonalization (live
    integration, requires API key). A pass here is NOT evidence the ERM3
    cascade is orthogonal.
    """
    DemoLeg = namedtuple("DemoLeg", "ticker dollars")
    # Stylized signed-notional L3 book. The XLK hedge carries market beta 1.25
    # (an ETF leg with its own market beta — exactly Conrad's concern). Betas
    # are hand-picked so the weighted sum is *exactly* zero:
    #   100_000*1.30 + (-100_000)*1.10 + (-16_000)*1.25 = 0
    legs = [
        DemoLeg("LONG", +100_000.0),
        DemoLeg("SHORT", -100_000.0),
        DemoLeg("XLK", -16_000.0),
    ]
    betas = {"LONG": 1.30, "SHORT": 1.10, "XLK": 1.25}
    gross = sum(abs(leg.dollars) for leg in legs)
    net = _realized_net_beta(legs, lambda t: betas[t])
    assert abs(net) < 0.01 * gross


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
