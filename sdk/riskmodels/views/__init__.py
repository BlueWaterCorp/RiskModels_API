"""View helpers — small structured payloads for agents and thumbnails (no charts)."""

from .agent_thumbnail import (
    agent_thumbnail,
    classify_residual,
    generate_hedge_hint,
    generate_summary,
    get_dominant_layer,
    get_layer_shares,
)

__all__ = [
    "agent_thumbnail",
    "classify_residual",
    "generate_hedge_hint",
    "generate_summary",
    "get_dominant_layer",
    "get_layer_shares",
]
