"""Mapping dict completeness (Phase 1.3)."""

from __future__ import annotations

from riskmodels.mapping import (
    BATCH_RETURNS_LONG_RENAME,
    METRICS_V3_TO_SEMANTIC,
    TICKER_RETURNS_COLUMN_RENAME,
)


def test_metrics_v3_to_semantic_is_injective_on_targets():
    targets = list(METRICS_V3_TO_SEMANTIC.values())
    assert len(targets) == len(set(targets)), "duplicate semantic targets"


def test_ticker_returns_column_rename_maps_all_wire_keys():
    assert len(TICKER_RETURNS_COLUMN_RENAME) == 7
    expected = {
        "l3_mkt_hr": "l3_market_hr",
        "l3_sec_hr": "l3_sector_hr",
        "l3_sub_hr": "l3_subsector_hr",
        "l3_mkt_er": "l3_market_er",
        "l3_sec_er": "l3_sector_er",
        "l3_sub_er": "l3_subsector_er",
        "l3_res_er": "l3_residual_er",
    }
    for k, v in TICKER_RETURNS_COLUMN_RENAME.items():
        assert expected[k] == v


def test_batch_returns_long_rename_l1_l2_l3_to_semantic_hr():
    assert BATCH_RETURNS_LONG_RENAME["l1"] == "l3_market_hr"
    assert BATCH_RETURNS_LONG_RENAME["l2"] == "l3_sector_hr"
    assert BATCH_RETURNS_LONG_RENAME["l3"] == "l3_subsector_hr"
    assert BATCH_RETURNS_LONG_RENAME["gross_return"] == "returns_gross"


def test_rename_dicts_keys_disjoint_from_values():
    for name, d in (
        ("METRICS_V3_TO_SEMANTIC", METRICS_V3_TO_SEMANTIC),
        ("TICKER_RETURNS_COLUMN_RENAME", TICKER_RETURNS_COLUMN_RENAME),
        ("BATCH_RETURNS_LONG_RENAME", BATCH_RETURNS_LONG_RENAME),
    ):
        assert set(d.keys()).isdisjoint(set(d.values())), f"{name}: key/value overlap"
