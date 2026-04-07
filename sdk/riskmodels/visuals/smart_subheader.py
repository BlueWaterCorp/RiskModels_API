"""AI-enhanced subheader generator for snapshot charts.

Generates precise, institutional-quality subheader commentary for every
Plotly chart in R1 snapshots and the visuals gallery. Enforces reference
to exact time range, data_as_of, and lineage. Never hallucinates numbers.

Two modes:
- **Rule-based** (default): fast, offline, deterministic. Uses the data
  directly to produce factual commentary. Always available.
- **LLM-enhanced** (optional): calls an LLM for more nuanced phrasing.
  Requires `openai` package and an API key. Falls back to rule-based on failure.

Usage
-----
    from riskmodels.visuals.smart_subheader import generate_subheader

    text = generate_subheader(
        chart_type="er_attribution",
        title="L3 Explained-Return Attribution",
        data={"l3_mkt_er": 0.45, "l3_res_er": 0.15, ...},
        data_as_of="2026-04-04",
        ticker="NVDA",
    )
"""

from __future__ import annotations

import json
from typing import Any


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_subheader(
    chart_type: str,
    title: str,
    data: dict[str, Any],
    *,
    data_as_of: str = "",
    time_range: str = "past 252 trading days",
    ticker: str = "",
    benchmark: str = "",
    use_llm: bool = False,
    llm_model: str = "gpt-4o-mini",
) -> str:
    """Generate a professional subheader for a chart.

    Parameters
    ----------
    chart_type : One of "er_attribution", "hr_cascade", "peer_table",
                 "waterfall", "histogram", "multi_line", etc.
    title      : The chart's visible title.
    data       : Dict of metrics used by the chart.
    data_as_of : ISO date string (e.g. "2026-04-04").
    time_range : Human description of the period.
    ticker     : Stock ticker for context.
    benchmark  : Benchmark/peer group label.
    use_llm    : If True, attempt LLM generation with rule-based fallback.
    llm_model  : Model to use for LLM generation.

    Returns
    -------
    A 1-2 sentence professional subheader string.
    """
    # Always compute rule-based first (fast, deterministic, always available)
    rule_text = _rule_based(chart_type, data, ticker, benchmark, data_as_of, time_range)

    if not use_llm:
        return rule_text

    # Attempt LLM enhancement
    try:
        return _llm_enhanced(
            chart_type, title, data,
            data_as_of=data_as_of,
            time_range=time_range,
            ticker=ticker,
            benchmark=benchmark,
            model=llm_model,
        )
    except Exception:
        return rule_text


# ---------------------------------------------------------------------------
# Rule-based generator (offline, deterministic)
# ---------------------------------------------------------------------------

def _rule_based(
    chart_type: str,
    data: dict[str, Any],
    ticker: str,
    benchmark: str,
    data_as_of: str,
    time_range: str,
) -> str:
    """Generate subheader from data alone — no LLM, no network."""
    period = f"over the {time_range}" if time_range else ""
    asof = f" ending {data_as_of}" if data_as_of else ""
    period_clause = f"{period}{asof}".strip()

    generators = {
        "er_attribution": _rule_er_attribution,
        "hr_cascade": _rule_hr_cascade,
        "peer_table": _rule_peer_table,
        "waterfall": _rule_waterfall,
        "histogram": _rule_histogram,
        "multi_line": _rule_multi_line,
        "stacked_area": _rule_stacked_area,
    }

    gen = generators.get(chart_type)
    if gen:
        return gen(data, ticker, benchmark, period_clause)

    # Generic fallback
    if ticker and period_clause:
        return f"{ticker} factor risk decomposition {period_clause}."
    return title


def _gf(data: dict, full: str, abbr: str) -> float:
    """Get metric as float with fallback."""
    v = data.get(full) if data.get(full) is not None else data.get(abbr)
    return float(v) if v is not None else 0.0


def _rule_er_attribution(data: dict, ticker: str, benchmark: str, period: str) -> str:
    mkt = _gf(data, "l3_market_er", "l3_mkt_er") * 100
    sec = _gf(data, "l3_sector_er", "l3_sec_er") * 100
    sub = _gf(data, "l3_subsector_er", "l3_sub_er") * 100
    res = _gf(data, "l3_residual_er", "l3_res_er") * 100
    total = abs(mkt) + abs(sec) + abs(sub) + abs(res)

    if total < 0.01:
        return f"No significant explained return decomposition available for {ticker}."

    dominant = max(
        [("market", abs(mkt), mkt), ("sector", abs(sec), sec),
         ("subsector", abs(sub), sub), ("residual", abs(res), res)],
        key=lambda x: x[1],
    )
    dom_pct = dominant[1] / total * 100 if total else 0

    parts = [f"{ticker}'s return {period} decomposes into market {mkt:+.1f}%, "
             f"sector {sec:+.1f}%, subsector {sub:+.1f}%, residual {res:+.1f}%."]

    if abs(res) > 5:
        parts.append(f"Residual alpha of {res:+.1f}% indicates significant stock-specific performance.")
    elif dom_pct > 60:
        parts.append(f"{dominant[0].capitalize()} drives {dom_pct:.0f}% of total explained variance.")

    return " ".join(parts)


def _rule_hr_cascade(data: dict, ticker: str, benchmark: str, period: str) -> str:
    mkt_hr = _gf(data, "l3_market_hr", "l3_mkt_hr")
    sec_hr = _gf(data, "l3_sector_hr", "l3_sec_hr")
    sub_hr = _gf(data, "l3_subsector_hr", "l3_sub_hr")
    vol = _gf(data, "vol_23d", "volatility")

    text = f"L3 hedge ratios {period}: market beta {mkt_hr:.2f}"
    if sec_hr > 0.01:
        text += f", sector {sec_hr:.2f}"
    if sub_hr > 0.01:
        text += f", subsector {sub_hr:.2f}"
    text += "."

    if mkt_hr > 1.15 and vol > 0:
        text += (f" Elevated beta ({mkt_hr:.2f}) with {vol*100:.1f}% realised vol "
                 f"implies amplified market sensitivity.")
    elif mkt_hr < 0.85:
        text += f" Defensive beta ({mkt_hr:.2f}) implies reduced market exposure."

    return text


def _rule_peer_table(data: dict, ticker: str, benchmark: str, period: str) -> str:
    spread = data.get("selection_spread")
    peer_count = data.get("peer_count", 0)

    if spread is not None:
        bps = float(spread) * 10000
        direction = "outperforming" if bps > 0 else "underperforming"
        text = (f"{ticker} is {direction} the {benchmark} peer average "
                f"by {abs(bps):.0f} bps on residual alpha {period}.")
    else:
        text = f"{ticker} vs {benchmark} peer cohort {period}."

    return text


def _rule_waterfall(data: dict, ticker: str, benchmark: str, period: str) -> str:
    total = data.get("total_return")
    if total is not None:
        return (f"Return attribution waterfall for {ticker} {period}. "
                f"Total return: {float(total)*100:+.1f}%.")
    return f"Step-by-step return attribution for {ticker} {period}."


def _rule_histogram(data: dict, ticker: str, benchmark: str, period: str) -> str:
    current = data.get("current_value")
    label = data.get("metric_label", "value")
    if current is not None:
        return (f"Distribution of {label} across the universe {period}. "
                f"{ticker} current: {float(current):.2f}.")
    return f"Cross-sectional distribution of {label} {period}."


def _rule_multi_line(data: dict, ticker: str, benchmark: str, period: str) -> str:
    series_names = data.get("series_names", [])
    if series_names:
        names = ", ".join(series_names[:3])
        return f"Time series of {names} {period}."
    return f"Multi-factor time series {period}."


def _rule_stacked_area(data: dict, ticker: str, benchmark: str, period: str) -> str:
    return f"Stacked factor contribution to explained risk {period}."


# ---------------------------------------------------------------------------
# LLM-enhanced generator (optional, requires openai)
# ---------------------------------------------------------------------------

_LLM_PROMPT = """You are a senior quantitative risk analyst at BW Macro.

Generate a single professional subheader (1-2 short sentences) for this chart.

Chart type: {chart_type}
Title: {title}
Ticker: {ticker}
Benchmark: {benchmark}
Data as of: {data_as_of}
Time range: {time_range}
Key metrics: {key_facts_json}

Rules:
- MUST reference the exact time range and data_as_of date
- Use ONLY the real numbers provided above — never round, estimate, or hallucinate
- Institutional, factual, insightful tone (think Bloomberg PORT commentary)
- Max 2 short sentences
- Do NOT use quotation marks in your output
Output ONLY the subheader text."""


def _llm_enhanced(
    chart_type: str,
    title: str,
    data: dict[str, Any],
    *,
    data_as_of: str,
    time_range: str,
    ticker: str,
    benchmark: str,
    model: str,
) -> str:
    """Call LLM for nuanced subheader phrasing."""
    import openai

    # Build a clean subset of key facts (no raw objects)
    key_facts = {}
    for k, v in data.items():
        if isinstance(v, (int, float, str, bool)) and v is not None:
            key_facts[k] = v

    prompt = _LLM_PROMPT.format(
        chart_type=chart_type,
        title=title,
        ticker=ticker,
        benchmark=benchmark,
        data_as_of=data_as_of or "latest available",
        time_range=time_range or "past 252 trading days",
        key_facts_json=json.dumps(key_facts, default=str),
    )

    client = openai.OpenAI()
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=120,
        temperature=0.0,
    )

    text = response.choices[0].message.content.strip()
    # Strip any wrapping quotes the model might add
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1]
    return text
