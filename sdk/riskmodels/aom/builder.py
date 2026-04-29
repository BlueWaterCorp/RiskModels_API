"""Fluent builder → ``AOMSingleRequest`` / ``AOMChainRequest`` (v1)."""

from __future__ import annotations

from typing import Any

from .types import (
    AOMChainRequest,
    AOMSingleRequest,
    AttributionMode,
    ChainStage,
    ComparisonAlignment,
    IntentShorthand,
    Lens,
    OutputMode,
    PortfolioHoldings,
    Resolution,
    Scope,
    Subject,
    View,
)


def rm() -> RM:
    """Entry point for the minimal fluent API."""

    return RM()


class RM:
    """``.subject(...) → .scope(...) → lens(...) → .structured()`` chain."""

    def subject(self, subj: Subject) -> _SubjectBuilder:
        return _SubjectBuilder(subj)


class _SubjectBuilder:
    def __init__(self, subject: Subject) -> None:
        self._subject = subject

    def scope(
        self,
        *,
        date_range_preset: str | None = None,
        date_range: tuple[str, str] | dict[str, str] | None = None,
        as_of: str | None = None,
        frequency: str | None = None,
        benchmark: str | None = None,
    ) -> _ScopedBuilder:
        scope: Scope = {}
        if date_range_preset is not None:
            scope["date_range"] = {"preset": date_range_preset}
        elif date_range is not None:
            if isinstance(date_range, tuple):
                scope["date_range"] = {"start": date_range[0], "end": date_range[1]}
            else:
                scope["date_range"] = {"start": date_range["start"], "end": date_range["end"]}
        if as_of is not None:
            scope["as_of"] = as_of  # type: ignore[assignment]
        if frequency is not None:
            scope["frequency"] = frequency
        if benchmark is not None:
            scope["benchmark"] = benchmark
        return _ScopedBuilder(self._subject, scope)


class _ScopedBuilder:
    def __init__(self, subject: Subject, scope: Scope) -> None:
        self._subject = subject
        self._scope = scope

    def chain(self, *stages: ChainStage) -> _ChainBuilder:
        return _ChainBuilder(self._subject, dict(self._scope), list(stages))

    def return_attribution(
        self,
        *,
        attribution_mode: AttributionMode = "incremental",
        resolution: Resolution,
        view: View,
    ) -> _OutputTerminal:
        body = _single_body(self._subject, self._scope, "return_attribution", attribution_mode, resolution, view)
        return _OutputTerminal(body)

    def risk_decomposition(
        self,
        *,
        attribution_mode: AttributionMode = "incremental",
        resolution: Resolution,
        view: View,
    ) -> _OutputTerminal:
        body = _single_body(self._subject, self._scope, "risk_decomposition", attribution_mode, resolution, view)
        return _OutputTerminal(body)

    def exposure(self, *, resolution: Resolution, view: View) -> _OutputTerminal:
        body = _single_body(self._subject, self._scope, "exposure", None, resolution, view)
        return _OutputTerminal(body)


def _single_body(
    subject: Subject,
    scope: Scope,
    lens: Lens,
    attribution_mode: AttributionMode | None,
    resolution: Resolution,
    view: View,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "subject": subject,
        "scope": dict(scope),
        "lens": lens,
        "resolution": resolution,
        "view": view,
    }
    if attribution_mode is not None:
        out["attribution_mode"] = attribution_mode
    return out


class _OutputTerminal:
    def __init__(self, body: dict[str, Any]) -> None:
        self._body = body

    def structured(self) -> AOMSingleRequest:
        return self._finalize("structured")

    def explain(self) -> AOMSingleRequest:
        return self._finalize("explanation")

    def visual(self) -> AOMSingleRequest:
        return self._finalize("visual")

    def intent(self, value: IntentShorthand) -> _OutputTerminal:
        self._body["intent"] = value
        return self

    def _finalize(self, mode: OutputMode) -> AOMSingleRequest:
        self._body["output_mode"] = mode
        return self._body  # type: ignore[return-value]


class _ChainBuilder:
    def __init__(self, subject: Subject, scope: Scope, stages: list[ChainStage]) -> None:
        self._subject = subject
        self._scope = scope
        self._stages = stages
        self._intent_val: IntentShorthand | None = None

    def structured(self) -> AOMChainRequest:
        return self._finalize("structured")

    def explain(self) -> AOMChainRequest:
        return self._finalize("explanation")

    def visual(self) -> AOMChainRequest:
        return self._finalize("visual")

    def intent(self, value: IntentShorthand) -> _ChainBuilder:
        self._intent_val = value
        return self

    def _finalize(self, mode: OutputMode) -> AOMChainRequest:
        req: AOMChainRequest = {
            "subject": self._subject,
            "scope": dict(self._scope),
            "chain": list(self._stages),
            "output_mode": mode,
        }
        if self._intent_val is not None:
            req["intent"] = self._intent_val
        return req


# --- subject factories ---


def stock(ticker: str, *, symbol: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"type": "stock", "ticker": ticker}
    if symbol:
        out["symbol"] = symbol
    return out


def portfolio_inline(holdings: list[dict[str, Any] | PortfolioHoldings]) -> dict[str, Any]:
    return {"type": "portfolio", "source": "inline", "holdings": list(holdings)}


def portfolio_id(portfolio_id: str) -> dict[str, Any]:
    return {"type": "portfolio", "source": "id", "portfolio_id": portfolio_id}


def universe(universe_id: str) -> dict[str, Any]:
    return {"type": "universe", "universe_id": universe_id}


def comparison(subjects: list[Subject], *, alignment: ComparisonAlignment | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"type": "comparison", "subjects": list(subjects)}
    if alignment is not None:
        out["alignment"] = alignment
    return out


# --- chain stage factories ---


def analyze(
    *,
    lens: Lens,
    resolution: Resolution | None = None,
    view: View | None = None,
    attribution_mode: AttributionMode | None = None,
) -> ChainStage:
    st: dict[str, Any] = {"kind": "analyze", "lens": lens}
    if resolution is not None:
        st["resolution"] = resolution
    if view is not None:
        st["view"] = view
    if attribution_mode is not None:
        st["attribution_mode"] = attribution_mode
    return st  # type: ignore[return-value]


def hedge_action(*, depends_on: str | None = "previous") -> ChainStage:
    out: dict[str, Any] = {"kind": "hedge_action"}
    if depends_on is not None:
        out["depends_on"] = depends_on  # type: ignore[assignment]
    return out  # type: ignore[return-value]
