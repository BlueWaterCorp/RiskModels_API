"""Shared domain value objects for visual components.

These types use canonical field names (``market``, ``sector``, ``subsector``,
``residual``) — never abbreviated wire-format keys. Builders resolve
``l3_mkt_er`` → ``market`` via :func:`utils.l3_er_tuple_from_row`.
"""

from __future__ import annotations

import dataclasses
from typing import Any

from .._base import VisualComponentMixin


@dataclasses.dataclass
class L3LayerValues:
    """Four L3 factor values with canonical names."""

    market: float
    sector: float
    subsector: float
    residual: float

    @property
    def systematic(self) -> float:
        return self.market + self.sector + self.subsector

    @property
    def total(self) -> float:
        return self.market + self.sector + self.subsector + self.residual

    def to_dict(self) -> dict[str, float]:
        return {
            "market": self.market,
            "sector": self.sector,
            "subsector": self.subsector,
            "residual": self.residual,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> L3LayerValues:
        return cls(
            market=float(d["market"]),
            sector=float(d["sector"]),
            subsector=float(d["subsector"]),
            residual=float(d["residual"]),
        )


@dataclasses.dataclass
class WaterfallLayer:
    """One segment of a variance waterfall chart."""

    label: str
    value: float
    color: str

    def to_dict(self) -> dict[str, Any]:
        return {"label": self.label, "value": self.value, "color": self.color}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> WaterfallLayer:
        return cls(label=d["label"], value=float(d["value"]), color=d["color"])


@dataclasses.dataclass
class CascadePosition:
    """One position in a risk cascade chart."""

    ticker: str
    weight: float
    l3: L3LayerValues

    def to_dict(self) -> dict[str, Any]:
        return {"ticker": self.ticker, "weight": self.weight, "l3": self.l3.to_dict()}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CascadePosition:
        return cls(
            ticker=d["ticker"],
            weight=float(d["weight"]),
            l3=L3LayerValues.from_dict(d["l3"]),
        )


@dataclasses.dataclass
class AttributionPosition:
    """One position in an attribution cascade chart."""

    ticker: str
    weight: float
    realized_return: float
    l3: L3LayerValues

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "weight": self.weight,
            "realized_return": self.realized_return,
            "l3": self.l3.to_dict(),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> AttributionPosition:
        return cls(
            ticker=d["ticker"],
            weight=float(d["weight"]),
            realized_return=float(d["realized_return"]),
            l3=L3LayerValues.from_dict(d["l3"]),
        )


@dataclasses.dataclass
class L3TickerRow:
    """One ticker in an L3 decomposition chart."""

    ticker: str
    l3: L3LayerValues
    annualized_vol: float | None
    subsector_etf: str | None = None
    sector_etf: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "l3": self.l3.to_dict(),
            "annualized_vol": self.annualized_vol,
            "subsector_etf": self.subsector_etf,
            "sector_etf": self.sector_etf,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> L3TickerRow:
        vol = d.get("annualized_vol")
        return cls(
            ticker=d["ticker"],
            l3=L3LayerValues.from_dict(d["l3"]),
            annualized_vol=float(vol) if vol is not None else None,
            subsector_etf=d.get("subsector_etf"),
            sector_etf=d.get("sector_etf"),
        )
