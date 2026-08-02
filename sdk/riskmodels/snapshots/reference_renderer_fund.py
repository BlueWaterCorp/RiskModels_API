"""Public reference renderer for :class:`CanonicalFundSnapshot`.

Deterministic single-page PDF / PNG baseline for F1 / M1 shapes. Mirrors
``reference_renderer.py`` for stocks: no narrative generation, no BWMACRO
imports, only the public canonical contract.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib.ticker as mticker

from ._charts import chart_hbar, chart_table
from ._page import SnapshotPage
from ._theme import THEME
from .canonical_fund import CanonicalFundSnapshot


def _fmt_pct(v: float | None, *, decimals: int = 1, sign: bool = False) -> str:
    if v is None:
        return "—"
    fmt = f"{{:+.{decimals}f}}%" if sign else f"{{:.{decimals}f}}%"
    return fmt.format(v * 100.0)


def _fmt_num(v: float | None, *, decimals: int = 2) -> str:
    if v is None:
        return "—"
    return f"{v:.{decimals}f}"


def _fmt_aum(v: float | None) -> str:
    if v is None:
        return "—"
    if v >= 1e9:
        return f"${v / 1e9:.1f}B"
    if v >= 1e6:
        return f"${v / 1e6:.0f}M"
    return f"${v:,.0f}"


def _build_chips(snap: CanonicalFundSnapshot) -> list[tuple[str, str]]:
    cm = snap.core_metrics
    port = snap.portfolio
    chips: list[tuple[str, str]] = []
    if snap.identity.aum_usd is not None:
        chips.append(("AUM", _fmt_aum(snap.identity.aum_usd)))
    chips.append(("Holdings", str(port.total_holdings_count)))
    if cm.beta is not None:
        chips.append(("Beta", _fmt_num(cm.beta)))
    if cm.vol_23d is not None:
        chips.append(("Vol 23d", _fmt_pct(cm.vol_23d)))
    if cm.residual_er is not None:
        chips.append(("Resid ER", _fmt_pct(cm.residual_er, sign=True)))
    return chips


def _render_left_rail(page: SnapshotPage, snap: CanonicalFundSnapshot) -> None:
    ax = page.panel(row_slice=slice(2, 12), col_slice=slice(0, 3))
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_facecolor(THEME.palette.panel_bg)

    pal = THEME.palette
    typ = THEME.type
    cm = snap.core_metrics
    idy = snap.identity

    # Sectioned layout: each section gets its own y-band so blank-line spacers
    # aren't needed and gaps stay proportional regardless of line count.
    sections: list[tuple[str, list[tuple[str, str]]]] = []

    if idy.filer_metadata is not None:
        fm = idy.filer_metadata
        sections.append(("IDENTITY", [
            ("Filer", idy.symbol_id),
            ("Type", fm.filer_type or "—"),
            ("CIK", fm.cik),
            ("AUM Tier", fm.aum_tier or "—"),
            ("Coverage", fm.coverage),
        ]))
    else:
        sections.append(("IDENTITY", [
            ("Symbol", idy.symbol_id),
            ("Family", idy.fund_family or "—"),
            ("Inception", idy.inception_date or "—"),
            ("Expense", _fmt_pct(idy.expense_ratio)),
            ("AUM", _fmt_aum(idy.aum_usd)),
        ]))

    decomp_rows = [
        ("Market", _fmt_pct(cm.market_share)),
        ("Sector", _fmt_pct(cm.sector_share)),
        ("Subsector", _fmt_pct(cm.subsector_share)),
    ]
    # FF2 (v4): show the SMB+HML style leg when present. Pre-v4 (None) stays 4-leg.
    if cm.style_share is not None:
        decomp_rows.append(("Style", _fmt_pct(cm.style_share)))
    decomp_rows.append(("Residual", _fmt_pct(cm.residual_share)))
    sections.append(("DECOMPOSITION", decomp_rows))

    if snap.macro and snap.macro.correlations:
        macro_rows = [(name, f"{rho:+.2f}")
                      for name, rho in list(snap.macro.correlations.items())[:5]]
        sections.append(("MACRO ρ", macro_rows))

    # Vertical layout: header consumes 1.4 line-units, each row 1.0, gap 0.6.
    # Compute total units, then derive line-height fraction within axes.
    total_units = sum(1.4 + len(rows) for _, rows in sections)
    total_units += 0.6 * (len(sections) - 1)
    # Top/bottom margin inside the rail
    top_y = 0.97
    bottom_y = 0.03
    span = top_y - bottom_y
    unit = span / total_units

    y = top_y
    for s_idx, (header, rows) in enumerate(sections):
        # Section header
        ax.text(
            0.0, y, header,
            fontsize=typ.chip_label,
            fontweight=typ.weight_bold,
            color=pal.navy,
            transform=ax.transAxes,
            va="top", ha="left",
        )
        y -= 1.4 * unit

        for label, value in rows:
            ax.text(
                0.02, y, label,
                fontsize=typ.body,
                color=pal.text_mid,
                transform=ax.transAxes,
                va="top", ha="left",
            )
            ax.text(
                0.98, y, value,
                fontsize=typ.body,
                fontweight=typ.weight_bold,
                color=pal.text_dark,
                transform=ax.transAxes,
                va="top", ha="right",
            )
            y -= 1.0 * unit

        # Inter-section gap (skip after last section)
        if s_idx < len(sections) - 1:
            y -= 0.6 * unit


def _legend_label(raw: str) -> str:
    """Return a label safe for ``ax.legend()``.

    matplotlib treats labels with leading underscores as no-legend sentinels,
    so synthetic identifiers like ``__TEST_FUND__`` would silently drop from
    the legend without this. Trailing underscores are also stripped for
    visual cleanliness on synthetic fixtures. Real production symbols
    never lead or trail with ``_``.
    """
    stripped = raw.strip("_")
    return stripped or raw


def _render_section_i_performance(page: SnapshotPage, snap: CanonicalFundSnapshot) -> None:
    perf = snap.performance
    if not perf.cumulative_curves:
        ax = page.panel(row_slice=slice(2, 7), col_slice=slice(4, 12))
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
        ax.set_xticks([])
        ax.set_yticks([])
        return

    ax = page.panel(row_slice=slice(2, 7), col_slice=slice(4, 12))

    target = snap.identity.symbol_id
    ordered_labels: list[str] = []
    # Benchmark second: legacy "SPY" key, or the G.45 disclosed-default
    # label ("SPY (default)") the loader now emits.
    for k in [target, "SPY", "SPY (default)"]:
        if k in perf.cumulative_curves and k not in ordered_labels:
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
        ax.plot(dates, values, label=_legend_label(label), color=color, linewidth=lw, zorder=3 + i)
        drawn += 1

    if drawn == 0:
        ax.text(0.5, 0.5, "No data", ha="center", va="center",
                color=pal.text_light, transform=ax.transAxes)
        ax.set_xticks([])
        ax.set_yticks([])
        return

    ax.set_title(
        f"I. Performance Attribution · {perf.window_label}",
        loc="left",
        fontsize=typ.panel_title,
        fontweight=typ.weight_bold,
        color=pal.navy,
        pad=8,
    )
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(
        lambda y, _: "0%" if abs(y) < 1e-9 else f"{y:+.0%}"
    ))
    ax.axhline(0, color=pal.border, linewidth=strk.thin_lw, zorder=2)
    ax.legend(fontsize=typ.axis_tick, loc="upper left", ncol=min(drawn, 4))
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    n_pts = len(perf.cumulative_curves[ordered_labels[0]])
    if n_pts > 0:
        step = max(1, n_pts // 6)
        ax.xaxis.set_major_locator(mticker.MultipleLocator(step))
        for tick in ax.get_xticklabels():
            tick.set_rotation(0)
            tick.set_fontsize(typ.axis_tick)


def _render_section_ii_risk(page: SnapshotPage, snap: CanonicalFundSnapshot) -> None:
    ax = page.panel(row_slice=slice(7, 12), col_slice=slice(4, 8))

    comps = snap.risk.components
    if not comps:
        ax.set_title("II. Risk Decomposition",
                     loc="left",
                     fontsize=THEME.type.panel_title,
                     fontweight=THEME.type.weight_bold,
                     color=THEME.palette.navy)
        ax.text(0.5, 0.5, "Decomposition unavailable",
                ha="center", va="center",
                color=THEME.palette.text_light,
                transform=ax.transAxes)
        ax.set_xticks([])
        ax.set_yticks([])
        return

    labels = [c.label for c in comps]
    values = [c.share * 100.0 for c in comps]

    chart_hbar(
        ax,
        labels=labels,
        values=values,
        colors=THEME.palette.factor_colors[: len(labels)],
        title="II. Risk Decomposition",
        value_fmt="{:.1f}%",
        sort=False,
    )


def _render_section_iii_holdings(page: SnapshotPage, snap: CanonicalFundSnapshot) -> None:
    ax = page.panel(row_slice=slice(7, 12), col_slice=slice(8, 12))
    ax.set_title("III. Top Holdings",
                 loc="left",
                 fontsize=THEME.type.panel_title,
                 fontweight=THEME.type.weight_bold,
                 color=THEME.palette.navy,
                 pad=6)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)

    portfolio = snap.portfolio
    if not portfolio.holdings:
        ax.text(
            0.5, 0.5, "Holdings reconstruction pending",
            ha="center", va="center",
            color=THEME.palette.text_light,
            transform=ax.transAxes,
        )
        return

    top = sorted(portfolio.holdings, key=lambda h: h.weight, reverse=True)[:8]
    rows = [
        [
            h.ticker,
            _fmt_pct(h.weight),
            _fmt_pct(h.style_share) if h.style_share is not None else "—",
            _fmt_pct(h.residual_share) if h.residual_share is not None else "—",
        ]
        for h in top
    ]

    chart_table(ax, rows=rows, headers=["Ticker", "Wt", "Style", "Resid"])

    cov = portfolio.coverage_pct
    cov_s = _fmt_pct(cov) if cov is not None else "—"
    coverage_str = f"{portfolio.total_holdings_count} holdings · {cov_s} coverage"
    page.fig.text(
        0.83, 0.115,
        coverage_str,
        fontsize=THEME.type.footer,
        color=THEME.palette.text_light,
        ha="center", va="top",
    )


# Human-readable labels for the historical-degradation codes carried on
# ``TemporalContext.degraded_sections`` (G.44). Unknown codes fall back to
# the code itself — an unlabeled degradation is still disclosed.
_DEGRADED_SECTION_LABELS = {
    "holdings_model_share_overlay_skipped": "per-holding model shares omitted (current-model overlay)",
    "fund_fit_section_omitted": "model-fit statistics omitted (latest-only)",
    "holdings_labels_from_current_registry": "holding labels from the current symbols registry",
}


def _build_page(snap: CanonicalFundSnapshot) -> SnapshotPage:
    # Display the symbol_id with underscores stripped to avoid the literal
    # underscores reading as a fake underline on synthetic fixtures.
    # Production symbol_ids never lead/trail with ``_``, so this is a no-op there.
    display_id = snap.identity.symbol_id.strip("_") or snap.identity.symbol_id
    title = f"{display_id} — {snap.identity.name}"
    subtitle = f"Fund Snapshot · As of {snap.identity.as_of}"
    if snap.identity.filer_metadata is not None:
        subtitle = f"13F Filer Snapshot · As of {snap.identity.as_of}"

    # Historical as-of read (G.44): name the axis in the subtitle so the
    # page can never pass as a current snapshot.
    t = snap.temporal
    if t is not None and getattr(t, "as_of_basis", None):
        subtitle += f" · Historical ({t.as_of_basis} basis)"

    page = SnapshotPage(
        title=title,
        subtitle=subtitle,
        ticker=snap.identity.symbol_id,
        teo=snap.identity.as_of,
        chips=_build_chips(snap),
    )

    _render_left_rail(page, snap)
    _render_section_i_performance(page, snap)
    _render_section_ii_risk(page, snap)
    _render_section_iii_holdings(page, snap)

    # Degraded-sections labeling for historical reads: latest-only overlays
    # (current-model holding shares, fund-fit stats) are omitted rather
    # than served stale — say so on the page instead of leaving blanks.
    if t is not None and getattr(t, "degraded_sections", None):
        note = "; ".join(
            _DEGRADED_SECTION_LABELS.get(c, c) for c in t.degraded_sections
        )
        # Sits between the panel area and the footer rule (0.025); the
        # Section III coverage string occupies y=0.115 on the right, so
        # this line stays below it to avoid a collision.
        page.fig.text(
            0.05, 0.045,
            f"Historical as-of view — {note}.",
            fontsize=THEME.type.footer,
            color=THEME.palette.text_light,
            ha="left", va="bottom",
        )

    return page


def render_canonical_fund_to_pdf(
    snap: CanonicalFundSnapshot,
    output_path: str | Path,
) -> Path:
    """Render ``snap`` to a single-page PDF and return the output path."""
    page = _build_page(snap)
    return page.save(output_path)


def render_canonical_fund_to_png(
    snap: CanonicalFundSnapshot,
    output_path: str | Path,
) -> Path:
    """Render ``snap`` to a single-page PNG and return the output path."""
    page = _build_page(snap)
    return page.save(output_path)


def render_canonical_fund_to_png_bytes(snap: CanonicalFundSnapshot) -> bytes:
    """Render ``snap`` to PNG bytes (no file I/O)."""
    page = _build_page(snap)
    return page.to_png_bytes()
