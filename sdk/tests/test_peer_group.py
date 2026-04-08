"""Unit tests for riskmodels.peer_group — PeerGroupProxy + PeerComparison.

All tests construct real objects directly — no mock clients.
from_ticker() and compare() require a live API and are tested in the
integration tests at the bottom (skipped by default).
"""

from __future__ import annotations

import json
from typing import Any

import pandas as pd
import pytest

from riskmodels.peer_group import PeerComparison, PeerGroupProxy, _safe_float
from riskmodels.portfolio_math import PortfolioAnalysis
from riskmodels.lineage import RiskLineage


# ---------------------------------------------------------------------------
# Helpers — build real objects by hand
# ---------------------------------------------------------------------------

def _make_proxy(
    target_ticker: str = "NVDA",
    sector_etf: str = "SMH",
    peers: dict[str, float] | None = None,
) -> PeerGroupProxy:
    if peers is None:
        peers = {"AMD": 0.5, "INTC": 0.3, "AVGO": 0.2}
    return PeerGroupProxy(
        target_ticker=target_ticker,
        target_symbol=f"{target_ticker}-US",
        sector_etf=sector_etf,
        group_by="subsector_etf",
        weighting="market_cap",
        peer_tickers=sorted(peers.keys()),
        weights=peers,
        weight_source="market_cap",
        peer_names={t: t for t in peers},
    )


def _make_peer_portfolio(
    peer_tickers: list[str],
    peer_res_er: float = 0.31,
    peer_vol: float = 0.28,
) -> PortfolioAnalysis:
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


def _make_comparison(
    target_res_er: float = 0.42,
    peer_res_er: float = 0.31,
) -> PeerComparison:
    peers = ["AMD", "INTC", "AVGO"]
    peer_portfolio = _make_peer_portfolio(peers, peer_res_er=peer_res_er)
    peer_detail = peer_portfolio.per_ticker.copy()
    return PeerComparison(
        target_ticker="NVDA",
        peer_group_label="SMH Subsector Peers (cap-wt, N=3)",
        target_metrics={"l3_residual_er": target_res_er, "vol_23d": 0.55},
        peer_portfolio=peer_portfolio,
        target_l3_residual_er=target_res_er,
        peer_avg_l3_residual_er=peer_res_er,
        selection_spread=target_res_er - peer_res_er,
        target_vol=0.55,
        peer_avg_vol=0.28,
        peer_detail=peer_detail,
    )


# ---------------------------------------------------------------------------
# PeerGroupProxy — constructed directly
# ---------------------------------------------------------------------------

class TestPeerGroupProxy:
    def test_label_includes_etf_and_count(self):
        pg = _make_proxy()
        assert "SMH" in pg.label
        assert "3" in pg.label

    def test_n_peers(self):
        pg = _make_proxy()
        assert pg.n_peers == 3

    def test_target_excluded_from_peers(self):
        pg = _make_proxy()
        assert "NVDA" not in pg.peer_tickers

    def test_as_positions_format(self):
        pg = _make_proxy()
        positions = pg.as_positions()
        assert isinstance(positions, list)
        assert all("ticker" in p and "weight" in p for p in positions)
        total = sum(p["weight"] for p in positions)
        assert total == pytest.approx(1.0)
        assert "NVDA" not in {p["ticker"] for p in positions}

    def test_to_dict_serializable(self):
        pg = _make_proxy()
        d = pg.to_dict()
        required_keys = {
            "target_ticker", "target_symbol", "sector_etf", "group_by",
            "weighting", "weight_source", "n_peers", "peer_tickers", "weights",
        }
        assert required_keys.issubset(d.keys())
        assert d["target_ticker"] == "NVDA"
        assert d["n_peers"] == 3
        json.dumps(d)  # must be JSON-serializable

    def test_equal_weight_source(self):
        pg = PeerGroupProxy(
            target_ticker="XYZ",
            target_symbol="XYZ-US",
            sector_etf="XLF",
            group_by="sector_etf",
            weighting="equal",
            peer_tickers=["JPM", "BAC"],
            weights={"JPM": 0.5, "BAC": 0.5},
            weight_source="equal",
        )
        assert pg.weight_source == "equal"
        assert "eq-wt" in pg.label


# ---------------------------------------------------------------------------
# PeerComparison — constructed directly
# ---------------------------------------------------------------------------

class TestPeerComparison:
    def test_selection_spread(self):
        comp = _make_comparison(target_res_er=0.42, peer_res_er=0.31)
        assert comp.selection_spread == pytest.approx(0.11)

    def test_summary_row(self):
        comp = _make_comparison()
        row = comp.summary_row()
        assert row["ticker"] == "NVDA"
        assert row["selection_spread"] == pytest.approx(0.11)
        assert row["peer_count"] == 3

    def test_to_dataframe(self):
        comp = _make_comparison()
        df = comp.to_dataframe()
        assert len(df) == 4  # 1 target summary + 3 peers
        assert df.iloc[0]["ticker"] == "NVDA"

    def test_to_csv_string(self):
        comp = _make_comparison()
        csv_str = comp.to_csv()
        assert csv_str is not None
        assert "NVDA" in csv_str

    def test_to_csv_file(self, tmp_path):
        comp = _make_comparison()
        out = tmp_path / "peers.csv"
        comp.to_csv(path=out)
        assert out.exists()
        df = pd.read_csv(out)
        assert len(df) == 4


# ---------------------------------------------------------------------------
# _safe_float — edge cases
# ---------------------------------------------------------------------------

class TestSafeFloat:
    def test_none(self):
        assert _safe_float(None) is None

    def test_nan(self):
        assert _safe_float(float("nan")) is None

    def test_valid_float(self):
        assert _safe_float(0.42) == pytest.approx(0.42)

    def test_string_float(self):
        assert _safe_float("0.5") == pytest.approx(0.5)

    def test_empty_string(self):
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
    if coverage_pct < 50:
        pytest.skip(
            f"Low subsector_etf coverage ({coverage_pct:.1f}%) — "
            "backfill from sector-etf-mapper.ts may be needed before PeerGroupProxy is reliable"
        )
