"""Lightweight helpers for LLM / chat context around SDK outputs."""

from __future__ import annotations

from typing import Any


class ChatInsights:
    def __init__(self, client: Any) -> None:
        self._client = client

    def describe_plotly_figure(self, fig: Any) -> str:
        """Return a short, model-friendly blurb for a Plotly ``Figure``."""
        try:
            title = fig.layout.title.text if getattr(fig.layout, "title", None) else "Plotly figure"
        except Exception:
            title = "Plotly figure"
        return (
            f"{title}\n"
            "Interactive chart: use .show() in Jupyter; export with .write_html() or .to_image() "
            "(requires kaleido for static images; pip install riskmodels-py[viz])."
        )
