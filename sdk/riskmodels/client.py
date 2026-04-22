"""High-level RiskModels API client."""

from __future__ import annotations

import json
import os
import warnings
from typing import Any, Literal, cast
from urllib.parse import quote

import httpx
import pandas as pd

from .auth import OAuthClientCredentialsAuth, StaticBearerAuth
from .capabilities import DISCOVER_SPEC, discover_markdown
from .legends import COMBINED_ERM3_MACRO_LEGEND, SHORT_MACRO_SERIES_LEGEND, SHORT_RANKINGS_LEGEND
from .lineage import RiskLineage
from .mapping import TICKER_RETURNS_COLUMN_RENAME
from .metadata_attach import attach_sdk_metadata
from .parsing import (
    batch_returns_long_normalize,
    build_rankings_small_cohort_warnings,
    csv_bytes_to_dataframe,
    factor_correlation_batch_item_to_row,
    factor_correlation_body_to_row,
    l3_decomposition_json_to_dataframe,
    parquet_bytes_to_dataframe,
    rankings_grid_headline,
    rankings_grid_to_dataframe,
    rankings_leaderboard_headline,
    rankings_top_to_dataframe,
    ticker_returns_json_to_dataframe,
)
from .portfolio_math import (
    PositionsInput,
    analyze_batch_to_portfolio,
    metrics_body_to_row,
    positions_to_weights,
)
from .ticker_resolve import resolve_ticker
from .transport import Transport
from .validation import ValidateMode, run_validation
from .xarray_convert import long_df_to_dataset

FormatType = Literal["json", "parquet", "csv"]
DiscoverFormat = Literal["markdown", "json"]

RankingMetric = Literal[
    "mkt_cap",
    "gross_return",
    "sector_residual",
    "subsector_residual",
    "er_l1",
    "er_l2",
    "er_l3",
]
RankingCohort = Literal["universe", "sector", "subsector"]
RankingWindow = Literal["1d", "21d", "63d", "252d"]


DEFAULT_SCOPE = (
    "ticker-returns risk-decomposition batch-analysis factor-correlation macro-factor-series rankings"
)
DEFAULT_BASE_URL = "https://riskmodels.app/api"


def _timeout_seconds_from_env(default: float = 120.0) -> float:
    """HTTP client timeout for Transport (seconds). Override with RISKMODELS_HTTP_TIMEOUT."""
    raw = os.environ.get("RISKMODELS_HTTP_TIMEOUT")
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(str(raw).strip())
    except ValueError:
        return default


class RiskModelsClient:
    """HTTP client for the RiskModels API.

    Prefer namespaces such as ``client.stock.current.plot(...)`` for charts. A future thin
    ``client.plot(...)`` convenience wrapper may be added without changing existing methods.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        api_key: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        default_scope: str = DEFAULT_SCOPE,
        timeout: float = 120.0,
        validate: ValidateMode = "warn",
        er_tolerance: float = 0.05,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._validate_default = validate
        self._er_tolerance = er_tolerance
        base_url = base_url.rstrip("/")
        self._base_url = base_url
        if api_key:
            auth: Any = StaticBearerAuth(api_key)
        elif client_id and client_secret:
            auth = OAuthClientCredentialsAuth(
                base_url,
                client_id,
                client_secret,
                default_scope,
                timeout=timeout,
            )
        else:
            raise ValueError("Provide api_key or (client_id and client_secret)")
        self._transport = Transport(base_url, auth, timeout=timeout, http_client=http_client)

    @classmethod
    def from_env(cls) -> RiskModelsClient:
        """Create a client from environment variables.

        Reads credentials from the environment (or ``.env`` / ``.env.local`` files):

        - ``RISKMODELS_API_KEY`` — static Bearer token (simplest option).
        - ``RISKMODELS_CLIENT_ID`` + ``RISKMODELS_CLIENT_SECRET`` — OAuth2 client
          credentials (~15 min JWT refresh).
        - ``RISKMODELS_BASE_URL`` — optional, defaults to ``https://riskmodels.app/api``.
        - ``RISKMODELS_OAUTH_SCOPE`` — optional OAuth scope override.

        Returns:
            Configured :class:`RiskModelsClient` instance.

        Raises:
            ValueError: If neither API key nor OAuth credentials are set.

        Example:
            >>> import os
            >>> os.environ["RISKMODELS_API_KEY"] = "rm_agent_live_..."
            >>> client = RiskModelsClient.from_env()
        """
        from .env import load_repo_dotenv

        load_repo_dotenv()
        base = os.environ.get("RISKMODELS_BASE_URL", DEFAULT_BASE_URL)
        key = os.environ.get("RISKMODELS_API_KEY")
        if key is not None:
            key = key.strip()
        cid = os.environ.get("RISKMODELS_CLIENT_ID")
        csec = os.environ.get("RISKMODELS_CLIENT_SECRET")
        if cid is not None:
            cid = cid.strip()
        if csec is not None:
            csec = csec.strip()
        scope = os.environ.get("RISKMODELS_OAUTH_SCOPE", DEFAULT_SCOPE)
        timeout = _timeout_seconds_from_env()
        if key:
            return cls(base_url=base, api_key=key, timeout=timeout)
        if cid and csec:
            return cls(
                base_url=base,
                client_id=cid,
                client_secret=csec,
                default_scope=scope,
                timeout=timeout,
            )
        raise ValueError("Set RISKMODELS_API_KEY or RISKMODELS_CLIENT_ID + RISKMODELS_CLIENT_SECRET")

    def close(self) -> None:
        """Close the underlying HTTP transport and release connections."""
        self._transport.close()

    def __enter__(self) -> RiskModelsClient:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    @property
    def stock(self) -> Any:
        """Namespace for single-stock charts and analytics (e.g., ``client.stock.current.plot(...)``)."""
        from .performance.stock import StockNamespace

        if not hasattr(self, "_stock_ns"):
            self._stock_ns = StockNamespace(self)
        return self._stock_ns

    @property
    def portfolio(self) -> Any:
        """Namespace for portfolio-level charts and risk cascades (e.g., ``client.portfolio.current.plot(...)``)."""
        from .performance.portfolio import PortfolioNamespace

        if not hasattr(self, "_portfolio_ns"):
            self._portfolio_ns = PortfolioNamespace(self)
        return self._portfolio_ns

    @property
    def pri(self) -> Any:
        """Namespace for Portfolio Risk Index analytics and time series."""
        from .performance.pri import PRINamespace

        if not hasattr(self, "_pri_ns"):
            self._pri_ns = PRINamespace(self)
        return self._pri_ns

    @property
    def insights(self) -> Any:
        """Namespace for AI-generated risk insights and commentary."""
        from .insights import InsightsNamespace

        if not hasattr(self, "_insights_ns"):
            self._insights_ns = InsightsNamespace(self)
        return self._insights_ns

    @property
    def visuals(self) -> Any:
        """PNG export helpers (:class:`riskmodels.visuals.client_bridge.ClientVisuals`)."""
        from .visuals.client_bridge import ClientVisuals

        if not hasattr(self, "_visuals_bridge"):
            self._visuals_bridge = ClientVisuals(self)
        return self._visuals_bridge

    def discover(
        self,
        *,
        format: DiscoverFormat = "markdown",
        to_stdout: bool = True,
        live: bool = False,
    ) -> str | dict[str, Any]:
        """List all available SDK methods, parameters, and capabilities.

        Outputs a structured digest of every method on the client — names,
        parameter types, defaults, enums, and return types. Designed for both
        human exploration and AI agent tool synthesis (Claude Desktop, MCP).

        Args:
            format: Output format — ``"markdown"`` (default, human-readable) or
                ``"json"`` (machine-readable, includes ``tool_definition_hints``).
            to_stdout: If True (default), print the output. If False, only return it.
            live: If True, ping the API to verify connectivity and append
                lineage from a live ``/tickers`` call.

        Returns:
            Markdown string or JSON dict describing all available methods.

        Example:
            >>> client = RiskModelsClient.from_env()
            >>> client.discover()  # prints markdown to stdout
            >>> spec = client.discover(format="json", to_stdout=False)
        """
        spec = dict(DISCOVER_SPEC)
        if live:
            try:
                _, lin, _ = self._transport.request("GET", "/tickers", params={"search": "AAPL"})
                spec["live_tickers_ping"] = {"ok": True, "lineage": lin.to_dict()}
            except Exception as e:
                spec["live_tickers_ping"] = {"ok": False, "error": str(e)}
        if format == "json":
            out: dict[str, Any] = spec
            if to_stdout:
                print(json.dumps(out, indent=2))
            return out
        text = discover_markdown(spec)
        if to_stdout:
            print(text)
        return text

    def get_metrics(
        self,
        ticker: str,
        *,
        as_dataframe: bool = False,
        validate: ValidateMode | None = None,
    ) -> dict[str, Any] | pd.DataFrame:
        """Fetch the latest risk snapshot for a single ticker.

        Returns hedge ratios (HR), explained risk (ER) fractions, volatility,
        market cap, and close price from the most recent trading day. This is
        the primary method for single-stock risk analysis.

        Args:
            ticker: Stock ticker symbol (e.g., ``"NVDA"``, ``"AAPL"``). Aliases
                like ``"GOOGL"`` are resolved automatically (→ ``"GOOG"``).
            as_dataframe: If True, return a one-row DataFrame with SDK metadata
                in ``df.attrs`` (``legend``, ``riskmodels_semantic_cheatsheet``,
                ``riskmodels_lineage``). If False (default), return a plain dict.
            validate: Override the client's default validation mode (``"warn"``,
                ``"error"``, or ``"off"``). Checks ER sum ≈ 1.0 and HR signs.

        Returns:
            Dict or one-row DataFrame with ~33 fields including:

            - **Hedge ratios**: ``l1_market_hr``, ``l3_market_hr``, ``l3_sector_hr``,
              ``l3_subsector_hr`` — dollars of ETF to trade per $1 of stock.
            - **Explained risk**: ``l3_market_er``, ``l3_sector_er``,
              ``l3_subsector_er``, ``l3_residual_er`` — variance fractions summing to ~1.0.
            - **Betas**: ``l1_mkt_beta``, ``l2_sec_beta``, ``l3_sub_beta``.
            - **Price/vol**: ``price_close``, ``market_cap``, ``vol_23d``, ``vol_252d_ann``.

        Example:
            >>> client = RiskModelsClient.from_env()
            >>> df = client.get_metrics("NVDA", as_dataframe=True)
            >>> print(f"Market hedge: {df['l3_market_hr'].iloc[0]:.2f}")
            >>> print(f"Residual risk: {df['l3_residual_er'].iloc[0]:.1%}")
        """
        t, _ = resolve_ticker(ticker, self)
        body, lineage, _r = self._transport.request("GET", path)
        meta = body.get("_metadata") if isinstance(body, dict) else None
        lineage = RiskLineage.merge(lineage, RiskLineage.from_metadata(meta))
        row = metrics_body_to_row(body)
        mode = validate if validate is not None else self._validate_default
        run_validation(row, mode=mode, er_tolerance=self._er_tolerance)
        if not as_dataframe:
            return row
        df = pd.DataFrame([row])
        attach_sdk_metadata(df, lineage, kind="metrics_snapshot")
        return df

    def decompose(
        self,
        ticker: str,
        *,
        as_dataframe: bool = False,
    ) -> dict[str, Any] | pd.DataFrame:
        """Decompose a single position into four additive ERM3 layers.

        Args:
            ticker: Stock ticker symbol (e.g., ``"NVDA"``).
            as_dataframe: If True, return a 4-row DataFrame (one per layer) with
                SDK metadata in ``df.attrs``. If False (default), return raw JSON.

        Returns:
            Dict or DataFrame with columns: ``ticker``, ``layer``, ``er``
            (explained risk fraction), ``hr`` (hedge ratio), ``hedge_etf``
            (which ETF to trade), ``data_as_of``.

            Sign convention: ``hedge[etf] == -exposure[layer].hr``. A positive
            stock ``hr`` yields a negative ETF dollar ratio (short the ETF to
            hedge a long position).

        Example:
            >>> client = RiskModelsClient.from_env()
            >>> df = client.decompose("NVDA", as_dataframe=True)
            >>> print(df[["layer", "er", "hr", "hedge_etf"]])
        """

        t, _ = resolve_ticker(ticker, self)
        body, lineage, _r = self._transport.request(
            "POST", "/decompose", json={"ticker": t}
        )
        meta = body.get("_metadata") if isinstance(body, dict) else None
        lineage = RiskLineage.merge(lineage, RiskLineage.from_metadata(meta))

        if not as_dataframe:
            return body

        exposure = body.get("exposure", {}) if isinstance(body, dict) else {}
        rows: list[dict[str, Any]] = []
        for layer_name in ("market", "sector", "subsector", "residual"):
            layer = exposure.get(layer_name, {}) or {}
            rows.append(
                {
                    "ticker": body.get("ticker"),
                    "layer": layer_name,
                    "er": layer.get("er"),
                    "hr": layer.get("hr"),
                    "hedge_etf": layer.get("hedge_etf"),
                    "data_as_of": body.get("data_as_of"),
                }
            )
        df = pd.DataFrame(rows)
        attach_sdk_metadata(df, lineage, kind="decompose_position")
        return df

    def get_metrics_with_macro_correlation(
        self,
        ticker: str,
        *,
        factors: list[str] | None = None,
        return_type: str = "l3_residual",
        window_days: int = 252,
        method: str = "pearson",
        validate: ValidateMode | None = None,
    ) -> pd.DataFrame:
        """Fetch risk metrics and macro factor correlations in one call.

        Combines :meth:`get_metrics` and :meth:`get_factor_correlation_single`
        into a single one-row DataFrame.

        Args:
            ticker: Stock ticker symbol (e.g., ``"NVDA"``).
            factors: List of macro factor keys (e.g., ``["vix", "bitcoin"]``).
                Defaults to all factors if not specified.
            return_type: Which return series to correlate — ``"gross"`` or
                ``"l3_residual"`` (default) for idiosyncratic vs macro.
            window_days: Trailing window in trading days (default 252).
            method: ``"pearson"`` (default) or ``"spearman"``.
            validate: Override the client's default ER/HR validation mode.

        Returns:
            One-row DataFrame with ERM3 metrics + ``macro_corr_*`` columns.

        Example:
            >>> client = RiskModelsClient.from_env()
            >>> df = client.get_metrics_with_macro_correlation("NVDA", factors=["vix", "bitcoin"])
        """
        df_m = self.get_metrics(ticker, as_dataframe=True, validate=validate)
        df_c = self.get_factor_correlation_single(
            ticker,
            factors=factors,
            return_type=return_type,
            window_days=window_days,
            method=method,
            as_dataframe=True,
        )
        macro_cols = [c for c in df_c.columns if c != "ticker"]
        out = pd.concat(
            [df_m.reset_index(drop=True), df_c[macro_cols].reset_index(drop=True)],
            axis=1,
        )

        def _lineage_from_frame(df: pd.DataFrame) -> RiskLineage:
            raw = df.attrs.get("riskmodels_lineage")
            if raw:
                try:
                    return RiskLineage(**json.loads(raw))
                except Exception:
                    pass
            return RiskLineage()

        merged = RiskLineage.merge(_lineage_from_frame(df_m), _lineage_from_frame(df_c))
        attach_sdk_metadata(
            out,
            merged,
            kind="metrics_macro_snapshot",
            legend=COMBINED_ERM3_MACRO_LEGEND,
        )
        return out

    def get_ticker_returns(
        self,
        ticker: str,
        *,
        years: int = 1,
        limit: int | None = None,
        format: FormatType = "json",
        nocache: bool | None = None,
        validate: ValidateMode | None = None,
    ) -> pd.DataFrame:
        """Daily returns time series for a stock or ETF.

        Calls ``GET /ticker-returns``. The endpoint accepts **both stocks and ETFs**:
        stocks return gross returns plus rolling hedge ratios / explained-risk
        columns; ETFs (e.g. ``SPY``, ``XLK``) return date / returns_gross /
        price_close with the L1/L2/L3 columns set to ``None`` because ETFs are
        not factor-decomposed. The response's ``asset_type`` field distinguishes
        the two.
        """
        t, _ = resolve_ticker(ticker, self)
        params: dict[str, Any] = {"ticker": t, "years": years, "format": format}
        if limit is not None:
            params["limit"] = limit
        if nocache is not None:
            params["nocache"] = nocache
        mode = validate if validate is not None else self._validate_default
        asset_type: str | None = None
        if format == "json":
            body, hdr_lineage, _r = self._transport.request("GET", "/ticker-returns", params=params)
            meta = body.get("_metadata") if isinstance(body, dict) else None
            lineage = RiskLineage.merge(hdr_lineage, RiskLineage.from_metadata(meta))
            asset_type = body.get("asset_type") if isinstance(body, dict) else None
            df = ticker_returns_json_to_dataframe(body)
        else:
            content, lineage, _r = self._transport.request(
                "GET",
                "/ticker-returns",
                params=params,
                expect_json=False,
            )
            if format == "parquet":
                df = parquet_bytes_to_dataframe(content)
            else:
                df = csv_bytes_to_dataframe(content)
        # Apply V3 short-name → semantic rename for ALL formats. Previously this
        # was only applied to CSV/parquet, which meant the JSON path (the default)
        # left columns as short names (l1_cfr, l3_cfr, ...) while downstream
        # consumers — notably build_p1_data_from_stock_context's CFR detection —
        # expected the full semantic names (l1_combined_factor_return, etc.).
        # That mismatch made the snapshot chart silently fall back to gross ETF
        # lines instead of using the CFR data. The rename must run for every
        # format for the column-name contract to hold.
        df = df.rename(columns={k: v for k, v in TICKER_RETURNS_COLUMN_RENAME.items() if k in df.columns})
        # Downcast every numeric column to float32 at the API boundary so the
        # downstream snapshot pipeline (cumulative_returns, trailing_returns,
        # P1Data construction) runs in float32 — matching what the zarr path
        # already does. JS / PostgREST serializes Postgres REAL columns at
        # float64 precision (JS has no float32 type), and json.loads parses to
        # Python float (also float64). Without this cast, identical underlying
        # data produces ~1e-6 relative drift between API-path and zarr-path
        # cumulative series after 252 multiplications. The cast is the cheapest
        # place to enforce parity.
        if not df.empty:
            import numpy as _np
            for c in df.select_dtypes(include=["float64", "float32"]).columns:
                df[c] = df[c].astype(_np.float32)
        if not df.empty and mode != "off":
            last = df.iloc[-1].to_dict()
            run_validation(last, mode=mode, er_tolerance=self._er_tolerance)
        attach_sdk_metadata(df, lineage, kind="ticker_returns")
        if asset_type is not None:
            df.attrs["asset_type"] = asset_type
        return df

    def get_returns(
        self,
        ticker: str,
        *,
        years: int = 1,
        format: FormatType = "json",
    ) -> pd.DataFrame | dict[str, Any]:
        """DEPRECATED: alias for :meth:`get_ticker_returns`.

        The underlying ``/returns`` route was removed; this wrapper now calls
        ``/ticker-returns``, which returns a superset of the old payload
        (gross returns + rolling hedge ratios) and also accepts ETFs.
        """
        warnings.warn(
            "client.get_returns() is deprecated; call client.get_ticker_returns() "
            "instead. /ticker-returns now accepts both stocks and ETFs.",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.get_ticker_returns(ticker, years=years, format=format)

    def get_etf_returns(
        self,
        symbol: str,
        *,
        years: int = 1,
        format: FormatType = "json",
    ) -> pd.DataFrame | dict[str, Any]:
        """DEPRECATED: alias for :meth:`get_ticker_returns`.

        The underlying ``/etf-returns`` route was removed. ETF returns now flow
        through ``/ticker-returns`` (served from ``ds_etf.zarr``); L1/L2/L3
        columns will be ``None`` since ETFs are not factor-decomposed.
        """
        warnings.warn(
            "client.get_etf_returns() is deprecated; call client.get_ticker_returns() "
            "instead. /ticker-returns now serves ETFs from ds_etf.zarr.",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.get_ticker_returns(symbol, years=years, format=format)

    def get_plaid_holdings(self) -> dict[str, Any]:
        """Fetch investment holdings synced via Plaid for the authenticated user.

        Returns brokerage holdings linked through the Plaid flow in the web app.

        Returns:
            Dict with keys: ``holdings``, ``accounts``, ``securities``,
            ``summary``, ``_metadata``, ``_agent``.

        Example:
            >>> data = client.get_plaid_holdings()
            >>> print(f"Holdings count: {len(data.get('holdings', []))}")
        """
        body, _lineage, _ = self._transport.request("GET", "/plaid/holdings")
        return body

    def post_portfolio_risk_index(
        self,
        positions: list[dict[str, Any]] | list[tuple[str, float]],
        *,
        time_series: bool = False,
        years: int = 1,
    ) -> dict[str, Any]:
        """Compute holdings-weighted L3 explained risk decomposition for a portfolio.

        Args:
            positions: List of dicts or tuples with ticker and weight.
            time_series: If True, include historical time series (default False).
            years: Years of history for the time series (default 1).

        Returns:
            Dict with ``portfolio_risk_index`` containing weighted ER
            decomposition.

        Example:
            >>> client = RiskModelsClient.from_env()
            >>> result = client.post_portfolio_risk_index([("NVDA", 0.5), ("AAPL", 0.5)])
        """
        rows: list[dict[str, Any]] = []
        for p in positions:
            if isinstance(p, dict):
                t = str(p.get("ticker", "")).strip()
                w = float(p["weight"])
                rows.append({"ticker": t, "weight": w})
            else:
                rows.append({"ticker": str(p[0]).strip(), "weight": float(p[1])})
        for r in rows:
            if r["ticker"]:
                canon, _ = resolve_ticker(r["ticker"], self)
                r["ticker"] = canon
        payload: dict[str, Any] = {
            "positions": rows,
            "timeSeries": time_series,
            "years": years,
        }
        body, _lineage, _ = self._transport.request("POST", "/portfolio/risk-index", json=payload)
        return body

    def get_rankings(
        self,
        ticker: str,
        *,
        metric: RankingMetric | None = None,
        cohort: RankingCohort | None = None,
        window: RankingWindow | None = None,
        as_dataframe: bool = True,
    ) -> dict[str, Any] | pd.DataFrame:
        """Retrieve cross-sectional rank grid for a single ticker.

        Shows where a stock sits relative to peers across multiple dimensions
        and time windows. Percentile 100 = best.

        Args:
            ticker: Stock ticker symbol.
            metric: Filter to a specific metric (e.g., ``"gross_return"``).
            cohort: Filter to ``"universe"``, ``"sector"``, or ``"subsector"``.
            window: Filter to ``"1d"``, ``"21d"``, ``"63d"``, or ``"252d"``.
            as_dataframe: If True (default), return DataFrame with SDK attrs.

        Returns:
            DataFrame with columns: ``metric``, ``cohort``, ``window``,
            ``rank_ordinal``, ``cohort_size``, ``rank_percentile``.

        Example:
            >>> client = RiskModelsClient.from_env()
            >>> df = client.get_rankings("NVDA")
        """
        t, _ = resolve_ticker(ticker, self)
        params: dict[str, str] = {}
        if metric is not None:
            params["metric"] = cast(str, metric)
        if cohort is not None:
            params["cohort"] = cast(str, cohort)
        if window is not None:
            params["window"] = cast(str, window)
        body, hdr_lineage, _ = self._transport.request(
            "GET",
            f"/rankings/{quote(t, safe='')}",
            params=params or None,
        )
        if not as_dataframe:
            return body
        df = rankings_grid_to_dataframe(body)
        meta = body.get("_metadata") if isinstance(body, dict) else None
        lineage = RiskLineage.merge(hdr_lineage, RiskLineage.from_metadata(meta))
        attach_sdk_metadata(
            df,
            lineage,
            kind="rankings_snapshot",
            legend=SHORT_RANKINGS_LEGEND,
            include_cheatsheet=False,
        )
        warn = build_rankings_small_cohort_warnings(df)
        if warn:
            df.attrs["riskmodels_warnings"] = warn
        hl = rankings_grid_headline(df)
        if hl:
            df.attrs["riskmodels_rankings_headline"] = hl
        return df

    def get_top_rankings(
        self,
        *,
        metric: RankingMetric,
        cohort: RankingCohort,
        window: RankingWindow,
        limit: int = 10,
        as_dataframe: bool = True,
    ) -> dict[str, Any] | pd.DataFrame:
        """Retrieve the leaderboard — top-ranked tickers for a given metric/cohort/window.

        Args:
            metric: Ranking metric (e.g., ``"sector_residual"``, ``"gross_return"``).
            cohort: Peer group (``"universe"``, ``"sector"``, ``"subsector"``).
            window: Time window (``"1d"``, ``"21d"``, ``"63d"``, ``"252d"``).
            limit: Max results (1–100, default 10).
            as_dataframe: If True (default), return DataFrame.

        Returns:
            DataFrame with ``ticker``, ``rank_ordinal``, ``rank_percentile``.

        Example:
            >>> client = RiskModelsClient.from_env()
            >>> top = client.get_top_rankings(metric="sector_residual", cohort="universe", window="252d")
        """
        cap = max(1, min(100, int(limit)))
        params = {
            "metric": metric,
            "cohort": cohort,
            "window": window,
            "limit": str(cap),
        }
        body, hdr_lineage, _ = self._transport.request("GET", "/rankings/top", params=params)
        if not as_dataframe:
            return body
        df = rankings_top_to_dataframe(body)
        if not df.empty:
            df = df.copy()
            df["metric"] = metric
            df["cohort"] = cohort
            df["window"] = window
            df["ranking_key"] = f"{window}_{cohort}_{metric}"
        meta = body.get("_metadata") if isinstance(body, dict) else None
        lineage = RiskLineage.merge(hdr_lineage, RiskLineage.from_metadata(meta))
        attach_sdk_metadata(
            df,
            lineage,
            kind="rankings_leaderboard",
            legend=SHORT_RANKINGS_LEGEND,
            include_cheatsheet=False,
        )
        df.attrs["riskmodels_rankings_query"] = json.dumps(
            {
                "teo": body.get("teo"),
                "metric": metric,
                "cohort": cohort,
                "window": window,
                "limit": cap,
            },
        )
        df.attrs["riskmodels_rankings_headline"] = rankings_leaderboard_headline(
            teo=body.get("teo"),
            metric=metric,
            cohort=cohort,
            window=window,
            limit=cap,
            row_count=len(df),
        )
        warn = build_rankings_small_cohort_warnings(df)
        if warn:
            df.attrs["riskmodels_warnings"] = warn
        return df

    def filter_universe_by_ranking(
        self,
        *,
        metric: RankingMetric,
        cohort: RankingCohort,
        window: RankingWindow,
        min_percentile: float = 90.0,
        limit: int = 500,
    ) -> pd.DataFrame:
        """Filter the leaderboard to stocks above a percentile threshold.

        Args:
            metric: Ranking metric (e.g., ``"sector_residual"``).
            cohort: Peer group (``"universe"``, ``"sector"``, ``"subsector"``).
            window: Time window (``"1d"``, ``"21d"``, ``"63d"``, ``"252d"``).
            min_percentile: Minimum percentile to include (default 90.0 = top decile).
            limit: Max names to fetch before filtering (capped to 100 by API).

        Returns:
            DataFrame of tickers meeting the percentile threshold.

        Example:
            >>> client = RiskModelsClient.from_env()
            >>> top_decile = client.filter_universe_by_ranking(
            ...     metric="gross_return", cohort="universe", window="252d"
            ... )
        """
        cap = max(1, min(100, int(limit)))
        df = self.get_top_rankings(
            metric=metric,
            cohort=cohort,
            window=window,
            limit=cap,
            as_dataframe=True,
        )
        assert isinstance(df, pd.DataFrame)
        if "rank_percentile" not in df.columns:
            return df.iloc[0:0].copy()
        sub = df.dropna(subset=["rank_percentile"])
        out = cast(
            pd.DataFrame,
            sub[sub["rank_percentile"] >= float(min_percentile)].copy(),
        )
        meta = df.attrs.get("riskmodels_lineage")
        if meta:
            out.attrs["riskmodels_lineage"] = meta
        out.attrs["legend"] = df.attrs.get("legend", SHORT_RANKINGS_LEGEND)
        out.attrs["riskmodels_kind"] = "rankings_filtered"
        note = (
            f"Filtered rank_percentile>={min_percentile} from top {cap} "
            f"({metric}/{cohort}/{window})."
        )
        out.attrs["riskmodels_filter_note"] = note
        if df.attrs.get("riskmodels_warnings"):
            out.attrs["riskmodels_warnings"] = df.attrs["riskmodels_warnings"]
        if df.attrs.get("riskmodels_rankings_headline"):
            out.attrs["riskmodels_parent_headline"] = df.attrs["riskmodels_rankings_headline"]
        return out

    def filter_universe(
        self,
        *,
        metric: RankingMetric,
        cohort: RankingCohort,
        window: RankingWindow,
        min_percentile: float = 90.0,
        limit: int = 500,
    ) -> pd.DataFrame:
        """Alias for :meth:`filter_universe_by_ranking` (same parameters)."""
        return self.filter_universe_by_ranking(
            metric=metric,
            cohort=cohort,
            window=window,
            min_percentile=min_percentile,
            limit=limit,
        )

    def get_l3_decomposition(
        self,
        ticker: str,
        *,
        market_factor_etf: str | None = None,
        years: int | None = None,
        as_of: str | None = None,
        validate: ValidateMode | None = None,
    ) -> pd.DataFrame:
        """Retrieve daily historical L3 hedge ratios and explained risk decomposition.

        Returns a time series showing how a stock's risk decomposition evolves
        over time — useful for tracking regime changes, sector rotation, or
        shifts in idiosyncratic risk.

        When ``as_of`` (YYYY-MM-DD) is set, the returned DataFrame is sliced to
        rows with date <= as_of. The request is auto-bumped to ``years=2`` if
        needed so there is enough history to slice. Validation (if enabled)
        runs against the post-slice last row so tolerance checks reflect the
        pinned as-of state.

        Args:
            ticker: Stock ticker symbol (e.g., ``"NVDA"``).
            market_factor_etf: Override the market factor ETF (default SPY).
            years: Years of history (default determined by server, typically 1).
            as_of: Optional YYYY-MM-DD date to pin the decomposition to a
                specific historical point. Slices results to date <= as_of.
            validate: Override the client's default ER/HR validation mode.

        Returns:
            DataFrame with columns: ``date``, ``l3_market_hr``, ``l3_sector_hr``,
            ``l3_subsector_hr``, ``l3_market_er``, ``l3_sector_er``,
            ``l3_subsector_er``, ``l3_residual_er``.

        Example:
            >>> client = RiskModelsClient.from_env()
            >>> df = client.get_l3_decomposition("NVDA")
            >>> print(df[["date", "l3_residual_er"]].tail())
        """
        t, _ = resolve_ticker(ticker, self)
        effective_years = years
        if as_of is not None and (effective_years is None or effective_years < 2):
            effective_years = 2
        params: dict[str, Any] = {"ticker": t}
        if market_factor_etf:
            params["market_factor_etf"] = market_factor_etf
        if effective_years is not None:
            params["years"] = effective_years
        body, lineage, _ = self._transport.request("GET", "/l3-decomposition", params=params)
        df = l3_decomposition_json_to_dataframe(body)
        if as_of is not None and not df.empty and "date" in df.columns:
            dates = df["date"].astype(str).str[:10]
            df = df[dates <= as_of].reset_index(drop=True)
        mode = validate if validate is not None else self._validate_default
        if not df.empty and mode != "off":
            last = df.iloc[-1].to_dict()
            run_validation(last, mode=mode, er_tolerance=self._er_tolerance)
        attach_sdk_metadata(df, lineage, kind="l3_decomposition")
        return df

    def get_factor_correlation(
        self,
        ticker: str | list[str],
        *,
        factors: list[str] | None = None,
        return_type: str = "l3_residual",
        window_days: int = 252,
        method: str = "pearson",
        as_dataframe: bool = False,
    ) -> dict[str, Any] | pd.DataFrame:
        """POST /correlation — stock vs macro factor correlations (batch-capable).

        Use this for batch requests (list of tickers) or when you need full
        control over the request body. For single-ticker GET requests, see
        `get_factor_correlation_single()`.

        Args:
            ticker: Single ticker or list of tickers to analyze.
            factors: Optional list of macro factor keys (e.g., ["vix", "bitcoin"]).
                     Defaults to all six factors if not specified.
            return_type: Which return series to use ("gross", "l1", "l2", "l3_residual").
            window_days: Trailing window for correlation (20-2000).
            method: "pearson" or "spearman".
            as_dataframe: If True, return a DataFrame with SDK attrs (one row per ticker;
                batch error rows use ``macro_batch_error`` / ``macro_batch_status``).

        Returns:
            Raw API dict unless ``as_dataframe=True`` (then ``pandas.DataFrame``).
        """
        payload: dict[str, Any] = {
            "return_type": return_type,
            "window_days": window_days,
            "method": method,
        }
        if isinstance(ticker, list):
            payload["ticker"] = [resolve_ticker(str(x), self)[0] for x in ticker]
        else:
            t, _ = resolve_ticker(ticker, self)
            payload["ticker"] = t
        if factors is not None:
            payload["factors"] = factors
        body, hdr_lineage, _ = self._transport.request("POST", "/correlation", json=payload)
        if not as_dataframe:
            return body
        meta = body.get("_metadata") if isinstance(body, dict) else None
        lineage = RiskLineage.merge(hdr_lineage, RiskLineage.from_metadata(meta))
        if isinstance(ticker, list):
            results = body.get("results")
            if not isinstance(results, list):
                raise ValueError("Batch correlation response missing results array")
            rows = [factor_correlation_batch_item_to_row(x) for x in results]
            df = pd.DataFrame(rows)
            attach_sdk_metadata(
                df,
                lineage,
                kind="macro_correlation_batch",
                legend=COMBINED_ERM3_MACRO_LEGEND,
            )
            return df
        row = factor_correlation_body_to_row(body)
        df = pd.DataFrame([row])
        attach_sdk_metadata(
            df,
            lineage,
            kind="macro_correlation",
            legend=COMBINED_ERM3_MACRO_LEGEND,
        )
        return df

    def get_factor_correlation_single(
        self,
        ticker: str,
        *,
        factors: list[str] | None = None,
        return_type: str = "l3_residual",
        window_days: int = 252,
        method: str = "pearson",
        as_dataframe: bool = False,
    ) -> dict[str, Any] | pd.DataFrame:
        """GET /metrics/{ticker}/correlation — single ticker factor correlations.

        Lightweight GET endpoint for single-ticker correlation queries.
        Preferred over `get_factor_correlation()` when analyzing one ticker
        at a time, as it uses URL parameters and is more cache-friendly.

        Args:
            ticker: Stock ticker symbol (e.g., "AAPL", "NVDA").
            factors: Optional comma-separated list via query param.
                     Provide as Python list (e.g., ["vix", "bitcoin"]).
            return_type: Which return series ("gross", "l1", "l2", "l3_residual").
            window_days: Trailing window for correlation (20-2000, default 252).
            method: "pearson" or "spearman" (default "pearson").
            as_dataframe: If True, return a one-row DataFrame with ``macro_corr_*`` columns
                and SDK attrs (legend includes macro correlation semantics).

        Returns:
            API dict or one-row ``pandas.DataFrame`` when ``as_dataframe=True``.

        Example:
            >>> client = RiskModelsClient.from_env()
            >>> result = client.get_factor_correlation_single(
            ...     "NVDA",
            ...     factors=["vix", "bitcoin"],
            ...     window_days=126
            ... )
            >>> print(result["correlations"]["vix"])
            0.42
        """
        t, _ = resolve_ticker(ticker, self)
        params: dict[str, Any] = {
            "return_type": return_type,
            "window_days": str(window_days),
            "method": method,
        }
        if factors is not None:
            params["factors"] = ",".join(factors)
        body, hdr_lineage, _ = self._transport.request("GET", f"/metrics/{t}/correlation", params=params)
        if not as_dataframe:
            return body
        meta = body.get("_metadata") if isinstance(body, dict) else None
        lineage = RiskLineage.merge(hdr_lineage, RiskLineage.from_metadata(meta))
        row = factor_correlation_body_to_row(body)
        df = pd.DataFrame([row])
        attach_sdk_metadata(
            df,
            lineage,
            kind="macro_correlation",
            legend=COMBINED_ERM3_MACRO_LEGEND,
        )
        return df

    def get_macro_factor_series(
        self,
        *,
        factors: list[str] | None = None,
        start: str | None = None,
        end: str | None = None,
        as_dataframe: bool = False,
    ) -> dict[str, Any] | pd.DataFrame:
        """GET /macro-factors — daily macro factor returns (no ticker).

        Long-format rows from Supabase ``macro_factors``: ``factor_key``, ``teo``, ``return_gross``.
        Omit ``factors`` to use all six canonical keys. Default range: five calendar years through today (UTC);
        server enforces a 20-year maximum span.

        Args:
            factors: Optional list of factor keys (e.g. ``[\"bitcoin\", \"vix\"]``).
            start: Inclusive start date ``YYYY-MM-DD``.
            end: Inclusive end date ``YYYY-MM-DD``.
            as_dataframe: If True, return only the ``series`` rows as a DataFrame with SDK attrs.

        Returns:
            Full API JSON (``factors_requested``, ``series``, ``warnings``, …) or a long DataFrame.
        """
        params: dict[str, Any] = {}
        if factors is not None:
            params["factors"] = ",".join(factors)
        if start is not None:
            params["start"] = start
        if end is not None:
            params["end"] = end
        body, hdr_lineage, _ = self._transport.request("GET", "/macro-factors", params=params)
        if not as_dataframe:
            return body
        meta = body.get("_metadata") if isinstance(body, dict) else None
        lineage = RiskLineage.merge(hdr_lineage, RiskLineage.from_metadata(meta))
        series = body.get("series") if isinstance(body, dict) else None
        rows = series if isinstance(series, list) else []
        df = pd.DataFrame(rows)
        attach_sdk_metadata(
            df,
            lineage,
            kind="macro_factor_series",
            legend=SHORT_MACRO_SERIES_LEGEND,
        )
        return df

    def batch_analyze(
        self,
        tickers: list[str],
        metrics: list[str],
        *,
        years: int = 1,
        format: FormatType = "json",
        return_lineage: bool = False,
    ) -> dict[str, Any] | tuple[dict[str, Any], RiskLineage] | tuple[pd.DataFrame, RiskLineage]:
        """Batch-analyze multiple tickers via POST /batch/analyze.

        Sends up to 100 tickers in a single request. 25% cheaper per position
        than individual calls.

        Args:
            tickers: List of ticker symbols (up to 100).
            metrics: Which metric sets to include.
            years: Years of history (default 1).
            format: ``"json"`` (default), ``"parquet"``, or ``"csv"``.
            return_lineage: If True and ``format="json"``, return ``(body, lineage)``.

        Returns:
            JSON dict or ``(DataFrame, lineage)`` for parquet/CSV.

        Example:
            >>> body = client.batch_analyze(["NVDA", "AAPL"], ["full_metrics"])
        """
        payload = {
            "tickers": [str(x).strip().upper() for x in tickers],
            "metrics": metrics,
            "years": years,
            "format": format,
        }
        if format == "json":
            body, lineage, _ = self._transport.request("POST", "/batch/analyze", json=payload)
            meta = body.get("_metadata") if isinstance(body, dict) else None
            lineage = RiskLineage.merge(lineage, RiskLineage.from_metadata(meta))
            if return_lineage:
                return body, lineage
            return body
        content, lineage, _ = self._transport.request("POST", "/batch/analyze", json=payload, expect_json=False)
        df = parquet_bytes_to_dataframe(content) if format == "parquet" else csv_bytes_to_dataframe(content)
        df = batch_returns_long_normalize(df)
        attach_sdk_metadata(df, lineage, kind="batch_returns_long")
        return df, lineage

    def analyze_portfolio(
        self,
        positions: PositionsInput,
        *,
        metrics: tuple[str, ...] | list[str] | None = None,
        years: int = 1,
        validate: ValidateMode | None = None,
        include_returns_panel: bool = False,
        er_tolerance: float | None = None,
    ) -> Any:
        """Analyze a weighted portfolio: per-ticker metrics and portfolio-level aggregates.

        Args:
            positions: Portfolio weights — dict, list of tuples, or list of dicts.
            metrics: Metric sets to request (default ``["full_metrics", "hedge_ratios"]``).
            years: Years of history for return-based metrics (default 1).
            validate: Override ER/HR validation mode.
            include_returns_panel: If True, attach xarray panel.
            er_tolerance: Override ER sum tolerance.

        Returns:
            :class:`PortfolioAnalysis` with ``per_ticker``, ``portfolio_hedge_ratios``,
            and ``portfolio_l3_er_weighted_mean``.

        Example:
            >>> pa = client.analyze({"NVDA": 0.5, "AAPL": 0.5})
            >>> print(pa.portfolio_hedge_ratios)
        """
        weights = positions_to_weights(positions)
        mlist = list(metrics) if metrics is not None else ["full_metrics", "hedge_ratios"]
        if include_returns_panel and "returns" not in mlist:
            mlist.append("returns")
        body, lineage = self._batch_json_for_portfolio(list(weights.keys()), mlist, years)
        tol = er_tolerance if er_tolerance is not None else self._er_tolerance
        mode = validate if validate is not None else self._validate_default
        pa = analyze_batch_to_portfolio(
            body,
            weights,
            validate=mode,
            er_tolerance=tol,
            include_returns_long=include_returns_panel,
            response_lineage=lineage,
        )
        if include_returns_panel and pa.returns_long is not None and not pa.returns_long.empty:
            try:
                pa.panel = long_df_to_dataset(pa.returns_long, pa.lineage)
            except ImportError:
                pa.panel = None
        return pa

    analyze = analyze_portfolio

    def get_metrics_snapshot_pdf(self, ticker: str) -> tuple[bytes, RiskLineage]:
        """Download a single-name risk snapshot as a PDF report.

        Args:
            ticker: Stock ticker symbol (e.g., ``"NVDA"``).

        Returns:
            Tuple of ``(pdf_bytes, lineage)``.

        Example:
            >>> pdf_bytes, lineage = client.get_metrics_snapshot_pdf("NVDA")
            >>> Path("nvda_snapshot.pdf").write_bytes(pdf_bytes)
        """
        t, _ = resolve_ticker(ticker, self)
        path = f"/metrics/{quote(t, safe='')}/snapshot.pdf"
        data, lineage, _r = self._transport.request("GET", path, expect_json=False)
        return data, lineage

    def post_portfolio_risk_snapshot_pdf(
        self,
        positions: PositionsInput,
        *,
        title: str | None = None,
        as_of_date: str | None = None,
    ) -> tuple[bytes, RiskLineage]:
        """Generate a portfolio risk snapshot as a PDF report.

        Args:
            positions: Portfolio weights — dict, list of tuples, or list of dicts.
            title: Optional title for the PDF header.
            as_of_date: Optional date override (``YYYY-MM-DD``).

        Returns:
            Tuple of ``(pdf_bytes, lineage)``.

        Example:
            >>> pdf, _ = client.post_portfolio_risk_snapshot_pdf(
            ...     [("NVDA", 0.3), ("AAPL", 0.7)], title="My Portfolio"
            ... )
        """
        weights = positions_to_weights(positions)
        body: dict[str, Any] = {
            "format": "pdf",
            "positions": [{"ticker": k, "weight": float(v)} for k, v in weights.items()],
        }
        if title is not None:
            body["title"] = title
        if as_of_date is not None:
            body["as_of_date"] = as_of_date
        data, lineage, _r = self._transport.request(
            "POST",
            "/portfolio/risk-snapshot",
            json=body,
            expect_json=False,
        )
        return data, lineage

    def post_portfolio_risk_snapshot(
        self,
        positions: PositionsInput,
        *,
        title: str | None = None,
        as_of_date: str | None = None,
        include_diversification: bool = False,
        window_days: int = 252,
    ) -> tuple[dict, RiskLineage]:
        """Generate a portfolio risk snapshot as structured JSON.

        Args:
            positions: Portfolio weights — dict, list of tuples, or list of dicts.
            title: Optional title for the snapshot.
            as_of_date: Optional date override (``YYYY-MM-DD``).
            include_diversification: If True, include diversification metrics.
            window_days: Trailing window for diversification (default 252).

        Returns:
            Tuple of ``(data_dict, lineage)``.

        Example:
            >>> data, lineage = client.post_portfolio_risk_snapshot(
            ...     {"NVDA": 0.5, "AAPL": 0.5}, include_diversification=True
            ... )
        """
        weights = positions_to_weights(positions)
        body: dict[str, Any] = {
            "format": "json",
            "positions": [{"ticker": k, "weight": float(v)} for k, v in weights.items()],
        }
        if title is not None:
            body["title"] = title
        if as_of_date is not None:
            body["as_of_date"] = as_of_date
        if include_diversification:
            body["include_diversification"] = True
            body["window_days"] = window_days
        data, lineage, _r = self._transport.request(
            "POST",
            "/portfolio/risk-snapshot",
            json=body,
        )
        return data, lineage

    def _batch_json_for_portfolio(
        self, tickers: list[str], metrics: list[str], years: int
    ) -> tuple[dict[str, Any], RiskLineage]:
        payload = {"tickers": tickers, "metrics": metrics, "years": years, "format": "json"}
        body, lineage, _ = self._transport.request("POST", "/batch/analyze", json=payload)
        meta = body.get("_metadata") if isinstance(body, dict) else None
        lineage = RiskLineage.merge(lineage, RiskLineage.from_metadata(meta))
        return body, lineage

    def get_dataset(
        self,
        tickers: list[str],
        *,
        years: int = 1,
        format: FormatType = "parquet",
    ) -> Any:
        """Build a multi-dimensional xarray Dataset from batch returns.

        Args:
            tickers: List of ticker symbols.
            years: Years of history (default 1).
            format: Must be ``"parquet"`` (default) or ``"csv"``.

        Returns:
            ``xarray.Dataset`` with dimensions ``(ticker, date, metric)``.

        Example:
            >>> ds = client.get_dataset(["NVDA", "AAPL", "MSFT"], years=2)
        """
        if format == "json":
            raise ValueError("get_dataset requires format='parquet' or 'csv' (use batch_analyze for JSON).")
        out = self.batch_analyze(tickers, ["returns"], years=years, format=format)
        if isinstance(out, dict):
            raise TypeError("Expected tabular batch response")
        df, lineage = out
        return long_df_to_dataset(df, lineage)

    def search_tickers(
        self,
        *,
        search: str | None = None,
        mag7: bool | None = None,
        include_metadata: bool | None = None,
        as_dataframe: bool = True,
    ) -> pd.DataFrame | list[Any]:
        """Search the RiskModels ticker universe.

        Args:
            search: Ticker or company name to search for.
            mag7: If True, return only the Magnificent 7 stocks.
            include_metadata: If True, include sector/subsector ETF mappings.
            as_dataframe: If True (default), return a DataFrame.

        Returns:
            DataFrame with a ``ticker`` column, or a list if ``as_dataframe=False``.

        Example:
            >>> client.search_tickers(search="nvidia")
            >>> client.search_tickers(mag7=True)
        """
        params: dict[str, Any] = {}
        if search is not None:
            params["search"] = search
        if mag7 is not None:
            params["mag7"] = mag7
        if include_metadata is not None:
            params["include_metadata"] = include_metadata
        body, lin, _ = self._transport.request("GET", "/tickers", params=params or None)
        if isinstance(body, list):
            if as_dataframe:
                if body and isinstance(body[0], str):
                    df = pd.DataFrame({"ticker": body})
                else:
                    df = pd.DataFrame(body)
                attach_sdk_metadata(df, lin, kind="tickers_universe")
                return df
            return body
        if isinstance(body, dict):
            rows = body.get("tickers") or body.get("data")
            if rows is None:
                rows = []
            # GET /tickers?search=… returns { ticker } or { ticker, suggestions } — not tickers[]
            if not rows and isinstance(body.get("suggestions"), list) and body["suggestions"]:
                rows = body["suggestions"]
            if not rows and body.get("ticker") is not None:
                rows = [{"ticker": str(body["ticker"]).strip().upper()}]
            if as_dataframe:
                if isinstance(rows, list) and rows and isinstance(rows[0], str):
                    df = pd.DataFrame({"ticker": rows})
                elif isinstance(rows, list):
                    df = pd.DataFrame(rows)
                else:
                    df = pd.DataFrame([rows])
                attach_sdk_metadata(df, lin, kind="tickers_universe")
                return df
            return rows if isinstance(rows, list) else [body]
        df = pd.DataFrame()
        attach_sdk_metadata(df, lin, kind="tickers_universe")
        return df

    # --- Supabase ticker_metadata (sector/peer discovery) ---

    def get_ticker_metadata(
        self,
        *,
        ticker: str | None = None,
        sector_etf: str | None = None,
        subsector_etf: str | None = None,
        columns: str = "ticker,company_name,market_cap,sector_etf,subsector_etf",
        order: str = "market_cap.desc.nullslast",
        limit: int = 500,
        as_dataframe: bool = True,
    ) -> pd.DataFrame | list[dict[str, Any]]:
        """Query the ``ticker_metadata`` Supabase table directly.

        This is the authoritative source for sector/subsector mappings,
        company names, and market caps.  Used by :class:`PeerGroupProxy`
        to discover sector peers without expensive batch-analyze calls.

        Parameters
        ----------
        ticker        : Exact ticker filter (e.g. ``"NVDA"``).
        sector_etf    : Filter rows where ``sector_etf`` matches (e.g. ``"XLK"``).
        subsector_etf : Filter rows where ``subsector_etf`` matches (e.g. ``"SOXX"``).
        columns       : PostgREST ``select`` clause.
        order         : PostgREST ``order`` clause.
        limit         : Max rows.
        as_dataframe  : Return a DataFrame (default) or list of dicts.

        Returns
        -------
        DataFrame or list[dict] with the requested metadata.

        Raises
        ------
        ValueError
            If ``SUPABASE_URL`` or ``SUPABASE_SERVICE_ROLE_KEY`` are not set.
        """
        from .env import load_repo_dotenv
        load_repo_dotenv()

        sb_url = os.environ.get("SUPABASE_URL", "").strip().strip('"').strip("'").rstrip("/")
        sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip().strip('"').strip("'")
        if not sb_url or not sb_key:
            raise ValueError(
                "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use get_ticker_metadata(). "
                "These are typically in .env.local alongside RISKMODELS_API_KEY."
            )

        params: dict[str, str] = {
            "select": columns,
            "order": order,
            "limit": str(limit),
        }
        if ticker:
            params["ticker"] = f"eq.{ticker}"
        if sector_etf:
            params["sector_etf"] = f"eq.{sector_etf}"
        if subsector_etf:
            params["subsector_etf"] = f"eq.{subsector_etf}"

        headers = {
            "apikey": sb_key,
            "Authorization": f"Bearer {sb_key}",
        }

        r = httpx.get(
            f"{sb_url}/rest/v1/ticker_metadata",
            params=params,
            headers=headers,
            timeout=15,
        )
        r.raise_for_status()
        rows = r.json()

        if as_dataframe:
            df = pd.DataFrame(rows) if rows else pd.DataFrame()
            return df
        return rows

    # --- Visual Refinement (MatPlotAgent Pattern) ---
    def generate_refined_plot(
        self,
        plot_description: str,
        output_path: str | None = None,
        *,
        llm_client: Any | None = None,
        max_iterations: int = 10,
        llm_provider: Literal["openai", "anthropic"] = "openai",
        model: str | None = None,
    ) -> Any:
        """Generate a refined plot through recursive Vision-LLM feedback.

        Automates the loop between Python execution and Vision-LLM evaluation to
        produce professional financial visualizations following RiskModels standards.

        Args:
            plot_description: Description of the desired plot (e.g., "L3 risk
                decomposition stacked area chart for NVDA over 2 years")
            output_path: Path to save the PNG (defaults to temp file)
            llm_client: LLM client instance (OpenAI or Anthropic). Must be
                provided either here or pre-configured via the agent.
            max_iterations: Maximum refinement iterations (default 10)
            llm_provider: Which LLM provider to use ("openai" or "anthropic")
            model: Vision model name (provider-specific defaults used if None)

        Returns:
            RefinementResult with success status, output path, iteration count,
            final code, and evaluation history.

        Raises:
            ImportError: If visual_refinement module dependencies are missing
            ValueError: If llm_client is not provided

        Example:
            >>> from openai import OpenAI
            >>> from riskmodels import RiskModelsClient
            >>> client = RiskModelsClient.from_env()
            >>> llm = OpenAI(api_key="sk-...")
            >>> result = client.generate_refined_plot(
            ...     "L3 hedge ratio time series for AAPL with proper financial styling",
            ...     output_path="aapl_hedge.png",
            ...     llm_client=llm,
            ...     max_iterations=5
            ... )
            >>> print(f"Iterations: {result.iterations}")
            >>> print(f"Output: {result.output_path}")
        """
        if llm_client is None:
            raise ValueError(
                "llm_client is required. Provide an OpenAI or Anthropic client instance. "
                "Example: client.generate_refined_plot(..., llm_client=openai_client)"
            )

        # Import here to avoid hard dependency on LLM libraries
        from .visual_refinement import MatPlotAgent

        agent = MatPlotAgent(
            client=self,
            llm_client=llm_client,
            llm_provider=llm_provider,
            model=model,
        )
        return agent.generate_refined_plot(
            plot_description=plot_description,
            output_path=output_path,
            max_iterations=max_iterations,
        )

    # --- Semantic aliases (agent-native) ---
    get_risk = get_metrics
    get_history = get_ticker_returns
    get_returns_series = get_ticker_returns
    batch = batch_analyze
    analyze = analyze_portfolio
    get_cube = get_dataset
    get_panel = get_dataset
