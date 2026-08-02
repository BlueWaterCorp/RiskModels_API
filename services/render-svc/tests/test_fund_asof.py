"""G.44 — historical as_of pass-through for fund subjects.

`_load_subject_data`'s fund branch used to 501 on any as_of that didn't
match the loader's latest teo. With `get_data_for_f1(as_of=...)` serving
"latest stored period <= as_of" (reality mode, report_date basis — ADR
2026-08-01), the loader forwards the date and resolves to the SERVED
period's teo, so the artifact GCS path and X-Artifact-Resolved-As-Of
carry the date the numbers are actually from. A date predating history
maps the SDK's FundAsOfUnavailableError to an as_of-specific 404.

`_compute_canonical_f1` (POST /render f1 live path) threads as_of into
the loader — previously the parameter appeared only in the error string,
so a historical date silently rendered latest data.

Kept separate from test_artifacts.py to avoid merge friction with the
G.42/G.43 work landing there in parallel.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

import riskmodels.snapshots as rms
from riskmodels.snapshots import FundAsOfUnavailableError, FundData

from render_svc.artifacts import _load_subject_data
from render_svc.render import CanonicalNotFound, _compute_canonical_f1


def _fd(teo: str, historical: bool = False) -> FundData:
    kw = {}
    if historical:
        kw = {
            "as_of_requested": "2024-06-30",
            "as_of_basis": "report_date",
            "historical_degradations": ["fund_fit_section_omitted"],
        }
    return FundData(
        bw_fund_id="BW-FUND-S000000008",
        ticker_primary="XT",
        fund_name="As-Of Test Fund",
        teo=teo,
        equity_style_9box=None,
        aum_usd=1e9,
        **kw,
    )


class TestLoadSubjectDataFundAsOf:
    def _patch_loader(self, monkeypatch, result):
        calls: list[dict] = []

        def fake(bw_fund_id, **kwargs):
            calls.append({"bw_fund_id": bw_fund_id, **kwargs})
            if isinstance(result, Exception):
                raise result
            return result

        monkeypatch.setattr(rms, "get_data_for_f1", fake)
        return calls

    def test_latest_path_unchanged(self, monkeypatch):
        calls = self._patch_loader(monkeypatch, _fd("2026-06-30"))
        fd, resolved = _load_subject_data("BW-FUND-S000000008", "fund", "latest")
        assert resolved == "2026-06-30"
        # Latest requests must not send an as_of into the SDK.
        assert calls == [{"bw_fund_id": "BW-FUND-S000000008"}]

    def test_historical_as_of_passes_through_and_resolves_served_teo(
        self, monkeypatch
    ):
        calls = self._patch_loader(
            monkeypatch, _fd("2024-06-28", historical=True)
        )
        fd, resolved = _load_subject_data(
            "BW-FUND-S000000008", "fund", "2024-06-30"
        )
        # Resolved is the SERVED period (<= requested), not the request date.
        assert resolved == "2024-06-28"
        assert fd.as_of_basis == "report_date"
        assert calls == [
            {"bw_fund_id": "BW-FUND-S000000008", "as_of": "2024-06-30"}
        ]

    def test_pre_history_as_of_maps_to_404(self, monkeypatch):
        self._patch_loader(
            monkeypatch,
            FundAsOfUnavailableError("BW-FUND-S000000008", "1990-01-01"),
        )
        with pytest.raises(HTTPException) as exc:
            _load_subject_data("BW-FUND-S000000008", "fund", "1990-01-01")
        assert exc.value.status_code == 404
        assert "1990-01-01" in str(exc.value.detail)

    def test_loader_failure_still_maps_to_502(self, monkeypatch):
        self._patch_loader(monkeypatch, RuntimeError("gcs exploded"))
        with pytest.raises(HTTPException) as exc:
            _load_subject_data("BW-FUND-S000000008", "fund", "latest")
        assert exc.value.status_code == 502

    def test_resolved_after_as_of_violates_pit_invariant(self, monkeypatch):
        # A loader that ever resolves past the requested date must be
        # refused, not persisted under a wrong historical key.
        self._patch_loader(monkeypatch, _fd("2024-07-15"))
        with pytest.raises(HTTPException) as exc:
            _load_subject_data("BW-FUND-S000000008", "fund", "2024-06-30")
        assert exc.value.status_code == 502
        assert "PIT invariant" in str(exc.value.detail)


class TestRenderArtifactHistoricalFund:
    """The old 501 mismatched-pin gate is gone (G.44): a historical as_of
    renders through, keyed under the SERVED period's teo."""

    def test_historical_as_of_renders_and_keys_on_served_teo(
        self, monkeypatch, store
    ):
        from tests.test_artifacts import (
            PREFIX,
            _install_fake_bwmacro_artifact,
            _req,
        )
        from render_svc.artifacts import render_artifact

        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="top_holdings_erm_stacked",
            version="v1",
            applicable=("fund",),
            render_data_result={"slug": "top_holdings_erm_stacked", "rows": []},
        )
        served = _fd("2024-06-28", historical=True)
        monkeypatch.setattr(
            rms, "get_data_for_f1", lambda bw_fund_id, **kw: served
        )

        data, mime, gcs_path, resolved_as_of, cache_control, receipt_id = (
            render_artifact(
                _req(subject_id="BW-FUND-S000000008", as_of="2024-06-30"),
                store=store,
                prefix=PREFIX,
            )
        )
        # Keyed and echoed under the SERVED date, not the requested one.
        assert resolved_as_of == "2024-06-28"
        assert "/BW-FUND-S000000008/2024-06-28.json" in gcs_path
        # Explicit as_of stays immutable-cacheable.
        assert "immutable" in cache_control


class TestComputeCanonicalF1AsOf:
    def test_as_of_threads_into_loader(self, monkeypatch):
        calls: list[dict] = []

        def fake(bw_fund_id, **kwargs):
            calls.append({"bw_fund_id": bw_fund_id, **kwargs})
            return _fd("2024-06-28", historical=True)

        monkeypatch.setattr(rms, "get_data_for_f1", fake)
        snap = _compute_canonical_f1(
            bw_fund_id="BW-FUND-S000000008",
            as_of="2024-06-30",
            generated_utc="2026-08-01T00:00:00+00:00",
        )
        assert calls == [
            {"bw_fund_id": "BW-FUND-S000000008", "as_of": "2024-06-30"}
        ]
        # Canonical carries the SERVED period and the historical frame.
        assert snap.identity.as_of == "2024-06-28"
        assert snap.temporal.observation_mode == "reality"
        assert snap.temporal.as_of_basis == "report_date"
        assert snap.temporal.degraded_sections == ["fund_fit_section_omitted"]

    def test_pre_history_maps_to_canonical_not_found(self, monkeypatch):
        def fake(bw_fund_id, **kwargs):
            raise FundAsOfUnavailableError(bw_fund_id, kwargs.get("as_of", "?"))

        monkeypatch.setattr(rms, "get_data_for_f1", fake)
        with pytest.raises(CanonicalNotFound) as exc:
            _compute_canonical_f1(
                bw_fund_id="BW-FUND-S000000008",
                as_of="1990-01-01",
                generated_utc=None,
            )
        assert "1990-01-01" in str(exc.value)
