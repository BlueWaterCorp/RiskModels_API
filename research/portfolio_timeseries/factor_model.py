"""K=4 factor model — style-block residualization (stub).

The K=3 ERM3 cascade (market → sector → subsector → stock-specific residual)
becomes K=4 by inserting a **style** block between subsector and residual. The
style factor must be orthogonalized against the subsector block before it can
be loaded, which needs the methodology (and collinearity check) Aman still owes.

Do NOT invent the style-block methodology here. This module stays a stub until
that documentation is available (see Step 5 / the plan's stretch goal).
"""

from __future__ import annotations


def residualize_style(size, value, subsector_exposure):
    """OLS-project style onto subsector and return the residual.

    Blocked on Aman's K=4 factor-model documentation (style-block methodology
    + collinearity check). Implement in Step 5 only once that is available; do
    not invent the projection convention.
    """
    raise NotImplementedError("Blocked on K=4 factor model docs from Aman (Step 5)")


__all__ = ["residualize_style"]
