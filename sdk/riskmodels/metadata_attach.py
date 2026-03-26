"""Attach RiskLineage + legend + semantic cheatsheet to pandas / xarray objects."""

from __future__ import annotations

import json
from typing import Any

from .legends import SHORT_ERM3_LEGEND
from .lineage import RiskLineage
from .mapping import BATCH_RETURNS_LONG_RENAME, COLUMN_AGENT_HINTS, METRICS_V3_TO_SEMANTIC


def _wire_semantic_reference_json() -> str:
    return json.dumps(
        {
            "metrics_v3_to_semantic": dict(METRICS_V3_TO_SEMANTIC),
            "batch_returns_long_table": dict(BATCH_RETURNS_LONG_RENAME)
            | {
                "note": (
                    "Wire l1/l2/l3 are three L3 component HR series, not L1/L2/L3 model levels."
                ),
            },
        },
        indent=2,
    )


def build_semantic_cheatsheet_md() -> str:
    """Compact markdown for DataFrame.attrs and LLM grounding."""
    lines = [
        "### Semantic field cheatsheet (SDK output)",
        "",
        "Use these names in code and explanations (not raw V3 wire keys in API JSON).",
        "",
        _wire_semantic_reference_json(),
        "",
        "### Column hints",
    ]
    for col, hint in sorted(COLUMN_AGENT_HINTS.items()):
        lines.append(f"- **{col}**: {hint}")
    lines.extend(
        [
            "",
            "### Units",
            "- HR: dollar ETF notional per $1 stock.",
            "- ER: fraction of variance (0–1).",
        ]
    )
    return "\n".join(lines)


def attach_sdk_metadata(
    obj: Any,
    lineage: RiskLineage | None,
    *,
    kind: str,
    include_cheatsheet: bool = True,
) -> None:
    """Set attrs used by agents and `to_llm_context`."""
    if lineage is None:
        lineage = RiskLineage()
    attrs = getattr(obj, "attrs", None)
    if attrs is None:
        return
    attrs["legend"] = SHORT_ERM3_LEGEND
    attrs["riskmodels_kind"] = kind
    attrs["riskmodels_lineage"] = lineage.to_json()
    if include_cheatsheet:
        attrs["riskmodels_semantic_cheatsheet"] = build_semantic_cheatsheet_md()
    for k, v in lineage.to_dict().items():
        attrs[f"riskmodels_{k}"] = "" if v is None else str(v)


def ensure_dataframe_legend(df: Any, lineage: RiskLineage | None, *, kind: str) -> Any:
    """Idempotent: attach full SDK attrs if missing legend (e.g. user-constructed frames)."""
    if not hasattr(df, "attrs"):
        return df
    if df.attrs.get("legend") != SHORT_ERM3_LEGEND:
        attach_sdk_metadata(df, lineage, kind=kind)
    return df
