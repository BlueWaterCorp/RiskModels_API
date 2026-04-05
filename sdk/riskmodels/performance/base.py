"""Unified result container for tabular outputs + plot/PDF dispatch."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, cast

import pandas as pd

from ..lineage import RiskLineage
from ..llm import to_llm_context
from ..portfolio_math import PortfolioAnalysis


OutputFmt = Literal["figure", "png", "svg"]


@dataclass
class PerformanceResult:
    """Holds portfolio or stock metrics with lineage for plotting and LLM context."""

    lineage: RiskLineage
    kind: Literal["stock", "portfolio", "pri"]
    portfolio_analysis: PortfolioAnalysis | None = None
    stock_metrics: pd.DataFrame | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dataframe(self) -> pd.DataFrame:
        if self.portfolio_analysis is not None:
            return self.portfolio_analysis.per_ticker.copy()
        if self.stock_metrics is not None:
            return self.stock_metrics.copy()
        raise ValueError("PerformanceResult has no tabular payload")

    def to_xarray(self) -> Any:
        if self.portfolio_analysis is None:
            raise ValueError("No portfolio analysis; call analyze_portfolio(..., include_returns_panel=True)")
        return self.portfolio_analysis.to_xarray()

    def to_llm_context(self, *, include_lineage: bool = True) -> str:
        if self.portfolio_analysis is not None:
            return self.portfolio_analysis.to_llm_context(include_lineage=include_lineage)
        df = self.stock_metrics
        if df is None:
            return ""
        return to_llm_context(df, include_lineage=include_lineage)

    def plot(
        self,
        style: str = "auto",
        *,
        output: OutputFmt = "figure",
        **kwargs: Any,
    ) -> Any:
        """Dispatch to ``riskmodels.visuals`` based on ``kind`` and ``style``."""
        from ..visuals import cascade
        from ..visuals.l3_decomposition import plot_l3_horizontal

        if self.kind == "stock" and self.stock_metrics is not None:
            rows = self.stock_metrics.to_dict("records")
            fig = plot_l3_horizontal(
                rows,
                sigma_scaled=kwargs.get("sigma_scaled", True),
                lineage=self.lineage,
                metadata=kwargs.get("metadata"),
            )
            return _maybe_export(fig, output, kwargs)

        if self.kind == "portfolio" and self.portfolio_analysis is not None:
            pa = self.portfolio_analysis
            w = pa.weights
            style_l = "risk_cascade" if style == "auto" else style.lower()
            if style_l in ("risk_cascade", "cascade", "risk"):
                fig = cascade.plot_risk_cascade(
                    pa.per_ticker,
                    w,
                    sort_by=kwargs.get("sort_by", "weight"),
                    include_systematic_labels=kwargs.get("include_systematic_labels", True),
                    benchmark=kwargs.get("benchmark"),
                    lineage=self.lineage,
                )
                return _maybe_export(fig, output, kwargs)
            if style_l in ("attribution_cascade", "attribution"):
                rl = pa.returns_long
                if rl is None or rl.empty:
                    raise ValueError(
                        "Attribution plot needs returns panel; pass include_returns_panel=True "
                        "to analyze_portfolio"
                    )
                fig = cascade.plot_attribution_cascade(
                    rl,
                    w,
                    pa.per_ticker,
                    sort_by=kwargs.get("sort_by", "weight"),
                    lineage=self.lineage,
                )
                return _maybe_export(fig, output, kwargs)
            raise ValueError(f"Unknown portfolio plot style: {style}")

        raise ValueError("Nothing to plot for this PerformanceResult")

def _maybe_export(fig: Any, output: OutputFmt, kwargs: dict[str, Any]) -> Any:
    if output == "figure":
        return fig
    if output == "png":
        try:
            scale = float(kwargs.get("scale", 2))
            return cast(bytes, fig.to_image(format="png", scale=scale))
        except Exception as e:  # pragma: no cover
            raise ImportError("PNG export needs kaleido: pip install riskmodels-py[viz]") from e
    if output == "svg":
        return cast(bytes, fig.to_image(format="svg"))
    raise ValueError(output)
