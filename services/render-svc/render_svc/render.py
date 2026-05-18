"""Render orchestration: GCS canonical JSON → requested format.

Phase 1 (cache-hit): read canonical JSON from GCS, fast-subset gate,
render the requested format, optionally write back.

Phase 2 (cache-miss live render): when canonical JSON missing AND
live render is enabled, fetch source zarr data, compute canonical via
``riskmodels.snapshots.{from_components, from_fund_components}``, run
the full gate, render, and write everything back to GCS so future
requests hit the cache.
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .gate import fast_subset_check
from .gcs import ObjectStore, canonical_path


class RenderError(Exception):
    """Base class for orchestration errors."""


class CanonicalNotFound(RenderError):
    """The canonical JSON object is not in GCS at the resolved path.

    Raised on cache miss when live render is disabled, or when live
    render is enabled but couldn't compute (e.g. ticker not in universe).
    """


class LiveRenderUnavailable(RenderError):
    """Cache-miss path was attempted but live render isn't supported here.

    Raised for compositions that don't yet have a zarr-direct compute
    path wired up (currently F1 / C1 — Phase 2.5 work).
    """


class GateFailure(RenderError):
    """The canonical failed the fast-subset contract gate."""

    def __init__(self, failures: list[str]) -> None:
        super().__init__("; ".join(failures))
        self.failures = failures


_CONTENT_TYPES = {
    "json": "application/json",
    "pdf": "application/pdf",
    "png": "image/png",
}


@dataclass(frozen=True)
class RenderResult:
    """The bytes returned to the caller plus the GCS path the artifact lives at."""

    data: bytes
    content_type: str
    gcs_path: str
    written_to_cache: bool


def _load_canonical(composition: str, raw_bytes: bytes) -> Any:
    """Deserialize canonical JSON bytes into the appropriate dataclass."""
    from riskmodels.snapshots import CanonicalFundSnapshot, CanonicalStockSnapshot

    raw = json.loads(raw_bytes.decode("utf-8"))

    if composition == "p1":
        # CanonicalStockSnapshot.from_json takes a path; we stage to a tempfile.
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
            json.dump(raw, tf)
            tmp_path = tf.name
        try:
            return CanonicalStockSnapshot.from_json(tmp_path)
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    if composition == "f1":
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
            json.dump(raw, tf)
            tmp_path = tf.name
        try:
            return CanonicalFundSnapshot.from_json(tmp_path)
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    raise RenderError(f"composition {composition!r} not yet supported")


def _render(composition: str, snap: Any, fmt: str) -> bytes:
    """Render the canonical to the requested format."""
    from riskmodels.snapshots import (
        render_canonical_fund_to_pdf,
        render_canonical_fund_to_png_bytes,
        render_canonical_to_pdf,
        render_canonical_to_png_bytes,
    )

    if fmt == "png":
        if composition == "p1":
            return render_canonical_to_png_bytes(snap)
        if composition == "f1":
            return render_canonical_fund_to_png_bytes(snap)

    if fmt == "pdf":
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
            tmp_path = tf.name
        try:
            if composition == "p1":
                render_canonical_to_pdf(snap, tmp_path)
            elif composition == "f1":
                render_canonical_fund_to_pdf(snap, tmp_path)
            else:
                raise RenderError(f"composition {composition!r} not yet supported")
            return Path(tmp_path).read_bytes()
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    raise RenderError(f"format {fmt!r} not supported")


def _compute_canonical_p1(
    *,
    ticker: str,
    as_of: str,
    generated_utc: str | None,
    zarr_root_uri: str,
) -> Any:
    """Phase 2 — fetch P1 from zarr and build a CanonicalStockSnapshot.

    Imports the SDK lazily so the cache-hit path doesn't pay the import
    cost. Returns the canonical or raises ``LiveRenderUnavailable`` if
    the SDK doesn't accept the zarr root URI shape (e.g. requires a
    local Path object — that's a Phase 2.5 fix).
    """
    from pathlib import Path

    from riskmodels.snapshots import from_components
    from riskmodels.snapshots.zarr_context import build_p1_from_zarr

    try:
        # The SDK accepts ``Path`` for zarr_root; for GCS-style URIs the
        # underlying xarray.open_zarr will resolve via fsspec when the
        # service environment has gcsfs installed and credentials are
        # set up via Application Default Credentials.
        zarr_root = Path(zarr_root_uri) if not zarr_root_uri.startswith("gs://") else zarr_root_uri  # type: ignore[assignment]
        p1 = build_p1_from_zarr(
            ticker=ticker,
            zarr_root=zarr_root,  # type: ignore[arg-type]
            as_of_date=as_of,
        )
    except (TypeError, ValueError, FileNotFoundError) as exc:
        raise LiveRenderUnavailable(
            f"zarr-direct P1 fetch failed for {ticker}@{as_of}: {exc}"
        ) from exc

    return from_components(p1, generated_utc=generated_utc)


def _compute_canonical_f1(
    *,
    bw_fund_id: str,
    as_of: str,
    generated_utc: str | None,
) -> Any:
    """Phase 2 — fetch F1 from per-fund zarrs and build a CanonicalFundSnapshot.

    F1's data path reads ``gs://rm_api_data/ERM3_Funds/bw_fund_id/{id}/ds_*.zarr/``
    directly via the public SDK (no Supabase enrichment). The Supabase-backed
    enrichment lives in BWMACRO and is unavailable in this service.
    """
    from riskmodels.snapshots import from_fund_components, get_data_for_f1

    try:
        fd = get_data_for_f1(bw_fund_id)
    except Exception as exc:
        raise LiveRenderUnavailable(
            f"zarr-direct F1 fetch failed for {bw_fund_id}@{as_of}: {exc}"
        ) from exc

    return from_fund_components(fd, generated_utc=generated_utc)


def render_from_gcs(
    *,
    store: ObjectStore,
    prefix: str,
    composition: str,
    identifier: str,
    as_of: str,
    fmt: str,
    persist: bool = True,
    live_render: bool = False,
    generated_utc: str | None = None,
    zarr_root_uri: str = "gs://rm_api_data/eodhd",
    compute_p1: Callable[..., Any] | None = None,
    compute_f1: Callable[..., Any] | None = None,
) -> RenderResult:
    """Render path: cache hit fast → cache miss live (when enabled).

    1. Resolve canonical JSON path.
    2. Read from GCS.
    3. **Cache hit:** deserialize → fast-subset gate → render → optionally
       write back the rendered format.
    4. **Cache miss + live_render disabled:** raise ``CanonicalNotFound``.
    5. **Cache miss + live_render enabled:** call the composition's compute
       function → run fast-subset gate → render → write canonical JSON +
       rendered format to GCS for future hits → return.

    ``compute_p1`` / ``compute_f1`` injection points exist for tests; in
    production they default to ``_compute_canonical_p1`` / ``_compute_canonical_f1``.
    """
    composition = composition.lower()
    fmt = fmt.lower()
    if fmt not in _CONTENT_TYPES:
        raise RenderError(f"format {fmt!r} not supported (json|pdf|png)")

    json_path = canonical_path(prefix, composition, identifier, as_of, "json")
    raw_bytes = store.read(json_path)

    cache_miss_filled = False
    if raw_bytes is None:
        if not live_render:
            raise CanonicalNotFound(f"gs://.../{json_path} not found")

        # Phase 2: live render path.
        compute_p1 = compute_p1 or _compute_canonical_p1
        compute_f1 = compute_f1 or _compute_canonical_f1

        if composition == "p1":
            snap = compute_p1(
                ticker=identifier,
                as_of=as_of,
                generated_utc=generated_utc,
                zarr_root_uri=zarr_root_uri,
            )
        elif composition == "f1":
            snap = compute_f1(
                bw_fund_id=identifier,
                as_of=as_of,
                generated_utc=generated_utc,
            )
        else:
            raise LiveRenderUnavailable(
                f"composition {composition!r} has no live-render compute path"
            )

        failures = fast_subset_check(snap)
        if failures:
            raise GateFailure(failures)

        # Persist the freshly-computed canonical JSON so future requests hit
        # the cache. ``snap.to_json`` writes via tempfile; we read the bytes
        # back and upload.
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
            tmp_path = tf.name
        try:
            snap.to_json(tmp_path)
            raw_bytes = Path(tmp_path).read_bytes()
        finally:
            Path(tmp_path).unlink(missing_ok=True)

        if persist:
            store.write(json_path, raw_bytes, content_type=_CONTENT_TYPES["json"])
        cache_miss_filled = True
    else:
        snap = _load_canonical(composition, raw_bytes)
        failures = fast_subset_check(snap)
        if failures:
            raise GateFailure(failures)

    if fmt == "json":
        return RenderResult(
            data=raw_bytes,
            content_type=_CONTENT_TYPES["json"],
            gcs_path=json_path,
            written_to_cache=cache_miss_filled,
        )

    rendered = _render(composition, snap, fmt)

    target_path = canonical_path(prefix, composition, identifier, as_of, fmt)
    written = False
    if persist:
        store.write(target_path, rendered, content_type=_CONTENT_TYPES[fmt])
        written = True

    return RenderResult(
        data=rendered,
        content_type=_CONTENT_TYPES[fmt],
        gcs_path=target_path,
        written_to_cache=written or cache_miss_filled,
    )
