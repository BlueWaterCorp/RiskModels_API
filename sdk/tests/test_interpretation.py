"""Tests for the public Risk Interpretation contract.

Focuses on shape/contract guarantees that the BWMACRO engine and the
SDK community both rely on. The editorial engine itself lives in
BWMACRO and is tested there.

The ``DDData`` class moved to BWMACRO during PR 3 (2026-05). These public-side
tests use a ``_DDLike`` stand-in that exposes the same attribute surface
``compute_features`` / ``derive_default_judgment`` consume — the interpretation
module is structurally typed (``Any``) at runtime.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import pytest

from riskmodels.interpretation import (
    INTERPRETER_VERSION,
    Judgment,
    compute_features,
    derive_default_judgment,
    judgment_narrative_violations,
    recommendation_language_violations,
)
from riskmodels.snapshots._stock_data import P1Data


# ---------------------------------------------------------------------------
# Structural DDData stand-in — public side has no DDData class.
# ---------------------------------------------------------------------------

@dataclass
class _DDLike:
    """Minimal DDData-shaped object for exercising the public interpretation surface."""
    p1: P1Data
    peer_comparison: Any = None
    peer_sharpes: dict[str, tuple[float, float]] = field(default_factory=dict)
    peer_rankings: dict[str, tuple[float, float]] = field(default_factory=dict)

    # Delegate the same handful of fields BWMACRO's DDData exposes as properties.
    @property
    def ticker(self) -> str:
        return self.p1.ticker

    @property
    def teo(self) -> str:
        return self.p1.teo

    @property
    def metrics(self) -> dict[str, Any]:
        return self.p1.metrics

    @property
    def sector_etf(self):
        return self.p1.sector_etf

    @property
    def subsector_etf(self):
        return self.p1.subsector_etf

    @property
    def subsector_label(self) -> str:
        return self.p1.subsector_label

    @property
    def company_name(self) -> str:
        return self.p1.company_name


# ---------------------------------------------------------------------------
# Synthetic fixtures — keep them tiny; we are testing contract, not numerics
# ---------------------------------------------------------------------------

def _make_ddata(
    *,
    ticker: str = "TEST",
    res_er: float = 0.55,
    sec_er: float = 0.20,
    sub_er: float = 0.10,
    mkt_er: float = 0.15,
    vol_23d: float = 0.28,
    ttm: float = 0.18,
    ttm_spy: float = 0.12,
    ttm_sub: float = 0.10,
    rank_resid: float = 78.0,
    rank_gross: float = 72.0,
    sharpe_resid_3y: float = 1.42,
    res_series_pct: float = 0.04,
    gross_series_pct: float = 0.32,
) -> _DDLike:
    """Build a minimal DDData-shaped fixture covering compute_features inputs.

    The helper is intentionally explicit — every value is a parameter
    so eval cases can produce 'high residual + positive', 'high
    residual + negative', etc. without copying boilerplate.
    """
    # Ten-day l3_er_series that compounds to roughly the requested gross/res
    # totals. We only need enough rows for the geometric loop.
    n = 10
    daily_total = (1 + gross_series_pct) ** (1 / n) - 1
    daily_res = (1 + res_series_pct) ** (1 / n) - 1
    daily_sys = daily_total - daily_res
    # Split sys across mkt/sec/sub proportionally to their var shares.
    sys_share = mkt_er + sec_er + sub_er
    if sys_share <= 0:
        sys_share = 1e-6
    daily_mkt = daily_sys * (mkt_er / sys_share)
    daily_sec = daily_sys * (sec_er / sys_share)
    daily_sub = daily_sys * (sub_er / sys_share)
    l3_er_series = [
        (f"2026-01-{i+1:02d}", daily_mkt, daily_sec, daily_sub, daily_res)
        for i in range(n)
    ]

    p1 = P1Data(
        ticker=ticker,
        company_name=f"{ticker} Inc.",
        teo="2026-01-31",
        universe="us_largecap",
        sector_etf="XLK",
        subsector_etf="SOXX",
        metrics={
            "l3_market_er":     mkt_er,
            "l3_sector_er":     sec_er,
            "l3_subsector_er":  sub_er,
            "l3_residual_er":   res_er,
            "vol_23d":          vol_23d,
            "market_cap":       1.0e12,
        },
        cum_stock=[("2026-01-01", 0.0), ("2026-01-31", gross_series_pct)],
        cum_spy=[("2026-01-01", 0.0), ("2026-01-31", ttm_spy)],
        cum_sector=[("2026-01-01", 0.0), ("2026-01-31", ttm_sub)],
        cum_subsector=[("2026-01-01", 0.0), ("2026-01-31", ttm_sub)],
        tr_stock={"1y": ttm, "3m": 0.05, "1m": 0.02, "1d": 0.001},
        tr_spy={"1y": ttm_spy, "3m": 0.04, "1m": 0.01, "1d": 0.0},
        tr_sector={"1y": ttm_sub, "3m": 0.03, "1m": 0.01, "1d": 0.0},
        tr_subsector={"1y": ttm_sub, "3m": 0.03, "1m": 0.01, "1d": 0.0},
        dd_stock=[],
        dd_spy=[],
        sharpe_1y=None,
        max_drawdown=None,
        vol_23d=vol_23d,
        rankings={
            "252d_subsector_subsector_residual": {"rank_percentile": rank_resid},
            "252d_subsector_gross_return":       {"rank_percentile": rank_gross},
        },
        l3_er_series=l3_er_series,
    )

    return _DDLike(
        p1=p1,
        peer_comparison=None,
        peer_sharpes={ticker: (1.10, sharpe_resid_3y)},
        peer_rankings={ticker: (rank_gross, rank_resid)},
    )


# ---------------------------------------------------------------------------
# Judgment shape
# ---------------------------------------------------------------------------

def test_judgment_default_fields():
    j = Judgment()
    assert j.version == INTERPRETER_VERSION
    assert j.features == {}
    assert j.text == {}
    assert j.states == {}
    assert j.flags == []


def test_judgment_is_frozen():
    j = Judgment(ticker="AAPL")
    with pytest.raises(Exception):  # FrozenInstanceError
        j.ticker = "MSFT"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# compute_features
# ---------------------------------------------------------------------------

def test_compute_features_keys_present():
    data = _make_ddata()
    f = compute_features(data)
    expected_keys = {
        "residual_share", "market_share", "sector_share", "subsector_share",
        "systematic_share",
        "geo_gross_return_pct", "geo_systematic_return_pct",
        "geo_residual_return_pct",
        "annualized_vol", "residual_vol",
        "ttm_return_pct", "ttm_spy_return_pct", "ttm_sector_return_pct",
        "ttm_subsector_return_pct", "ttm_vs_spy_pp", "ttm_vs_benchmark_pp",
        "residual_rank_pct", "gross_rank_pct", "residual_sharpe_3y",
    }
    assert expected_keys.issubset(f.keys())


def test_compute_features_deterministic():
    data = _make_ddata()
    f1 = compute_features(data)
    f2 = compute_features(data)
    assert f1 == f2


def test_compute_features_geometric_attribution_signs():
    """Positive residual contribution should produce positive geo_residual_return_pct."""
    data = _make_ddata(res_series_pct=0.04, gross_series_pct=0.32)
    f = compute_features(data)
    assert f["geo_residual_return_pct"] is not None
    assert f["geo_residual_return_pct"] > 0
    # geometric gross ≈ 32%, residual ≈ 4%, systematic ≈ gross − residual
    assert abs(f["geo_gross_return_pct"] - 32.0) < 1.0
    assert abs(f["geo_residual_return_pct"] - 4.0) < 1.0


def test_compute_features_negative_residual():
    data = _make_ddata(res_series_pct=-0.05, gross_series_pct=0.10)
    f = compute_features(data)
    assert f["geo_residual_return_pct"] is not None
    assert f["geo_residual_return_pct"] < 0


# ---------------------------------------------------------------------------
# derive_default_judgment — bland stub contract
# ---------------------------------------------------------------------------

# Vocabulary that must NEVER appear in the public stub. If any of these
# show up in `text`, the editorial layer has leaked into the public SDK.
_FORBIDDEN_QUALIFIERS = [
    "Strong", "Solid", "Muted",
    "beta-driven", "idiosyncratic exposure", "stock-specific",
    "ranks near the top", "ranks above", "ranks below",
    "sits near the cohort median",
    "Outperforming", "Underperforming",
    "alpha quality",
    "Negative Contribution", "Positive Contribution", "Flat Contribution",
    "Quality Strong", "Quality, Negative",
]


@pytest.mark.parametrize(
    "kwargs",
    [
        # high residual + positive contribution
        dict(res_er=0.65, res_series_pct=0.04, rank_resid=85),
        # high residual + negative contribution
        dict(res_er=0.65, res_series_pct=-0.06, rank_resid=82),
        # high systematic + low residual rank
        dict(res_er=0.20, mkt_er=0.40, sec_er=0.25, sub_er=0.15,
             res_series_pct=-0.02, rank_resid=22),
        # balanced
        dict(res_er=0.40, mkt_er=0.30, sec_er=0.20, sub_er=0.10,
             res_series_pct=0.01, rank_resid=55),
    ],
)
def test_default_judgment_no_qualifier_vocabulary(kwargs):
    data = _make_ddata(**kwargs)
    j = derive_default_judgment(data)
    blob = " ".join(j.text.values()).lower()
    for word in _FORBIDDEN_QUALIFIERS:
        assert word.lower() not in blob, (
            f"public stub leaked editorial qualifier: {word!r} in text "
            f"-> {j.text}"
        )


def test_default_judgment_text_keys():
    data = _make_ddata()
    j = derive_default_judgment(data)
    assert set(j.text.keys()) == {
        "headline", "cum_insight", "alpha_quality_insight",
        "dna_insight", "summary",
    }


def test_default_judgment_states_and_flags_empty():
    """The bland public stub never fills states or flags. Those are BWMACRO's."""
    data = _make_ddata()
    j = derive_default_judgment(data)
    assert j.states == {}
    assert j.flags == []


def test_default_judgment_includes_features():
    data = _make_ddata()
    j = derive_default_judgment(data)
    assert "residual_share" in j.features
    assert "geo_residual_return_pct" in j.features


def test_default_judgment_carries_version_and_ticker():
    data = _make_ddata(ticker="NVDA")
    j = derive_default_judgment(data)
    assert j.version == INTERPRETER_VERSION
    assert j.ticker == "NVDA"
    assert j.as_of == data.teo


def test_default_judgment_text_contains_numerics():
    """Bland stub should still produce useful text — not just empty strings."""
    data = _make_ddata(res_er=0.55, rank_resid=78)
    j = derive_default_judgment(data)
    # Expect a percent figure somewhere in headline
    assert re.search(r"[+\-]?\d", j.text["headline"]), j.text["headline"]


# ---------------------------------------------------------------------------
# Narrative boundary — no recommendation language (THE_ANALYST §2)
# ---------------------------------------------------------------------------

def test_recommendation_language_violations_detects_advice_framing():
    assert recommendation_language_violations("You should trim NVDA here.") == ["you should"]
    assert "we recommend" in recommendation_language_violations(
        "We recommend hedging the market leg."
    )
    assert "consider buying" in recommendation_language_violations(
        "You could consider buying more semis."
    )


def test_recommendation_language_violations_clean_on_descriptions():
    # Bare "buy"/"sell"/"hedge" in factual descriptions must NOT trip the guard.
    assert recommendation_language_violations("The L3 market hedge ratio is 0.62.") == []
    assert recommendation_language_violations(
        "$0.62 of SPY per $1 of portfolio neutralizes the market leg."
    ) == []
    assert recommendation_language_violations("Heavy presence of momentum buyers.") == []
    assert recommendation_language_violations("") == []
    assert recommendation_language_violations(None) == []


def test_judgment_narrative_violations_flags_recommendation_laden_judgment():
    bad = Judgment(
        ticker="NVDA",
        as_of="2026-05-01",
        text={
            "headline": "NVDA — systematic 70%, residual +2.1%.",
            "summary": "You should trim your NVDA position and rebalance toward defensives.",
        },
    )
    viol = judgment_narrative_violations(bad)
    assert viol, "expected the recommendation-laden summary to be flagged"
    assert any("text.summary" in v for v in viol)


def test_judgment_narrative_violations_clean_on_default_judgment():
    data = _make_ddata(ticker="NVDA", res_er=0.4, rank_resid=72)
    j = derive_default_judgment(data)
    assert judgment_narrative_violations(j) == []
