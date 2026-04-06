"""Unit tests for riskmodels.peer_group — PeerGroupProxy + PeerComparison.

All tests are offline (no HTTP). The client is mocked to return controlled
fixtures so we can test construction logic, weighting, fallback paths,
and comparison math without hitting the live API.

Integration tests (marked @pytest.mark.integration) require a live
RISKMODELS_API_KEY and are skipped by default (see pyproject.toml addopts).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from dataclasses import dataclass
from typing import Any

import pandas as pd
import pytest

from riskmodels.peer_group import PeerComparison, PeerGroupProxy, _cap_weight_peers, _safe_float
from riskmodels.portfolio_math import PortfolioAnalysis, renormalize_weights
from riskmodels.lineage import RiskLineage


# ---------------------------------------------------------------------------
# Fixtures — controlled metric snapshots
# ---------------------------------------------------------------------------

def _make_metrics_df(
    ticker: str = "NVDA",
    symbol: str = "NVDA-US",
    subsector_etf: str = "SMH",
    sector_etf: str = "XLK",
    l3_residual_er: float = 0.42,
    vol_23d: float = 0.38,
    market_cap: float = 3_200_000_000_000.0,
) -> pd.DataFrame:
    return pd.DataFrame([{
        "ticker": ticker,
        "symbol": symbol,
        "subsector_etf": subsector_etf,
        "sector_etf": sector_etf,
        "l3_residual_er": l3_residual_er,
        "l3_market_er": 0.20,
        "l3_sector_er": 0.18,
        "l3_subsector_er": 0.20,
        "vol_23d": vol_23d,
        "market_cap": market_cap,
        "l3_market_hr": 1.10,
        "l3_sector_hr": 0.85,
        "l3_subsector_hr": 0.72,
    }])


def _make_universe_df(rows: list[dict]) -> pd.DataFrame:
    """Build a universe DataFrame as returned by client.search_tickers()."""
    return pd.DataFrame(rows)


def _make_mock_client(
    target_df: pd.DataFrame,
    universe_df: pd.DataFrame,
    peer_dfs: dict[str, pd.DataFrame] | None = None,
    portfolio_analysis: PortfolioAnalysis | None = None,
) -> MagicMock:
    """Build a mock RiskModelsClient with controlled return values."""
    client = MagicMock()

    # get_metrics returns target_df for the target; peer_dfs for peers
    peer_dfs = peer_dfs or {}

    def _get_metrics(ticker: str, as_dataframe: bool = False) -> pd.DataFrame:
        ticker_up = ticker.upper()
        return peer_dfs.get(ticker_up, target_df)

    client.get_metrics.side_effect = _get_metrics
    client.search_tickers.return_value = universe_df

    if portfolio_analysis is not None:
        client.analyze_portfolio.return_value = portfolio_analysis

    return client


def _make_peer_portfolio(
    peer_tickers: list[str],
    peer_res_er: float = 0.31,
    peer_vol: float = 0.28,
) -> PortfolioAnalysis:
    """Minimal PortfolioAnalysis for peer group results."""
    weights = {t: 1.0 / len(peer_tickers) for t in peer_tickers}
    rows = [
        {
            "ticker": t,
            "weight": weights[t],
            "l3_residual_er": peer_res_er,
            "l3_market_er": 0.20,
            "l3_sector_er": 0.19,
            "l3_subsector_er": 0.18,
            "vol_23d": peer_vol,
        }
        for t in peer_tickers
    ]
    per_ticker = pd.DataFrame(rows).set_index("ticker", drop=False)
    return PortfolioAnalysis(
        lineage=RiskLineage(),
        per_ticker=per_ticker,
        portfolio_hedge_ratios={"l3_market_hr": 1.05, "l3_sector_hr": 0.80},
        portfolio_l3_er_weighted_mean={
            "l3_market_er": 0.20,
            "l3_sector_er": 0.19,
            "l3_subsector_er": 0.18,
            "l3_residual_er": peer_res_er,
        },
        weights=weights,
        errors={},
    )


# ---------------------------------------------------------------------------
# 1. from_ticker() — correct subsector_etf filtering
# ---------------------------------------------------------------------------

def test_from_ticker_uses_subsector_by_default():
    """PeerGroupProxy.from_ticker() defaults to subsector_etf, not sector_etf."""
    target_df = _make_metrics_df("NVDA", subsector_etf="SMH", sector_etf="XLK")
    universe = _make_universe_df([
        {"ticker": "NVDA", "subsector_etf": "SMH", "sector_etf": "XLK"},
        {"ticker": "AMD",  "subsector_etf": "SMH", "sector_etf": "XLK"},
        {"ticker": "INTC", "subsector_etf": "SMH", "sector_etf": "XLK"},
        {"ticker": "AAPL", "subsector_etf": "XLK", "sector_etf": "XLK"},  # wrong subsector
        {"ticker": "MSFT", "subsector_etf": "XLK", "sector_etf": "XLK"},  # wrong subsector
    ])
    peer_dfs = {
        "AMD":  _make_metrics_df("AMD",  market_cap=400_000_000_000.0),
        "INTC": _make_metrics_df("INTC", market_cap=100_000_000_000.0),
    }
    client = _make_mock_client(target_df, universe, peer_dfs)

    pg = PeerGroupProxy.from_ticker(client, "NVDA")

    assert pg.target_ticker == "NVDA"
    assert pg.group_by == "subsector_etf"
    assert pg.sector_etf == "SMH"
    # Only SMH peers, AAPL/MSFT excluded
    assert "AMD" in pg.peer_tickers
    assert "INTC" in pg.peer_tickers
    assert "AAPL" not in pg.peer_tickers
    assert "MSFT" not in pg.peer_tickers
    # Target excluded from its own peer group
    assert "NVDA" not in pg.peer_tickers


# ---------------------------------------------------------------------------
# 2. from_ticker() — subsector fallback to sector when subsector_etf is None
# ---------------------------------------------------------------------------

def test_from_ticker_falls_back_to_sector_when_no_subsector():
    """If target has no subsector_etf, fall back to sector_etf with a warning."""
    target_df = _make_metrics_df("XYZ", subsector_etf=None, sector_etf="XLF")
    target_df["subsector_etf"] = None  # explicitly None
    universe = _make_universe_df([
        {"ticker": "XYZ",  "sector_etf": "XLF", "subsector_etf": None},
        {"ticker": "JPM",  "sector_etf": "XLF", "subsector_etf": None},
        {"ticker": "BAC",  "sector_etf": "XLF", "subsector_etf": None},
        {"ticker": "GS",   "sector_etf": "XLF", "subsector_etf": None},
        {"ticker": "NVDA", "sector_etf": "XLK", "subsector_etf": "SMH"},
    ])
    peer_dfs = {
        "JPM": _make_metrics_df("JPM", market_cap=600_000_000_000.0),
        "BAC": _make_metrics_df("BAC", market_cap=300_000_000_000.0),
        "GS":  _make_metrics_df("GS",  market_cap=150_000_000_000.0),
    }
    client = _make_mock_client(target_df, universe, peer_dfs)

    with pytest.warns(UserWarning, match="subsector_etf"):
        pg = PeerGroupProxy.from_ticker(client, "XYZ")

    assert pg.group_by == "sector_etf"
    assert pg.sector_etf == "XLF"
    assert set(pg.peer_tickers) == {"JPM", "BAC", "GS"}
    assert "NVDA" not in pg.peer_tickers


# ---------------------------------------------------------------------------
# 3. _cap_weight_peers() — valid caps produce correct weights
# ---------------------------------------------------------------------------

def test_cap_weight_peers_correct_weights():
    """Cap-weighting divides each cap by the total."""
    peer_dfs = {
        "AMD":  _make_metrics_df("AMD",  market_cap=400.0),
        "INTC": _make_metrics_df("INTC", market_cap=100.0),
    }
    client = MagicMock()
    client.get_metrics.side_effect = lambda t, **kw: peer_dfs.get(t.upper(), pd.DataFrame())

    weights, source = _cap_weight_peers(client, ["AMD", "INTC"], min_cap_coverage=2)

    assert source == "market_cap"
    assert weights["AMD"] == pytest.approx(0.8)
    assert weights["INTC"] == pytest.approx(0.2)
    assert sum(weights.values()) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# 4. _cap_weight_peers() — fewer than min_cap_coverage → equal-weight fallback
# ---------------------------------------------------------------------------

def test_cap_weight_peers_equal_weight_fallback():
    """If fewer than min_cap_coverage tickers have market_cap, fall back to equal-weight."""
    peer_dfs = {
        "AMD": _make_metrics_df("AMD", market_cap=None),
    }

    def _get_metrics(t: str, **kw: Any) -> pd.DataFrame:
        df = peer_dfs.get(t.upper(), pd.DataFrame())
        if not df.empty:
            df = df.copy()
            df["market_cap"] = None
        return df

    client = MagicMock()
    client.get_metrics.side_effect = _get_metrics

    weights, source = _cap_weight_peers(client, ["AMD", "INTC", "AVGO"], min_cap_coverage=3)

    assert source == "equal"
    assert weights["AMD"] == pytest.approx(1 / 3)
    assert weights["INTC"] == pytest.approx(1 / 3)
    assert weights["AVGO"] == pytest.approx(1 / 3)


# ---------------------------------------------------------------------------
# 5. compare() — selection_spread = target_res_er - peer_avg_res_er
# ---------------------------------------------------------------------------

def test_compare_selection_spread():
    """PeerComparison.selection_spread = target residual ER minus peer avg."""
    target_res_er = 0.42
    peer_res_er = 0.31

    target_df = _make_metrics_df("NVDA", l3_residual_er=target_res_er)
    universe = _make_universe_df([
        {"ticker": "NVDA", "subsector_etf": "SMH"},
        {"ticker": "AMD",  "subsector_etf": "SMH"},
        {"ticker": "INTC", "subsector_etf": "SMH"},
        {"ticker": "AVGO", "subsector_etf": "SMH"},
    ])
    peers = ["AMD", "INTC", "AVGO"]
    peer_portfolio = _make_peer_portfolio(peers, peer_res_er=peer_res_er)
    peer_dfs = {t: _make_metrics_df(t, market_cap=200_000_000_000.0) for t in peers}

    client = _make_mock_client(target_df, universe, peer_dfs, peer_portfolio)

    pg = PeerGroupProxy.from_ticker(client, "NVDA")
    comparison = pg.compare(client)

    assert comparison.target_l3_residual_er == pytest.approx(target_res_er)
    assert comparison.peer_avg_l3_residual_er == pytest.approx(peer_res_er)
    assert comparison.selection_spread == pytest.approx(target_res_er - peer_res_er)
    assert isinstance(comparison, PeerComparison)
    assert comparison.target_ticker == "NVDA"


# ---------------------------------------------------------------------------
# 6. as_positions() — correct format for analyze_portfolio()
# ---------------------------------------------------------------------------

def test_as_positions_format():
    """as_positions() returns list of {ticker, weight} dicts summing to 1.0."""
    target_df = _make_metrics_df("NVDA", subsector_etf="SMH")
    universe = _make_universe_df([
        {"ticker": "NVDA", "subsector_etf": "SMH"},
        {"ticker": "AMD",  "subsector_etf": "SMH"},
        {"ticker": "INTC", "subsector_etf": "SMH"},
        {"ticker": "AVGO", "subsector_etf": "SMH"},
    ])
    peers = ["AMD", "INTC", "AVGO"]
    peer_dfs = {t: _make_metrics_df(t, market_cap=100_000_000_000.0) for t in peers}
    client = _make_mock_client(target_df, universe, peer_dfs)

    pg = PeerGroupProxy.from_ticker(client, "NVDA")
    positions = pg.as_positions()

    assert isinstance(positions, list)
    assert all("ticker" in p and "weight" in p for p in positions)
    total_weight = sum(p["weight"] for p in positions)
    assert total_weight == pytest.approx(1.0)
    tickers = {p["ticker"] for p in positions}
    assert "NVDA" not in tickers  # target excluded


# ---------------------------------------------------------------------------
# 7. to_dict() — serializable, all required fields present
# ---------------------------------------------------------------------------

def test_to_dict_serializable():
    """to_dict() returns a plain dict with all required fields."""
    target_df = _make_metrics_df("NVDA", subsector_etf="SMH")
    universe = _make_universe_df([
        {"ticker": "NVDA", "subsector_etf": "SMH"},
        {"ticker": "AMD",  "subsector_etf": "SMH"},
        {"ticker": "INTC", "subsector_etf": "SMH"},
        {"ticker": "AVGO", "subsector_etf": "SMH"},
    ])
    peers = ["AMD", "INTC", "AVGO"]
    peer_dfs = {t: _make_metrics_df(t, market_cap=100_000_000_000.0) for t in peers}
    client = _make_mock_client(target_df, universe, peer_dfs)

    pg = PeerGroupProxy.from_ticker(client, "NVDA")
    d = pg.to_dict()

    required_keys = {
        "target_ticker", "target_symbol", "sector_etf", "group_by",
        "weighting", "weight_source", "n_peers", "peer_tickers", "weights",
    }
    assert required_keys.issubset(d.keys())
    assert d["target_ticker"] == "NVDA"
    assert d["group_by"] == "subsector_etf"
    assert d["n_peers"] == len(peers)
    assert isinstance(d["weights"], dict)
    assert isinstance(d["peer_tickers"], list)
    # Must be JSON-serializable (no pandas types, no numpy)
    import json
    json.dumps(d)  # raises if not serializable


# ---------------------------------------------------------------------------
# 8. label property — readable string for snapshot headers
# ---------------------------------------------------------------------------

def test_label_includes_n_peers_and_etf():
    target_df = _make_metrics_df("NVDA", subsector_etf="SMH")
    universe = _make_universe_df([
        {"ticker": "NVDA", "subsector_etf": "SMH"},
        {"ticker": "AMD",  "subsector_etf": "SMH"},
        {"ticker": "INTC", "subsector_etf": "SMH"},
        {"ticker": "AVGO", "subsector_etf": "SMH"},
    ])
    peers = ["AMD", "INTC", "AVGO"]
    peer_dfs = {t: _make_metrics_df(t, market_cap=100_000_000_000.0) for t in peers}
    client = _make_mock_client(target_df, universe, peer_dfs)

    pg = PeerGroupProxy.from_ticker(client, "NVDA")
    lbl = pg.label

    assert "SMH" in lbl
    assert str(len(peers)) in lbl  # N=3


# ---------------------------------------------------------------------------
# 9. _safe_float — handles None, NaN, str cleanly
# ---------------------------------------------------------------------------

def test_safe_float_handles_edge_cases():
    import math
    assert _safe_float(None) is None
    assert _safe_float(float("nan")) is None
    assert _safe_float(0.42) == pytest.approx(0.42)
    assert _safe_float("0.5") == pytest.approx(0.5)
    assert _safe_float("") is None


# ---------------------------------------------------------------------------
# Integration tests (skipped by default — require live API key)
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_peer_group_nvda_live():
    """Full end-to-end: build PeerGroupProxy for NVDA and compare against peers."""
    from riskmodels import RiskModelsClient

    client = RiskModelsClient()
    pg = PeerGroupProxy.from_ticker(client, "NVDA")

    assert pg.target_ticker == "NVDA"
    assert pg.group_by == "subsector_etf"
    assert pg.n_peers >= 3
    # Should include at least one major semiconductor
    assert any(t in pg.peer_tickers for t in ["AMD", "INTC", "AVGO", "QCOM", "MRVL"])

    comparison = pg.compare(client)
    assert comparison.selection_spread is not None
    assert comparison.peer_avg_l3_residual_er is not None
    assert 0.0 <= comparison.peer_avg_l3_residual_er <= 1.0

    positions = pg.as_positions()
    assert sum(p["weight"] for p in positions) == pytest.approx(1.0, abs=1e-6)


@pytest.mark.integration
def test_peer_group_subsector_coverage():
    """Verify subsector_etf is populated in /api/tickers for common names."""
    from riskmodels import RiskModelsClient

    client = RiskModelsClient()
    universe = client.search_tickers(include_metadata=True, as_dataframe=True)

    assert "subsector_etf" in universe.columns, (
        "subsector_etf missing from /api/tickers metadata — endpoint patch may not be deployed"
    )

    total = len(universe)
    has_subsector = universe["subsector_etf"].notna().sum()
    coverage_pct = has_subsector / total * 100

    print(f"\nsubsector_etf coverage: {has_subsector}/{total} ({coverage_pct:.1f}%)")
    # Warn if coverage is very low
    if coverage_pct < 50:
        pytest.skip(
            f"Low subsector_etf coverage ({coverage_pct:.1f}%) — "
            "backfill from sector-etf-mapper.ts may be needed before PeerGroupProxy is reliable"
        )
