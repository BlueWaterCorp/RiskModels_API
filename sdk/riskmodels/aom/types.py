"""Analysis Object Model types — aligned with repo-root ``aom/AOM_TYPES.ts``."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

Lens = Literal["return_attribution", "risk_decomposition", "exposure"]
Resolution = Literal["market_only", "market_sector", "full_stack"]
View = Literal["snapshot", "timeseries", "distribution"]
OutputMode = Literal["structured", "explanation", "visual"]
AttributionMode = Literal["incremental", "cumulative"]
IntentShorthand = Literal[
    "explain_return",
    "reduce_risk",
    "find_hidden_bets",
    "compare_peers",
    "screen_universe",
]

ATTRIBUTION_LENSES: frozenset[Lens] = frozenset({"return_attribution", "risk_decomposition"})


class StockSubject(TypedDict, total=False):
    type: Literal["stock"]
    ticker: str
    symbol: str


class PortfolioHoldings(TypedDict):
    ticker: str
    weight: float


class PortfolioSubjectInline(TypedDict):
    type: Literal["portfolio"]
    source: Literal["inline"]
    holdings: list[PortfolioHoldings]


class PortfolioSubjectId(TypedDict):
    type: Literal["portfolio"]
    source: Literal["id"]
    portfolio_id: str


PortfolioSubject = PortfolioSubjectInline | PortfolioSubjectId


class UniverseSubject(TypedDict):
    type: Literal["universe"]
    universe_id: str


class ComparisonAlignment(TypedDict, total=False):
    date_range: Literal["shared"]
    normalize: bool


class ComparisonSubject(TypedDict, total=False):
    type: Literal["comparison"]
    subjects: list[Any]
    alignment: ComparisonAlignment


Subject = StockSubject | PortfolioSubject | UniverseSubject | ComparisonSubject


class DateRangePreset(TypedDict):
    preset: str


class DateRangeExplicit(TypedDict):
    start: str
    end: str


class Scope(TypedDict, total=False):
    date_range: DateRangePreset | DateRangeExplicit
    as_of: Literal["latest"] | str
    frequency: str
    benchmark: str


class ChainStageAnalyze(TypedDict, total=False):
    kind: Literal["analyze"]
    lens: Lens
    resolution: Resolution
    view: View
    attribution_mode: AttributionMode


class ChainStageHedge(TypedDict, total=False):
    kind: Literal["hedge_action"]
    depends_on: Literal["previous"] | str


ChainStage = ChainStageAnalyze | ChainStageHedge


class AOMSingleRequest(TypedDict, total=False):
    subject: Subject
    scope: Scope
    lens: Lens
    attribution_mode: AttributionMode
    resolution: Resolution
    view: View
    output_mode: OutputMode
    intent: IntentShorthand


class AOMChainRequest(TypedDict, total=False):
    subject: Subject
    scope: Scope
    chain: list[ChainStage]
    output_mode: OutputMode
    intent: IntentShorthand


AOMRequest = AOMSingleRequest | AOMChainRequest


def is_chain_request(r: AOMRequest) -> bool:
    return "chain" in r and isinstance(r.get("chain"), list)
