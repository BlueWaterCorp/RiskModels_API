"""Unit tests for riskmodels.pair_trade.

Run:  python3 -m pytest test_pair_trade.py -v

Fixtures are real GET /metrics bodies for INTC and AMD (engine, 2026-05-26),
trimmed to the fields pair_trade consumes.
"""

import pytest

from riskmodels.pair_trade import (
    PairTradeNeutralization,
    compute_pair_neutralization,
)

D = 10_000.0

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


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
