"""G.44 — historical as-of echo through the fund canonical + renderer.

A historical ``FundData`` (as_of_basis set) must surface on the canonical
as a reality-mode TemporalContext carrying the requested date, the basis,
and the degraded-sections markers — and the reference renderer must show
the historical labeling so the page can never pass as a current snapshot.
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

from riskmodels.snapshots import (
    CanonicalFundSnapshot,
    FundData,
    from_fund_components,
)
from riskmodels.snapshots.reference_renderer_fund import _build_page


def _fund_data(historical: bool) -> FundData:
    kw = {}
    if historical:
        kw = {
            "as_of_requested": "2024-06-30",
            "as_of_basis": "report_date",
            "historical_degradations": [
                "holdings_model_share_overlay_skipped",
                "fund_fit_section_omitted",
            ],
        }
    return FundData(
        bw_fund_id="BW-FUND-ASOF",
        ticker_primary="XT",
        fund_name="As-Of Test Fund",
        teo="2024-06-28",
        equity_style_9box=None,
        aum_usd=1e9,
        cum_nav_return=[("2024-05-31", 0.0), ("2024-06-28", 0.02)],
        **kw,
    )


def test_historical_fund_data_yields_reality_mode_temporal():
    snap = from_fund_components(_fund_data(historical=True))
    t = snap.temporal
    assert t is not None
    assert t.observation_mode == "reality"
    assert t.as_of_requested == "2024-06-30"
    assert t.as_of_basis == "report_date"
    assert "fund_fit_section_omitted" in t.degraded_sections
    # Identity as_of is the SERVED period (≤ requested).
    assert snap.identity.as_of == "2024-06-28"


def test_latest_fund_data_keeps_knowledge_mode_default():
    snap = from_fund_components(_fund_data(historical=False))
    t = snap.temporal
    assert t is not None
    assert t.observation_mode == "knowledge"
    assert t.as_of_requested is None
    assert t.as_of_basis is None
    assert t.degraded_sections == []


def test_temporal_echo_round_trips_through_json(tmp_path):
    snap = from_fund_components(_fund_data(historical=True))
    p = tmp_path / "snap.json"
    snap.to_json(p)
    back = CanonicalFundSnapshot.from_json(p)
    assert back.temporal is not None
    assert back.temporal.observation_mode == "reality"
    assert back.temporal.as_of_requested == "2024-06-30"
    assert back.temporal.as_of_basis == "report_date"
    assert back.temporal.degraded_sections == [
        "holdings_model_share_overlay_skipped",
        "fund_fit_section_omitted",
    ]


def _fig_texts(page) -> list[str]:
    return [t.get_text() for t in page.fig.texts]


def test_renderer_shows_historical_subtitle_and_degraded_note():
    snap = from_fund_components(_fund_data(historical=True))
    page = _build_page(snap)
    texts = _fig_texts(page)
    assert any("Historical (report_date basis)" in s for s in texts)
    note = [s for s in texts if s.startswith("Historical as-of view")]
    assert note, f"degraded-sections note missing; fig texts: {texts}"
    assert "model shares omitted" in note[0]
    assert "model-fit statistics omitted" in note[0]


def test_renderer_latest_page_carries_no_historical_labeling():
    snap = from_fund_components(_fund_data(historical=False))
    page = _build_page(snap)
    texts = _fig_texts(page)
    assert not any("Historical" in s for s in texts)
