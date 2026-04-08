"""Shared foundation for visual component dataclasses.

Provides schema versioning, render options, lineage summary, and
the base mixin that gives every component ``to_dict()`` / ``from_dict()``.
"""

from __future__ import annotations

import dataclasses
from typing import Any, Literal

from ..lineage import RiskLineage
from ..snapshots._json_io import _make_serializable

SCHEMA_VERSION = "1.0"


@dataclasses.dataclass(frozen=True)
class RenderOptions:
    """Presentation-only knobs passed to ``plot_*_from_data()`` renderers."""

    theme: Literal["light", "terminal_dark"] = "light"
    width: int = 1200
    height: int = 800
    scale: float = 3.0
    title_override: str | None = None
    subtitle_override: str | None = None


@dataclasses.dataclass
class LineageSummary:
    """Lightweight, serializable subset of :class:`RiskLineage`."""

    model_version: str | None = None
    data_as_of: str | None = None
    factor_set_id: str | None = None

    @classmethod
    def from_risk_lineage(cls, lineage: RiskLineage | None) -> LineageSummary | None:
        if lineage is None:
            return None
        return cls(
            model_version=lineage.model_version,
            data_as_of=lineage.data_as_of,
            factor_set_id=lineage.factor_set_id,
        )


class VisualComponentMixin:
    """Mixin providing JSON-safe ``to_dict()`` and ``from_dict()`` for component dataclasses.

    Subclasses must be ``@dataclass`` classes.
    """

    schema_version: str = SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-safe dict with ``schema_version`` stamp."""
        d = _make_serializable(self)
        d["schema_version"] = self.schema_version
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Any:
        """Reconstruct from a plain dict (e.g. loaded from JSON).

        Validates schema_version and delegates nested reconstruction
        to field-level ``from_dict`` methods where available.
        """
        sv = d.get("schema_version", SCHEMA_VERSION)
        if sv != SCHEMA_VERSION:
            raise ValueError(
                f"Schema version mismatch: expected {SCHEMA_VERSION!r}, got {sv!r}"
            )

        hints = {f.name: f.type for f in dataclasses.fields(cls)}
        kwargs: dict[str, Any] = {}
        for f in dataclasses.fields(cls):
            if f.name == "schema_version":
                continue
            if f.name not in d:
                if f.default is not dataclasses.MISSING:
                    kwargs[f.name] = f.default
                elif f.default_factory is not dataclasses.MISSING:
                    kwargs[f.name] = f.default_factory()
                continue
            val = d[f.name]
            # If the field type has from_dict, use it for nested reconstruction
            ft = hints.get(f.name)
            if isinstance(val, dict) and ft and hasattr(ft, "from_dict"):
                kwargs[f.name] = ft.from_dict(val)
            elif isinstance(val, list) and ft:
                # Try to reconstruct list elements if they have from_dict
                kwargs[f.name] = _reconstruct_list(val, f.name, cls)
            else:
                kwargs[f.name] = val
        return cls(**kwargs)


def _reconstruct_list(items: list, field_name: str, parent_cls: type) -> list:
    """Attempt to reconstruct list items using type hints from the parent class."""
    import typing

    hints = typing.get_type_hints(parent_cls)
    hint = hints.get(field_name)
    if hint is None:
        return items

    # Extract inner type from list[X]
    origin = getattr(hint, "__origin__", None)
    if origin is not list:
        return items
    args = getattr(hint, "__args__", ())
    if not args:
        return items
    inner = args[0]

    if hasattr(inner, "from_dict") and items and isinstance(items[0], dict):
        return [inner.from_dict(item) for item in items]
    return items
