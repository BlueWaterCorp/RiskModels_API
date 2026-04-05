"""Ready-made gallery recipes: NVDA L3 + MAG7 cap-weighted portfolio cascades.

Weights from ``market_cap`` use live ``get_metrics`` data when available; otherwise a documented
early-2026 illustrative cap-share snapshot is used (not from a single exchange close).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from ._mag7 import (
    MAG7_CAP_WEIGHTS_FALLBACK_EARLY_2026,
    MAG7_SNAPSHOT_DATE_DOC,
    mag7_cap_weighted_positions,
)
from .mag7_l3_er import save_mag7_l3_explained_risk_png
from .mag7_l3_sigma_rr import save_mag7_l3_sigma_rr_png
from .save import (
    save_l3_decomposition_png,
    save_portfolio_attribution_cascade_png,
    save_portfolio_risk_cascade_png,
)


def run_gallery_mag7_l3_er(
    client: Any,
    output_dir: str | Path = ".",
    *,
    filename: str = "mag7_l3_explained_risk.png",
    title: str | None = None,
    subtitle: str | None = None,
    **kwargs: Any,
) -> Path:
    """Article-style MAG7 L3 explained-risk bars (variance fractions; ``er_systematic`` annotations)."""
    out = Path(output_dir)
    return save_mag7_l3_explained_risk_png(
        client,
        filename=out / filename,
        title=title,
        subtitle=subtitle,
        **kwargs,
    )


def run_gallery_mag7_l3_sigma_rr(
    client: Any,
    output_dir: str | Path = ".",
    *,
    filename: str = "mag7_l3_sigma_rr.png",
    title: str | None = None,
    subtitle: str | None = None,
    theme: str = "light",
    **kwargs: Any,
) -> Path:
    """Article-style MAG7 L3 σ-scaled RR+HR bars (annualized vol × risk ratios)."""
    out = Path(output_dir)
    return save_mag7_l3_sigma_rr_png(
        client,
        filename=out / filename,
        title=title,
        subtitle=subtitle,
        theme=theme,
        **kwargs,
    )


def run_gallery_nvda_l3(
    client: Any,
    output_dir: str | Path = ".",
    *,
    filename: str = "nvda_l3_risk.png",
    title: str | None = None,
    subtitle: str | None = None,
    **kwargs: Any,
) -> Path:
    """Save σ-scaled L3 decomposition for NVDA (live batch metrics)."""
    out = Path(output_dir)
    return save_l3_decomposition_png(
        client,
        filename=out / filename,
        ticker="NVDA",
        title=title or "NVDA — L3 risk decomposition",
        subtitle=subtitle,
        **kwargs,
    )


def run_gallery_mag7_risk_cascade(
    client: Any,
    output_dir: str | Path = ".",
    *,
    filename: str = "mag7_risk_cascade.png",
    title: str | None = None,
    subtitle: str | None = None,
    **kwargs: Any,
) -> tuple[Path, Literal["market_cap", "fallback_early_2026"]]:
    positions, src = mag7_cap_weighted_positions(client)
    if subtitle is None:
        subtitle = (
            f"MAG7 cap-weighted · weights: {src}"
            + (f" · fallback doc: {MAG7_SNAPSHOT_DATE_DOC}" if src == "fallback_early_2026" else "")
        )
    out = Path(output_dir)
    path = save_portfolio_risk_cascade_png(
        client,
        positions=positions,
        filename=out / filename,
        title=title or "MAG7 — L3 risk cascade",
        subtitle=subtitle,
        **kwargs,
    )
    return path, src


def run_gallery_mag7_attribution_cascade(
    client: Any,
    output_dir: str | Path = ".",
    *,
    filename: str = "mag7_attribution_cascade.png",
    title: str | None = None,
    subtitle: str | None = None,
    **kwargs: Any,
) -> tuple[Path, Literal["market_cap", "fallback_early_2026"]]:
    positions, src = mag7_cap_weighted_positions(client)
    if subtitle is None:
        subtitle = (
            f"MAG7 cap-weighted · weights: {src}"
            + (f" · fallback doc: {MAG7_SNAPSHOT_DATE_DOC}" if src == "fallback_early_2026" else "")
        )
    out = Path(output_dir)
    path = save_portfolio_attribution_cascade_png(
        client,
        positions=positions,
        filename=out / filename,
        title=title or "MAG7 — attribution proxy cascade",
        subtitle=subtitle,
        **kwargs,
    )
    return path, src


_GALLERY_COMMON_KW = frozenset(
    {"width", "height", "scale", "dpi", "figsize", "engine", "years", "validate", "er_tolerance"},
)


def run_gallery_all(
    client: Any,
    output_dir: str | Path = ".",
    **kwargs: Any,
) -> list[Path]:
    """Write NVDA L3 + MAG7 L3 ER + MAG7 risk + MAG7 attribution PNGs into ``output_dir``.

    Only export-related keys (``width``, ``height``, ``scale``, ``dpi``, ``figsize``, ``engine``,
    ``years``, ``validate``, ``er_tolerance``) are forwarded to each chart; pass the ``run_gallery_*``
    functions individually for custom titles.
    """
    common = {k: v for k, v in kwargs.items() if k in _GALLERY_COMMON_KW}
    out: list[Path] = []
    out.append(run_gallery_nvda_l3(client, output_dir, **common))
    out.append(run_gallery_mag7_l3_er(client, output_dir, **common))
    out.append(run_gallery_mag7_l3_sigma_rr(client, output_dir, **common))
    p1, _ = run_gallery_mag7_risk_cascade(client, output_dir, **common)
    out.append(p1)
    p2, _ = run_gallery_mag7_attribution_cascade(client, output_dir, **common)
    out.append(p2)
    return out


__all__ = [
    "MAG7_CAP_WEIGHTS_FALLBACK_EARLY_2026",
    "MAG7_SNAPSHOT_DATE_DOC",
    "mag7_cap_weighted_positions",
    "run_gallery_all",
    "run_gallery_mag7_attribution_cascade",
    "run_gallery_mag7_l3_er",
    "run_gallery_mag7_l3_sigma_rr",
    "run_gallery_mag7_risk_cascade",
    "run_gallery_nvda_l3",
]
