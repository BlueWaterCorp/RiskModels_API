"""Ticker normalization and curated aliases."""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass
from typing import Any

from .exceptions import ValidationWarning
from .mapping import TICKER_ALIAS_MAP

logger = logging.getLogger("riskmodels")


@dataclass
class ResolutionNote:
    raw: str
    canonical: str
    reason: str


def resolve_ticker(
    raw: str,
    client: Any = None,
    *,
    context: str = "metrics",
) -> tuple[str, ResolutionNote | None]:
    """
    Return (canonical_upper_ticker, note_if_changed).
    If client is provided, future versions may call /tickers search for ambiguous cases.

    On alias remap (e.g. GOOGL→GOOG), logs **info** and emits **ValidationWarning** so agents
    refresh their symbol universe and use the canonical ticker in follow-up calls.
    """
    del client, context  # reserved for API-backed resolution
    t = raw.strip().upper()
    if not t:
        raise ValueError("Empty ticker")
    mapped = TICKER_ALIAS_MAP.get(t)
    if mapped and mapped != t:
        note = ResolutionNote(raw=t, canonical=mapped, reason="curated_share_class_alias")
        logger.info("Resolved ticker %s → %s (%s)", t, mapped, note.reason)
        warnings.warn(
            ValidationWarning(
                f"Ticker {t} was resolved to canonical symbol {mapped} ({note.reason}).",
                fix=(
                    "Update your working symbol and portfolio keys to the canonical ticker for all "
                    "subsequent SDK calls so results align with the API universe."
                ),
            ),
            stacklevel=2,
        )
        return mapped, note
    return t, None
