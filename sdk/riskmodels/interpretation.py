"""Risk Interpretation — public Judgment shape + bland numeric stub.

This module is the public boundary of the risk-interpretation system.
The editorial engine (qualifier vocabulary, threshold tables, flag
predicates, peer-placement phrasing) lives privately at
``bwmacro/risk_interpretation/`` and is wired into the snapshot
renderers via the ``judgment`` parameter on the public render entry
points.

What is here:

    Judgment                 — frozen dataclass; the contract every
                               consumer (snapshot, chat, API) reads.
    INTERPRETER_VERSION      — bump when the schema or the public
                               feature dictionary changes shape.
    compute_features(data)   — pure numeric extraction from a DDData-shaped
                               object (structurally typed); no qualifiers,
                               no states, no flags.
    derive_default_judgment  — bland public stub. Renders text fields
                               using raw numerics only — no editorial
                               vocabulary. SDK community uses this when
                               BWMACRO is not available.

What is NOT here (and must not be added):

    - Qualifier vocabulary ("Strong", "Solid", "Muted", "beta-driven",
      "ranks near the top of the cohort", etc.).
    - Threshold tables that map features to states (e.g. "residual
      share > 0.5 → idiosyncratic").
    - Flag predicates ("high_residual_negative", "industry_tailwind").

All of the above live in BWMACRO. If you need to add or change
interpretation rules, work there. See
``.cursor/skills/risk-judgment-shape/SKILL.md`` for the boundary spec.
"""

from __future__ import annotations

import math as _math
from dataclasses import dataclass, field
from typing import Any

from .mapping import first_present as _g

# DDData lives privately in BWMACRO post-PR 3. This module is structurally typed:
# any object exposing ``.p1.metrics``, ``.peer_comparison``, etc. works at runtime.


INTERPRETER_VERSION = "v1"


@dataclass(frozen=True)
class Judgment:
    """Canonical interpretation object passed into snapshot renderers.

    Consumers read ``text`` (always populated) and may also use
    ``features``, ``states``, and ``flags`` for richer downstream
    rendering. The bland public stub fills only ``features`` and
    ``text``; the BWMACRO engine fills all four.
    """

    version: str = INTERPRETER_VERSION
    as_of: str = ""
    ticker: str = ""
    features: dict[str, Any] = field(default_factory=dict)
    text: dict[str, str] = field(default_factory=dict)
    states: dict[str, str] = field(default_factory=dict)
    flags: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Pure feature extraction — same numerics whether the bland stub or the
# BWMACRO engine consumes it. No qualifiers, no thresholds, no editorial.
# ---------------------------------------------------------------------------



def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if _math.isfinite(f) else None


def compute_features(data: Any) -> dict[str, Any]:
    """Extract numeric features from a DDData-shaped object. Pure; no API calls.

    Returns a flat dict suitable for both the bland stub renderer and
    the BWMACRO interpretation engine. Values are ``None`` when the
    underlying source is unavailable; callers should handle that.
    """
    p1 = data.p1
    m = data.metrics

    # ── Per-window explained-risk shares (L3 ER decomposition) ──
    mkt_er = _to_float(_g(m, "l3_market_er", "l3_mkt_er")) or 0.0
    sec_er = _to_float(_g(m, "l3_sector_er", "l3_sec_er")) or 0.0
    sub_er = _to_float(_g(m, "l3_subsector_er", "l3_sub_er")) or 0.0
    res_er = _to_float(_g(m, "l3_residual_er", "l3_res_er")) or 0.0
    sys_share = mkt_er + sec_er + sub_er

    # ── Geometric attribution over the l3_er_series window ──
    geo_sys_pct: float | None = None
    geo_res_pct: float | None = None
    geo_gross_pct: float | None = None
    if p1.l3_er_series:
        prod_l3 = 1.0
        prod_gross = 1.0
        for _d, _mkt, _sec, _sub, _res in p1.l3_er_series:
            prod_l3 *= (1 + _mkt + _sec + _sub)
            prod_gross *= (1 + _mkt + _sec + _sub + _res)
        geo_sys_pct = (prod_l3 - 1.0) * 100.0
        geo_res_pct = (prod_gross - prod_l3) * 100.0
        geo_gross_pct = (prod_gross - 1.0) * 100.0

    # ── Volatility ──
    vol = _to_float(_g(m, "vol_23d", "volatility", "annualized_volatility"))
    if vol is None:
        sv = _to_float(m.get("stock_var"))
        if sv is not None and sv > 0:
            vol = _math.sqrt(sv * 252.0)
    # Some upstream sources express vol in pct rather than fraction
    if vol is not None and vol > 1.5:
        vol = vol / 100.0
    res_vol = (vol * _math.sqrt(max(res_er, 1e-6))) if vol is not None else None

    # ── Trailing returns (TTM and shorter) ──
    ttm = _to_float((p1.tr_stock or {}).get("1y"))
    ttm_spy = _to_float((p1.tr_spy or {}).get("1y"))
    ttm_sec = _to_float((p1.tr_sector or {}).get("1y"))
    ttm_sub = _to_float((p1.tr_subsector or {}).get("1y"))
    ttm_bench = ttm_sub if ttm_sub is not None else ttm_sec

    # ── Peer rank percentiles (target's row in the subsector cohort) ──
    rank_resid_pct: float | None = None
    rank_gross_pct: float | None = None
    rk = (p1.rankings or {}).get("252d_subsector_subsector_residual") or {}
    rank_resid_pct = _to_float(rk.get("rank_percentile"))
    rk_g = (p1.rankings or {}).get("252d_subsector_gross_return") or {}
    rank_gross_pct = _to_float(rk_g.get("rank_percentile"))

    # Fall back to peer_rankings dict if the structured ranking row
    # wasn't populated (different code paths fill these in).
    if rank_resid_pct is None and (data.peer_rankings or {}).get(p1.ticker):
        _, _r = data.peer_rankings[p1.ticker]
        rank_resid_pct = _to_float(_r)
    if rank_gross_pct is None and (data.peer_rankings or {}).get(p1.ticker):
        _g_r, _ = data.peer_rankings[p1.ticker]
        rank_gross_pct = _to_float(_g_r)

    # ── Residual Sharpe (3Y) — from peer_sharpes if target row populated ──
    sharpe_resid_3y: float | None = None
    target_sharpes = (data.peer_sharpes or {}).get(p1.ticker)
    if target_sharpes is not None and len(target_sharpes) >= 2:
        sharpe_resid_3y = _to_float(target_sharpes[1])

    return {
        # Explained-risk shares
        "residual_share":  res_er,
        "market_share":    mkt_er,
        "sector_share":    sec_er,
        "subsector_share": sub_er,
        "systematic_share": sys_share,

        # Geometric attribution over the window
        "geo_gross_return_pct":      geo_gross_pct,
        "geo_systematic_return_pct": geo_sys_pct,
        "geo_residual_return_pct":   geo_res_pct,

        # Volatility
        "annualized_vol":  vol,
        "residual_vol":    res_vol,

        # TTM total returns
        "ttm_return_pct":             None if ttm is None else ttm * 100.0,
        "ttm_spy_return_pct":         None if ttm_spy is None else ttm_spy * 100.0,
        "ttm_sector_return_pct":      None if ttm_sec is None else ttm_sec * 100.0,
        "ttm_subsector_return_pct":   None if ttm_sub is None else ttm_sub * 100.0,
        "ttm_vs_spy_pp":              None if (ttm is None or ttm_spy is None)
                                          else (ttm - ttm_spy) * 100.0,
        "ttm_vs_benchmark_pp":        None if (ttm is None or ttm_bench is None)
                                          else (ttm - ttm_bench) * 100.0,

        # Peer rank percentiles (100 = best in cohort)
        "residual_rank_pct": rank_resid_pct,
        "gross_rank_pct":    rank_gross_pct,
        "residual_sharpe_3y": sharpe_resid_3y,
    }


# ---------------------------------------------------------------------------
# Narrative boundary — no recommendation language in a Judgment
#
# The Analyst illuminates risk structure and reports model outputs (including
# hedge ratios *as math*); it never recommends a specific trade / hedge /
# rebalance, never assesses suitability, never reasons about the user's personal
# circumstances. See THE_ANALYST.md §2 (BWMACRO). Same class of guard as the
# no-mock-data rule: a Judgment whose deterministic narrative text trips this
# fails CI (`contract_check`). The BWMACRO editorial engine imports the same
# check so it can't ship recommendation-laden text either.
# ---------------------------------------------------------------------------

# Unambiguous recommendation framings. Low false-positive on purpose — we flag
# *advice framing* ("you should …", "we recommend …", "consider buying …"), not
# the bare words "buy"/"sell"/"hedge", which appear in legitimate descriptions
# ("the L3 market hedge ratio is 0.62", "buyers and sellers").
_RECOMMENDATION_MARKERS: tuple[str, ...] = (
    "you should", "you shouldn't", "you ought to", "you need to", "you must ",
    "you'll want to", "you will want to", "you might want to", "you may want to",
    "you could trim", "you could buy", "you could sell", "you could hedge",
    "you could rebalance", "you could add", "you could reduce",
    "we recommend", "we'd recommend", "we would recommend", "i recommend",
    "i'd recommend", "we suggest you", "we suggest that you", "i suggest you",
    "we'd suggest", "i'd suggest", "we advise", "i advise",
    "our recommendation", "our advice", "is recommended", "is advised",
    "consider buying", "consider selling", "consider trimming",
    "consider hedging", "consider rebalancing", "consider adding",
    "consider reducing", "consider rotating",
)


def recommendation_language_violations(text: str | None) -> list[str]:
    """Return the recommendation-framing markers found in ``text`` (case-insensitive).

    Empty list ⇒ clean. See the section comment above for the boundary.
    """
    if not text:
        return []
    low = text.lower()
    return [m for m in _RECOMMENDATION_MARKERS if m in low]


def judgment_narrative_violations(judgment: Judgment) -> list[str]:
    """Scan a Judgment's deterministic narrative text fields for recommendation
    language. Returns ``["text.<field>: '<marker>'", ...]`` — empty when clean.

    Only the free-text ``text`` dict is scanned; ``states``/``flags`` are
    machine labels, not prose.
    """
    out: list[str] = []
    for field_name, value in (judgment.text or {}).items():
        if not isinstance(value, str):
            continue
        for marker in recommendation_language_violations(value):
            out.append(f"text.{field_name}: {marker!r}")
    return out


# ---------------------------------------------------------------------------
# Bland public stub — raw numerics, no editorial vocabulary
# ---------------------------------------------------------------------------

def _fmt_pct(v: float | None, *, sign: bool = False, decimals: int = 1) -> str:
    if v is None:
        return "n/a"
    if sign:
        return f"{v:+.{decimals}f}%"
    return f"{v:.{decimals}f}%"


def _fmt_int(v: float | None) -> str:
    if v is None:
        return "n/a"
    return f"{int(round(v))}"


def derive_default_judgment(data: Any) -> Judgment:
    """Public stub — produces a Judgment whose ``text`` is purely numeric.

    Used when no BWMACRO judgment is injected into the renderer. SDK
    community callers see accurate raw figures with no editorial
    qualifiers; the BWMACRO engine produces the qualifier-rich version
    that ships in the production snapshots.
    """
    f = compute_features(data)
    ticker = data.ticker
    bench = data.subsector_etf or data.sector_etf or "benchmark"

    sys_share_pct = (f["systematic_share"] or 0.0) * 100.0
    res_share_pct = (f["residual_share"] or 0.0) * 100.0
    rank_resid = f["residual_rank_pct"]

    headline = (
        f"{ticker} — systematic {sys_share_pct:.0f}%, "
        f"residual {_fmt_pct(f['geo_residual_return_pct'], sign=True)}, "
        f"peer rank {_fmt_int(rank_resid)} vs {bench}."
    )

    cum_insight = (
        f"{ticker} ({_fmt_pct(f['geo_gross_return_pct'], sign=True)} net): "
        f"factor bridge — systematic "
        f"{_fmt_pct(f['geo_systematic_return_pct'], sign=True)}, "
        f"residual {_fmt_pct(f['geo_residual_return_pct'], sign=True)} "
        f"(geometric attribution)."
    )

    res_vol_pct = (f["residual_vol"] or 0.0) * 100.0 if f["residual_vol"] is not None else None
    alpha_quality_insight = (
        f"{ticker} — residual return "
        f"{_fmt_pct(f['geo_residual_return_pct'], sign=True)}, "
        f"residual vol {_fmt_pct(res_vol_pct)}, "
        f"peer rank {_fmt_int(rank_resid)}/100."
    )

    dna_insight = (
        f"{ticker} — residual share {res_share_pct:.0f}%, "
        f"residual rank {_fmt_int(rank_resid)}/100 in {bench} cohort."
    )

    summary_parts = [
        f"{ticker} delivered {_fmt_pct(f['ttm_return_pct'], sign=True)} TTM",
    ]
    if f["ttm_spy_return_pct"] is not None:
        summary_parts.append(
            f"(SPY {_fmt_pct(f['ttm_spy_return_pct'], sign=True)}, "
            f"{_fmt_pct(f['ttm_vs_spy_pp'], sign=True)} vs SPY)"
        )
    summary_parts.append(
        f"Systematic {sys_share_pct:.0f}%, "
        f"residual {_fmt_pct(f['geo_residual_return_pct'], sign=True)}; "
        f"peer rank {_fmt_int(rank_resid)}/100."
    )
    summary = ". ".join(summary_parts) + "."

    return Judgment(
        version=INTERPRETER_VERSION,
        as_of=data.teo,
        ticker=ticker,
        features=f,
        text={
            "headline": headline,
            "cum_insight": cum_insight,
            "alpha_quality_insight": alpha_quality_insight,
            "dna_insight": dna_insight,
            "summary": summary,
        },
        states={},
        flags=[],
    )


__all__ = [
    "INTERPRETER_VERSION",
    "Judgment",
    "compute_features",
    "derive_default_judgment",
    "recommendation_language_violations",
    "judgment_narrative_violations",
]
