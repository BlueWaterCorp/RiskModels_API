"""3D namespaces, visuals, PDF transport, and ``PositionsInput``."""

from __future__ import annotations

import json

import httpx
import pandas as pd
import pytest

from riskmodels import RiskModelsClient
from riskmodels.lineage import RiskLineage
from riskmodels.performance.base import PerformanceResult
from riskmodels.portfolio_math import positions_to_weights
from riskmodels.visuals.cascade import plot_attribution_cascade, plot_risk_cascade
from riskmodels.visuals.l3_decomposition import plot_l3_horizontal
from riskmodels.visuals.utils import adjacent_bar_positions


def _client(handler):
    transport = httpx.MockTransport(handler)
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )


def test_positions_to_weights_accepts_list_of_dicts():
    w = positions_to_weights([{"ticker": "AAPL", "weight": 1.0}, {"ticker": "MSFT", "weight": 3.0}])
    assert w["AAPL"] == pytest.approx(0.25)
    assert w["MSFT"] == pytest.approx(0.75)


@pytest.mark.parametrize("time_axis", ["current", "historical"])
@pytest.mark.parametrize(
    "ns,has_plot",
    [
        ("stock", True),
        ("portfolio", True),
        ("pri", False),
    ],
)
def test_client_namespace_surface(time_axis: str, ns: str, has_plot: bool):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    c = _client(handler)
    branch = getattr(c, ns)
    facade = getattr(branch, time_axis)
    assert facade is not None
    if has_plot and ns != "pri":
        assert callable(getattr(facade, "plot", None)) or hasattr(facade, "data")


def test_get_metrics_snapshot_pdf():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/snapshot.pdf")
        assert "/metrics/NVDA/" in request.url.path
        return httpx.Response(200, content=b"%PDF-1.4 mock", headers={"X-API-Cost-USD": "0.25"})

    c = _client(handler)
    blob, lin = c.get_metrics_snapshot_pdf("NVDA")
    assert blob.startswith(b"%PDF")
    assert isinstance(lin, RiskLineage)


def test_post_portfolio_risk_snapshot_pdf():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(200, content=b"%PDF-1.4 mock")

    c = _client(handler)
    blob, _ = c.post_portfolio_risk_snapshot_pdf([{"ticker": "AAPL", "weight": 0.6}, {"ticker": "MSFT", "weight": 0.4}])
    assert blob.startswith(b"%PDF")
    assert captured["body"]["format"] == "pdf"
    assert len(captured["body"]["positions"]) == 2


def test_plot_l3_horizontal_smoke():
    rows = [
        {
            "ticker": "AAPL",
            "l3_market_er": 0.3,
            "l3_sector_er": 0.2,
            "l3_subsector_er": 0.1,
            "l3_residual_er": 0.4,
            "l3_market_hr": 0.9,
            "vol_23d": 0.28,
            "subsector_etf": "XLK",
        }
    ]
    fig = plot_l3_horizontal(rows, sigma_scaled=True, lineage=RiskLineage(model_version="t"))
    assert fig.layout.title.text


def test_adjacent_bar_positions_unit_widths():
    c, w = adjacent_bar_positions([0.25, 0.75], gap=0.0)
    assert len(c) == 2
    assert float(w.sum()) == pytest.approx(1.0)


def test_adjacent_bar_positions_bars_touch_no_gap():
    """Centers and widths from adjacent_bar_positions must pack [0,1] with no interior gaps."""
    c, w = adjacent_bar_positions([0.1, 0.2, 0.7], gap=0.0)
    assert len(c) == 3
    for i in range(len(c) - 1):
        right_i = float(c[i] + w[i] / 2.0)
        left_next = float(c[i + 1] - w[i + 1] / 2.0)
        assert right_i == pytest.approx(left_next)
    assert float(c[0] - w[0] / 2.0) == pytest.approx(0.0)
    assert float(c[-1] + w[-1] / 2.0) == pytest.approx(1.0)


def test_cascade_plotly_layout_zero_gap_keys():
    from riskmodels.visuals.utils import cascade_plotly_layout

    d = cascade_plotly_layout()
    assert d["bargap"] == 0
    assert d["bargroupgap"] == 0
    assert d["barmode"] == "overlay"


def test_plot_risk_cascade_smoke():
    df = pd.DataFrame(
        {
            "l3_market_er": [0.25, 0.25],
            "l3_sector_er": [0.25, 0.25],
            "l3_subsector_er": [0.25, 0.25],
            "l3_residual_er": [0.25, 0.25],
        },
        index=["AAPL", "MSFT"],
    )
    fig = plot_risk_cascade(df, {"AAPL": 0.5, "MSFT": 0.5})
    assert fig.layout.title.text


def test_plot_attribution_cascade_smoke():
    snap = pd.DataFrame(
        {
            "l3_market_er": [0.25],
            "l3_sector_er": [0.25],
            "l3_subsector_er": [0.25],
            "l3_residual_er": [0.25],
        },
        index=["AAPL"],
    )
    rl = pd.DataFrame(
        {
            "ticker": ["AAPL", "AAPL"],
            "returns_gross": [0.01, -0.005],
        }
    )
    fig = plot_attribution_cascade(rl, {"AAPL": 1.0}, snap)
    assert fig.layout.title.text


def test_performance_result_portfolio_plot():
    from riskmodels.portfolio_math import analyze_batch_to_portfolio

    body = {
        "results": {
            "AAPL": {
                "ticker": "AAPL",
                "status": "success",
                "full_metrics": {
                    "l3_market_er": 0.25,
                    "l3_sector_er": 0.25,
                    "l3_subsector_er": 0.25,
                    "l3_residual_er": 0.25,
                },
            },
        },
        "_metadata": {},
    }
    pa = analyze_batch_to_portfolio(body, {"AAPL": 1.0}, validate="off")
    pr = PerformanceResult(lineage=pa.lineage, kind="portfolio", portfolio_analysis=pa)
    fig = pr.plot(style="risk_cascade")
    assert fig.layout.title.text
