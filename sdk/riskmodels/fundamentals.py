"""PIT quarterly fundamentals — parsing, cadence-based next-earnings estimate,
and cost-of-capital sensitivity-grid helpers for ``GET /fundamentals/{ticker}``.

This module owns the DataFrame shape and derived (client-side, non-reconstructive)
helpers for the fundamentals endpoint. ``client.get_fundamentals()`` /
``client.next_earnings()`` (see ``client.py``) call the endpoint and delegate
parsing here — mirroring how ``parsing.py`` backs ``get_ticker_returns`` /
``get_rankings``.

LICENSING: every field this module reads comes from the server's already
derived-only, sanitized response body (``lib/api/fundamentals-contract.ts`` on
the API side). This module never reconstructs a held-back raw field (revenue,
net income, EPS, balance-sheet levels, earnings surprise) from derived ones —
it only reshapes and aggregates what the server already cleared to ship. See
``CLAUDE.md`` — "Derived-only licensing is enforced server-side — never add
client-side raw-field reconstruction."

Examples
--------
>>> from riskmodels import RiskModelsClient
>>> client = RiskModelsClient.from_env()
>>> df = client.get_fundamentals("AAPL", as_dataframe=True)
>>> df.columns[:3].tolist()
['period_end_date', 'filed_date', 'filed_date_source']
>>> client.next_earnings("AAPL")
{'ticker': 'AAPL', 'last_filed_date': '2026-01-30', 'estimated_next_filed_date': '2026-05-01', ...}
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal

import pandas as pd

from .lineage import RiskLineage
from .metadata_attach import attach_sdk_metadata

RfTenor = Literal["3m", "1y", "2y", "5y", "10y", "30y"]

FUNDAMENTALS_ROW_COLUMNS = [
    "period_end_date",
    "filed_date",
    "filed_date_source",
    "gross_margin",
    "operating_margin",
    "roe_ttm",
    "roa_ttm",
    "leverage_ratio",
    "fcf_margin",
    "beta_market",
    "beta_sector",
    "beta_subsector",
    "beta_source",
    "rf_rate",
    "cost_of_equity",
    "cost_of_debt",
    "wacc",
    "economic_profit",
    "market_cap",
]

FUNDAMENTALS_COLUMN_HINTS: dict[str, str] = {
    "period_end_date": "Fiscal quarter end (economic truth).",
    "filed_date": "PIT knowledge-time stamp; null if unfiled at the requested as_of.",
    "filed_date_source": "'exact' (vendor filing date) or 'approx' (period_end + 45d, the 10-Q deadline).",
    "roe_ttm": "Trailing-4Q net income / trailing-4Q average total equity.",
    "roa_ttm": "Trailing-4Q net income / trailing-4Q average total assets.",
    "leverage_ratio": "Latest total_debt / latest total_equity (point-in-time, not TTM).",
    "fcf_margin": "(cash_from_operations_ttm - capex_ttm) / revenue_ttm.",
    "beta_market": "Short-half-life conditional market beta — NOT a textbook long-run CAPM beta.",
    "beta_source": "Provenance of the beta window: none | in-universe | out-of-universe | post-delisting.",
    "rf_rate": "Treasury CMT yield at the requested rf_tenor, sampled at/before this quarter's period end.",
    "cost_of_equity": "CAPM: rf_rate + beta_market * erp (caller-supplied erp).",
    "wacc": "BOOK-value-weighted WACC (balance-sheet equity/debt, not market-value weights).",
    "economic_profit": "(roe_ttm - cost_of_equity) * total_equity — equity-charge form.",
}


def attach_fundamentals_semantic_hints(df: pd.DataFrame) -> None:
    """Merge the fundamentals-specific column hints into df.attrs cheatsheet target."""
    existing = df.attrs.get("riskmodels_column_hints")
    merged = {**(existing or {}), **FUNDAMENTALS_COLUMN_HINTS}
    df.attrs["riskmodels_column_hints"] = merged


def fundamentals_json_to_dataframe(body: dict[str, Any]) -> pd.DataFrame:
    """Rows from ``GET /fundamentals/{ticker}`` -> one-row-per-quarter DataFrame.

    Empty rows list -> empty DataFrame with the full column set (never a
    zero-column frame, so downstream ``df["roe_ttm"]`` reads are safe).
    """
    rows = body.get("rows") or []
    if not rows:
        return pd.DataFrame(columns=FUNDAMENTALS_ROW_COLUMNS)
    df = pd.DataFrame(rows)
    for col in FUNDAMENTALS_ROW_COLUMNS:
        if col not in df.columns:
            df[col] = None
    mc = body.get("market_cap") or {}
    df["market_cap"] = mc.get("value")
    return df[FUNDAMENTALS_ROW_COLUMNS]


def sensitivity_grid_json_to_dataframe(body: dict[str, Any]) -> pd.DataFrame:
    """Flatten ``sensitivity_grid`` (erp x rf_tenor cells) into long form.

    One row per (erp, rf_tenor) combination: ``erp``, ``rf_tenor``,
    ``cost_of_equity``, ``wacc``, ``economic_profit``, plus the anchor
    ``period_end_date`` / ``filed_date`` repeated on every row for convenient
    ``groupby`` / heatmap pivoting.
    """
    grid = body.get("sensitivity_grid")
    cols = [
        "period_end_date",
        "filed_date",
        "erp",
        "rf_tenor",
        "cost_of_equity",
        "wacc",
        "economic_profit",
    ]
    if not grid or not grid.get("cells"):
        return pd.DataFrame(columns=cols)
    erp_values = grid["erp_values"]
    tenor_values = grid["rf_tenor_values"]
    records: list[dict[str, Any]] = []
    for i, erp in enumerate(erp_values):
        row = grid["cells"][i]
        for j, tenor in enumerate(tenor_values):
            cell = row[j]
            records.append(
                {
                    "period_end_date": grid.get("period_end_date"),
                    "filed_date": grid.get("filed_date"),
                    "erp": erp,
                    "rf_tenor": tenor,
                    "cost_of_equity": cell.get("cost_of_equity"),
                    "wacc": cell.get("wacc"),
                    "economic_profit": cell.get("economic_profit"),
                }
            )
    return pd.DataFrame.from_records(records, columns=cols)


@dataclass(frozen=True)
class NextEarningsEstimate:
    """Cadence-based next-filing estimate — NOT a real earnings calendar.

    Derived entirely from the already-shipped ``filed_date`` column (an
    allowlisted PIT stamp, not a held-back raw field): the median gap between
    consecutive observed filings, projected forward from the most recent one.
    No analyst estimate, no vendor earnings-calendar feed exists in the store
    (``eps_forecast`` / ``analyst_rating`` / ``target_price`` are permanently
    held back — see ``FUNDAMENTALS_HELD_BACK_FIELDS`` in the API repo). This
    is a statistical projection of a company's own historical filing cadence,
    always echoed with ``basis="filed_date_cadence"`` so callers don't mistake
    it for a confirmed date.
    """

    ticker: str
    last_filed_date: str | None
    estimated_next_filed_date: str | None
    median_cadence_days: float | None
    n_periods_observed: int
    basis: str = "filed_date_cadence"
    note: str = (
        "Statistical projection from historical filing cadence, not a confirmed "
        "earnings-calendar date. No analyst estimates or vendor earnings-calendar "
        "feed are stored (derived-only licensing posture)."
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "last_filed_date": self.last_filed_date,
            "estimated_next_filed_date": self.estimated_next_filed_date,
            "median_cadence_days": self.median_cadence_days,
            "n_periods_observed": self.n_periods_observed,
            "basis": self.basis,
            "note": self.note,
        }


def estimate_next_earnings(
    ticker: str,
    rows: list[dict[str, Any]],
    *,
    min_periods: int = 2,
) -> NextEarningsEstimate:
    """Project the next filing date from the median gap between observed ``filed_date`` values.

    Args:
        ticker: Echoed on the result.
        rows: Rows as returned by ``GET /fundamentals/{ticker}`` (oldest -> newest).
        min_periods: Minimum number of filed quarters required to compute a
            cadence; below this, the estimate is null (too little history to
            be more than a guess — most fundamentals histories start ~2009,
            so this only bites truly new stores).

    Returns:
        A :class:`NextEarningsEstimate`. All fields are null (but the object
        is still returned, never ``None``) when fewer than ``min_periods``
        filed dates are present.
    """
    filed = sorted(d for r in rows if (d := r.get("filed_date")))
    if len(filed) < min_periods:
        return NextEarningsEstimate(
            ticker=ticker,
            last_filed_date=filed[-1] if filed else None,
            estimated_next_filed_date=None,
            median_cadence_days=None,
            n_periods_observed=len(filed),
        )
    gaps = [
        (date.fromisoformat(b) - date.fromisoformat(a)).days
        for a, b in zip(filed[:-1], filed[1:])
    ]
    median_gap = statistics.median(gaps)
    last = date.fromisoformat(filed[-1])
    next_estimated = last + timedelta(days=round(median_gap))
    return NextEarningsEstimate(
        ticker=ticker,
        last_filed_date=filed[-1],
        estimated_next_filed_date=next_estimated.isoformat(),
        median_cadence_days=median_gap,
        n_periods_observed=len(filed),
    )


def attach_fundamentals_metadata(df: pd.DataFrame, body: dict[str, Any]) -> None:
    """Attach SDK lineage/legend/cheatsheet attrs so the frame rides ``to_llm_context()``."""
    meta = body.get("_metadata") if isinstance(body, dict) else None
    lineage = RiskLineage.from_metadata(meta) or RiskLineage()
    attach_sdk_metadata(df, lineage, kind="fundamentals")
    attach_fundamentals_semantic_hints(df)
    disclosures = body.get("disclosures") if isinstance(body, dict) else None
    if disclosures:
        df.attrs["riskmodels_fundamentals_disclosures"] = disclosures
