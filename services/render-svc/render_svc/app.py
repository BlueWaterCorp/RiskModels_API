"""FastAPI app: ``POST /render`` + health probes.

Exposes the cache-hit render path. Cache miss returns 404; live render
from raw zarr data is Phase 2.
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import Body, FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

from .gcs import GcsObjectStore, ObjectStore
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

    return app


# Module-level app instance for ``uvicorn render_svc.app:app``.
settings = load_from_env()
logging.basicConfig(level=settings.log_level)
app = _make_app(settings, GcsObjectStore(bucket=settings.bucket))
