"""Factor-colour palette — single source of truth for every snapshot renderer.

Canonical home: this module lives in the **public SDK** (``RiskModels_API``)
because BWMACRO imports ``riskmodels``, never the reverse. Every Matplotlib
and Plotly snapshot renderer in either repo must import its colours from
here (directly, or via a thin re-export module) rather than hardcoding hex
literals.

Governing rule (locked — quote verbatim wherever this palette is documented,
including ``BWMACRO/DESIGN.md``):

    Neutral colors are reserved for baseline, totals, unresolved holdings,
    and non-categorical structure. Chromatic colors are reserved for
    differentiated explanatory layers.

``DESIGN.md`` (``BWMACRO/DESIGN.md``) is the human-readable design spec —
read it for usage guidance and rationale. This module is the enforced,
machine-checked source of truth: ``BWMACRO/tests`` asserts these values
match the table in ``DESIGN.md`` exactly, and that no other module in
either repo re-defines ``LAYER_COLORS`` with different values.

CEO-approved 2026-07-09 (decisions 1B/3B/4A/5A, global scope). Do not
change these hexes without updating ``DESIGN.md`` and the drift-prevention
test in the same change.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# LAYER_COLORS — chromatic colors for differentiated explanatory layers.
#
# "market" is deliberately *not* the brand navy: it is rendered as a
# recessive / reference series (dashed where drawn as a line) so the
# reader's eye lands on sector / subsector / residual first.
# ---------------------------------------------------------------------------
LAYER_COLORS: dict[str, str] = {
    "market": "#64748b",
    "sector": "#0369a1",
    "subsector": "#6d28d9",
    "residual": "#00aa00",
}
"""ERM3 ontology layer palette (Market → Sector → Subsector → Residual)."""

LAYER_ORDER: tuple[str, ...] = ("market", "sector", "subsector", "residual")
"""Canonical layer render order — always Market → Sector → Subsector → Residual."""

# ---------------------------------------------------------------------------
# NEUTRALS — reserved for baseline, totals, unresolved holdings, and
# non-categorical structure. Never used for a differentiated data layer.
# ---------------------------------------------------------------------------
GROSS_TOTAL: str = "#334155"
"""Aggregate / total series (e.g. gross fund return line, gross bar)."""

HOLDINGS_FALLBACK: str = "#475569"
"""Unresolved composition fill — per-name L3 unavailable, portfolio weight only."""

# ---------------------------------------------------------------------------
# RESERVED — never a data series. Chrome / headers / rules / logo / text only.
# ---------------------------------------------------------------------------
BRAND_NAVY: str = "#002a5e"
"""Headers, rules, logo, chrome. Never a chart data series."""

BODY_INK: str = "#111827"
"""Body text only. Never a chart data series."""

__all__ = [
    "LAYER_COLORS",
    "LAYER_ORDER",
    "GROSS_TOTAL",
    "HOLDINGS_FALLBACK",
    "BRAND_NAVY",
    "BODY_INK",
]
