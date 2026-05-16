"""Runtime configuration for the render service.

All knobs come from environment variables so the same container ships to
dev / staging / prod without code changes. Defaults match production.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Settings:
    """Service configuration resolved from environment at startup."""

    # GCS bucket holding canonical-snapshot artifacts.
    # gs://{bucket}/{prefix}/{composition}/{YYYY-MM}/{identifier}.{ext}
    bucket: str
    prefix: str

    # Anchored timestamp for re-render determinism. Production sets this to
    # the trading-day close (e.g. 2026-05-09T16:00:00-05:00 expressed UTC).
    # Must match what the nightly batch uses or live re-renders drift.
    generated_utc_anchor: str | None

    # Logging
    log_level: str

    # Whether to write rendered formats back to GCS (default: yes).
    # Tests set this to False to avoid bucket writes.
    persist_renders: bool

    # Phase 2: enable cache-miss live render. When False (default), cache
    # miss returns 404 cleanly. When True, the service fetches source data,
    # computes the canonical from scratch, writes it to GCS, and serves the
    # result. Disable this if upstream zarr access misbehaves in production.
    live_render: bool

    # Phase 2: zarr root URI for P1 cache-miss compute. Defaults to the
    # ERM3 EODHD zarr path. Used only when live_render is True.
    zarr_root_uri: str


_DEFAULT_BUCKET = "rm_api_data"
_DEFAULT_ZARR_ROOT_URI = "gs://rm_api_data/eodhd"


def load_from_env() -> Settings:
    """Resolve runtime settings from env vars.

    Logs a WARNING for each silent default actually used — operators
    debugging "why is render-svc reading the wrong bucket" can see
    in the startup logs whether the env var was set or whether the
    default kicked in. Closes MASTER_BACKLOG P.6 + P.8 (the two
    silent-default settings paths in this module).
    """
    bucket_env = os.environ.get("RENDER_SVC_BUCKET")
    bucket = bucket_env or _DEFAULT_BUCKET
    if not bucket_env:
        log.warning(
            "RENDER_SVC_BUCKET not set; using default bucket=%r. "
            "Set the env var explicitly to silence this warning and "
            "guarantee cache writes go where you intend.",
            bucket,
        )

    zarr_env = os.environ.get("RENDER_SVC_ZARR_ROOT_URI")
    zarr_root_uri = zarr_env or _DEFAULT_ZARR_ROOT_URI
    if not zarr_env:
        log.warning(
            "RENDER_SVC_ZARR_ROOT_URI not set; using default zarr_root_uri=%r. "
            "Set the env var explicitly to silence this warning and "
            "confirm live_render compute targets the right zarr root.",
            zarr_root_uri,
        )

    return Settings(
        bucket=bucket,
        prefix=os.environ.get("RENDER_SVC_PREFIX", "snapshots"),
        generated_utc_anchor=os.environ.get("RENDER_SVC_GENERATED_UTC") or None,
        log_level=os.environ.get("RENDER_SVC_LOG_LEVEL", "INFO"),
        persist_renders=os.environ.get("RENDER_SVC_PERSIST_RENDERS", "1") != "0",
        live_render=os.environ.get("RENDER_SVC_LIVE_RENDER", "0") == "1",
        zarr_root_uri=zarr_root_uri,
    )
