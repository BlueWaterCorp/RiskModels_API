"""``client.visuals.*`` facades for PNG helpers (lazy import of ``visuals.save``)."""

from __future__ import annotations

from typing import Any


class ClientVisuals:
    def __init__(self, client: Any) -> None:
        self._client = client

    def save_l3_decomposition_png(self, **kwargs: Any) -> Any:
        from .save import save_l3_decomposition_png

        return save_l3_decomposition_png(self._client, **kwargs)

    def save_portfolio_risk_cascade_png(self, **kwargs: Any) -> Any:
        from .save import save_portfolio_risk_cascade_png

        return save_portfolio_risk_cascade_png(self._client, **kwargs)

    def save_portfolio_attribution_cascade_png(self, **kwargs: Any) -> Any:
        from .save import save_portfolio_attribution_cascade_png

        return save_portfolio_attribution_cascade_png(self._client, **kwargs)

    def save_mag7_l3_explained_risk_png(self, **kwargs: Any) -> Any:
        from .mag7_l3_er import save_mag7_l3_explained_risk_png

        return save_mag7_l3_explained_risk_png(self._client, **kwargs)

    def save_mag7_l3_sigma_rr_png(self, **kwargs: Any) -> Any:
        from .mag7_l3_sigma_rr import save_mag7_l3_sigma_rr_png

        return save_mag7_l3_sigma_rr_png(self._client, **kwargs)


__all__ = ["ClientVisuals"]
