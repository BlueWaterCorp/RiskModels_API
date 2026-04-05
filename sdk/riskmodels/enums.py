"""Orthogonal dimensions for the RiskModels SDK: time, output, and data kind."""

from __future__ import annotations

from enum import Enum
from typing import Literal

__all__ = [
    "TimeAxis",
    "OutputKind",
    "DataKind",
    "TimeLiteral",
    "OutputLiteral",
    "DataKindLiteral",
]


class TimeAxis(str, Enum):
    """Observation horizon for a request."""

    current = "current"
    historical = "historical"


class OutputKind(str, Enum):
    """Primary artifact type returned to the caller."""

    data = "data"
    pdf = "pdf"
    plot = "plot"
    chat = "chat"


class DataKind(str, Enum):
    """Economic meaning of the payload (ERM3)."""

    stock_performance = "stock-performance"
    portfolio_performance = "portfolio-performance"
    pri_benchmark_relative = "pri-benchmark-relative"
    stock_risk = "stock-risk"


TimeLiteral = Literal["current", "historical"]
OutputLiteral = Literal["data", "pdf", "plot", "chat"]
DataKindLiteral = Literal[
    "stock-performance",
    "portfolio-performance",
    "pri-benchmark-relative",
    "stock-risk",
]
