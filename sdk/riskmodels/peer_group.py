"""Peer-Group Portfolio Proxy — synthetic benchmark for selection skill isolation.

Given a target stock, constructs a cap-weighted (or equal-weighted) portfolio of
sector/subsector peers. Used by S3 (Concentration Mekko) and S4 (Style Drift)
snapshots to separate allocation from selection in attribution analysis.

Construction is query-time, not persisted. The same PeerGroupProxy definition is
shared across all snapshot quadrants that need portfolio-level context.

Architecture
------------
This module follows the SDK's fetch/render separation:

    get_data  → PeerGroupProxy object (pure data, no rendering)
    render_*  → snapshot scripts consume the proxy (visuals/ layer)

When the Supabase schema evolves, only this module changes — chart layouts untouched.

Examples
--------
>>> from riskmodels import RiskModelsClient
>>> from riskmodels.peer_group import PeerGroupProxy
>>> client = RiskModelsClient()
>>> pg = PeerGroupProxy.from_ticker(client, "NVDA")
>>> pg.target_ticker
'NVDA'
>>> pg.sector_etf          # subsector_etf is the default grouping
'SMH'
>>> pg.group_by
'subsector_etf'
>>> pg.peer_tickers[:3]
['AMD', 'INTC', 'AVGO']
>>> pg.weights["AMD"]
0.0823
>>> comparison = pg.compare(client)
>>> comparison.target_l3_residual_er
0.42
>>> comparison.peer_avg_l3_residual_er
0.31
>>> comparison.selection_spread
0.11
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import pandas as pd

from .lineage import RiskLineage
from .metadata_attach import attach_sdk_metadata
from .portfolio_math import (
    PORTFOLIO_HR_KEYS,
    PORTFOLIO_L3_ER_KEYS,
    PortfolioAnalysis,
    analyze_batch_to_portfolio,
    normalize_positions,
)


# ---------------------------------------------------------------------------
# Core data objects
# ---------------------------------------------------------------------------

@dataclass
class PeerComparison:
    """Result of comparing a target stock against its peer group.

    All ER/HR fields use semantic names (l3_market_er, l3_sector_hr, etc.)
    consistent with ``normalize_metrics_v3()`` output.
    """

    target_ticker: str
    peer_group_label: str  # e.g. "XLK Sector Peers (cap-weighted, N=23)"

    # Target stock metrics (from GET /metrics)
    target_metrics: dict[str, Any]

    # Peer portfolio aggregation (reuses PortfolioAnalysis)
    peer_portfolio: PortfolioAnalysis

    # Pre-computed spreads for quick access
    target_l3_residual_er: float | None = None
    peer_avg_l3_residual_er: float | None = None
    selection_spread: float | None = None  # target - peer avg

    target_vol: float | None = None
    peer_avg_vol: float | None = None

    # Per-ticker detail for tables
    peer_detail: pd.DataFrame = field(default_factory=pd.DataFrame)

    def summary_row(self) -> dict[str, Any]:
        """Single-row dict for embedding in snapshot tables."""
        return {
            "ticker": self.target_ticker,
            "peer_group": self.peer_group_label,
            "target_l3_res_er": self.target_l3_residual_er,
            "peer_avg_l3_res_er": self.peer_avg_l3_residual_er,
            "selection_spread": self.selection_spread,
            "target_vol": self.target_vol,
            "peer_avg_vol": self.peer_avg_vol,
            "peer_count": len(self.peer_portfolio.weights),
        }

    def to_dataframe(self) -> pd.DataFrame:
        """Peer detail with target summary row prepended."""
        target_row = pd.DataFrame([self.summary_row()])
        if self.peer_detail.empty:
            return target_row
        return pd.concat([target_row, self.peer_detail], ignore_index=True)

    def to_csv(self, path: str | Path | None = None) -> str | None:
        """Write to CSV file or return CSV string if path is None."""
        df = self.to_dataframe()
        if path is not None:
            df.to_csv(path, index=False)
            return None
        return df.to_csv(index=False)


@dataclass
class PeerGroupProxy:
    """Synthetic portfolio of sector/subsector peers for a target stock.

    This is the intermediary object that Gemini correctly identified:
    it bridges a single stock to a portfolio, enabling relative context
    on every snapshot without requiring a user-defined portfolio.

    Parameters
    ----------
    target_ticker : str
        The stock we're analyzing (human-facing ticker, not symbol).
    target_symbol : str
        FactSet symbol for the target (internal key).
    sector_etf : str
        The ETF that defines this peer group (e.g. "XLK", "SMH").
    group_by : str
        Which column was used: "sector_etf" or "subsector_etf".
    weighting : str
        "market_cap" or "equal" — how peers are weighted.
    peer_tickers : list[str]
        Tickers of all peers (excluding target).
    weights : dict[str, float]
        Normalized weights for peers (sum to 1.0, target excluded).
    weight_source : str
        "market_cap" if live caps used, "equal" if fallback.
    """

    target_ticker: str
    target_symbol: str
    sector_etf: str
    group_by: Literal["sector_etf", "subsector_etf"]
    weighting: Literal["market_cap", "equal"]
    peer_tickers: list[str]
    weights: dict[str, float]
    weight_source: str
    peer_names: dict[str, str] = field(default_factory=dict)  # ticker → company_name
    lineage: RiskLineage = field(default_factory=RiskLineage)

    @property
    def n_peers(self) -> int:
        return len(self.peer_tickers)

    @property
    def label(self) -> str:
        w = "cap-wt" if self.weighting == "market_cap" else "eq-wt"
        group_label = "Subsector" if "subsector" in self.group_by else "Sector"
        return f"{self.sector_etf} {group_label} Peers ({w}, N={self.n_peers})"

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    @classmethod
    def from_ticker(
        cls,
        client: Any,
        ticker: str,
        *,
        group_by: Literal["sector_etf", "subsector_etf"] = "subsector_etf",
        weighting: Literal["market_cap", "equal"] = "market_cap",
        exclude_target: bool = True,
        min_peers: int = 3,
        sector_etf_override: str | None = None,
        max_peers: int = 50,
    ) -> "PeerGroupProxy":
        """Build a peer group from the Supabase ``ticker_metadata`` table.

        Default is ``subsector_etf`` (e.g. SOXX for semiconductors) because
        sector-level peers (e.g. all of XLK) are too broad to isolate
        selection skill. Use ``sector_etf`` only as an explicit fallback
        when subsector has too few peers.

        Steps:
        1. Query ticker_metadata for the target → resolve symbol + sector
        2. Query ticker_metadata for all rows matching the same sector ETF
        3. Cap-weight by market_cap (from the same table — no extra API calls)

        This replaces the old approach that used ``search_tickers()`` (which
        didn't return sector metadata) and individual ``get_metrics()`` calls
        for cap-weighting (N+1 API calls).
        """
        ticker = ticker.upper()

        # Step 1: Resolve target from ticker_metadata
        target_df = client.get_ticker_metadata(ticker=ticker)
        if target_df.empty:
            raise ValueError(
                f"Ticker '{ticker}' not found in ticker_metadata table"
            )
        target_row = target_df.iloc[0].to_dict()
        target_ticker = str(target_row.get("ticker", ticker)).upper()
        target_symbol = str(target_row.get("symbol", ticker))

        # Step 2: Determine which sector ETF to group by
        # Prefer the DB's own value (ticker_metadata is the source of truth).
        # The override is used only if the DB has no value for the requested field.
        sector_val = target_row.get(group_by) or sector_etf_override
        if not sector_val and group_by == "subsector_etf":
            sector_val = target_row.get("sector_etf")
            if sector_val:
                group_by = "sector_etf"  # type: ignore[assignment]
                warnings.warn(
                    f"{ticker} has no subsector_etf; falling back to sector_etf={sector_val}",
                    UserWarning,
                    stacklevel=2,
                )
        if not sector_val:
            raise ValueError(
                f"Cannot build peer group: {ticker} has no {group_by} in ticker_metadata. "
                f"Available fields: {sorted(target_row.keys())}"
            )
        sector_val = str(sector_val)

        # Step 3: Query all peers in the same sector/subsector
        query_kwargs = {group_by: sector_val}
        peers_df = client.get_ticker_metadata(
            columns="ticker,company_name,market_cap",
            limit=max_peers + 1,  # +1 for target
            **query_kwargs,
        )

        all_peer_tickers = [
            str(t).upper() for t in peers_df["ticker"].tolist() if t
        ]

        if exclude_target:
            all_peer_tickers = [
                t for t in all_peer_tickers if t != target_ticker
            ]

        if len(all_peer_tickers) < min_peers:
            # Try broader grouping: sector_etf
            if group_by == "subsector_etf":
                broader_val = target_row.get("sector_etf")
                if broader_val:
                    warnings.warn(
                        f"Only {len(all_peer_tickers)} peers in {sector_val}; "
                        f"broadening to sector_etf={broader_val}",
                        UserWarning,
                        stacklevel=2,
                    )
                    sector_val = str(broader_val)
                    group_by = "sector_etf"  # type: ignore[assignment]
                    peers_df = client.get_ticker_metadata(
                        sector_etf=sector_val,
                        columns="ticker,company_name,market_cap",
                        limit=max_peers + 1,
                    )
                    all_peer_tickers = [
                        str(t).upper()
                        for t in peers_df["ticker"].tolist()
                        if t and str(t).upper() != target_ticker
                    ]

        if len(all_peer_tickers) < min_peers:
            warnings.warn(
                f"Only {len(all_peer_tickers)} peers found for {ticker} in {sector_val} "
                f"(min_peers={min_peers}). Proceeding anyway.",
                UserWarning,
                stacklevel=2,
            )

        # Step 4: Cap-weight using market_cap from ticker_metadata (no extra API calls)
        if weighting == "market_cap" and "market_cap" in peers_df.columns:
            cap_rows = peers_df[
                peers_df["ticker"].str.upper().isin(all_peer_tickers)
            ].copy()
            cap_rows["market_cap"] = pd.to_numeric(cap_rows["market_cap"], errors="coerce")
            cap_rows = cap_rows.dropna(subset=["market_cap"])
            cap_rows = cap_rows[cap_rows["market_cap"] > 0]

            if len(cap_rows) >= min(3, len(all_peer_tickers)):
                total_cap = cap_rows["market_cap"].sum()
                weights = {
                    str(row["ticker"]).upper(): float(row["market_cap"]) / total_cap
                    for _, row in cap_rows.iterrows()
                }
                weight_source = "market_cap"
            else:
                n = len(all_peer_tickers)
                weights = {t: 1.0 / n for t in all_peer_tickers} if n else {}
                weight_source = "equal"
        else:
            n = len(all_peer_tickers)
            weights = {t: 1.0 / n for t in all_peer_tickers} if n else {}
            weight_source = "equal"

        # Build ticker → company_name map from the same peers_df (no extra API call)
        peer_names: dict[str, str] = {}
        if "company_name" in peers_df.columns:
            for _, row in peers_df.iterrows():
                t = str(row.get("ticker", "")).upper()
                cn = row.get("company_name")
                if t and cn and isinstance(cn, str):
                    peer_names[t] = cn

        return cls(
            target_ticker=target_ticker,
            target_symbol=target_symbol,
            sector_etf=sector_val,
            group_by=group_by,
            weighting=weighting,
            peer_tickers=sorted(weights.keys()),
            weights=weights,
            weight_source=weight_source,
            peer_names=peer_names,
        )

    # ------------------------------------------------------------------
    # Comparison (fetch + render separation point)
    # ------------------------------------------------------------------

    def compare(
        self,
        client: Any,
        *,
        include_returns: bool = False,
        years: int = 1,
    ) -> PeerComparison:
        """Fetch metrics for target + all peers and compute relative spreads.

        This is the DATA step. It returns a PeerComparison object that
        snapshot renderers consume. No chart logic here.
        """
        # Fetch target metrics
        target_snap = client.get_metrics(self.target_ticker, as_dataframe=True)
        target_row = target_snap.iloc[0].to_dict() if not target_snap.empty else {}

        # Fetch peer portfolio via existing SDK pipeline
        #   analyze_portfolio already handles batch + weighted aggregation
        peer_analysis = client.analyze_portfolio(
            self.weights,
            years=years,
            include_returns_panel=include_returns,
        )

        # Extract comparison fields
        t_res_er = _safe_float(target_row.get("l3_residual_er"))
        p_res_er = _safe_float(
            peer_analysis.portfolio_l3_er_weighted_mean.get("l3_residual_er")
        )
        spread = (t_res_er - p_res_er) if (t_res_er is not None and p_res_er is not None) else None

        t_vol = _safe_float(target_row.get("vol_23d") or target_row.get("volatility"))
        # Derive vol from stock_var if missing
        if t_vol is None:
            t_var = _safe_float(target_row.get("stock_var"))
            if t_var is not None:
                import math
                t_vol = math.sqrt(t_var * 252)

        # Peer avg vol from per_ticker (try vol_23d first, then derive from stock_var)
        p_vol = None
        if not peer_analysis.per_ticker.empty:
            pt = peer_analysis.per_ticker
            if "vol_23d" in pt.columns:
                vol_col = pt["vol_23d"]
            elif "stock_var" in pt.columns:
                import math
                vol_col = pt["stock_var"].apply(
                    lambda v: math.sqrt(float(v) * 252) if pd.notna(v) and v is not None else None
                )
            else:
                vol_col = pd.Series(dtype=float)

            valid_vols = vol_col.dropna()
            if not valid_vols.empty:
                peer_weights = pd.Series(peer_analysis.weights)
                common = valid_vols.index.intersection(peer_weights.index)
                if len(common) > 0:
                    w = peer_weights.loc[common]
                    w = w / w.sum()
                    p_vol = float((valid_vols.loc[common].astype(float) * w).sum())

        # Inject company_name into per_ticker so renderers have display names
        peer_detail = peer_analysis.per_ticker.copy()
        if self.peer_names and not peer_detail.empty:
            peer_detail["company_name"] = peer_detail.index.map(
                lambda t: self.peer_names.get(str(t).upper(), "")
            )

        return PeerComparison(
            target_ticker=self.target_ticker,
            peer_group_label=self.label,
            target_metrics=target_row,
            peer_portfolio=peer_analysis,
            target_l3_residual_er=t_res_er,
            peer_avg_l3_residual_er=p_res_er,
            selection_spread=spread,
            target_vol=t_vol,
            peer_avg_vol=p_vol,
            peer_detail=peer_detail,
        )

    def as_positions(self) -> list[dict[str, Any]]:
        """Convert to positions format for SDK portfolio methods."""
        return [{"ticker": t, "weight": w} for t, w in self.weights.items()]

    def to_dict(self) -> dict[str, Any]:
        """Serializable representation for caching or logging."""
        return {
            "target_ticker": self.target_ticker,
            "target_symbol": self.target_symbol,
            "sector_etf": self.sector_etf,
            "group_by": self.group_by,
            "weighting": self.weighting,
            "weight_source": self.weight_source,
            "n_peers": self.n_peers,
            "peer_tickers": self.peer_tickers,
            "weights": self.weights,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cap_weight_peers(
    client: Any,
    tickers: list[str],
    min_cap_coverage: int = 3,
) -> tuple[dict[str, float], str]:
    """Fetch market_cap for each peer and compute cap-weights.

    Falls back to equal-weight if fewer than ``min_cap_coverage`` tickers
    have valid market_cap (same pattern as ``_mag7.py``).
    """
    caps: list[tuple[str, float]] = []
    for t in tickers:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            try:
                snap = client.get_metrics(t, as_dataframe=True)
            except Exception:
                continue
        if snap.empty:
            continue
        row = snap.iloc[0]
        cap = row.get("market_cap")
        if cap is None or (isinstance(cap, float) and pd.isna(cap)):
            continue
        try:
            caps.append((str(t).upper(), float(cap)))
        except (TypeError, ValueError):
            continue

    if len(caps) >= min_cap_coverage:
        total = sum(c for _, c in caps)
        if total > 0:
            return {t: c / total for t, c in caps}, "market_cap"

    # Fallback: equal-weight over all requested tickers
    n = len(tickers)
    if n == 0:
        return {}, "equal"
    return {t: 1.0 / n for t in tickers}, "equal"


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return f if pd.notna(f) else None
    except (TypeError, ValueError):
        return None


__all__ = [
    "PeerComparison",
    "PeerGroupProxy",
]
