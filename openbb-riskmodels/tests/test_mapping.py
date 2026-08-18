from __future__ import annotations

from openbb_riskmodels.mapping import (
    FUNDAMENTALS_ROW_COLUMNS,
    map_decompose,
    map_decompose_historical,
    map_fundamentals,
)

DECOMPOSE = {
    "ticker": "NVDA",
    "data_as_of": "2026-04-21",
    "exposure": {
        "market": {"er": 0.45, "hr": 1.10, "hedge_etf": "SPY"},
        "sector": {"er": 0.22, "hr": 0.35, "hedge_etf": "XLK"},
        "subsector": {"er": 0.20, "hr": 0.60, "hedge_etf": "SMH"},
        "residual": {"er": 0.13, "hr": None, "hedge_etf": None},
    },
    "hedge": {"SPY": -1.10, "XLK": -0.35, "SMH": -0.60},
    "hedge_levels": {"recommended_level": "L2"},
    "style": {"explained_variance": 0.03, "hedgeable": False},
    "stock_specific": {"explained_variance": 0.66, "hedgeable": False},
}


def test_map_decompose_layers_hedge_and_v4_blocks():
    out = map_decompose(DECOMPOSE)
    assert out["ticker"] == "NVDA"
    assert out["recommended_hedge_level"] == "L2"
    assert out["hedge_map"]["SPY"] == -1.10
    assert out["market"]["hedge_etf"] == "SPY"
    assert out["residual"]["hr"] is None
    assert out["style"]["explained_variance"] == 0.03
    assert out["stock_specific"]["explained_variance"] == 0.66
    assert out["stock_specific"]["hedgeable"] is False


def test_map_decompose_historical_renames_l3_columns():
    rows = map_decompose_historical(
        [
            {
                "date": "2026-01-02T00:00:00",
                "l3_market_er": 0.25,
                "l3_sector_er": 0.25,
                "l3_subsector_er": 0.25,
                "l3_residual_er": 0.25,
                "l3_market_hr": 0.1,
                "l3_sector_hr": 0.1,
                "l3_subsector_hr": 0.0,
            }
        ]
    )
    assert rows[0]["date"] == "2026-01-02"
    assert rows[0]["market_er"] == 0.25
    assert rows[0]["market_hr"] == 0.1


def test_map_fundamentals_keeps_pit_columns():
    records = [
        {
            "period_end_date": "2025-09-30",
            "filed_date": "2025-10-31",
            "filed_date_source": "exact",
            "sec_facts": {"net_income": {"value": 1.0, "source": "us_gaap"}},
            "roe_ttm": 1.6,
            "payout_ratio": 0.1,
            "beta_source": "in-universe",
            "wacc": 0.085,
            "economic_profit": 13.0,
            "market_cap": 3.5e12,
        }
    ]
    rows = map_fundamentals(records)
    assert set(FUNDAMENTALS_ROW_COLUMNS) <= set(rows[0])
    assert rows[0]["filed_date"] == "2025-10-31"
    assert rows[0]["filed_date_source"] == "exact"
    assert rows[0]["sec_facts"]["net_income"]["source"] == "us_gaap"
    assert rows[0]["payout_ratio"] == 0.1
    assert rows[0]["beta_source"] == "in-universe"
