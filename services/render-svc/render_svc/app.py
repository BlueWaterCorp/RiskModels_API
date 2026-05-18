"""FastAPI app: ``POST /render`` + health probes.

Exposes the cache-hit render path. Cache miss returns 404; live render
from raw zarr data is Phase 2.
"""

from __future__ import annotations

import functools
import logging
from typing import Any, Literal

import xarray as xr
from fastapi import Body, FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

from .artifacts import ArtifactRenderRequest, render_artifact
from .gcs import GcsObjectStore, ObjectStore
from .portfolio_evolution import KERNEL_VERSION, compute_portfolio_evolution
from .render import (
    CanonicalNotFound,
    GateFailure,
    LiveRenderUnavailable,
    RenderError,
    render_from_gcs,
)
from .settings import Settings, load_from_env


class RenderRequest(BaseModel):
    """Request body for ``POST /render``.

    Defined at module scope (not inside ``_make_app``) so pydantic v2 can
    resolve the type adapter — closures defeat the v2 type machinery.
    """

    composition: Literal["p1", "f1", "c1"] = Field(..., description="Snapshot family")
    identifier: str = Field(..., min_length=1, max_length=64)
    as_of: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    format: Literal["json", "pdf", "png"] = "pdf"


class PortfolioEvolutionRequest(BaseModel):
    """Request body for ``POST /portfolio-evolution`` (The Analyst M4)."""

    portfolio_id: str = Field(..., min_length=1, max_length=128)
    portfolio_history: list[dict[str, Any]] = Field(
        ..., description="M3c CmlPortfolioSnapshot[] jsonb shape: [{as_of_date, holdings, ingest_adapter}, ...]"
    )
    include_full_breakdown: bool = False


@functools.lru_cache(maxsize=1)
def _load_erm3_resources(zarr_root_uri: str) -> tuple[xr.Dataset, dict[str, str]]:
    """Open the ERM3 monthly zarr and build the ticker→symbol bridge from its
    coords. Cached per-process; the zarr is ~14MB and we want one open per
    worker. Override via monkeypatch in tests."""
    em_uri = f"{zarr_root_uri.rstrip('/')}/ds_erm3_monthly_SPY_uni_mc_3000.zarr"
    em = xr.open_zarr(em_uri)
    tickers = em["ticker"].values
    symbols = em["symbol"].values
    bridge: dict[str, str] = {}
    for t, s in zip(tickers, symbols):
        ts = str(t).strip().upper()
        if not ts or ts == "NAN":
            continue
        bridge[ts] = str(s)
    return em, bridge


def _make_app(settings: Settings, store: ObjectStore) -> FastAPI:
    app = FastAPI(
        title="riskmodels-render-svc",
        version="0.1.0",
        docs_url=None,  # internal service; no public docs
        redoc_url=None,
    )

    log = logging.getLogger("render_svc")

    @app.get("/health")
    def health() -> dict[str, str]:
        # ``/healthz`` is intentionally NOT used: Google's Cloud Run frontend
        # intercepts that path and returns its own 404 before requests reach
        # the user container.
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz() -> dict[str, str]:
        # Cheap readiness probe: confirm the store can resolve a HEAD on a
        # known-not-existent path (proves credentials + connectivity work).
        try:
            store.head("__readyz_probe__")
            return {"status": "ready", "bucket": settings.bucket}
        except Exception as exc:  # noqa: BLE001
            log.exception("readiness probe failed")
            raise HTTPException(status_code=503, detail=f"not ready: {exc}")

    @app.post("/render")
    def render(req: RenderRequest = Body(...)):
        try:
            result = render_from_gcs(
                store=store,
                prefix=settings.prefix,
                composition=req.composition,
                identifier=req.identifier,
                as_of=req.as_of,
                fmt=req.format,
                persist=settings.persist_renders,
                live_render=settings.live_render,
                generated_utc=settings.generated_utc_anchor,
                zarr_root_uri=settings.zarr_root_uri,
            )
        except CanonicalNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except LiveRenderUnavailable as exc:
            log.warning("live render unavailable: %s", exc)
            raise HTTPException(status_code=503, detail=str(exc))
        except GateFailure as exc:
            log.error("contract gate failed: %s", exc.failures)
            raise HTTPException(
                status_code=422,
                detail={"gate_failures": exc.failures},
            )
        except RenderError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        return Response(
            content=result.data,
            media_type=result.content_type,
            headers={
                "X-Canonical-Path": f"gs://{settings.bucket}/{result.gcs_path}",
                "X-Cache-Written": "1" if result.written_to_cache else "0",
            },
        )

    @app.post("/artifacts/render")
    def post_artifacts_render(req: ArtifactRenderRequest = Body(...)):
        """Artifact registry render endpoint — see render_svc.artifacts.

        Cache-first; live-renders on GCS miss by importing
        `bwmacro.snapshots.artifacts.{slug}.{version}` and calling its
        `render_data` / `render_figure`. Phase 1B scope: fund subjects +
        as_of='latest'. See ARTIFACT_REGISTRY_PHASE_1B_PLAN.md §10.
        """
        data, mime, gcs_path, resolved_as_of, cache_control, receipt_id = render_artifact(
            req,
            store=store,
            prefix=settings.prefix,
            persist=settings.persist_renders,
        )
        return Response(
            content=data,
            media_type=mime,
            headers={
                "X-Artifact-GCS-Path": f"gs://{settings.bucket}/{gcs_path}",
                "X-Artifact-Resolved-As-Of": resolved_as_of,
                "X-Artifact-Receipt-Id": receipt_id,
                "Cache-Control": cache_control,
            },
        )

    @app.get("/portfolio-evolution/health")
    def portfolio_evolution_health() -> dict[str, Any]:
        """Diagnostic probe for the ERM3 monthly zarr open path.

        The ``POST /portfolio-evolution`` endpoint converts every load
        failure into a 503 with a generic ``"ERM3 monthly unavailable"``
        prefix — useful for the API contract, but it hides the underlying
        error class (gcsfs auth vs missing zarr vs xarray engine vs
        anything else) so root-cause diagnosis requires turning on
        xarray/gcsfs debug logging in production. This endpoint always
        attempts a fresh open + returns the underlying error class +
        message + the zarr URI it tried, so an operator can curl this
        once and see which gap is biting without code changes.

        On success: 200 with ``status="ok"`` + zarr URI + n_tickers in
        the resolved bridge (proves the zarr opened AND the ticker
        coords were readable, not just that the bucket was reachable).

        On failure: 503 with structured detail naming the error class
        + message + zarr URI. Use the error class to triage:

          - ``FileNotFoundError`` / ``PathNotFoundError`` → wrong URI or
            zarr not on the bucket
          - ``DefaultCredentialsError`` / ``RefreshError`` → Cloud Run
            service account missing storage.objects.get on the bucket
          - ``ImportError`` → xarray / gcsfs missing from the deploy

        Closes MASTER_BACKLOG P.9.
        """
        zarr_uri = settings.zarr_root_uri
        try:
            _, bridge = _load_erm3_resources(zarr_uri)
            return {
                "status": "ok",
                "zarr_root_uri": zarr_uri,
                "n_tickers_in_bridge": len(bridge),
            }
        except Exception as exc:  # noqa: BLE001
            log.exception("portfolio-evolution health probe failed")
            raise HTTPException(
                status_code=503,
                detail={
                    "status": "error",
                    "zarr_root_uri": zarr_uri,
                    "error_class": type(exc).__name__,
                    "error_module": type(exc).__module__,
                    "error_message": str(exc),
                },
            )

    @app.post("/portfolio-evolution")
    def portfolio_evolution(req: PortfolioEvolutionRequest = Body(...)):
        """The Analyst M4 — what changed since the last portfolio snapshot.

        Reads `portfolio_history` (M3c jsonb shape) + a cached ERM3 monthly
        zarr, runs the constant-holdings-within-segment kernel, returns the
        design-§5 response shape.
        """
        try:
            erm3, bridge = _load_erm3_resources(settings.zarr_root_uri)
        except Exception as exc:  # noqa: BLE001
            log.exception("failed to load ERM3 resources")
            raise HTTPException(status_code=503, detail=f"ERM3 monthly unavailable: {exc}")

        try:
            result = compute_portfolio_evolution(
                req.portfolio_history,
                portfolio_id=req.portfolio_id,
                erm3_monthly=erm3,
                ticker_to_symbol=bridge,
                include_full_breakdown=req.include_full_breakdown,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("portfolio-evolution kernel failed")
            raise HTTPException(status_code=400, detail=str(exc))

        return Response(
            content=_json_dumps(result),
            media_type="application/json",
            headers={
                "X-Kernel-Version": KERNEL_VERSION,
                "X-Coverage-In-Erm3": str(result["_metadata"]["coverage_in_erm3"]),
            },
        )

    return app


def _json_dumps(obj: Any) -> bytes:
    import json

    return json.dumps(obj, default=str, separators=(",", ":")).encode("utf-8")


# Module-level app instance for ``uvicorn render_svc.app:app``.
settings = load_from_env()
logging.basicConfig(level=settings.log_level)
app = _make_app(settings, GcsObjectStore(bucket=settings.bucket))
