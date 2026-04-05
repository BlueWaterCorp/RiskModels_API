"""Publication-style Plotly/Matplotlib charts for ERM3."""

from .cascade import plot_attribution_cascade, plot_risk_cascade
from .gallery import (
    MAG7_CAP_WEIGHTS_FALLBACK_EARLY_2026,
    MAG7_SNAPSHOT_DATE_DOC,
    mag7_cap_weighted_positions,
    run_gallery_all,
    run_gallery_mag7_attribution_cascade,
    run_gallery_mag7_l3_er,
    run_gallery_mag7_l3_sigma_rr,
    run_gallery_mag7_risk_cascade,
    run_gallery_nvda_l3,
)
from .mag7_l3_er import (
    MAG7_L3_ER_DEFAULT_TICKERS,
    MAG7_L3_ER_SUBTITLE,
    MAG7_L3_ER_TITLE,
    plot_mag7_l3_explained_risk,
    save_mag7_l3_explained_risk_png,
)
from .mag7_l3_sigma_rr import (
    MAG7_L3_SIGMA_RR_DEFAULT_TICKERS,
    MAG7_L3_SIGMA_RR_SUBTITLE,
    MAG7_L3_SIGMA_RR_TITLE,
    plot_mag7_l3_sigma_rr,
    save_mag7_l3_sigma_rr_png,
)
from .l3_decomposition import plot_l3_horizontal
from .save import (
    save_l3_decomposition_png,
    save_portfolio_attribution_cascade_png,
    save_portfolio_risk_cascade_png,
    write_plotly_png,
)
from .styles import PRESET_REGISTRY, get_preset
from .utils import adjacent_bar_positions, cascade_plotly_layout

__all__ = [
    "MAG7_CAP_WEIGHTS_FALLBACK_EARLY_2026",
    "MAG7_L3_ER_DEFAULT_TICKERS",
    "MAG7_L3_ER_SUBTITLE",
    "MAG7_L3_ER_TITLE",
    "MAG7_L3_SIGMA_RR_DEFAULT_TICKERS",
    "MAG7_L3_SIGMA_RR_SUBTITLE",
    "MAG7_L3_SIGMA_RR_TITLE",
    "MAG7_SNAPSHOT_DATE_DOC",
    "adjacent_bar_positions",
    "cascade_plotly_layout",
    "get_preset",
    "mag7_cap_weighted_positions",
    "plot_attribution_cascade",
    "plot_l3_horizontal",
    "plot_mag7_l3_explained_risk",
    "plot_mag7_l3_sigma_rr",
    "plot_risk_cascade",
    "PRESET_REGISTRY",
    "run_gallery_all",
    "run_gallery_mag7_attribution_cascade",
    "run_gallery_mag7_l3_er",
    "run_gallery_mag7_l3_sigma_rr",
    "run_gallery_mag7_risk_cascade",
    "run_gallery_nvda_l3",
    "save_l3_decomposition_png",
    "save_mag7_l3_explained_risk_png",
    "save_mag7_l3_sigma_rr_png",
    "save_portfolio_attribution_cascade_png",
    "save_portfolio_risk_cascade_png",
    "write_plotly_png",
]
