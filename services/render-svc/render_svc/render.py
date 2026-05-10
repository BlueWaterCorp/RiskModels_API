"""Render orchestration: GCS canonical JSON → requested format.

Phase 1 scope: cache-hit path. Reads the canonical JSON from GCS, runs the
fast-subset gate, renders the requested format, optionally writes the
rendered bytes back to GCS for future hits.

Phase 2 (after FundData promotion lands): adds cache-miss handling that
fetches raw zarr data and computes the canonical from scratch.
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .gate import fast_subset_check
from .gcs import ObjectStore, canonical_path


class RenderError(Exception):
    """Base class for orchestration errors."""


class CanonicalNotFound(RenderError):
    """The canonical JSON object is not in GCS at the resolved path."""


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


def render_from_gcs(
    *,
    store: ObjectStore,
    prefix: str,
    composition: str,
    identifier: str,
    as_of: str,
    fmt: str,
    persist: bool = True,
) -> RenderResult:
    """Cache-hit render path.

    1. Resolve canonical JSON path.
    2. Read from GCS (raise CanonicalNotFound on miss).
    3. Deserialize → run fast-subset gate (raise GateFailure on failure).
    4. If fmt == "json", return the canonical JSON bytes verbatim.
    5. Otherwise render to the requested format.
    6. Optionally write the rendered bytes back to GCS at the format path.

    Returns the rendered bytes + content type + GCS path the canonical lives at.
    """
    composition = composition.lower()
    fmt = fmt.lower()
    if fmt not in _CONTENT_TYPES:
        raise RenderError(f"format {fmt!r} not supported (json|pdf|png)")

    json_path = canonical_path(prefix, composition, identifier, as_of, "json")
    raw_bytes = store.read(json_path)
    if raw_bytes is None:
        raise CanonicalNotFound(f"gs://.../{json_path} not found")

    if fmt == "json":
        # Verify the canonical is at least loadable + gate-passing before
        # serving it; this catches the case where bad content somehow landed
        # in the bucket.
        snap = _load_canonical(composition, raw_bytes)
        failures = fast_subset_check(snap)
        if failures:
            raise GateFailure(failures)
        return RenderResult(
            data=raw_bytes,
            content_type=_CONTENT_TYPES["json"],
            gcs_path=json_path,
            written_to_cache=False,
        )

    snap = _load_canonical(composition, raw_bytes)
    failures = fast_subset_check(snap)
    if failures:
        raise GateFailure(failures)

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
        written_to_cache=written,
    )
