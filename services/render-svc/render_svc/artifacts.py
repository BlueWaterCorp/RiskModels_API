"""``POST /artifacts/render`` — Phase 1B artifact registry endpoint.

Cache-first artifact rendering for the artifact registry described in
``BWMACRO/docs/architecture/intelligence_runtime/ARTIFACT_REGISTRY.md``.

Request flow
------------
1. Validate the request shape (slug / version / subject_id / as_of / format).
2. Resolve ``subject_kind`` from ``subject_id`` prefix.
3. Load subject data via the public SDK (today: ``riskmodels.snapshots.
   get_data_for_f1`` for funds).
4. Compose the GCS key
   ``{prefix}/artifacts/{slug}@{version}/{subject_id}/{resolved_as_of}.{ext}``.
   ``resolved_as_of`` is whatever the loader actually picked (the SDK's
   "latest valid period" today; an arbitrary historical as_of is Phase 2).
5. Cache hit → return bytes.
6. Cache miss → import ``bwmacro.snapshots.artifacts.{slug}.{version}``,
   check ``subject_kind`` against the module's ``APPLICABLE_SUBJECT_KINDS``,
   pick the matching adapter, render, write to GCS (idempotent on the
   render-once key), return bytes.

Phase 1B deliberately defers
----------------------------
- Postgres ``artifact_registry`` UPSERT — Dagster reconciliation job
  populates the table from GCS in a follow-on. The GCS object existence
  is the v1 source of truth.
- Arbitrary historical ``as_of`` — the SDK loader doesn't yet accept an
  as_of param; threading it through is a follow-on (returns 501 today).
- ``subject_kind != fund`` — filer / ETF / cohort / client adapters land
  as their Phase 2 artifact rows ship.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

from .gcs import ObjectStore

log = logging.getLogger(__name__)


# Subject_id prefix → subject_kind, mirroring the artifact contract's
# applicable_subject_kinds vocabulary.
_SUBJECT_PREFIX_KIND: dict[str, str] = {
    "BW-FUND-": "fund",
    "BW-ETF-": "etf",
    "BW-FILER-": "filer_13f",
    "BW-COHORT-": "cohort",
    "BW-STOCK-": "stock",
    "BW-PORTFOLIO-": "client_portfolio",
}

_FORMAT_MIME: dict[str, str] = {
    "json": "application/json",
    "png": "image/png",
    "svg": "image/svg+xml",
}


class ArtifactRenderRequest(BaseModel):
    """Request body for ``POST /artifacts/render``."""

    slug: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    version: str = Field(..., pattern=r"^v\d+$")
    subject_id: str = Field(..., min_length=1, max_length=128)
    as_of: str = Field(
        ...,
        description="ISO date 'YYYY-MM-DD' or the literal 'latest'",
        pattern=r"^(latest|\d{4}-\d{2}-\d{2})$",
    )
    format: Literal["json", "png", "svg"] = "json"
    subject_payload: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Inline subject data for kinds the server can't resolve from a "
            "stable identifier (today: client_portfolio). Required when "
            "subject_kind == 'client_portfolio'; the GCS cache key is "
            "derived from a stable hash of the payload so render-once "
            "still holds for identical pastes."
        ),
    )


def _resolve_subject_kind(subject_id: str) -> str:
    for prefix, kind in _SUBJECT_PREFIX_KIND.items():
        if subject_id.startswith(prefix):
            return kind
    raise HTTPException(
        status_code=422,
        detail=(
            f"Unrecognized subject_id prefix in {subject_id!r}; "
            f"expected one of {sorted(_SUBJECT_PREFIX_KIND)}"
        ),
    )


def _artifact_gcs_path(
    prefix: str,
    slug: str,
    version: str,
    subject_id: str,
    resolved_as_of: str,
    fmt: str,
) -> str:
    return f"{prefix.rstrip('/')}/artifacts/{slug}@{version}/{subject_id}/{resolved_as_of}.{fmt}"


def _import_artifact_module(slug: str, version: str) -> Any:
    """Lazy import of ``bwmacro.snapshots.artifacts.{slug}.{version}``."""
    qualname = f"bwmacro.snapshots.artifacts.{slug}.{version}"
    try:
        return importlib.import_module(qualname)
    except ImportError as exc:
        log.warning("artifact module not found: %s", qualname)
        raise HTTPException(
            status_code=404,
            detail=f"Artifact {slug}@{version} not found",
        ) from exc


def _adapter_for(slug: str, subject_kind: str) -> Callable[[Any], Any]:
    """Resolve the adapter for ``(slug, subject_kind)``.

    Currently wired:
      - fund: ``top_holdings_erm_stacked``, ``cumulative_return_strip``
      - client_portfolio: ``top_holdings_erm_stacked``

    Filer / ETF / cohort adapters land alongside their Phase 2 artifact
    rows in ``BWMACRO/src/bwmacro/snapshots/artifacts/adapters.py``.
    """
    from bwmacro.snapshots.artifacts import adapters

    if subject_kind == "fund":
        if slug == "top_holdings_erm_stacked":
            return lambda fd: adapters.holdings_from_fund_data(fd, top_n=12)
        if slug == "cumulative_return_strip":
            return adapters.cumulative_return_series_from_fund_data
        raise HTTPException(
            status_code=501,
            detail=(
                f"No fund adapter wired for slug={slug!r} "
                f"(add to bwmacro.snapshots.artifacts.adapters)"
            ),
        )

    if subject_kind == "client_portfolio":
        if slug == "top_holdings_erm_stacked":
            return lambda positions: adapters.holdings_from_client_portfolio(
                positions, top_n=12
            )
        raise HTTPException(
            status_code=501,
            detail=(
                f"No client_portfolio adapter wired for slug={slug!r} "
                f"(only top_holdings_erm_stacked is widened so far)"
            ),
        )

    raise HTTPException(
        status_code=501,
        detail=(
            f"subject_kind={subject_kind!r} adapter not yet wired "
            f"(Phase 2 task; see ARTIFACT_REGISTRY.md §13)"
        ),
    )


def _payload_hash(positions: list[dict]) -> str:
    """Stable 16-char hex hash of a positions list (for the GCS cache key).

    Round-trips the list through ``json.dumps(sort_keys=True)`` so two
    equivalent payloads with different key ordering hash to the same
    digest. Truncates to 16 hex chars (64 bits) — enough collision
    resistance for an artifact-registry cache key, short enough to stay
    readable in URLs and logs.
    """
    canonical = json.dumps(positions, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _resolve_client_portfolio(
    req: "ArtifactRenderRequest",
) -> tuple[list[dict], str, str]:
    """Validate + resolve a client_portfolio request.

    Returns ``(positions, resolved_subject_id, resolved_as_of)``.

    - ``positions`` is the raw list from ``subject_payload['positions']``.
    - ``resolved_subject_id`` is ``BW-PORTFOLIO-<payload-hash>`` so two
      pastes of the same portfolio hit the same GCS key (render-once).
    - ``resolved_as_of`` is today's UTC date when the request asks for
      ``latest`` (a pasted portfolio is time-anchored to the paste), or
      the literal ISO date the caller supplied.
    """
    if req.subject_payload is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "subject_payload is required for subject_kind='client_portfolio'. "
                "Pass the workspace snapshot positions list under the "
                "'positions' key."
            ),
        )
    positions = req.subject_payload.get("positions")
    if not isinstance(positions, list) or not positions:
        raise HTTPException(
            status_code=400,
            detail=(
                "subject_payload.positions must be a non-empty list of "
                "position rows (ticker / weight / l3_*_er fields)."
            ),
        )

    resolved_subject_id = f"BW-PORTFOLIO-{_payload_hash(positions)}"
    if req.as_of == "latest":
        resolved_as_of = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    else:
        resolved_as_of = req.as_of
    return positions, resolved_subject_id, resolved_as_of


def _load_subject_data(subject_id: str, subject_kind: str, as_of: str) -> Any:
    """Load subject data + verify the loader's resolved as_of.

    Phase 1B: only ``subject_kind == "fund"`` is wired, and only
    ``as_of == "latest"`` (or an as_of matching the loader's resolved
    latest_report_date) is supported. Arbitrary historical as_of is a
    Phase 2 task (the SDK ``get_data_for_f1`` doesn't yet accept an
    ``as_of`` parameter).
    """
    if subject_kind != "fund":
        raise HTTPException(
            status_code=501,
            detail=f"subject_kind={subject_kind!r} loader not wired (Phase 2)",
        )

    from riskmodels.snapshots import get_data_for_f1

    try:
        fd = get_data_for_f1(subject_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("get_data_for_f1 failed for %s", subject_id)
        raise HTTPException(
            status_code=502,
            detail=f"Subject loader failed for {subject_id!r}: {exc}",
        ) from exc

    resolved = getattr(fd, "teo", None)
    if not resolved:
        raise HTTPException(
            status_code=502,
            detail=f"Subject {subject_id!r} has no resolved as_of from loader",
        )

    if as_of != "latest" and as_of != resolved:
        raise HTTPException(
            status_code=501,
            detail=(
                f"as_of={as_of!r} differs from loader's resolved {resolved!r}; "
                f"specific historical as_of is Phase 2. Use as_of='latest' "
                f"or as_of={resolved!r}."
            ),
        )

    return fd, resolved


def _render_bytes(mod: Any, data: Any, fmt: str) -> bytes:
    """Materialize the artifact in the requested format."""
    if fmt == "json":
        return json.dumps(mod.render_data(data), separators=(",", ":")).encode("utf-8")
    fig = mod.render_figure(data)
    if fmt == "png":
        return fig.to_image(format="png", scale=2.0)
    if fmt == "svg":
        return fig.to_image(format="svg")
    raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt!r}")


def _receipt_id(gcs_path: str) -> str:
    """Stable 8-hex-char receipt token derived from the GCS path.

    The masthead's "#run_seq" line on the LANDING workspace wants a short
    versioned-record identifier. For artifact-registry-backed records this
    is a deterministic hash of the GCS key (which already encodes
    slug@version, subject_id, as_of, and format). Two views of the same
    artifact instance share the same receipt id.

    The portfolio_snapshots-backed path uses an integer ``run_seq`` from
    its own table; the receipt id here looks visually identical when
    rendered as "#a1b2c3d4". Soft unification per the artifact-registry →
    LANDING handoff doc dated 2026-05-15.
    """
    return hashlib.sha256(gcs_path.encode("utf-8")).hexdigest()[:8]


def _cache_control_for(requested_as_of: str) -> str:
    """Pick the Cache-Control header value.

    Explicit ISO dates → forever-immutable (the render-once contract
    means the bytes never change for that key). ``as_of=latest`` →
    1 hour (so nightly re-renders propagate within the hour).
    """
    if requested_as_of == "latest":
        return "public, max-age=3600"
    return "public, max-age=31536000, immutable"


def render_artifact(
    req: ArtifactRenderRequest,
    *,
    store: ObjectStore,
    prefix: str,
    persist: bool = True,
) -> tuple[bytes, str, str, str, str, str]:
    """Render one artifact instance.

    Returns ``(bytes, content_type, gcs_path, resolved_as_of, cache_control,
    receipt_id)``. ``receipt_id`` is an 8-hex-char stable hash of the GCS
    path — see ``_receipt_id`` for the LANDING-masthead unification
    rationale.
    """
    subject_kind = _resolve_subject_kind(req.subject_id)

    if subject_kind == "client_portfolio":
        # Subject data is supplied inline; cache key is payload-hash-derived.
        subject_data, resolved_subject_id, resolved_as_of = _resolve_client_portfolio(req)
    else:
        # Loader-resolved path (fund today; etf / filer / cohort to follow).
        subject_data, resolved_as_of = _load_subject_data(
            req.subject_id, subject_kind, req.as_of
        )
        resolved_subject_id = req.subject_id

    gcs_path = _artifact_gcs_path(
        prefix, req.slug, req.version, resolved_subject_id, resolved_as_of, req.format
    )
    receipt_id = _receipt_id(gcs_path)

    raw = store.read(gcs_path)
    if raw is not None:
        return (
            raw,
            _FORMAT_MIME[req.format],
            gcs_path,
            resolved_as_of,
            _cache_control_for(req.as_of),
            receipt_id,
        )

    # Cache miss → live render.
    mod = _import_artifact_module(req.slug, req.version)

    applicable = tuple(getattr(mod, "APPLICABLE_SUBJECT_KINDS", ()))
    if subject_kind not in applicable:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Artifact {req.slug}@{req.version} not applicable to "
                f"subject_kind={subject_kind!r} "
                f"(supports: {list(applicable)})"
            ),
        )

    adapter = _adapter_for(req.slug, subject_kind)
    normalized = adapter(subject_data)
    rendered = _render_bytes(mod, normalized, req.format)

    if persist:
        store.write(gcs_path, rendered, content_type=_FORMAT_MIME[req.format])

    return (
        rendered,
        _FORMAT_MIME[req.format],
        gcs_path,
        resolved_as_of,
        _cache_control_for(req.as_of),
        receipt_id,
    )
