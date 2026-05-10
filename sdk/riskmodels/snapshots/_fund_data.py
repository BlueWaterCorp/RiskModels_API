"""Public fund snapshot data stub — consumed by :func:`canonical_fund.from_fund_components`.

Replaced when the per-fund zarr reader lands; until then this shape is enough
for synthetic fixtures and contract gates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class FundData:
    """Component bundle for F1 canonical assembly (synthetic / cache JSON).

    Mirrors :class:`P1Data` discipline: static dataclass, ``to_json`` / ``from_json``
    via the shared snapshot JSON envelope. No network calls.
    """

    symbol_id: str
    name: str
    teo: str
    filing_date: str | None = None
    aum_usd: float | None = None
    fund_family: str | None = None
    share_class_count: int | None = None
    expense_ratio: float | None = None
    inception_date: str | None = None

    holdings: list[dict[str, Any]] = field(default_factory=list)
    total_holdings_count: int = 0
    coverage_pct: float | None = None
    portfolio_metrics: dict[str, Any] = field(default_factory=dict)

    cum_fund: list[tuple[str, float]] = field(default_factory=list)
    cum_spy: list[tuple[str, float]] = field(default_factory=list)
    cum_sector: list[tuple[str, float]] = field(default_factory=list)
    cum_subsector: list[tuple[str, float]] = field(default_factory=list)
    tr_fund: dict[str, float | None] = field(default_factory=dict)
    tr_spy: dict[str, float | None] = field(default_factory=dict)
    tr_sector: dict[str, float | None] = field(default_factory=dict)
    tr_subsector: dict[str, float | None] = field(default_factory=dict)
    dd_fund: list[tuple[str, float]] = field(default_factory=list)
    dd_spy: list[tuple[str, float]] = field(default_factory=list)
    sharpe_1y: float | None = None
    max_drawdown: float | None = None
    vol_23d: float | None = None
    macro_correlations: dict[str, float | None] = field(default_factory=dict)
    macro_window: str = "252d"
    cumulative_bench_lines_use_cfr: bool = False
    sdk_version: str = "0.3.0"

    def to_json(self, path: str | Path) -> Path:
        from ._json_io import dump_json

        return dump_json(self, path)

    @classmethod
    def from_json(cls, path: str | Path) -> FundData:
        from ._json_io import load_json

        raw = load_json(path)
        d = raw["data"]

        def _load_series(lst: list | None) -> list[tuple[str, float]]:
            if not lst:
                return []
            return [(str(r[0]), float(r[1])) for r in lst if r[1] is not None]

        return cls(
            symbol_id=d["symbol_id"],
            name=d["name"],
            teo=d["teo"],
            filing_date=d.get("filing_date"),
            aum_usd=d.get("aum_usd"),
            fund_family=d.get("fund_family"),
            share_class_count=d.get("share_class_count"),
            expense_ratio=d.get("expense_ratio"),
            inception_date=d.get("inception_date"),
            holdings=list(d.get("holdings", [])),
            total_holdings_count=int(d.get("total_holdings_count", 0)),
            coverage_pct=d.get("coverage_pct"),
            portfolio_metrics=dict(d.get("portfolio_metrics", {})),
            cum_fund=_load_series(d.get("cum_fund")),
            cum_spy=_load_series(d.get("cum_spy")),
            cum_sector=_load_series(d.get("cum_sector")),
            cum_subsector=_load_series(d.get("cum_subsector")),
            tr_fund=d.get("tr_fund", {}),
            tr_spy=d.get("tr_spy", {}),
            tr_sector=d.get("tr_sector", {}),
            tr_subsector=d.get("tr_subsector", {}),
            dd_fund=_load_series(d.get("dd_fund")),
            dd_spy=_load_series(d.get("dd_spy")),
            sharpe_1y=d.get("sharpe_1y"),
            max_drawdown=d.get("max_drawdown"),
            vol_23d=d.get("vol_23d"),
            macro_correlations=d.get("macro_correlations", {}),
            macro_window=d.get("macro_window", "252d"),
            cumulative_bench_lines_use_cfr=bool(d.get("cumulative_bench_lines_use_cfr", False)),
            sdk_version=d.get("sdk_version", "0.3.0"),
        )
