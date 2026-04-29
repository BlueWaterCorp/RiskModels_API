"""Tests for the visual component library (Phase 1).

All tests use synthetic data — no API calls needed.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from riskmodels.visuals.components import (
    AttributionCascadeData,
    AttributionPosition,
    CascadePosition,
    L3DecompositionData,
    L3LayerValues,
    L3TickerRow,
    RiskCascadeData,
    VarianceWaterfallData,
    WaterfallLayer,
    build_attribution_cascade_data,
    build_l3_decomposition_data,
    build_risk_cascade_data,
    build_variance_waterfall_data,
    plot_attribution_cascade_from_data,
    plot_l3_decomposition_from_data,
    plot_risk_cascade_from_data,
    plot_variance_waterfall_from_data,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def per_ticker_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "l3_market_er": [0.40, 0.30],
            "l3_sector_er": [0.20, 0.25],
            "l3_subsector_er": [0.15, 0.20],
            "l3_residual_er": [0.25, 0.25],
            "vol_23d": [0.35, 0.28],
        },
        index=["AAPL", "MSFT"],
    )


@pytest.fixture
def weights() -> dict[str, float]:
    return {"AAPL": 0.6, "MSFT": 0.4}


@pytest.fixture
def returns_long_df() -> pd.DataFrame:
    np.random.seed(42)
    dates = pd.date_range("2025-01-01", periods=20)
    rows = []
    for t in ["AAPL", "MSFT"]:
        for d in dates:
            rows.append({"ticker": t, "date": d, "returns_gross": np.random.normal(0.001, 0.02)})
    return pd.DataFrame(rows)


@pytest.fixture
def l3_rows() -> list[dict]:
    return [
        {
            "ticker": "NVDA",
            "l3_market_rr": 0.35,
            "l3_sector_rr": 0.25,
            "l3_subsector_rr": 0.15,
            "l3_residual_er": 0.25,
            "vol_23d": 0.55,
            "subsector_etf": "SOXX",
            "sector_etf": "XLK",
        },
        {
            "ticker": "AAPL",
            "l3_market_rr": 0.50,
            "l3_sector_rr": 0.20,
            "l3_subsector_rr": 0.10,
            "l3_residual_er": 0.20,
            "vol_23d": 0.30,
            "subsector_etf": "SOXX",
            "sector_etf": "XLK",
        },
    ]


# ---------------------------------------------------------------------------
# L3LayerValues
# ---------------------------------------------------------------------------

class TestL3LayerValues:
    def test_systematic(self):
        v = L3LayerValues(market=0.4, sector=0.2, subsector=0.15, residual=0.25)
        assert abs(v.systematic - 0.75) < 1e-9

    def test_total(self):
        v = L3LayerValues(market=0.4, sector=0.2, subsector=0.15, residual=0.25)
        assert abs(v.total - 1.0) < 1e-9

    def test_round_trip(self):
        v = L3LayerValues(market=0.4, sector=0.2, subsector=0.15, residual=0.25)
        d = v.to_dict()
        restored = L3LayerValues.from_dict(d)
        assert restored.market == v.market
        assert restored.residual == v.residual


# ---------------------------------------------------------------------------
# Variance Waterfall
# ---------------------------------------------------------------------------

class TestVarianceWaterfall:
    def test_build_data_sigma_scaled(self, per_ticker_df, weights):
        data = build_variance_waterfall_data(per_ticker_df, weights, sigma_scaled=True)
        assert len(data.layers) == 4
        assert data.sigma_scaled is True
        assert data.total_value > 0
        layer_sum = sum(l.value for l in data.layers)
        assert abs(layer_sum - data.total_value) < 1e-9

    def test_build_data_variance_fractions(self, per_ticker_df, weights):
        data = build_variance_waterfall_data(per_ticker_df, weights, sigma_scaled=False)
        assert data.sigma_scaled is False
        assert "variance" in data.x_title.lower()

    def test_round_trip(self, per_ticker_df, weights):
        data = build_variance_waterfall_data(per_ticker_df, weights)
        d = data.to_dict()
        assert d["schema_version"] == "1.0"
        # Ensure JSON-safe
        json_str = json.dumps(d)
        restored = VarianceWaterfallData.from_dict(json.loads(json_str))
        assert len(restored.layers) == len(data.layers)
        assert restored.layers[0].value == data.layers[0].value
        assert restored.sigma_scaled == data.sigma_scaled

    def test_plot_from_data(self, per_ticker_df, weights):
        data = build_variance_waterfall_data(per_ticker_df, weights)
        fig = plot_variance_waterfall_from_data(data)
        assert hasattr(fig, "data")
        assert len(fig.data) > 0

    def test_adapter_matches(self, per_ticker_df, weights):
        from riskmodels.visuals import plot_variance_waterfall

        fig_adapter = plot_variance_waterfall(per_ticker_df, weights, sigma_scaled=True)
        data = build_variance_waterfall_data(per_ticker_df, weights, sigma_scaled=True)
        fig_component = plot_variance_waterfall_from_data(data)
        assert len(fig_adapter.data) == len(fig_component.data)


# ---------------------------------------------------------------------------
# Risk Cascade
# ---------------------------------------------------------------------------

class TestRiskCascade:
    def test_build_data(self, per_ticker_df, weights):
        data = build_risk_cascade_data(per_ticker_df, weights)
        assert len(data.positions) == 2
        assert data.portfolio_systematic_er > 0
        assert data.sort_by == "weight"

    def test_round_trip(self, per_ticker_df, weights):
        data = build_risk_cascade_data(per_ticker_df, weights)
        d = data.to_dict()
        assert d["schema_version"] == "1.0"
        json_str = json.dumps(d)
        restored = RiskCascadeData.from_dict(json.loads(json_str))
        assert len(restored.positions) == len(data.positions)
        assert restored.positions[0].ticker == data.positions[0].ticker
        assert restored.positions[0].l3.market == data.positions[0].l3.market

    def test_plot_from_data(self, per_ticker_df, weights):
        data = build_risk_cascade_data(per_ticker_df, weights)
        fig = plot_risk_cascade_from_data(data)
        assert hasattr(fig, "data")
        assert len(fig.data) > 0

    def test_adapter_matches(self, per_ticker_df, weights):
        from riskmodels.visuals import plot_risk_cascade

        fig_adapter = plot_risk_cascade(per_ticker_df, weights)
        data = build_risk_cascade_data(per_ticker_df, weights)
        fig_component = plot_risk_cascade_from_data(data)
        assert len(fig_adapter.data) == len(fig_component.data)


# ---------------------------------------------------------------------------
# Attribution Cascade
# ---------------------------------------------------------------------------

class TestAttributionCascade:
    def test_build_data(self, returns_long_df, per_ticker_df, weights):
        data = build_attribution_cascade_data(returns_long_df, weights, per_ticker_df)
        assert len(data.positions) == 2
        # Each position should have a realized return
        for p in data.positions:
            assert isinstance(p.realized_return, float)

    def test_round_trip(self, returns_long_df, per_ticker_df, weights):
        data = build_attribution_cascade_data(returns_long_df, weights, per_ticker_df)
        d = data.to_dict()
        assert d["schema_version"] == "1.0"
        json_str = json.dumps(d)
        restored = AttributionCascadeData.from_dict(json.loads(json_str))
        assert len(restored.positions) == len(data.positions)
        assert restored.positions[0].realized_return == data.positions[0].realized_return

    def test_plot_from_data(self, returns_long_df, per_ticker_df, weights):
        data = build_attribution_cascade_data(returns_long_df, weights, per_ticker_df)
        fig = plot_attribution_cascade_from_data(data)
        assert hasattr(fig, "data")
        assert len(fig.data) > 0

    def test_adapter_matches(self, returns_long_df, per_ticker_df, weights):
        from riskmodels.visuals import plot_attribution_cascade

        fig_adapter = plot_attribution_cascade(returns_long_df, weights, per_ticker_df)
        data = build_attribution_cascade_data(returns_long_df, weights, per_ticker_df)
        fig_component = plot_attribution_cascade_from_data(data)
        assert len(fig_adapter.data) == len(fig_component.data)


# ---------------------------------------------------------------------------
# L3 Decomposition
# ---------------------------------------------------------------------------

class TestL3Decomposition:
    def test_build_data_sigma_scaled(self, l3_rows):
        data = build_l3_decomposition_data(l3_rows, sigma_scaled=True)
        assert len(data.rows) == 2
        assert data.sigma_scaled is True
        assert data.rows[0].ticker == "NVDA"
        assert data.rows[0].annualized_vol == pytest.approx(0.55)

    def test_build_data_er_mode(self, l3_rows):
        data = build_l3_decomposition_data(l3_rows, sigma_scaled=False, annotation_mode="er_systematic")
        assert data.annotation_mode == "er_systematic"

    def test_round_trip(self, l3_rows):
        data = build_l3_decomposition_data(l3_rows)
        d = data.to_dict()
        assert d["schema_version"] == "1.0"
        json_str = json.dumps(d)
        restored = L3DecompositionData.from_dict(json.loads(json_str))
        assert len(restored.rows) == len(data.rows)
        assert restored.rows[0].ticker == data.rows[0].ticker
        assert restored.rows[0].l3.market == data.rows[0].l3.market
        assert restored.rows[1].subsector_etf == data.rows[1].subsector_etf

    def test_plot_from_data(self, l3_rows):
        data = build_l3_decomposition_data(l3_rows)
        fig = plot_l3_decomposition_from_data(data)
        assert hasattr(fig, "data")
        assert len(fig.data) > 0

    def test_adapter_matches(self, l3_rows):
        from riskmodels.visuals import plot_l3_horizontal

        fig_adapter = plot_l3_horizontal(l3_rows, sigma_scaled=True)
        data = build_l3_decomposition_data(l3_rows, sigma_scaled=True)
        fig_component = plot_l3_decomposition_from_data(data)
        assert len(fig_adapter.data) == len(fig_component.data)

    def test_dataframe_input(self):
        df = pd.DataFrame([
            {
                "ticker": "TSLA",
                "l3_mkt_er": 0.5,
                "l3_sec_er": 0.2,
                "l3_sub_er": 0.1,
                "l3_res_er": 0.2,
                "vol_23d": 0.60,
            }
        ])
        data = build_l3_decomposition_data(df, sigma_scaled=True, annotation_mode="er_systematic")
        assert len(data.rows) == 1
        assert data.rows[0].ticker == "TSLA"
        assert data.rows[0].l3.market == pytest.approx(0.5)

    def test_plot_raw_l3_decomposition_exact_fields(self):
        from riskmodels.visuals import plot_l3_decomposition

        raw = {
            "ticker": "NVDA",
            "dates": ["2026-01-01", "2026-01-02"],
            "l3_market_er": [0.3, 0.31],
            "l3_sector_er": [0.2, 0.19],
            "l3_subsector_er": [0.1, 0.11],
            "l3_residual_er": [0.4, 0.39],
        }

        fig = plot_l3_decomposition(raw, metric="variance", mode="timeseries")

        assert len(fig.data) == 4
        assert fig.data[0].name == "market: l3_market_er"
        assert list(fig.data[0].y) == [0.3, 0.31]
        assert fig.layout.meta["source"] == "/l3-decomposition"
        assert fig.layout.meta["l3_mapping"]["residual"] == "l3_residual_er"

    def test_plot_raw_portfolio_risk_snapshot_exact_nested_fields(self):
        from riskmodels.visuals import plot_l3_decomposition

        raw = {
            "as_of": "2026-01-02",
            "portfolio_risk_index": {
                "variance_decomposition": {
                    "market": 0.25,
                    "sector": 0.20,
                    "subsector": 0.15,
                    "residual": 0.40,
                    "systematic": 0.60,
                },
                "portfolio_volatility_23d": 0.18,
                "position_count": 3,
            },
        }

        fig = plot_l3_decomposition(raw)

        assert fig.data[0].name == "market: portfolio_risk_index.variance_decomposition.market"
        assert list(fig.data[0].x) == ["2026-01-02"]
        assert list(fig.data[3].y) == [0.40]
        assert fig.layout.meta["systematic_field"] == (
            "portfolio_risk_index.variance_decomposition.systematic"
        )

    def test_plot_raw_snapshot_mode_uses_layer_labels(self):
        from riskmodels.visuals import plot_l3_decomposition

        raw = {
            "as_of": "2026-01-02",
            "portfolio_risk_index": {
                "variance_decomposition": {
                    "market": 0.25,
                    "sector": 0.20,
                    "subsector": 0.15,
                    "residual": 0.40,
                    "systematic": 0.60,
                },
                "portfolio_volatility_23d": 0.18,
                "position_count": 3,
            },
        }

        fig = plot_l3_decomposition(raw, mode="snapshot")

        assert list(fig.data[0].y) == ["market", "sector", "subsector", "residual"]
        assert list(fig.data[0].customdata) == [
            "portfolio_risk_index.variance_decomposition.market",
            "portfolio_risk_index.variance_decomposition.sector",
            "portfolio_risk_index.variance_decomposition.subsector",
            "portfolio_risk_index.variance_decomposition.residual",
        ]

    def test_plot_raw_decompose_total_validation(self):
        from riskmodels.visuals import L3DecompositionMappingError, plot_l3_decomposition

        raw = {
            "data_as_of": "2026-01-02",
            "exposure": {
                "market": {"er": 0.25, "hr": 1.0, "hedge_etf": "SPY"},
                "sector": {"er": 0.25, "hr": 0.2, "hedge_etf": "XLK"},
                "subsector": {"er": 0.25, "hr": 0.1, "hedge_etf": "SMH"},
                "residual": {"er": 0.25, "hr": None, "hedge_etf": None},
            },
            "_data_health": {"er_sum": 0.90},
        }

        with pytest.raises(L3DecompositionMappingError, match="_data_health.er_sum"):
            plot_l3_decomposition(raw, metric="variance")

    def test_plot_raw_return_attribution_exact_fields(self):
        from riskmodels.visuals import plot_l3_decomposition

        raw = {
            "attribution": {
                "teo": ["2026-01-01", "2026-01-02"],
                "gross": [0.01, 0.02],
                "market": [0.002, 0.004],
                "sector": [0.003, 0.005],
                "subsector": [0.001, 0.002],
                "residual": [0.004, 0.009],
                "systematic": [0.006, 0.011],
            }
        }

        fig = plot_l3_decomposition(raw, metric="return")

        assert fig.data[0].name == "market: attribution.market"
        assert fig.layout.meta["total_field"] == "attribution.gross"
        assert fig.layout.meta["metric"] == "return"
