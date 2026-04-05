"""Insights and chat-oriented helpers."""

from __future__ import annotations

from typing import Any

from .chat import ChatInsights

__all__ = ["ChatInsights", "InsightsNamespace"]


class InsightsNamespace:
    def __init__(self, client: Any) -> None:
        self.chat = ChatInsights(client)
