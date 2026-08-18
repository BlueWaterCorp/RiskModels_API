"""Provider registration — skip if openbb-core is not installed."""

from __future__ import annotations

from pathlib import Path

import pytest

PROVIDER_SRC = (
    Path(__file__).resolve().parents[1] / "openbb_riskmodels" / "provider.py"
)


def test_source_does_not_register_equity_fundamental_metrics():
    text = PROVIDER_SRC.read_text(encoding="utf-8")
    assert "EquityFundamentalMetrics" not in text.split("fetcher_dict", 1)[-1]
    compact = "".join(text.split())
    assert "fetcher_dict={}" in compact


def test_provider_fetcher_dict_empty():
    pytest.importorskip("openbb_core")
    from openbb_riskmodels.provider import riskmodels_provider

    assert riskmodels_provider.name == "riskmodels"
    assert riskmodels_provider.fetcher_dict == {}
    assert "EquityFundamentalMetrics" not in riskmodels_provider.fetcher_dict
