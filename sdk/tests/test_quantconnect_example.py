"""The stdlib-only QuantConnect helper must agree with riskmodels.alpha on the same basket."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from riskmodels import alpha_legs

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("riskmodels_alpha", ROOT / "examples" / "quantconnect" / "riskmodels_alpha.py")
qc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qc)
BASKET = json.loads((Path(__file__).parent / "fixtures" / "hedge_basket_NVDA_2026-11-09.json").read_text())


@pytest.mark.parametrize("direction", ["buy", "sell"])
def test_helper_matches_sdk(direction):
    sdk = {leg.symbol: leg.dollars for leg in alpha_legs(BASKET, direction, 20_000)}
    assert qc.alpha_legs(BASKET, direction, 20_000) == pytest.approx(sdk)


class _Algo:
    def __init__(self, key="rm_agent_live_x"):
        self.key, self.logs, self.urls = key, [], []

    def get_parameter(self, name):
        return self.key if name == "riskmodels_api_key" else None

    def download(self, url, headers):
        self.urls.append((url, headers))
        return json.dumps(BASKET)

    def log(self, msg):
        self.logs.append(msg)


def test_get_alpha_uses_header_and_logs_timing():
    algo = _Algo()
    legs = qc.get_alpha(algo, "NVDA", "sell", 10_000)
    assert algo.urls[0][0].endswith("/hedge-basket/NVDA?user_segment=stat_arb")
    assert algo.urls[0][1]["Authorization"] == "Bearer rm_agent_live_x"
    assert legs["NVDA"] == pytest.approx(-10_000)
    assert "ms" in algo.logs[0] and "NVDA" in algo.logs[0]


def test_missing_key_raises():
    with pytest.raises(ValueError):
        qc.get_alpha(_Algo(key=None), "NVDA", "buy", 1000)
