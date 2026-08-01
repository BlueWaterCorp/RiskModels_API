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

    # Whether Supabase credentials are present for holdings enrichment.
    #
    # Not a knob — an observation. ``get_data_for_f1`` enriches fund holdings
    # via ``enrich_fund_data_with_supabase``, which resolves bw_sym_id → ticker
    # and attaches per-holding L3 risk shares. Every Supabase read in that path
    # soft-fails to ``[]`` when credentials are missing, by design, so that pip
    # consumers without keys still work. In a *service* that same design turns
    # into a silent wrong answer: fund and client_portfolio renders return
    # HTTP 200 with raw ``BW-BBG…`` labels and every risk share ``None`` — a
    # structurally valid, completely empty stacked bar. Nothing errors, so
    # nothing alerts.
    #
    # Recording it here makes the degradation legible at startup and on
    # /readyz instead of only in the pixels.
    #
    # Defaults to False — "assume degraded until proven otherwise". A caller
    # constructing Settings by hand (tests, fixtures) has not resolved
    # credentials, and claiming enrichment works would be the same optimistic
    # guess this field exists to remove.
    holdings_enrichment_available: bool = False


_DEFAULT_BUCKET = "rm_api_data"
_DEFAULT_ZARR_ROOT_URI = "gs://rm_api_data/eodhd"


def _supabase_credentials_present() -> tuple[bool, str | None]:
    """Mirror ``_supabase_creds`` in ``riskmodels.snapshots._fund_data``.

    Both naming conventions count, because the SDK accepts either.

    Returns ``(usable, warning)``. Presence is deliberately not the whole
    test: on 2026-08-01 this service was wired with a well-formed
    ``service_role`` JWT that Supabase rejected with 401 *Legacy API keys are
    disabled* (they were turned off 2026-07-06). A presence-only check called
    that configuration healthy while every fund chart still rendered blank —
    the same silent-wrong-answer this whole field exists to surface, just
    moved one level up.

    A live probe would be the real test, but it costs a network round trip at
    import time. The cheap discriminator is the key format: legacy keys are
    JWTs (``eyJ…``), current keys are ``sb_secret_…`` / ``sb_publishable_…``.
    A JWT here is almost certainly disabled, so say so.
    """
    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or ""
    ).strip()
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or ""
    ).strip()
    if not (url and key):
        return False, None
    if key.startswith("eyJ"):
        return False, (
            "Supabase key is a legacy JWT (eyJ…). Legacy anon/service_role keys were "
            "disabled 2026-07-06 and return 401, which the SDK soft-fails into an "
            "un-enriched render. Use the sb_secret_… key from Doppler erm3/prd."
        )
    return True, None


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

    enrichment, credential_warning = _supabase_credentials_present()
    if credential_warning:
        log.warning("Holdings enrichment will not work: %s", credential_warning)
    elif not enrichment:
        log.warning(
            "Supabase credentials absent (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, "
            "or the NEXT_PUBLIC_* pair). Holdings enrichment will silently no-op: "
            "fund renders will return HTTP 200 carrying raw bw_sym_id labels and "
            "null risk shares — a valid-looking, empty chart. Set the credentials "
            "(Doppler erm3/prd) to restore ticker resolution and L3 shares."
        )

    return Settings(
        bucket=bucket,
        prefix=os.environ.get("RENDER_SVC_PREFIX", "snapshots"),
        generated_utc_anchor=os.environ.get("RENDER_SVC_GENERATED_UTC") or None,
        log_level=os.environ.get("RENDER_SVC_LOG_LEVEL", "INFO"),
        persist_renders=os.environ.get("RENDER_SVC_PERSIST_RENDERS", "1") != "0",
        live_render=os.environ.get("RENDER_SVC_LIVE_RENDER", "0") == "1",
        zarr_root_uri=zarr_root_uri,
        holdings_enrichment_available=enrichment,
    )
