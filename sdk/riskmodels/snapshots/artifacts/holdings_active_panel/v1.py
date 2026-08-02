"""``holdings_active_panel@v1`` — the holdings-active comparison panel (G.45).

Artifact wrapper over the existing ``fitWeightVectors`` kernel
(``GET /api/data/benchmark-fit`` — active share, active-weight RMS, overlap,
top over/underweights). The kernel's point-in-time semantics are kept
untouched: subject at its latest teo ≤ ``as_of``, benchmark at its latest
teo ≤ the subject's teo — this module renders the payload, it never
recomputes it.

Benchmark provenance is part of the render contract (ADR 2026-08-01):
every render carries a visible label naming the benchmark and its basis —
``"vs SPY (default)"`` for the static house default (``benchmark_index``
is NULL for every fund, so SPY is a hardcoded default, not a prospectus
declaration), or the custom bench's own description (``ff_own``,
``cell_<slug>``). The readiness gate lives server-side
(``lib/benchmark-registry.ts``): benches with status ``development`` are
refused with 409 before this module ever sees data — do not work around
it here.

Render forms:
- ``render_data(fit, ...) -> dict`` — JSON contract (stats + labeled
  over/underweights + the provenance label).
- ``render_figure(fit, ...) -> go.Figure`` — Plotly diverging hbar of the
  top over/underweights with the stats and provenance label as header
  text. PNG/SVG are Kaleido projections done by the caller;
  ``format="figure"`` serves ``fig.to_json()`` directly.

Colors: active weights are *not* ERM3 layers, so the chromatic layer
palette stays untouched — neutrals only (``GROSS_TOTAL`` for
overweights, ``BENCH_LINE_COLOR`` for underweights), with the sign
carried by bar direction, per the palette governing rule.
"""

from __future__ import annotations

import logging
from typing import Any

import plotly.graph_objects as go

from riskmodels.snapshots._plotly_theme import (
    BENCH_LINE_COLOR,
    PLOTLY_THEME,
    _empty_panel_placeholder,
    apply_theme,
)
from riskmodels.snapshots._palette import GROSS_TOTAL

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Registry metadata (module contract shared with bwmacro.snapshots.artifacts)
# ---------------------------------------------------------------------------

ARTIFACT_SLUG: str = "holdings_active_panel"
ARTIFACT_VERSION: str = "v1"
#: fund only for v1 — the benchmark-fit endpoint also accepts BW-ETF-* /
#: BW-FILER-* subjects, but capability is a property of the (slug, kind)
#: pair and only the fund pair ships verified here. Widen with evidence.
APPLICABLE_SUBJECT_KINDS: tuple[str, ...] = ("fund",)
RENDER_FORMATS: tuple[str, ...] = ("json", "png", "svg")
RENDER_PARAMS: tuple[str, ...] = ("benchmark", "top_n")


# ---------------------------------------------------------------------------
# Label resolution (bw_sym_id → ticker/name; soft-fail)
# ---------------------------------------------------------------------------

def resolve_fit_labels(fit: dict[str, Any]) -> dict[str, Any]:
    """Attach ``ticker`` / ``name`` to the over/underweight rows.

    The kernel emits internal ``bw_sym_id`` identifiers. Resolution goes
    through the same Supabase ``symbols`` read the F1 loader uses
    (:func:`riskmodels.snapshots._fund_data._resolve_holdings_metadata`)
    and soft-fails: without credentials the rows keep their ``bw_sym_id``
    as the display label — an honest identifier, never an invented name.
    """
    rows = list(fit.get("top_overweights") or []) + list(
        fit.get("top_underweights") or []
    )
    syms = sorted({str(r.get("bw_sym_id")) for r in rows if r.get("bw_sym_id")})
    if not syms:
        return fit
    try:
        from riskmodels.snapshots._fund_data import _resolve_holdings_metadata

        meta = _resolve_holdings_metadata(syms)
    except Exception as exc:  # noqa: BLE001
        log.info("holdings_active_panel: symbol resolution skipped (%s)", exc)
        meta = {}

    def _with_labels(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out = []
        for r in items:
            m = meta.get(str(r.get("bw_sym_id")), {})
            out.append(
                {
                    **r,
                    "ticker": m.get("ticker") or None,
                    "name": m.get("name") or None,
                }
            )
        return out

    return {
        **fit,
        "top_overweights": _with_labels(list(fit.get("top_overweights") or [])),
        "top_underweights": _with_labels(list(fit.get("top_underweights") or [])),
    }


# ---------------------------------------------------------------------------
# Provenance label
# ---------------------------------------------------------------------------

def provenance_label(fit: dict[str, Any]) -> str:
    """Visible benchmark-provenance line (ADR 2026-08-01).

    - ``BW-BENCH-SPY`` → ``"vs SPY (default)"`` — the house default,
      disclosed as such because no fund carries a declared benchmark.
    - ``ff_own`` / ``cell_*`` → ``"vs <id> — <benchmark_name>"``.

    Always appends the benchmark's own as-of teo so the point-in-time
    basis is on the plate, not just in the payload.
    """
    bench_id = str(fit.get("benchmark_context_id") or "?")
    bench_name = str(fit.get("benchmark_name") or bench_id)
    bench_teo = str(fit.get("benchmark_teo") or "?")
    if bench_id == "BW-BENCH-SPY":
        head = "vs SPY (default)"
    elif bench_id.startswith("BW-BENCH-"):
        head = f"vs {bench_id} (default)"
    else:
        head = f"vs {bench_id} — {bench_name}"
    return f"{head} · benchmark as of {bench_teo}"


# ---------------------------------------------------------------------------
# Param validation
# ---------------------------------------------------------------------------

def _validate_params(
    fit: dict[str, Any], benchmark: str | None, top_n: int | None
) -> None:
    """Raise ``ValueError`` (→ render-svc 422) on inconsistent params.

    ``benchmark`` and ``top_n`` are applied by the loader when it calls
    the fit endpoint; here they may only *narrow* the payload. A
    ``benchmark`` that does not match the payload's resolved bench would
    silently serve the wrong comparison — refuse it.
    """
    if benchmark is not None:
        got = str(fit.get("benchmark_context_id") or "").lower()
        want = str(benchmark).strip().lower()
        # Accept the resolved id, or the common aliases the endpoint
        # itself resolves (spy → BW-BENCH-SPY, etc.).
        if want not in {got, got.replace("bw-bench-", "").lower()}:
            raise ValueError(
                f"params.benchmark={benchmark!r} does not match the "
                f"payload's resolved benchmark {fit.get('benchmark_context_id')!r}"
            )
    if top_n is not None and (int(top_n) < 1 or int(top_n) > 100):
        raise ValueError(f"top_n must be 1..100, got {top_n!r}")


def _row_label(r: dict[str, Any]) -> str:
    return str(r.get("ticker") or r.get("bw_sym_id") or "?")


# ---------------------------------------------------------------------------
# Render forms
# ---------------------------------------------------------------------------

def render_data(
    fit: dict[str, Any],
    *,
    benchmark: str | None = None,
    top_n: int | None = None,
) -> dict[str, Any]:
    """JSON contract form."""
    _validate_params(fit, benchmark, top_n)
    labeled = resolve_fit_labels(fit)
    over = list(labeled.get("top_overweights") or [])
    under = list(labeled.get("top_underweights") or [])
    if top_n is not None:
        over, under = over[: int(top_n)], under[: int(top_n)]
    return {
        "slug": ARTIFACT_SLUG,
        "version": ARTIFACT_VERSION,
        "subject_id": labeled.get("subject_id"),
        "subject_teo": labeled.get("subject_teo"),
        "benchmark": {
            "id": labeled.get("benchmark_context_id"),
            "name": labeled.get("benchmark_name"),
            "kind": labeled.get("benchmark_kind"),
            "teo": labeled.get("benchmark_teo"),
            "provenance": labeled.get("benchmark_provenance"),
            "label": provenance_label(labeled),
        },
        "active_share": labeled.get("active_share"),
        "active_weight_rms": labeled.get("active_weight_rms"),
        "n_overlap": labeled.get("n_overlap"),
        "n_subject_holdings": labeled.get("n_subject_holdings"),
        "n_benchmark_constituents": labeled.get("n_benchmark_constituents"),
        "weight_in_benchmark": labeled.get("weight_in_benchmark"),
        "benchmark_coverage": labeled.get("benchmark_coverage"),
        "overweights": over,
        "underweights": under,
    }


def render_figure(
    fit: dict[str, Any],
    *,
    benchmark: str | None = None,
    top_n: int | None = None,
    spec_mode: bool = False,
) -> go.Figure:
    """Plotly diverging hbar of the top over/underweights.

    ``spec_mode`` is accepted for the ``format="figure"`` fast path
    (render-svc passes it when serving the raw figure spec); the build is
    identical either way — nothing here needs Kaleido to lay out.
    """
    del spec_mode  # layout is identical; kwarg kept for the figure path
    _validate_params(fit, benchmark, top_n)
    labeled = resolve_fit_labels(fit)
    over = list(labeled.get("top_overweights") or [])
    under = list(labeled.get("top_underweights") or [])
    if top_n is not None:
        over, under = over[: int(top_n)], under[: int(top_n)]

    if not over and not under:
        return _empty_panel_placeholder(
            "No active-weight data for this subject/benchmark"
        )

    # Overweights on top (largest first), underweights below (most
    # negative last) — one diverging axis, sign carried by direction.
    rows = over + under[::-1]
    labels = [_row_label(r) for r in rows]
    values = [float(r.get("active_weight") or 0.0) for r in rows]
    colors = [GROSS_TOTAL if v >= 0 else BENCH_LINE_COLOR for v in values]

    apply_theme()
    fig = go.Figure(
        go.Bar(
            x=values,
            y=labels,
            orientation="h",
            marker={"color": colors},
            text=[f"{v * 100:+.2f}%" for v in values],
            textposition="outside",
            textfont={"size": PLOTLY_THEME.fonts.axis_tick},
            hovertemplate=(
                "%{y}: active %{x:+.2%}<extra></extra>"
            ),
        )
    )
    PLOTLY_THEME.style(fig)

    active_share = labeled.get("active_share")
    rms = labeled.get("active_weight_rms")
    n_overlap = labeled.get("n_overlap")
    n_subj = labeled.get("n_subject_holdings")
    stats = (
        f"Active share {active_share * 100:.1f}%"
        f" · RMS active weight {rms * 100:.1f}%"
        f" · overlap {n_overlap}/{n_subj}"
        if active_share is not None and rms is not None
        else "Active-weight summary unavailable"
    )
    subject_teo = str(labeled.get("subject_teo") or "?")

    fig.update_layout(
        title={
            "text": (
                f"Holdings active weights — {labeled.get('subject_id', '?')}"
                f"<br><sup>{stats}</sup>"
                f"<br><sup>{provenance_label(labeled)}"
                f" · subject as of {subject_teo}</sup>"
            ),
        },
        xaxis={"tickformat": "+.1%", "title": {"text": "active weight (subject − benchmark)"}},
        yaxis={"autorange": "reversed"},
        showlegend=False,
        margin={"t": 110, "l": 90, "r": 60, "b": 50},
        height=max(320, 36 * len(rows) + 150),
    )
    return fig


__all__ = [
    "ARTIFACT_SLUG",
    "ARTIFACT_VERSION",
    "APPLICABLE_SUBJECT_KINDS",
    "RENDER_FORMATS",
    "RENDER_PARAMS",
    "provenance_label",
    "resolve_fit_labels",
    "render_data",
    "render_figure",
]
