"""Portfolio performance namespace."""

from __future__ import annotations

from typing import Any

from ..portfolio_math import PositionsInput
from .base import PerformanceResult


class PortfolioCurrent:
    def __init__(self, client: Any) -> None:
        self._client = client

    def data(
        self,
        positions: PositionsInput,
        *,
        include_returns_panel: bool = False,
        **kwargs: Any,
    ) -> Any:
        return self._client.analyze_portfolio(
            positions,
            include_returns_panel=include_returns_panel,
            **kwargs,
        )

    def plot(
        self,
        positions: PositionsInput,
        *,
        style: str = "risk_cascade",
        sort_by: str = "weight",
        include_systematic_labels: bool = True,
        years: int = 1,
        benchmark: dict[str, float] | None = None,
        validate: Any = None,
        er_tolerance: float | None = None,
        metrics: list[str] | tuple[str, ...] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Any:
        st = style.lower()
        need_returns = st in ("attribution_cascade", "attribution")
        pa = self._client.analyze_portfolio(
            positions,
            include_returns_panel=need_returns,
            years=years,
            validate=validate,
            er_tolerance=er_tolerance,
            metrics=metrics,
        )
        pr = PerformanceResult(lineage=pa.lineage, kind="portfolio", portfolio_analysis=pa)
        return pr.plot(
            style=st,
            sort_by=sort_by,
            include_systematic_labels=include_systematic_labels,
            benchmark=benchmark,
            metadata=metadata,
        )

    def pdf(
        self,
        positions: PositionsInput,
        *,
        title: str | None = None,
        as_of_date: str | None = None,
    ) -> bytes:
        data, _ = self._client.post_portfolio_risk_snapshot_pdf(
            positions,
            title=title,
            as_of_date=as_of_date,
        )
        return data

    def performance_result(
        self,
        positions: PositionsInput,
        *,
        include_returns_panel: bool = False,
        **kwargs: Any,
    ) -> PerformanceResult:
        pa = self._client.analyze_portfolio(
            positions,
            include_returns_panel=include_returns_panel,
            **kwargs,
        )
        return PerformanceResult(lineage=pa.lineage, kind="portfolio", portfolio_analysis=pa)


class PortfolioHistorical:
    """Reserved for multi-period portfolio analytics."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def data(self, positions: PositionsInput, **kwargs: Any) -> Any:
        return self._client.analyze_portfolio(positions, include_returns_panel=True, **kwargs)


class PortfolioNamespace:
    def __init__(self, client: Any) -> None:
        self._client = client
        self.current = PortfolioCurrent(client)
        self.historical = PortfolioHistorical(client)
