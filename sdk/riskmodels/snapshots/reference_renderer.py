"""Public reference renderer for :class:`CanonicalStockSnapshot`.

Produces a clean, institutional, single-page PDF / PNG. The **reference
renderer** is the deterministic baseline that ships in the public SDK:
it has no narrative, no curated peer-benchmark layout, no hedge-construction
artwork, and depends only on the canonical contract. Its job is to be
trustworthy and stable.

The **institutional renderer** — the enriched composition with `Judgment`
narrative, curated peer presentation, and hedge-construction visuals —
lives privately in BWMACRO and consumes the same canonical object. Both
renderers read one source of truth; only the institutional renderer adds
editorial layers on top.

See ``BWMACRO/docs/architecture/CANONICAL_INTELLIGENCE_OBJECTS.md`` for
the boundary between the two.

Sections rendered (in order):

    Header                          identity band (ticker, company, as-of)
    Chips                           beta, vol, max DD, Sharpe
    Section I — Performance         cumulative-return curves (1Y)
    Section II — Risk decomposition variance shares (Market/Sector/Sub/Residual)
    Section III — Peer context      top peers by weight (compact table)

Hedge / macro sections in :class:`CanonicalStockSnapshot` are not rendered
here — they exist for downstream BWMACRO consumers.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import matplotlib.ticker as mticker
import numpy as np

from ._charts import chart_hbar, chart_table
from ._page import SnapshotPage
from ._theme import THEME
from .canonical import CanonicalStockSnapshot


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt_pct(v: float | None, *, decimals: int = 1, sign: bool = False) -> str:
    if v is None:
        return "—"
    fmt = f"{{:+.{decimals}f}}%" if sign else f"{{:.{decimals}f}}%"
    return fmt.format(v * 100.0)


def _fmt_num(v: float | None, *, decimals: int = 2) -> str:
    if v is None:
        return "—"
    return f"{v:.{decimals}f}"


def _build_chips(snap: CanonicalStockSnapshot) -> list[tuple[str, str]]:
    cm = snap.core_metrics
    return [
        ("Beta",     _fmt_num(cm.beta)),
        ("Vol 23d",  _fmt_pct(cm.vol_23d)),
        ("Max DD",   _fmt_pct(cm.max_drawdown_pct, sign=True)),
        ("Sharpe",   _fmt_num(cm.sharpe_252d)),
        ("Resid ER", _fmt_pct(cm.residual_er, sign=True)),
    ]


# ---------------------------------------------------------------------------
# Section renderers
# ---------------------------------------------------------------------------

def _render_section_i_performance(page: SnapshotPage, snap: CanonicalStockSnapshot) -> None:
    """Cumulative-return curves over the snapshot window."""
    perf = snap.performance
    if not perf.cumulative_curves:
        ax = page.panel(row_slice=slice(2, 6), col_slice=slice(3, 12))
        ax.text(
            0.5, 0.5, "Performance series unavailable",
            ha="center", va="center",
            color=THEME.palette.text_light,
            fontsize=THEME.type.body,
            transform=ax.transAxes,
        )
        ax.set_title("I. Performance Attribution", loc="left",
                     fontsize=THEME.type.panel_title,
                     fontweight=THEME.type.weight_bold,
                     color=THEME.palette.navy)
        ax.set_xticks([]); ax.set_yticks([])
        return

    ax = page.panel(row_slice=slice(2, 6), col_slice=slice(3, 12))

    # Pull stable label order: target → SPY → sector → subsector → others
    target = snap.identity.ticker
    ordered_labels: list[str] = []
    for k in [target, "SPY", snap.identity.sector_etf, snap.identity.subsector_etf]:
        if k and k in perf.cumulative_curves and k not in ordered_labels:
            ordered_labels.append(k)
    for k in perf.cumulative_curves:
        if k not in ordered_labels:
            ordered_labels.append(k)

    pal = THEME.palette
    strk = THEME.strokes
    typ = THEME.type

    palette = [pal.navy, pal.teal, pal.subsector, pal.green, pal.orange]

    drawn = 0
    for i, label in enumerate(ordered_labels):
        pts = perf.cumulative_curves.get(label) or []
        if not pts:
            continue
        dates = [p[0] for p in pts]
        values = [p[1] for p in pts]
        color = palette[i % len(palette)]
        lw = strk.series_lw if drawn < 3 else strk.thin_lw
        ax.plot(dates, values, label=label, color=color, linewidth=lw, zorder=3 + i)
        drawn += 1

    if drawn == 0:
        ax.text(0.5, 0.5, "No data", ha="center", va="center",
                color=pal.text_light, transform=ax.transAxes)
        ax.set_xticks([]); ax.set_yticks([])
        return

    ax.set_title(
        f"I. Performance Attribution · {perf.window_label}",
        loc="left",
        fontsize=typ.panel_title,
        fontweight=typ.weight_bold,
        color=pal.navy,
        pad=8,
    )
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda y, _: f"{y:+.0%}"))
    ax.axhline(0, color=pal.border, linewidth=strk.thin_lw, zorder=2)
    ax.legend(fontsize=typ.axis_tick, loc="best", ncol=min(drawn, 4))
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    # Sparser x-tick labels — show ~6 labels max
    n_pts = len(perf.cumulative_curves[ordered_labels[0]])
    if n_pts > 0:
        step = max(1, n_pts // 6)
        ax.xaxis.set_major_locator(mticker.MultipleLocator(step))
        for tick in ax.get_xticklabels():
            tick.set_rotation(0)
            tick.set_fontsize(typ.axis_tick)


def _render_section_ii_risk(page: SnapshotPage, snap: CanonicalStockSnapshot) -> None:
    """Variance-share decomposition."""
    ax = page.panel(row_slice=slice(8, 12), col_slice=slice(3, 7))

    comps = snap.risk.components
    if not comps:
        ax.set_title("II. Risk Decomposition (variance share)",
                     loc="left",
                     fontsize=THEME.type.panel_title,
                     fontweight=THEME.type.weight_bold,
                     color=THEME.palette.navy)
        ax.text(0.5, 0.5, "Decomposition unavailable",
                ha="center", va="center",
                color=THEME.palette.text_light,
                transform=ax.transAxes)
        ax.set_xticks([]); ax.set_yticks([])
        return

    labels = [c.label for c in comps]
    values = [c.share * 100.0 for c in comps]

    chart_hbar(
        ax,
        labels=labels,
        values=values,
        colors=THEME.palette.factor_colors[:len(labels)],
        title="II. Risk Decomposition (variance share)",
        value_fmt="{:.1f}%",
        sort=False,
    )


def _render_section_iii_peer(page: SnapshotPage, snap: CanonicalStockSnapshot) -> None:
    """Compact peer-cohort table."""
    ax = page.panel(row_slice=slice(8, 12), col_slice=slice(8, 12))
    ax.set_title("III. Peer Context",
                 loc="left",
                 fontsize=THEME.type.panel_title,
                 fontweight=THEME.type.weight_bold,
                 color=THEME.palette.navy,
                 pad=6)
    ax.set_xticks([]); ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)

    if snap.peer is None or not snap.peer.peers:
        ax.text(0.5, 0.5, "Peer context unavailable",
                ha="center", va="center",
                color=THEME.palette.text_light,
                transform=ax.transAxes)
        return

    # Top 6 peers by weight (descending)
    rows_sorted = sorted(
        snap.peer.peers,
        key=lambda r: (r.weight if r.weight is not None else 0.0),
        reverse=True,
    )[:6]

    table_rows: list[list[str]] = []
    for r in rows_sorted:
        table_rows.append([
            r.ticker,
            _fmt_pct(r.weight) if r.weight is not None else "—",
            _fmt_pct(r.residual_er, sign=True),
        ])

    chart_table(
        ax,
        rows=table_rows,
        headers=["Ticker", "Wt", "Resid ER"],
    )

    # Cohort label as caption — small text under the table
    page.fig.text(
        0.83, 0.115,
        f"Cohort: {snap.peer.cohort_label}  ·  N={snap.peer.cohort_size}",
        fontsize=THEME.type.footer,
        color=THEME.palette.text_light,
        ha="center", va="top",
    )


def _render_left_rail(page: SnapshotPage, snap: CanonicalStockSnapshot) -> None:
    """Stable identity spine — text-only summary in the left columns."""
    ax = page.panel(row_slice=slice(2, 12), col_slice=slice(0, 3))
    ax.set_xticks([]); ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_facecolor(THEME.palette.panel_bg)

    pal = THEME.palette
    typ = THEME.type
    cm = snap.core_metrics
    idy = snap.identity

    lines: list[tuple[str, str]] = [
        ("IDENTITY", ""),
        ("Ticker",        idy.ticker),
        ("Sector ETF",    idy.sector_etf or "—"),
        ("Subsector ETF", idy.subsector_etf or "—"),
        ("Market Cap",    f"${idy.market_cap_usd/1e9:,.1f}B" if idy.market_cap_usd else "—"),
        ("",              ""),
        ("DECOMPOSITION", ""),
        ("Market",        _fmt_pct(cm.market_share)),
        ("Sector",        _fmt_pct(cm.sector_share)),
        ("Subsector",     _fmt_pct(cm.subsector_share)),
        ("Residual",      _fmt_pct(cm.residual_share)),
    ]

    if snap.macro and snap.macro.correlations:
        lines.append(("", ""))
        lines.append(("MACRO ρ", ""))
        for name, rho in list(snap.macro.correlations.items())[:5]:
            lines.append((name, f"{rho:+.2f}"))

    n = len(lines)
    # Distribute lines vertically inside the axes (0.0 at bottom, 1.0 at top)
    for i, (label, value) in enumerate(lines):
        y = 1.0 - (i + 0.5) / n
        is_section = label.isupper() and value == "" and label != ""
        if is_section:
            ax.text(
                0.0, y, label,
                fontsize=typ.chip_label,
                fontweight=typ.weight_bold,
                color=pal.navy,
                transform=ax.transAxes,
                va="center", ha="left",
            )
        else:
            if label:
                ax.text(
                    0.02, y, label,
                    fontsize=typ.body,
                    color=pal.text_mid,
                    transform=ax.transAxes,
                    va="center", ha="left",
                )
            if value:
                ax.text(
                    0.98, y, value,
                    fontsize=typ.body,
                    fontweight=typ.weight_bold,
                    color=pal.text_dark,
                    transform=ax.transAxes,
                    va="center", ha="right",
                )


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

def render_canonical_to_pdf(
    snap: CanonicalStockSnapshot,
    output_path: str | Path,
) -> Path:
    """Render `snap` to a single-page PDF and return the output path."""
    page = _build_page(snap)
    return page.save(output_path)


def render_canonical_to_png(
    snap: CanonicalStockSnapshot,
    output_path: str | Path,
) -> Path:
    """Render `snap` to a single-page PNG and return the output path."""
    page = _build_page(snap)
    return page.save(output_path)


def render_canonical_to_png_bytes(snap: CanonicalStockSnapshot) -> bytes:
    """Render `snap` to PNG bytes (no file I/O)."""
    page = _build_page(snap)
    return page.to_png_bytes()


# ---------------------------------------------------------------------------
# Internal: page assembly
# ---------------------------------------------------------------------------

def _build_page(snap: CanonicalStockSnapshot) -> SnapshotPage:
    title = f"{snap.identity.ticker} — {snap.identity.company_name}"
    subtitle = f"Stock Snapshot · As of {snap.identity.as_of}"

    page = SnapshotPage(
        title=title,
        subtitle=subtitle,
        ticker=snap.identity.ticker,
        teo=snap.identity.as_of,
        chips=_build_chips(snap),
    )

    _render_left_rail(page, snap)
    _render_section_i_performance(page, snap)
    _render_section_ii_risk(page, snap)
    _render_section_iii_peer(page, snap)

    return page
