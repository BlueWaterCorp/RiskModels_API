"""Private PostgREST enrich for Cloud Run F1 renders.

Kept out of the public ``riskmodels-py`` wheel so API users never see or need
Supabase credentials. Soft-fails when ``SUPABASE_*`` / ``NEXT_PUBLIC_SUPABASE_*``
are missing so local tests still run.
"""

from __future__ import annotations

import logging
import os
from dataclasses import replace
from typing import Any

log = logging.getLogger(__name__)


def _supabase_creds() -> tuple[str, str] | None:
    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or ""
    ).strip().strip('"').strip("'").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or ""
    ).strip().strip('"').strip("'")
    if not url or not key:
        return None
    return url, key


def _supabase_query(path: str, params: dict[str, str]) -> list[dict[str, Any]]:
    creds = _supabase_creds()
    if creds is None:
        return []
    url, key = creds
    try:
        import httpx

        r = httpx.get(
            f"{url}/rest/v1/{path}",
            params=params,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=15,
        )
        r.raise_for_status()
        rows = r.json()
        return rows if isinstance(rows, list) else []
    except Exception:
        log.debug("Supabase query soft-failed for %s", path, exc_info=True)
        return []


def fund_identity_from_supabase(bw_fund_id: str) -> dict[str, Any]:
    rows = _supabase_query(
        "funds",
        {
            "bw_fund_id": f"eq.{bw_fund_id}",
            "select": (
                "bw_fund_id,ticker,fund_name,equity_style_9box,"
                "latest_report_date,latest_total_adj_mv"
            ),
            "limit": "1",
        },
    )
    return rows[0] if rows else {}


def _resolve_holdings_metadata(symbols: list[str]) -> dict[str, dict[str, Any]]:
    if not symbols:
        return {}
    in_clause = "(" + ",".join(symbols) + ")"
    rows = _supabase_query(
        "symbols",
        {
            "symbol": f"in.{in_clause}",
            "select": "symbol,ticker,name,sector_etf,subsector_etf",
        },
    )
    return {r["symbol"]: r for r in rows}


def _resolve_l3_decomposition(symbols: list[str]) -> dict[str, dict[str, float | None]]:
    if not symbols:
        return {}
    in_clause = "(" + ",".join(symbols) + ")"
    base_cols = "symbol,l3_mkt_er,l3_sec_er,l3_sub_er,l3_res_er"
    rows = _supabase_query(
        "security_history_latest",
        {
            "symbol": f"in.{in_clause}",
            "periodicity": "eq.daily",
            "select": base_cols + ",l3_style_er,l3_stock_specific_er",
        },
    )
    if not rows:
        rows = _supabase_query(
            "security_history_latest",
            {
                "symbol": f"in.{in_clause}",
                "periodicity": "eq.daily",
                "select": base_cols,
            },
        )

    out: dict[str, dict[str, float | None]] = {}
    for r in rows:
        style = r.get("l3_style_er")
        idio = r.get("l3_stock_specific_er")
        base = {
            "market_share": float(r["l3_mkt_er"] or 0.0),
            "sector_share": float(r["l3_sec_er"] or 0.0),
            "subsector_share": float(r["l3_sub_er"] or 0.0),
        }
        if style is not None and idio is not None:
            out[r["symbol"]] = {
                **base,
                "style_share": float(style or 0.0),
                "residual_share": float(idio or 0.0),
            }
        else:
            out[r["symbol"]] = {
                **base,
                "style_share": None,
                "residual_share": float(r["l3_res_er"] or 0.0),
            }
    return out


def _share_or_fallback(
    shares: dict[str, float | None],
    key: str,
    fallback: float | None,
) -> float | None:
    if not shares:
        return fallback
    v = shares.get(key)
    return fallback if v is None else float(v)


def enrich_fund_data(fd: Any) -> Any:
    """Resolve tickers / sector ETFs / per-stock L3 shares for holdings.

    Soft-fails to an unchanged ``FundData`` when credentials are missing.
    Historical as-of (G.44): skip the current-model L3 overlay — latest
    ``security_history_latest`` shares are not point-in-time. Ticker /
    identity fill still runs.
    """
    from riskmodels.snapshots import FundHolding

    if not getattr(fd, "holdings", None):
        # Still try identity fill when holdings empty but ticker missing.
        return _enrich_identity(fd)

    historical = bool(
        getattr(fd, "historical_degradations", None)
        or getattr(fd, "as_of_requested", None)
    )
    syms = [h.symbol for h in fd.holdings]
    ticker_map = _resolve_holdings_metadata(syms)
    l3_map: dict[str, dict[str, float | None]] = (
        {} if historical else _resolve_l3_decomposition(syms)
    )
    new_holdings = []
    for h in fd.holdings:
        meta = ticker_map.get(h.symbol, {})
        shares = l3_map.get(h.symbol, {})
        new_holdings.append(
            FundHolding(
                symbol=h.symbol,
                ticker=meta.get("ticker") or h.ticker,
                company_name=(meta.get("name") or meta.get("ticker") or h.company_name),
                weight=h.weight,
                sector_etf=meta.get("sector_etf") or h.sector_etf,
                subsector_etf=meta.get("subsector_etf") or h.subsector_etf,
                market_share=_share_or_fallback(shares, "market_share", h.market_share),
                sector_share=_share_or_fallback(shares, "sector_share", h.sector_share),
                subsector_share=_share_or_fallback(
                    shares, "subsector_share", h.subsector_share
                ),
                style_share=_share_or_fallback(shares, "style_share", h.style_share),
                residual_share=_share_or_fallback(
                    shares, "residual_share", h.residual_share
                ),
            )
        )
    fd = replace(fd, holdings=new_holdings)
    return _enrich_identity(fd)


def _enrich_identity(fd: Any) -> Any:
    """Fill ticker / fund_name from private ``funds`` table when local json missing."""
    bw_fund_id = getattr(fd, "bw_fund_id", None) or getattr(fd, "fund_id", None)
    if not bw_fund_id:
        return fd
    ticker_attr = "ticker_primary" if hasattr(fd, "ticker_primary") else (
        "ticker" if hasattr(fd, "ticker") else None
    )
    needs_ticker = bool(ticker_attr) and not getattr(fd, ticker_attr, None)
    needs_name = not getattr(fd, "fund_name", None) and not getattr(fd, "name", None)
    if not (needs_ticker or needs_name):
        return fd
    row = fund_identity_from_supabase(str(bw_fund_id))
    if not row:
        return fd
    updates: dict[str, Any] = {}
    if needs_ticker and row.get("ticker") and ticker_attr:
        updates[ticker_attr] = row["ticker"]
    if needs_name and row.get("fund_name"):
        if hasattr(fd, "fund_name"):
            updates["fund_name"] = row["fund_name"]
        elif hasattr(fd, "name"):
            updates["name"] = row["fund_name"]
    if not updates:
        return fd
    try:
        return replace(fd, **updates)
    except TypeError:
        return fd
