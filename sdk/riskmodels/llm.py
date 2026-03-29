"""Markdown export for LLM prompts."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pandas as pd

from .legends import COMBINED_ERM3_MACRO_LEGEND, SHORT_ERM3_LEGEND
from .lineage import RiskLineage
from .metadata_attach import attach_sdk_metadata, build_semantic_cheatsheet_md
from .parsing import factor_correlation_body_to_row
from .portfolio_math import PortfolioAnalysis

try:
    import xarray as xr
except ImportError:
    xr = None  # type: ignore[assignment]


def _df_to_markdown(df: pd.DataFrame) -> str:
    try:
        return df.to_markdown(index=True)
    except Exception:
        return "```\n" + df.to_string() + "\n```"


def _lineage_block(lineage: RiskLineage | None) -> str:
    if not lineage or not lineage.to_dict():
        return ""
    lines = [f"- **{k}**: {v}" for k, v in lineage.to_dict().items()]
    return "> **Lineage**\n> " + "\n> ".join(lines) + "\n\n"


def _legend_from_attrs(obj: Any) -> str:
    attrs = getattr(obj, "attrs", None)
    if attrs and attrs.get("legend"):
        return str(attrs["legend"])
    return SHORT_ERM3_LEGEND


def _cheatsheet_from_attrs(obj: Any) -> str | None:
    attrs = getattr(obj, "attrs", None)
    if not attrs:
        return None
    cs = attrs.get("riskmodels_semantic_cheatsheet")
    return str(cs) if cs else None


def _cheatsheet_block(text: str | None) -> str:
    if not text:
        return ""
    return "\n### Semantic field cheatsheet\n\n" + text + "\n"


def _rankings_attrs_preamble(attrs: Mapping[str, Any]) -> str:
    """Surface rank_percentile headline + cohort warnings before the table (LLM / notebooks)."""
    lines: list[str] = []
    hl = attrs.get("riskmodels_rankings_headline")
    if hl:
        lines.append(f"> **Rankings**: {hl}")
    ph = attrs.get("riskmodels_parent_headline")
    if ph:
        lines.append(f"> **Leaderboard**: {ph}")
    fn = attrs.get("riskmodels_filter_note")
    if fn:
        lines.append(f"> **Filter**: {fn}")
    w = attrs.get("riskmodels_warnings")
    if w:
        if isinstance(w, list):
            lines.append("> **Warnings**")
            lines.extend(f"> - {x}" for x in w)
        else:
            lines.append(f"> **Warnings**: {w}")
    if not lines:
        return ""
    return "\n".join(lines) + "\n\n"


def to_llm_context(obj: Any, *, include_lineage: bool = True) -> str:
    """
    Convert SDK outputs to GitHub-flavored Markdown (table + legend).
    Uses `obj.attrs['legend']` and `riskmodels_semantic_cheatsheet` when present.
    """
    parts: list[str] = []

    if isinstance(obj, pd.DataFrame):
        lineage = None
        if include_lineage and hasattr(obj, "attrs"):
            raw = obj.attrs.get("riskmodels_lineage")
            if raw:
                try:
                    import json

                    lineage = RiskLineage(**json.loads(raw))
                except Exception:
                    lineage = None
        if include_lineage and lineage:
            parts.append(_lineage_block(lineage))
        attrs_df = getattr(obj, "attrs", None) or {}
        pre = _rankings_attrs_preamble(attrs_df) if isinstance(attrs_df, Mapping) else ""
        if pre:
            parts.append(pre)
        parts.append(_df_to_markdown(obj))
        cs = _cheatsheet_from_attrs(obj)
        if cs:
            parts.append(_cheatsheet_block(cs))
        parts.append("\n### ERM3 legend\n\n" + _legend_from_attrs(obj))
        return "\n".join(parts)

    if xr is not None and isinstance(obj, xr.Dataset):
        if include_lineage:
            attrs = getattr(obj, "attrs", {})
            raw = attrs.get("riskmodels_lineage")
            if raw:
                try:
                    import json

                    lineage = RiskLineage(**json.loads(raw))
                    parts.append(_lineage_block(lineage))
                except Exception:
                    pass
        summary_lines = [
            f"- **{k}**: {getattr(obj, k).dims} {getattr(obj, k).shape}" for k in obj.data_vars
        ]
        parts.append("### xarray.Dataset summary\n" + "\n".join(summary_lines))
        cs = _cheatsheet_from_attrs(obj)
        if cs:
            parts.append(_cheatsheet_block(cs))
        parts.append("\n### ERM3 legend\n\n" + _legend_from_attrs(obj))
        return "\n".join(parts)

    if isinstance(obj, PortfolioAnalysis):
        pa = obj
        if include_lineage:
            parts.append(_lineage_block(pa.lineage))
        blocks = []
        if pa.per_ticker is not None and not pa.per_ticker.empty:
            blocks.append("### Per-ticker\n\n" + _df_to_markdown(pa.per_ticker))
        phr = pd.DataFrame([pa.portfolio_hedge_ratios])
        attach_sdk_metadata(phr, pa.lineage, kind="portfolio_hedge_ratios_summary")
        blocks.append("### Portfolio hedge ratios (weighted)\n\n" + _df_to_markdown(phr))
        if pa.errors:
            err_df = pd.DataFrame([pa.errors]).T.rename(columns={0: "error"})
            attach_sdk_metadata(err_df, pa.lineage, kind="portfolio_errors")
            blocks.append("### Errors\n\n" + _df_to_markdown(err_df))
        parts.append("\n\n".join(blocks))
        cs = None
        for frame in (pa.per_ticker, pa.returns_long, phr):
            if frame is not None and hasattr(frame, "attrs"):
                cs = _cheatsheet_from_attrs(frame)
                if cs:
                    break
        if cs:
            parts.append(_cheatsheet_block(cs))
        else:
            parts.append(_cheatsheet_block(build_semantic_cheatsheet_md()))
        parts.append("\n### ERM3 legend\n\n" + pa.legend)
        return "\n".join(parts)

    if isinstance(obj, dict):
        if "correlations" in obj and isinstance(obj.get("correlations"), dict):
            row = factor_correlation_body_to_row(obj)
            meta = obj.get("_metadata") if isinstance(obj, dict) else None
            lineage = RiskLineage.merge(RiskLineage(), RiskLineage.from_metadata(meta) or RiskLineage())
            df = pd.DataFrame([row])
            attach_sdk_metadata(
                df,
                lineage,
                kind="macro_correlation",
                legend=COMBINED_ERM3_MACRO_LEGEND,
            )
            return to_llm_context(df, include_lineage=include_lineage)
        df = pd.DataFrame([obj])
        attach_sdk_metadata(df, None, kind="metrics_dict_row")
        return to_llm_context(df, include_lineage=include_lineage)

    return str(obj)
