"""Cohort statistics and residual demeaning (ERM3 H.146).

Why this module exists
----------------------
ERM3 fits its regressions **without an intercept**, deliberately, so each
stock's residual retains its alpha. That is the right choice for a risk
product, but it has a consequence most consumers will not anticipate: the
**cross-sectional mean residual is not zero**. Anyone ranking names against
each other is therefore ranking against a moving baseline unless they subtract
it first.

:func:`demean` does that subtraction. It exists so that five consumers do not
write five subtly different demeaning implementations — which is the real risk
of leaving this to downstream code. The rule it encodes is short: subtract the
cohort mean **at the level your residual is defined against**. A sector-level
residual demeans within its sector cohort; a subsector residual within its
subsector.

A note on drift figures: the cross-sectional mean drifts, and **the sign is not
stable across the sample** — roughly -3.2%/yr over 2014-2026 but +2.6%/yr over
the full 2000-2026 panel. Any headline number quoted without its window is
wrong, so this module quotes none and computes from the window you ask for.

Dispersion
----------
``residual_sd`` is the cross-sectional dispersion within a cohort: how much
there is to select from. It is a **conditioning and allocation** variable, not
an alpha source — it multiplies skill and cannot create it, and zero IC times a
well-timed gross multiplier is still zero. Read it with ``mean_pairwise_corr``,
which separates genuinely idiosyncratic dispersion from names simply moving
together.

Scope
-----
Addressable cohorts are SPY and the 11 GICS sector SPDRs. Cohorts are addressed
by ticker.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterable, Literal, Sequence

import pandas as pd

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .client import RiskModelsClient

__all__ = [
    "PUBLIC_COHORTS",
    "DEFAULT_VARIABLES",
    "fetch_cohort_cross_section",
    "fetch_cohort_series",
    "fetch_cohort_roster",
    "decompose_selection_vs_drift",
    "demean",
]

#: Addressable cohorts: the market cohort plus the 11 GICS sector SPDRs.
PUBLIC_COHORTS: tuple[str, ...] = (
    "SPY",
    "XLE",
    "XLB",
    "XLI",
    "XLY",
    "XLP",
    "XLV",
    "XLF",
    "XLK",
    "XLC",
    "XLU",
    "XLRE",
)

DEFAULT_VARIABLES: tuple[str, ...] = (
    "residual_mean",
    "residual_sd",
    "mean_pairwise_corr",
    "n_names",
    "n_effective",
)

DemeanLevel = Literal["market", "sector"]


def _csv(values: Sequence[str] | None) -> str | None:
    if not values:
        return None
    return ",".join(str(v).strip().upper() for v in values if str(v).strip())


def fetch_cohort_roster(client: "RiskModelsClient") -> dict[str, Any]:
    """Addressable cohorts, the variable catalogue, and the interpretation notes.

    Free discovery call. The returned ``disclosures`` block carries the
    no-intercept contract read straight from the store, so it is always the
    text that matches the data rather than a copy that can drift.
    """
    body, _lineage, _ = client._transport.request("GET", "/cohorts/roster")
    return body if isinstance(body, dict) else {}


def fetch_cohort_cross_section(
    client: "RiskModelsClient",
    *,
    cohorts: Sequence[str] | None = None,
    variables: Sequence[str] | None = None,
    teo: str | None = None,
    min_names: int | None = None,
) -> pd.DataFrame:
    """Cohort statistics across cohorts at one observation date.

    Args:
        client: An authenticated :class:`RiskModelsClient`.
        cohorts: Cohort tickers. Default: all public cohorts.
        variables: Variable names. Default: :data:`DEFAULT_VARIABLES`.
        teo: Observation date ``YYYY-MM-DD`` (default latest).
        min_names: Drop cohorts below this member count — statistics on a
            handful of names are noise.

    Returns:
        DataFrame indexed by cohort ticker, with ``level``, ``parent``, and one
        column per requested variable. ``df.attrs`` carries ``teo`` and
        ``disclosures``.
    """
    params: dict[str, Any] = {}
    if (c := _csv(cohorts)) is not None:
        params["cohorts"] = c
    if variables:
        params["variables"] = ",".join(variables)
    if teo:
        params["teo"] = teo
    if min_names is not None:
        params["min_names"] = min_names

    body, _lineage, _ = client._transport.request(
        "GET", "/cohorts", params=params or None
    )
    rows = (body or {}).get("cohorts") or []
    records = [
        {"cohort": r.get("ticker"), "level": r.get("level"), "parent": r.get("parent"), **(r.get("values") or {})}
        for r in rows
    ]
    df = pd.DataFrame.from_records(records)
    if not df.empty:
        df = df.set_index("cohort")
    df.attrs["teo"] = (body or {}).get("teo")
    df.attrs["disclosures"] = (body or {}).get("disclosures") or {}
    return df


def fetch_cohort_series(
    client: "RiskModelsClient",
    *,
    cohorts: Sequence[str] | None = None,
    variables: Sequence[str] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    min_names: int | None = None,
    include_proxy_source: bool = False,
) -> pd.DataFrame:
    """Cohort statistics over a date range, long-form.

    Args:
        client: An authenticated :class:`RiskModelsClient`.
        cohorts: Cohort tickers. Default: all public cohorts.
        variables: Variable names. Default: :data:`DEFAULT_VARIABLES`.
        start_date: Window start ``YYYY-MM-DD`` (default panel start, 2000-01-03).
        end_date: Window end ``YYYY-MM-DD`` (default latest).
        min_names: Drop days below this member count.
        include_proxy_source: Include the instrument that actually backed the
            cohort factor each day.

    Returns:
        Long-form DataFrame with ``date``, ``cohort``, ``level``, ``parent`` and
        one column per requested variable. ``df.attrs['proxied_fraction']`` maps
        each cohort to the share of its returned window that was proxied — two
        sector cohorts are majority-proxied over long windows, and a chart that
        hides that is showing partly a different basket.
    """
    params: dict[str, Any] = {}
    if (c := _csv(cohorts)) is not None:
        params["cohorts"] = c
    if variables:
        params["variables"] = ",".join(variables)
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date
    if min_names is not None:
        params["min_names"] = min_names
    if include_proxy_source:
        params["include_proxy_source"] = "true"

    body, _lineage, _ = client._transport.request(
        "GET", "/cohorts/series", params=params or None
    )

    records: list[dict[str, Any]] = []
    proxied: dict[str, float] = {}
    for series in (body or {}).get("cohorts") or []:
        ticker = series.get("ticker")
        proxied[ticker] = series.get("proxied_fraction")
        for point in series.get("points") or []:
            record = {
                "date": point.get("date"),
                "cohort": ticker,
                "level": series.get("level"),
                "parent": series.get("parent"),
                **(point.get("values") or {}),
            }
            if "proxy_source" in point:
                record["proxy_source"] = point["proxy_source"]
            records.append(record)

    df = pd.DataFrame.from_records(records)
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
    df.attrs["proxied_fraction"] = proxied
    df.attrs["disclosures"] = (body or {}).get("disclosures") or {}
    return df


def decompose_selection_vs_drift(
    positions: pd.DataFrame | Iterable[dict[str, Any]],
    client: "RiskModelsClient",
    *,
    level: DemeanLevel = "sector",
    start_date: str | None = None,
    end_date: str | None = None,
    min_names: int | None = None,
    include_series: bool = False,
) -> dict[str, Any]:
    """Split a book's realized residual return into selection and drift.

    Answers the question every equity PM has and few can answer: *was I paid
    for picking stocks, or for being net long the average stock?*

    For constant weights ``w_i``, daily residual return splits exactly::

        R_t = Σ_i w_i·(ε_i,t − μ_c(i),t)  +  Σ_c W_c·μ_c,t
              └──── selection ────┘          └──── drift ────┘

    **Selection** is what the book earned by holding names that beat their
    cohort's average residual. **Drift** is what it earned from net exposure to
    that average, which accrues on net weight whether or not anything was picked
    well. The two sum to the total by construction — this is an identity, not a
    regression.

    Weights are **not normalized**: rescaling them would change the drift term,
    which is proportional to net weight. A short is a negative weight.

    Args:
        positions: A DataFrame with ``ticker`` and ``weight`` columns, or an
            iterable of ``{"ticker": ..., "weight": ...}`` mappings.
        client: An authenticated :class:`RiskModelsClient`.
        level: ``"sector"`` demeans sector-level residuals against each name's
            sector cohort; ``"market"`` uses market-level residuals.
        start_date: Window start ``YYYY-MM-DD``.
        end_date: Window end ``YYYY-MM-DD``.
        min_names: Ignore cohort means on days the cohort was thinner than this.
        include_series: Also return the daily selection/drift series.

    Returns:
        The decomposition payload: ``totals`` (residual, selection, drift,
        selection_share), ``by_cohort``, ``coverage`` naming any dropped
        positions, and ``disclosures``.

    Note:
        Realized historical attribution of the weights you state. Not a
        forecast, not a backtest, and not a recommendation.
    """
    if isinstance(positions, pd.DataFrame):
        if "ticker" not in positions.columns or "weight" not in positions.columns:
            raise KeyError("positions frame needs 'ticker' and 'weight' columns")
        rows = [
            {"ticker": str(t).strip().upper(), "weight": float(w)}
            for t, w in zip(positions["ticker"], positions["weight"])
        ]
    else:
        rows = [
            {"ticker": str(p["ticker"]).strip().upper(), "weight": float(p["weight"])}
            for p in positions
        ]

    payload: dict[str, Any] = {
        "positions": rows,
        "level": level,
        "include_series": include_series,
    }
    if start_date:
        payload["start_date"] = start_date
    if end_date:
        payload["end_date"] = end_date
    if min_names is not None:
        payload["min_names"] = min_names

    body, _lineage, _ = client._transport.request(
        "POST", "/cohorts/pnl-decomposition", json=payload
    )
    return body if isinstance(body, dict) else {}


def demean(
    frame: pd.DataFrame,
    client: "RiskModelsClient",
    *,
    level: DemeanLevel = "sector",
    residual_col: str = "residual",
    cohort_col: str | None = None,
    date_col: str = "date",
    out_col: str | None = None,
    min_names: int | None = None,
) -> pd.DataFrame:
    """Subtract the cohort mean residual from a frame of per-stock residuals.

    ERM3 residuals are fitted without an intercept, so they are **not**
    zero-mean cross-sectionally. Ranking names against each other without
    removing that common component ranks partly on the baseline rather than on
    the stock. This applies the correction at the level you specify.

    Match ``level`` to how your residual was defined. A residual measured
    against a sector factor demeans within its sector cohort (``level="sector"``,
    the default); one measured against the market demeans within the market
    cohort (``level="market"``).

    Args:
        frame: Per-stock rows carrying a date, a residual, and — for
            ``level="sector"`` — the stock's sector cohort ticker.
        client: An authenticated :class:`RiskModelsClient`.
        level: ``"sector"`` demeans within each stock's sector cohort;
            ``"market"`` demeans every row against the SPY cohort.
        residual_col: Column holding the residual to correct.
        cohort_col: Column holding the sector cohort ticker (e.g. ``XLK``).
            Required for ``level="sector"``; ignored for ``"market"``.
            Defaults to ``"sector_etf"`` when present, else ``"cohort"``.
        date_col: Column holding the observation date.
        out_col: Name for the corrected column. Defaults to
            ``f"{residual_col}_demeaned"``.
        min_names: Passed through to the cohort fetch — days on which a cohort
            had fewer than this many members are treated as having no usable
            mean, and rows on those days come back with a null correction
            rather than a noisy one.

    Returns:
        A copy of ``frame`` with two added columns: the corrected residual, and
        ``cohort_residual_mean`` — the quantity subtracted, kept so the
        correction stays auditable rather than disappearing into the number.

    Raises:
        KeyError: If a required column is missing.
        ValueError: If the frame carries cohorts outside the addressable set.
    """
    if residual_col not in frame.columns:
        raise KeyError(f"frame has no column {residual_col!r}")
    if date_col not in frame.columns:
        raise KeyError(f"frame has no column {date_col!r}")

    out_col = out_col or f"{residual_col}_demeaned"
    out = frame.copy()
    out[date_col] = pd.to_datetime(out[date_col])

    if level == "market":
        cohort_keys = pd.Series("SPY", index=out.index)
        wanted: list[str] = ["SPY"]
    else:
        if cohort_col is None:
            cohort_col = "sector_etf" if "sector_etf" in out.columns else "cohort"
        if cohort_col not in out.columns:
            raise KeyError(
                f"frame has no column {cohort_col!r}; pass cohort_col= to name the "
                "column holding each row's sector cohort ticker"
            )
        cohort_keys = out[cohort_col].astype("string").str.strip().str.upper()
        present = {c for c in cohort_keys.dropna().unique()}
        unknown = present - set(PUBLIC_COHORTS)
        if unknown:
            raise ValueError(
                "frame contains cohorts outside the addressable set: "
                f"{sorted(unknown)}. Addressable cohorts are {list(PUBLIC_COHORTS)}."
            )
        wanted = sorted(present)

    if not wanted:
        out[out_col] = out[residual_col]
        out["cohort_residual_mean"] = pd.NA
        return out

    span = out[date_col]
    means = fetch_cohort_series(
        client,
        cohorts=wanted,
        variables=["residual_mean"],
        start_date=span.min().strftime("%Y-%m-%d"),
        end_date=span.max().strftime("%Y-%m-%d"),
        min_names=min_names,
    )

    if means.empty:
        out[out_col] = pd.NA
        out["cohort_residual_mean"] = pd.NA
        return out

    lookup = means.set_index(["date", "cohort"])["residual_mean"]
    keys = pd.MultiIndex.from_arrays([out[date_col], cohort_keys])
    correction = pd.Series(lookup.reindex(keys).to_numpy(), index=out.index)

    out["cohort_residual_mean"] = correction
    out[out_col] = out[residual_col] - correction
    return out
