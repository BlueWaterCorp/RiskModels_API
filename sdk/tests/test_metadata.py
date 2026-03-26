"""attach_sdk_metadata and semantic cheatsheet (Phase 2.3)."""

from __future__ import annotations

import json

import pandas as pd

from riskmodels.legends import SHORT_ERM3_LEGEND
from riskmodels.lineage import RiskLineage
from riskmodels.mapping import COLUMN_AGENT_HINTS
from riskmodels.metadata_attach import attach_sdk_metadata


def test_attach_sdk_metadata_sets_expected_attrs():
    df = pd.DataFrame({"a": [1]})
    lineage = RiskLineage(
        model_version="ERM3-test",
        data_as_of="2026-01-01",
        request_id="req-1",
    )
    attach_sdk_metadata(df, lineage, kind="test_kind")

    assert df.attrs["legend"] == SHORT_ERM3_LEGEND
    assert df.attrs["riskmodels_kind"] == "test_kind"
    assert "riskmodels_semantic_cheatsheet" in df.attrs
    assert df.attrs["riskmodels_model_version"] == "ERM3-test"
    assert df.attrs["riskmodels_data_as_of"] == "2026-01-01"
    assert df.attrs["riskmodels_request_id"] == "req-1"


def test_riskmodels_lineage_is_valid_json_roundtrip():
    df = pd.DataFrame()
    lineage = RiskLineage(model_version="v1", universe_size=3000)
    attach_sdk_metadata(df, lineage, kind="m")

    raw = df.attrs["riskmodels_lineage"]
    parsed = json.loads(raw)
    assert isinstance(parsed, dict)
    assert parsed["model_version"] == "v1"
    assert parsed["universe_size"] == 3000


def test_semantic_cheatsheet_contains_column_agent_hints():
    df = pd.DataFrame()
    attach_sdk_metadata(df, RiskLineage(), kind="x")

    sheet = df.attrs["riskmodels_semantic_cheatsheet"]
    for col, hint in COLUMN_AGENT_HINTS.items():
        assert col in sheet
        assert hint in sheet


def test_attach_with_none_lineage_uses_empty_lineage():
    df = pd.DataFrame()
    attach_sdk_metadata(df, None, kind="empty")

    assert json.loads(df.attrs["riskmodels_lineage"]) == {}


def test_include_cheatsheet_false_omits_cheatsheet():
    df = pd.DataFrame()
    attach_sdk_metadata(df, RiskLineage(), kind="y", include_cheatsheet=False)

    assert "riskmodels_semantic_cheatsheet" not in df.attrs
