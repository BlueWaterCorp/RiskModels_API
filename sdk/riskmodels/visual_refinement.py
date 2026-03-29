"""Recursive Visual Refinement — MatPlotAgent Pattern.

Automates the loop between Python execution and Vision-LLM feedback for
professional financial visualization using the RiskModels SDK.
"""

from __future__ import annotations

import base64
import os
import re
import subprocess
import tempfile
import textwrap
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

import pandas as pd

if TYPE_CHECKING:
    from .client import RiskModelsClient


# Financial styling standards — wire key → semantic alias
SEMANTIC_FIELD_MAP: dict[str, str] = {
    "l3_mkt_hr": "l3_market_hr",
    "l3_sec_hr": "l3_sector_hr",
    "l3_sub_hr": "l3_subsector_hr",
    "l3_mkt_er": "l3_market_er",
    "l3_sec_er": "l3_sector_er",
    "l3_sub_er": "l3_subsector_er",
    "l3_res_er": "l3_residual_er",
}

# Color standards for financial risk visualization
FINANCIAL_COLOR_STANDARDS: dict[str, str] = {
    "market_risk": "#4B0082",  # Indigo for Market Risk (SPY)
    "sector_risk": "#228B22",  # Green for Sector
    "residual_risk": "#808080",  # Gray for Idiosyncratic/Residual
    "subsector_risk": "#4169E1",  # Royal Blue for Subsector
}

# GitHub-flavored contrast (README light/dark backgrounds)
GITHUB_LIGHT = {
    "canvas": "#f6f8fa",
    "fg": "#24292f",
    "muted": "#6e7781",
    "green": "#1a7f37",
    "red": "#cf222e",
}
GITHUB_DARK = {
    "canvas": "#0d1117",
    "fg": "#e6edf3",
    "muted": "#8b949e",
    "green": "#3fb950",
    "red": "#f85149",
}

# README / GitHub dark-mode embeds: high-contrast, matches github.com dark UI (#0d1117)
README_DARK = {
    "canvas": "#0d1117",
    "surface": "#161b22",
    "fg": "#e6edf3",
    "muted": "#8b949e",
    "hill_fill": "#238636",
    "hill_line": "#3fb950",
    "needle": "#58a6ff",
    "cell_edge": "#30363d",
    "bar_muted_line": "#484f58",
    "accent_purple": "#8957e5",
    "accent_blue": "#58a6ff",
    "accent_green": "#3fb950",
    "positive": "#3fb950",
    "negative": "#f85149",
    "brand": "#79c0ff",
}

GitHubChartTheme = Literal["github_light", "github_dark", "transparent", "readme_dark"]

MacroChartStyle = Literal["light", "readme_dark"]

# System context for the agent
SYSTEM_CONTEXT = """You are a Quant Visual Auditor specialized in financial data visualization.

SDK USAGE RULES:
- ALWAYS use semantic field names: l3_market_hr, l3_sector_hr, l3_subsector_hr (NOT wire keys like l3_mkt_hr)
- Use client.get_l3_decomposition() for factor decomposition data
- Use client.get_ticker_returns() for returns data
- Use client.get_rankings(ticker) for cross-sectional rank_percentile by universe / sector / subsector;
  use save_ranking_percentile_bar_chart() for cohort bars or save_ranking_chart() for a single “needle” on 0–100
- For README / GitHub embedding: save PNGs with transparent=True (and bbox_inches='tight') unless a solid theme is required

FINANCIAL COLOR STANDARDS (MUST FOLLOW):
- Market Risk (SPY): Indigo (#4B0082)
- Sector Risk: Green (#228B22)
- Idiosyncratic/Residual Risk: Gray (#808080)
- Subsector Risk: Royal Blue (#4169E1)

GRAPH REQUIREMENTS:
1. No overlapping text or labels
2. Financial axes must be clearly legible with proper formatting
3. Legend must be accurate and not obscure data
4. Professional styling suitable for institutional presentations
5. Use plt.tight_layout() to prevent clipping
6. For rankings: cohort order universe → sector → subsector; x-axis rank_percentile (0–100, 100=best)
7. For GitHub README/PR embeds, prefer PNG with transparent=True and bbox_inches='tight'

Your response must be either:
- "COMPLETE" if the graph meets all professional standards
- Specific code-fix instructions otherwise
"""

# Evaluation prompt template
EVALUATION_PROMPT = """Act as a Quant Visual Auditor. Review this financial graph for:

1. OVERLAPPING TEXT/LABELS: Check axis labels, tick labels, titles, and legends for any overlap
2. LEGIBILITY OF FINANCIAL AXES: Verify percentage signs, dollar formatting, date formatting, and scale clarity
3. LEGEND ACCURACY: Confirm legend matches plotted data and uses standard RiskModels terminology
4. PROFESSIONAL STYLING: Check color scheme (Indigo=Market, Green=Sector, Gray=Residual), font sizes, and overall polish

If the graph is perfect in all aspects, reply with exactly: COMPLETE

Otherwise, provide specific, actionable code-fix instructions. Be concise and technical.
"""

# Refinement prompt template
REFINEMENT_PROMPT = """The previous visualization code had issues. Review the feedback below and provide corrected Python code.

FEEDBACK FROM AUDITOR:
{feedback}

RULES FOR CORRECTED CODE:
1. Generate a complete, executable Python script
2. Use the RiskModels SDK: client = RiskModelsClient.from_env()
3. Use semantic field names (l3_market_hr, not l3_mkt_hr)
4. Follow financial color standards: Market=Indigo, Sector=Green, Residual=Gray
5. Save the output to: {output_path}
6. Include plt.tight_layout() before saving
7. For PNGs intended for GitHub README/Issues, use fig.savefig(..., transparent=True, bbox_inches='tight', dpi=150)
8. Add appropriate title, labels, and legend

Provide ONLY the Python code, no markdown formatting or explanations.
"""

# Initial plot generation prompt
INITIAL_PLOT_PROMPT = """Generate Python code to create a professional financial visualization using the RiskModels SDK.

PLOT REQUIREMENTS:
{plot_description}

SDK USAGE:
- Use: from riskmodels import RiskModelsClient; client = RiskModelsClient.from_env()
- Use semantic names: l3_market_hr, l3_sector_hr, l3_subsector_hr, l3_residual_er
- Fetch data using client.get_l3_decomposition() or client.get_ticker_returns()
- For ranking percentile bars: df = client.get_rankings('TICKER'); slice one metric+window; then save_ranking_percentile_bar_chart(slice, path, ...)

STYLING REQUIREMENTS:
- Market Risk (SPY): Indigo (#4B0082)
- Sector Risk: Green (#228B22)
- Residual/Idiosyncratic Risk: Gray (#808080)
- Subsector Risk: Royal Blue (#4169E1)
- Use plt.tight_layout() to prevent clipping
- Professional fonts and sizing
- For GitHub markdown embeds, prefer transparent=True on savefig with bbox_inches='tight'

OUTPUT:
Save the figure to: {output_path} (use transparent=True for README-friendly PNGs when appropriate)
Provide ONLY the Python code, no markdown formatting or explanations.
"""


_COHORT_BAR_ORDER = ["universe", "sector", "subsector"]
_COHORT_BAR_COLORS: dict[str, str] = {
    "universe": FINANCIAL_COLOR_STANDARDS["market_risk"],
    "sector": FINANCIAL_COLOR_STANDARDS["sector_risk"],
    "subsector": FINANCIAL_COLOR_STANDARDS["subsector_risk"],
}


def save_ranking_percentile_bar_chart(
    df: pd.DataFrame,
    output_path: str,
    *,
    metric: str | None = None,
    window: str | None = None,
    title: str | None = None,
    ticker: str | None = None,
    transparent: bool = False,
    readme_dark: bool = False,
) -> str:
    """Horizontal bar chart of ``rank_percentile`` by ``cohort`` (universe / sector / subsector).

    Expects a slice of ``client.get_rankings()`` with columns ``cohort`` and ``rank_percentile``.
    Optional ``metric`` / ``window`` filter when those columns exist. Requires matplotlib.

    Returns:
        Path written (same as ``output_path``).
    """
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as e:  # pragma: no cover
        raise ImportError(
            "save_ranking_percentile_bar_chart requires matplotlib; pip install matplotlib",
        ) from e

    plot_df = df.copy()
    if metric is not None and "metric" in plot_df.columns:
        plot_df = plot_df.loc[plot_df["metric"].astype(str) == metric]
    if window is not None and "window" in plot_df.columns:
        plot_df = plot_df.loc[plot_df["window"].astype(str) == window]
    need = {"cohort", "rank_percentile"}
    if not need.issubset(plot_df.columns):
        raise ValueError(f"DataFrame must include columns {sorted(need)}")
    plot_df = plot_df.dropna(subset=["rank_percentile", "cohort"])
    if plot_df.empty:
        raise ValueError("No rows with non-null cohort and rank_percentile")

    def _cohort_key(c: str) -> int:
        s = str(c).lower()
        return _COHORT_BAR_ORDER.index(s) if s in _COHORT_BAR_ORDER else 99

    plot_df = plot_df.assign(_sort=plot_df["cohort"].map(_cohort_key)).sort_values("_sort")
    cohorts = [str(c) for c in plot_df["cohort"]]
    vals = plot_df["rank_percentile"].astype(float).tolist()
    colors = [_COHORT_BAR_COLORS.get(str(c).lower(), "#555555") for c in cohorts]
    if readme_dark:
        dark_bar = {
            "universe": README_DARK["accent_purple"],
            "sector": README_DARK["accent_green"],
            "subsector": README_DARK["accent_blue"],
        }
        colors = [dark_bar.get(str(c).lower(), README_DARK["muted"]) for c in cohorts]

    n_bars = max(len(cohorts), 1)
    fig_h = max(2.4, 1.0 * n_bars + 1.0) if readme_dark else max(2.2, 0.9 * n_bars + 1.0)
    fig, ax = plt.subplots(figsize=(10.0 if readme_dark else 8.0, fig_h))
    if readme_dark:
        bg = README_DARK["canvas"]
        fig.patch.set_facecolor(bg)
        ax.set_facecolor(bg)
    elif transparent:
        fig.patch.set_facecolor("none")
        ax.set_facecolor("none")

    y_pos = list(range(len(cohorts)))
    bar_h = 0.6 if readme_dark else 0.55
    bars = ax.barh(y_pos, vals, color=colors, height=bar_h, zorder=3)
    if readme_dark:
        for bar, c in zip(bars, colors):
            bar.set_edgecolor(c)
            bar.set_linewidth(0)
            bar.set_alpha(0.85)

    for i, (v, c) in enumerate(zip(vals, colors)):
        label = f"{v:.1f}%"
        x_pos = v + 1.5 if v < 85 else v - 6.0
        txt_c = README_DARK["fg"] if readme_dark else "#333333"
        ax.text(x_pos, i, label, va="center", ha="left" if v < 85 else "right",
                fontsize=12 if readme_dark else 10, fontweight="bold", color=txt_c, zorder=5)

    ax.set_yticks(y_pos)
    ax.set_yticklabels([c.title() for c in cohorts])
    ax.set_xlim(0, 105)
    if readme_dark:
        ax.axvline(50, color=README_DARK["cell_edge"], ls="--", lw=0.8, zorder=1)
        ax.set_xticks([0, 25, 50, 75, 100])
        ax.tick_params(axis="x", colors=README_DARK["muted"], labelsize=9)
        ax.tick_params(axis="y", colors=README_DARK["fg"], labelsize=11, length=0)
        for s in ax.spines.values():
            s.set_visible(False)
    else:
        ax.axvline(50, color="#cccccc", ls="--", lw=0.9)
        ax.set_xlabel("Rank percentile (100 = best)")

    parts: list[str] = []
    if ticker:
        parts.append(str(ticker))
    if metric:
        parts.append(str(metric))
    if window:
        parts.append(str(window))
    ttl = title or " — ".join(parts) or "Cross-sectional rank percentiles"
    if readme_dark:
        ax.set_title(ttl, color=README_DARK["fg"], fontsize=14, fontweight="bold", pad=14)
    else:
        ax.set_title(ttl)
    fig.tight_layout()
    fig.savefig(
        output_path,
        dpi=300 if readme_dark else 150,
        bbox_inches="tight",
        transparent=transparent and not readme_dark,
    )
    plt.close(fig)
    return output_path


def _ranking_percentile_from_mapping(ranking_data: Mapping[str, Any] | pd.Series) -> float:
    if isinstance(ranking_data, pd.Series):
        d = ranking_data.to_dict()
    else:
        d = dict(ranking_data)
    v = d.get("rank_percentile", d.get("percentile"))
    if v is None or (isinstance(v, float) and pd.isna(v)):
        raise ValueError("ranking_data must include rank_percentile or percentile")
    return float(v)


def _plot_ranking_needle_on_axes(
    ax: Any,
    ticker: str,
    pct: float,
    *,
    subtitle: str | None,
    theme: GitHubChartTheme,
) -> None:
    """Draw the rank-percentile needle on an existing matplotlib Axes."""
    import math

    import numpy as np
    from matplotlib.colors import LinearSegmentedColormap

    if theme == "github_light":
        pal = GITHUB_LIGHT
    elif theme == "github_dark":
        pal = GITHUB_DARK
    elif theme == "readme_dark":
        pal = README_DARK
    else:
        pal = GITHUB_LIGHT

    pct = max(0.0, min(100.0, float(pct)))
    is_dark = theme == "readme_dark"

    xs = np.linspace(0, 100, 500)
    mu, sigma = 50.0, 22.0
    ys = np.exp(-0.5 * ((xs - mu) / sigma) ** 2)
    ys = ys / ys.max()

    if is_dark:
        grad_cmap = LinearSegmentedColormap.from_list(
            "needle_grad", [README_DARK["negative"], "#f0e130", README_DARK["positive"]]
        )
        for i in range(len(xs) - 1):
            frac = xs[i] / 100.0
            c = grad_cmap(frac)
            ax.fill_between(
                xs[i : i + 2], 0, ys[i : i + 2], color=c, alpha=0.30, linewidth=0, zorder=1
            )
        ax.plot(xs, ys, color=pal["hill_line"], lw=2.2, zorder=2)

        ax.axvline(pct, color=pal["needle"], linewidth=3.5, zorder=5, alpha=0.9)
        for w, a in [(10.0, 0.08), (6.0, 0.15)]:
            ax.axvline(pct, color=pal["needle"], linewidth=w, zorder=4, alpha=a)

        y_n = math.exp(-0.5 * ((pct - mu) / sigma) ** 2)
        ax.scatter(
            [pct], [y_n], color=pal["needle"], s=110, zorder=7,
            edgecolors="#e6edf3", linewidths=1.2,
        )
        ax.annotate(
            f"{pct:.0f}%",
            xy=(pct, y_n),
            xytext=(pct + 4.0, y_n + 0.12),
            fontsize=12,
            fontweight="bold",
            color=pal["needle"],
            arrowprops={"arrowstyle": "-", "color": pal["muted"], "lw": 0.8},
            zorder=8,
        )
    else:
        fill_c = pal["green"] if theme != "transparent" else "#238636"
        ax.fill_between(xs, 0, ys, color=fill_c, alpha=0.38, linewidth=0)
        needle_c = pal["red"] if theme != "transparent" else "#f85149"
        ax.axvline(pct, color=needle_c, linewidth=3.0, zorder=5)

    ax.set_xlim(0, 100)
    ax.set_ylim(0, 1.18 if is_dark else 1.05)
    ax.set_yticks([])
    if is_dark:
        ax.set_xticks([0, 25, 50, 75, 100])
        ax.set_xticklabels(["0", "25", "50", "75", "100"])
        ax.tick_params(axis="x", colors=pal["muted"], labelsize=10)
        ax.axvline(50, color=pal["cell_edge"], lw=0.7, ls="--", zorder=0)
        for spine in ax.spines.values():
            spine.set_visible(False)
    else:
        ax.set_xticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)

    fg = pal["fg"]
    title_txt = f"{ticker} — universe rank: {pct:.1f}th percentile"
    title_fs = 15 if is_dark else 12
    ax.set_title(title_txt, color=fg, fontsize=title_fs, fontweight="bold", loc="left", pad=16 if is_dark else 12)
    if subtitle:
        ax.text(
            0.0, -0.40 if is_dark else -0.35, subtitle,
            transform=ax.transAxes, color=pal["muted"],
            fontsize=10 if is_dark else 9,
        )


def save_ranking_chart(
    ticker: str,
    ranking_data: Mapping[str, Any] | pd.Series,
    path: str = "ranking_snapshot.png",
    *,
    subtitle: str | None = None,
    theme: GitHubChartTheme = "github_light",
    transparent: bool | None = None,
    dpi: int = 150,
) -> str:
    """Single-ticker “needle” on a 0–100 cross-sectional scale (``rank_percentile``, 100 = best).

    Draws a light Gaussian “ghost” band and a vertical marker at the percentile. Optimized for
    static PNGs in GitHub README / Issues (no seaborn; matplotlib only).

    ``theme`` selects GitHub-like palettes; ``transparent`` defaults to True when ``theme`` is
    ``\"transparent\"``, else False.
    """
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as e:  # pragma: no cover
        raise ImportError("save_ranking_chart requires matplotlib; pip install matplotlib") from e

    pct = _ranking_percentile_from_mapping(ranking_data)
    if transparent is None:
        transparent = theme == "transparent"

    if theme == "github_light":
        pal = GITHUB_LIGHT
    elif theme == "github_dark":
        pal = GITHUB_DARK
    elif theme == "readme_dark":
        pal = README_DARK
    else:
        pal = GITHUB_LIGHT

    fig_w, fig_h = (10.0, 3.0) if theme == "readme_dark" else (8.0, 2.2)
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    if transparent:
        fig.patch.set_facecolor("none")
        ax.set_facecolor("none")
    else:
        fig.patch.set_facecolor(pal["canvas"])
        ax.set_facecolor(pal["canvas"])

    _plot_ranking_needle_on_axes(ax, ticker, pct, subtitle=subtitle, theme=theme)

    fig.tight_layout()
    fig.savefig(path, dpi=dpi, bbox_inches="tight", transparent=transparent)
    plt.close(fig)
    return path


def save_macro_heatmap(
    portfolio_df: pd.DataFrame,
    path: str = "macro_heatmap.png",
    *,
    title: str = "Portfolio macro sensitivity",
    annot: bool = True,
    figsize: tuple[float, float] = (10, 6),
    transparent: bool = False,
    dpi: int = 150,
) -> str:
    """Correlation heatmap for numeric columns (e.g. tickers × ``macro_corr_*`` or returns).

    Uses a red–yellow–green diverging map centered at zero. Matplotlib only (no seaborn).
    """
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.colors import TwoSlopeNorm
    except ImportError as e:  # pragma: no cover
        raise ImportError(
            "save_macro_heatmap requires matplotlib; pip install matplotlib",
        ) from e

    num = portfolio_df.select_dtypes(include=["number"])
    if num.shape[1] < 2:
        raise ValueError("portfolio_df needs at least two numeric columns for a correlation matrix")
    corr = num.corr()
    arr = corr.to_numpy(dtype=float)
    n, m = arr.shape
    norm = TwoSlopeNorm(vmin=-1.0, vcenter=0.0, vmax=1.0)

    fig, ax = plt.subplots(figsize=figsize)
    if transparent:
        fig.patch.set_facecolor("none")
        ax.set_facecolor("none")
    im = ax.imshow(arr, cmap="RdYlGn", norm=norm, aspect="auto")
    ax.set_xticks(range(m))
    ax.set_yticks(range(n))
    ax.set_xticklabels(list(corr.columns), rotation=45, ha="right")
    ax.set_yticklabels(list(corr.index))
    ax.set_title(title)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    if annot:
        for i in range(n):
            for j in range(m):
                val = arr[i, j]
                if val != val:  # NaN
                    continue
                t = f"{val:.2f}"
                ax.text(
                    j,
                    i,
                    t,
                    ha="center",
                    va="center",
                    color="#1a1a1a" if abs(val) < 0.55 else "#f6f8fa",
                    fontsize=8,
                )
    fig.tight_layout()
    fig.savefig(path, dpi=dpi, bbox_inches="tight", transparent=transparent)
    plt.close(fig)
    return path


def _factor_matrix_to_numeric(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce correlation cells to float and drop all-NaN columns.

    API/SDK frames sometimes use ``object`` dtype (strings from JSON, mixed batch rows),
    which ``select_dtypes(include=['number'])`` omits entirely.
    """
    if df.empty or df.shape[1] == 0:
        return df
    out = df.apply(lambda s: pd.to_numeric(s, errors="coerce"))
    out = out.loc[:, out.notna().any(axis=0)]
    return out


def _make_dark_diverging_cmap():
    """Red (#f85149) → dark center (#161b22) → green (#3fb950) diverging colourmap."""
    from matplotlib.colors import LinearSegmentedColormap

    return LinearSegmentedColormap.from_list(
        "rm_dark_div",
        ["#f85149", "#a83232", "#161b22", "#1a6d2e", "#3fb950"],
        N=256,
    )


def _draw_macro_sensitivity_matrix_on_axes(
    ax: Any,
    sensitivity: pd.DataFrame,
    *,
    title: str,
    annot: bool,
    style: MacroChartStyle = "light",
) -> None:
    """Draw a ticker * factor correlation matrix (values in ~[-1, 1]) on *ax*."""
    import numpy as np
    from matplotlib.colors import TwoSlopeNorm

    if sensitivity.shape[1] < 1:
        raise ValueError("sensitivity needs at least one factor column")
    arr = sensitivity.astype(float).to_numpy()
    n, m = arr.shape
    fig = ax.get_figure()

    if style == "readme_dark":
        pal = README_DARK
        ax.set_facecolor(pal["canvas"])
        cmap = _make_dark_diverging_cmap()
        norm = TwoSlopeNorm(vmin=-1.0, vcenter=0.0, vmax=1.0)

        x = np.arange(m + 1)
        y = np.arange(n + 1)
        im = ax.pcolormesh(
            x, y, arr, cmap=cmap, norm=norm, shading="flat",
            edgecolors=pal["cell_edge"], linewidths=2.0,
        )
        ax.set_xlim(0, m)
        ax.set_ylim(0, n)
        ax.invert_yaxis()
        ax.set_xticks(np.arange(m) + 0.5)
        ax.set_xticklabels(
            list(sensitivity.columns), rotation=0, ha="center",
            color=pal["fg"], fontsize=11, fontweight="bold",
        )
        ax.set_yticks(np.arange(n) + 0.5)
        ax.set_yticklabels(
            list(sensitivity.index), color=pal["fg"], fontsize=11, fontweight="bold",
        )
        ax.tick_params(axis="both", length=0)
        for s in ax.spines.values():
            s.set_visible(False)
        ax.set_title(title, color=pal["fg"], fontsize=15, fontweight="bold", pad=16)

        cbar = fig.colorbar(im, ax=ax, fraction=0.035, pad=0.03, shrink=0.85)
        cbar.ax.yaxis.set_tick_params(colors=pal["muted"], labelsize=9)
        cbar.outline.set_edgecolor(pal["cell_edge"])
        cbar.set_ticks([-1, -0.5, 0, 0.5, 1])
        cbar.set_ticklabels(["-1.0", "-0.5", "0", "+0.5", "+1.0"])
        if annot:
            for i in range(n):
                for j in range(m):
                    val = arr[i, j]
                    if val != val:
                        continue
                    sign = "+" if val > 0 else ""
                    t = f"{sign}{val:.2f}"
                    ax.text(
                        j + 0.5, i + 0.5, t, ha="center", va="center",
                        color="#e6edf3", fontsize=12, fontweight="bold",
                    )
        return

    norm = TwoSlopeNorm(vmin=-1.0, vcenter=0.0, vmax=1.0)
    im = ax.imshow(arr, cmap="RdYlGn", norm=norm, aspect="auto")
    ax.set_xticks(range(m))
    ax.set_yticks(range(n))
    ax.set_xticklabels(list(sensitivity.columns), rotation=35, ha="right")
    ax.set_yticklabels(list(sensitivity.index))
    ax.set_title(title)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    if annot:
        for i in range(n):
            for j in range(m):
                val = arr[i, j]
                if val != val:
                    continue
                ax.text(
                    j, i, f"{val:.2f}", ha="center", va="center",
                    color="#1a1a1a" if abs(val) < 0.55 else "#f6f8fa", fontsize=8,
                )


def save_macro_sensitivity_matrix(
    sensitivity: pd.DataFrame,
    path: str = "macro_sensitivity.png",
    *,
    title: str = "Macro factor sensitivity (L3 residual vs macro returns)",
    annot: bool = True,
    figsize: tuple[float, float] | None = None,
    transparent: bool = False,
    dpi: int = 150,
    style: MacroChartStyle = "light",
) -> str:
    """Heatmap of API ``macro_corr_*`` values: index = tickers, columns = factor labels.

    Expects a numeric matrix only (no extra metadata columns). Values are typically Pearson or
    Spearman correlations in ``[-1, 1]``.

    ``style=\"readme_dark\"`` uses GitHub dark UI colors (``#0d1117``), grid lines between cells,
    and bold annotations — intended for README embeds.
    """
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as e:  # pragma: no cover
        raise ImportError(
            "save_macro_sensitivity_matrix requires matplotlib; pip install matplotlib",
        ) from e

    num = _factor_matrix_to_numeric(sensitivity)
    if num.shape[1] < 1:
        cols = list(sensitivity.columns)
        extra = (
            f" Columns present but no parseable numbers: {cols}."
            if cols
            else " No factor columns in frame."
        )
        raise ValueError("sensitivity needs at least one numeric factor column." + extra)
    if figsize is None:
        if style == "readme_dark":
            figsize = (max(8.0, 1.6 * num.shape[1] + 3.5), max(4.0, 0.6 * num.shape[0] + 2.0))
        else:
            figsize = (max(7.0, 0.55 * num.shape[1] + 4.0), max(3.5, 0.45 * num.shape[0] + 2.0))

    fig, ax = plt.subplots(figsize=figsize)
    if style == "readme_dark":
        fig.patch.set_facecolor(README_DARK["canvas"])
        ax.set_facecolor(README_DARK["canvas"])
    elif transparent:
        fig.patch.set_facecolor("none")
        ax.set_facecolor("none")
    _draw_macro_sensitivity_matrix_on_axes(ax, num, title=title, annot=annot, style=style)
    fig.tight_layout()
    fig.savefig(path, dpi=dpi, bbox_inches="tight", transparent=transparent and style != "readme_dark")
    plt.close(fig)
    return path


def save_risk_intel_inspiration_figure(
    macro_matrix: pd.DataFrame,
    ranking_ticker: str,
    ranking_data: Mapping[str, Any] | pd.Series,
    path: str = "readme_inspiration.png",
    *,
    macro_title: str = "MAG7 — macro correlations (L3 residual)",
    ranking_subtitle: str | None = None,
    theme: GitHubChartTheme = "github_light",
    dpi: int = 140,
) -> str:
    """Wide figure for README / docs: macro sensitivity matrix + rank-percentile needle."""
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as e:  # pragma: no cover
        raise ImportError(
            "save_risk_intel_inspiration_figure requires matplotlib; pip install matplotlib",
        ) from e

    pct = _ranking_percentile_from_mapping(ranking_data)
    is_dark = theme == "readme_dark"
    if is_dark:
        pal = README_DARK
        macro_style: MacroChartStyle = "readme_dark"
    elif theme == "github_light":
        pal = GITHUB_LIGHT
        macro_style = "light"
    else:
        pal = GITHUB_DARK
        macro_style = "light"

    num = _factor_matrix_to_numeric(macro_matrix)
    n_factors = max(num.shape[1], 1)
    ratio_l = max(1.3, 0.5 * n_factors + 0.5)

    fig_h = 6.2 if is_dark else 4.2
    fig = plt.figure(figsize=(16.0 if is_dark else 14.5, fig_h))
    fig.patch.set_facecolor(pal["canvas"])

    if is_dark:
        gs = fig.add_gridspec(
            1, 2,
            width_ratios=[ratio_l, 1.0],
            wspace=0.22,
            top=0.84, bottom=0.10, left=0.06, right=0.96,
        )
        fig.text(
            0.5, 0.97,
            "RiskModels  \u00b7  live API data  \u00b7  riskmodels.app",
            ha="center", va="top",
            fontsize=11, color=pal["brand"], fontweight="semibold",
        )
        ax_m = fig.add_subplot(gs[0, 0])
        ax_r = fig.add_subplot(gs[0, 1])
    else:
        gs = fig.add_gridspec(1, 2, width_ratios=[ratio_l, 1.0], wspace=0.28)
        ax_m = fig.add_subplot(gs[0, 0])
        ax_r = fig.add_subplot(gs[0, 1])
        fig.suptitle(
            "RiskModels \u2014 cross-sectional ranks & macro sensitivity",
            fontsize=13, fontweight="semibold", color=pal["fg"], y=1.05,
        )

    ax_m.set_facecolor(pal["canvas"])
    ax_r.set_facecolor(pal["canvas"])

    _draw_macro_sensitivity_matrix_on_axes(ax_m, num, title=macro_title, annot=True, style=macro_style)
    _plot_ranking_needle_on_axes(
        ax_r, ranking_ticker, pct,
        subtitle=ranking_subtitle, theme=theme,
    )

    fig.savefig(path, dpi=dpi, bbox_inches="tight", transparent=False)
    plt.close(fig)
    return path


@dataclass
class RefinementResult:
    """Result of the visual refinement process."""

    success: bool
    output_path: str
    iterations: int
    final_code: str
    evaluation_history: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    warning: str | None = None

    def __repr__(self) -> str:
        status = "✓" if self.success else "✗"
        return f"RefinementResult({status} iterations={self.iterations}, path={self.output_path})"


class MatPlotAgent:
    """Orchestrates recursive visual refinement using Vision-LLM feedback.

    The agent executes a loop of:
    1. Execute Python code to generate a plot
    2. Capture output (PNG or error trace)
    3. Send to Vision-LLM for evaluation
    4. Refine based on feedback
    5. Repeat until COMPLETE or max iterations reached

    Example:
        >>> from riskmodels import RiskModelsClient
        >>> from riskmodels.visual_refinement import MatPlotAgent
        >>> client = RiskModelsClient.from_env()
        >>> agent = MatPlotAgent(client, llm_client=openai_client)
        >>> result = agent.generate_refined_plot(
        ...     plot_description="L3 risk decomposition stacked area chart for NVDA",
        ...     output_path="nvda_risk.png",
        ...     max_iterations=5
        ... )
        >>> print(result)
    """

    def __init__(
        self,
        client: RiskModelsClient,
        llm_client: Any,
        *,
        llm_provider: Literal["openai", "anthropic"] = "openai",
        model: str | None = None,
        max_syntax_retries: int = 3,
        temp_dir: str | None = None,
    ) -> None:
        """Initialize the MatPlotAgent.

        Args:
            client: RiskModelsClient instance for data access
            llm_client: LLM client instance (OpenAI or Anthropic)
            llm_provider: Which LLM provider to use ("openai" or "anthropic")
            model: Model name (defaults to provider's vision model)
            max_syntax_retries: Max retries for syntax errors before giving up
            temp_dir: Directory for temporary files (defaults to system temp)
        """
        self.client = client
        self.llm_client = llm_client
        self.llm_provider = llm_provider
        self.model = model or self._default_model()
        self.max_syntax_retries = max_syntax_retries
        self.temp_dir = temp_dir or tempfile.gettempdir()

    def _default_model(self) -> str:
        """Return default vision model for provider."""
        if self.llm_provider == "anthropic":
            return "claude-3-5-sonnet-20241022"
        return "gpt-4o"

    def _call_llm_text(self, prompt: str, system: str | None = None) -> str:
        """Call LLM with text-only prompt."""
        if self.llm_provider == "anthropic":
            import anthropic

            messages = []
            if system:
                # Anthropic uses top-level system parameter
                pass
            messages.append({"role": "user", "content": prompt})

            kwargs: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "max_tokens": 4096,
            }
            if system:
                kwargs["system"] = system

            response = self.llm_client.messages.create(**kwargs)
            return response.content[0].text
        else:
            # OpenAI
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})

            response = self.llm_client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=4096,
            )
            return response.choices[0].message.content

    def _call_llm_vision(self, image_path: str, prompt: str) -> str:
        """Call LLM with image input for vision evaluation."""
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        if self.llm_provider == "anthropic":
            import anthropic

            response = self.llm_client.messages.create(
                model=self.model,
                max_tokens=4096,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image_data}},
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
            )
            return response.content[0].text
        else:
            # OpenAI
            response = self.llm_client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/png;base64,{image_data}"},
                            },
                        ],
                    }
                ],
                max_tokens=4096,
            )
            return response.choices[0].message.content

    def _extract_code(self, text: str) -> str:
        """Extract Python code from LLM response, handling markdown blocks."""
        # Try to extract code from markdown code blocks
        patterns = [
            r"```python\n(.*?)\n```",
            r"```\n(.*?)\n```",
            r"```python(.*?)```",
            r"```(.*?)```",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.DOTALL)
            if match:
                return match.group(1).strip()
        return text.strip()

    def _execute_code(self, code: str, output_path: str) -> tuple[bool, str]:
        """Execute Python code in subprocess. Returns (success, message)."""
        # Inject output path into code if not present
        if "{output_path}" in code:
            code = code.format(output_path=output_path)

        # Create a temporary script file
        fd, script_path = tempfile.mkstemp(suffix=".py", dir=self.temp_dir)
        try:
            with os.fdopen(fd, "w") as f:
                f.write(code)

            # Run in subprocess with timeout
            result = subprocess.run(
                ["python", script_path],
                capture_output=True,
                text=True,
                timeout=60,
                cwd=self.temp_dir,
            )

            if result.returncode != 0:
                return False, f"Execution Error:\n{result.stderr}"

            # Check if output file was created
            if not os.path.exists(output_path):
                return False, f"Output file not created at {output_path}"

            return True, "Success"
        except subprocess.TimeoutExpired:
            return False, "Execution timed out after 60 seconds"
        except Exception as e:
            return False, f"Execution failed: {str(e)}"
        finally:
            # Cleanup temp script
            try:
                os.unlink(script_path)
            except OSError:
                pass

    def generate_refined_plot(
        self,
        plot_description: str,
        output_path: str | None = None,
        *,
        max_iterations: int = 10,
        initial_code: str | None = None,
    ) -> RefinementResult:
        """Generate a refined plot through recursive Vision-LLM feedback.

        Args:
            plot_description: Description of the desired plot
            output_path: Where to save the final PNG (defaults to temp file)
            max_iterations: Maximum refinement iterations (default 10)
            initial_code: Optional initial code to start with instead of generating

        Returns:
            RefinementResult with success status, output path, and iteration history
        """
        # Determine output path
        if output_path is None:
            output_path = os.path.join(self.temp_dir, "temp_graph.png")
        output_path = os.path.abspath(output_path)

        history: list[dict[str, Any]] = []
        current_code = initial_code
        syntax_error_count = 0

        for iteration in range(1, max_iterations + 1):
            # Step 1: Generate or refine code
            if current_code is None:
                # Initial generation
                prompt = INITIAL_PLOT_PROMPT.format(
                    plot_description=plot_description,
                    output_path=output_path,
                )
                response = self._call_llm_text(prompt, system=SYSTEM_CONTEXT)
                current_code = self._extract_code(response)
            else:
                # We have feedback from previous iteration, generate refined code
                last_eval = history[-1]
                feedback = last_eval.get("feedback", "Fix the visualization issues.")
                prompt = REFINEMENT_PROMPT.format(
                    feedback=feedback,
                    output_path=output_path,
                )
                response = self._call_llm_text(prompt, system=SYSTEM_CONTEXT)
                current_code = self._extract_code(response)

            # Step 2: Execute code
            success, message = self._execute_code(current_code, output_path)

            if not success:
                # Execution failed - treat as feedback
                syntax_error_count += 1
                history.append({
                    "iteration": iteration,
                    "code": current_code,
                    "execution_success": False,
                    "feedback": f"Code execution failed:\n{message}",
                })

                # Check if we've exceeded syntax error retries
                if syntax_error_count >= self.max_syntax_retries:
                    return RefinementResult(
                        success=False,
                        output_path=output_path,
                        iterations=iteration,
                        final_code=current_code,
                        evaluation_history=history,
                        error=f"Syntax/execution error could not be resolved after {syntax_error_count} attempts",
                    )
                continue

            # Step 3: Vision evaluation
            try:
                evaluation = self._call_llm_vision(output_path, EVALUATION_PROMPT)
            except Exception as e:
                history.append({
                    "iteration": iteration,
                    "code": current_code,
                    "execution_success": True,
                    "evaluation_error": str(e),
                })
                return RefinementResult(
                    success=False,
                    output_path=output_path,
                    iterations=iteration,
                    final_code=current_code,
                    evaluation_history=history,
                    error=f"Vision LLM evaluation failed: {str(e)}",
                )

            # Step 4: Check for completion
            is_complete = "COMPLETE" in evaluation.upper()

            history.append({
                "iteration": iteration,
                "code": current_code,
                "execution_success": True,
                "feedback": evaluation,
                "is_complete": is_complete,
            })

            if is_complete:
                return RefinementResult(
                    success=True,
                    output_path=output_path,
                    iterations=iteration,
                    final_code=current_code,
                    evaluation_history=history,
                )

            # Reset syntax error count on successful execution
            syntax_error_count = 0

        # Max iterations reached
        return RefinementResult(
            success=True,  # We have a valid plot, just not perfect
            output_path=output_path,
            iterations=max_iterations,
            final_code=current_code or "",
            evaluation_history=history,
            warning=f"Max iterations ({max_iterations}) reached without COMPLETE status",
        )

    def generate_code_only(
        self,
        plot_description: str,
    ) -> str:
        """Generate plotting code without executing refinement loop.

        Args:
            plot_description: Description of the desired plot

        Returns:
            Generated Python code as string
        """
        output_path = os.path.join(self.temp_dir, "output.png")
        prompt = INITIAL_PLOT_PROMPT.format(
            plot_description=plot_description,
            output_path=output_path,
        )
        response = self._call_llm_text(prompt, system=SYSTEM_CONTEXT)
        return self._extract_code(response)


def generate_refined_plot(
    client: RiskModelsClient,
    llm_client: Any,
    plot_description: str,
    output_path: str | None = None,
    *,
    max_iterations: int = 10,
    llm_provider: Literal["openai", "anthropic"] = "openai",
    model: str | None = None,
) -> RefinementResult:
    """Convenience function for one-off refined plot generation.

    Example:
        >>> from riskmodels import RiskModelsClient
        >>> from openai import OpenAI
        >>> client = RiskModelsClient.from_env()
        >>> llm = OpenAI(api_key="...")
        >>> result = generate_refined_plot(
        ...     client, llm,
        ...     plot_description="L3 hedge ratio time series for AAPL",
        ...     output_path="aapl_hedge.png"
        ... )
        >>> print(f"Plot saved to: {result.output_path}")
    """
    agent = MatPlotAgent(
        client=client,
        llm_client=llm_client,
        llm_provider=llm_provider,
        model=model,
    )
    return agent.generate_refined_plot(
        plot_description=plot_description,
        output_path=output_path,
        max_iterations=max_iterations,
    )
