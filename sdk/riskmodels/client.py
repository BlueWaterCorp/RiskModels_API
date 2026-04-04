"""High-level RiskModels API client."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
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
from .portfolio_math import analyze_batch_to_portfolio, metrics_body_to_row, normalize_positions
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


class RiskModelsClient:
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
        if key:
            return cls(base_url=base, api_key=key)
        if cid and csec:
            return cls(base_url=base, client_id=cid, client_secret=csec, default_scope=scope)
        raise ValueError("Set RISKMODELS_API_KEY or RISKMODELS_CLIENT_ID + RISKMODELS_CLIENT_SECRET")

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> RiskModelsClient:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def discover(
        self,
        *,
        format: DiscoverFormat = "markdown",
        to_stdout: bool = True,
        live: bool = False,
    ) -> str | dict[str, Any]:
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
        t, _ = resolve_ticker(ticker, self)
        path = f"/metrics/{quote(t, safe='')}"
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
        """One-row snapshot: `get_metrics` + macro factor correlations (two HTTP calls).

        Merges lineage from both responses. Columns are ERM3 metrics plus ``macro_corr_*`` and
        macro parameters (see ``SHORT_MACRO_CORR_LEGEND`` / ``COMBINED_ERM3_MACRO_LEGEND``).

        Use ``return_type="gross"`` for total-equity co-movement vs macro, or ``"l3_residual"``
        for the idiosyncratic sleeve vs macro factors.
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
        t, _ = resolve_ticker(ticker, self)
        params: dict[str, Any] = {"ticker": t, "years": years, "format": format}
        if limit is not None:
            params["limit"] = limit
        if nocache is not None:
            params["nocache"] = nocache
        mode = validate if validate is not None else self._validate_default
        if format == "json":
            body, hdr_lineage, _r = self._transport.request("GET", "/ticker-returns", params=params)
            meta = body.get("_metadata") if isinstance(body, dict) else None
            lineage = RiskLineage.merge(hdr_lineage, RiskLineage.from_metadata(meta))
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
            df = df.rename(columns={k: v for k, v in TICKER_RETURNS_COLUMN_RENAME.items() if k in df.columns})
        if not df.empty and mode != "off":
            last = df.iloc[-1].to_dict()
            run_validation(last, mode=mode, er_tolerance=self._er_tolerance)
        attach_sdk_metadata(df, lineage, kind="ticker_returns")
        return df

    def get_returns(
        self,
        ticker: str,
        *,
        years: int = 1,
        format: FormatType = "json",
    ) -> pd.DataFrame | dict[str, Any]:
        t, _ = resolve_ticker(ticker, self)
        params: dict[str, Any] = {"ticker": t, "years": years, "format": format}
        if format == "json":
            body, _lineage, _ = self._transport.request("GET", "/returns", params=params)
            return body
        content, lineage, _ = self._transport.request("GET", "/returns", params=params, expect_json=False)
        df = parquet_bytes_to_dataframe(content) if format == "parquet" else csv_bytes_to_dataframe(content)
        attach_sdk_metadata(df, lineage, kind="returns")
        return df

    def get_etf_returns(
        self,
        symbol: str,
        *,
        years: int = 1,
        format: FormatType = "json",
    ) -> pd.DataFrame | dict[str, Any]:
        params: dict[str, Any] = {"ticker": symbol, "years": years, "format": format}
        if format == "json":
            body, lineage, _ = self._transport.request("GET", "/etf-returns", params=params)
            return body
        content, lineage, _ = self._transport.request("GET", "/etf-returns", params=params, expect_json=False)
        df = parquet_bytes_to_dataframe(content) if format == "parquet" else csv_bytes_to_dataframe(content)
        attach_sdk_metadata(df, lineage, kind="etf_returns")
        return df

    def get_plaid_holdings(self) -> dict[str, Any]:
        """GET /plaid/holdings — investment holdings synced via Plaid for the authenticated user.

        Returns the API JSON (``holdings``, ``accounts``, ``securities``, ``summary``, ``_metadata``, ``_agent``).

        **API keys:** if the key has explicit OAuth-style scopes, it must include ``plaid:holdings``
        (or ``*``). Keys with no scopes keep legacy full access. Link flow uses session auth
        (``POST /plaid/link-token`` and ``POST /plaid/exchange-public-token`` in the browser).
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
        """POST /portfolio/risk-index — holdings-weighted L3 ER decomposition (+ optional time series).

        If ``positions`` is empty (e.g. user linked Plaid but the first holdings sync has not
        finished), the API returns HTTP 200 with ``status: "syncing"`` and a ``message`` instead
        of ``portfolio_risk_index``. Treat that as a non-error polling state, not a failed chart.
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
        """GET /rankings/{ticker} — cross-sectional rank grid for one name.

        Each row is one (metric, cohort, window) with ``rank_ordinal``, ``cohort_size``,
        ``rank_percentile`` (100 = best). When ``as_dataframe=True`` (default), the frame
        includes ``ranking_key`` (``{window}_{cohort}_{metric}``), ``attrs['legend']``,
        ``riskmodels_warnings`` for small cohorts (N < 10), and ``riskmodels_rankings_headline``.
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
        """GET /rankings/top — leaderboard (best ``rank_ordinal`` first at latest ``teo``).

        Requires ``metric``, ``cohort``, and ``window``. ``limit`` is clamped server-side to 1–100.
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
        """Subset leaderboard rows with ``rank_percentile`` >= ``min_percentile`` (default top decile).

        Fetches up to ``min(limit, 100)`` names from ``get_top_rankings`` (API cap) then filters
        client-side. Rows with null ``rank_percentile`` are dropped.
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
        validate: ValidateMode | None = None,
    ) -> pd.DataFrame:
        t, _ = resolve_ticker(ticker, self)
        params: dict[str, Any] = {"ticker": t}
        if market_factor_etf:
            params["market_factor_etf"] = market_factor_etf
        body, lineage, _ = self._transport.request("GET", "/l3-decomposition", params=params)
        df = l3_decomposition_json_to_dataframe(body)
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
    ) -> dict[str, Any] | tuple[pd.DataFrame, RiskLineage]:
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
            return body
        content, lineage, _ = self._transport.request("POST", "/batch/analyze", json=payload, expect_json=False)
        df = parquet_bytes_to_dataframe(content) if format == "parquet" else csv_bytes_to_dataframe(content)
        df = batch_returns_long_normalize(df)
        attach_sdk_metadata(df, lineage, kind="batch_returns_long")
        return df, lineage

    def analyze_portfolio(
        self,
        positions: Mapping[str, float],
        *,
        metrics: tuple[str, ...] | list[str] | None = None,
        years: int = 1,
        validate: ValidateMode | None = None,
        include_returns_panel: bool = False,
        er_tolerance: float | None = None,
    ) -> Any:
        weights = normalize_positions(positions)
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
        from .visual_refinement import MatPlotAgent, RefinementResult

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
