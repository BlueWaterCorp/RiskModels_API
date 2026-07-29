"""``POST /artifacts/render`` — Phase 1B artifact registry endpoint.

Cache-first artifact rendering for the artifact registry described in
``BWMACRO/docs/architecture/intelligence_runtime/ARTIFACT_REGISTRY.md``.

Request flow
------------
1. Validate the request shape (slug / version / subject_id / as_of /
   format / params).
2. Resolve ``subject_kind`` from ``subject_id`` prefix.
3. Load subject data via the public SDK (today: ``riskmodels.snapshots.
   get_data_for_f1`` for funds).
4. Compose the GCS key
   ``{prefix}/artifacts/{slug}@{version}/{subject_id}/{resolved_as_of}[.params].[ext]``
   — request ``params`` (Phase 3) append a ``.top_n-5`` / ``.window-3m``
   fragment so each params combination is its own render-once instance.
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
from pydantic import BaseModel, ConfigDict, Field

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
    # Plotly figure spec (``fig.to_json()``) — plotly.js renders it directly
    # in the browser without a matplotlib/kaleido round-trip server-side.
    "figure": "application/json",
}


class ArtifactParams(BaseModel):
    """Optional per-slug render parameters (Phase 3).

    Which keys apply to which slug is enforced in ``render_artifact`` via
    ``_SLUG_PARAMS`` — unknown keys are rejected here (422) so a typo'd
    param can never silently fall back to the default render.
    """

    model_config = ConfigDict(extra="forbid")

    top_n: int | None = Field(default=None, ge=1, le=50)
    window: Literal["3m", "6m", "1y", "2y", "max"] | None = None


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
    format: Literal["json", "png", "svg", "figure"] = "json"
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
    params: ArtifactParams | None = Field(
        default=None,
        description=(
            "Per-slug render parameters. top_holdings_erm_stacked accepts "
            "top_n (int 1-50, default 12); cumulative_return_strip accepts "
            "window ('3m'|'6m'|'1y'|'2y'|'max', default 'max'). Params "
            "participate in the GCS cache key — each distinct combination "
            "renders once under its own key."
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
    params_fragment: str = "",
) -> str:
    return f"{prefix.rstrip('/')}/artifacts/{slug}@{version}/{subject_id}/{resolved_as_of}{params_fragment}.{fmt}"


# Which params each slug honors (Phase 3). Keys must be a subset of the
# ArtifactParams fields; the artifact module's RENDER_PARAMS declaration
# is the module-side gate (deploy-skew guard in _render_bytes).
_SLUG_PARAMS: dict[str, frozenset[str]] = {
    "top_holdings_erm_stacked": frozenset({"top_n"}),
    "cumulative_return_strip": frozenset({"window"}),
}


def _supplied_params(req: ArtifactRenderRequest) -> dict[str, Any]:
    """Params the caller explicitly set, validated against the slug.

    422 on a param that isn't applicable to the slug — silently ignoring
    it would serve the default render while looking like an honored
    request.
    """
    supplied = req.params.model_dump(exclude_none=True) if req.params else {}
    if not supplied:
        return {}
    applicable = _SLUG_PARAMS.get(req.slug, frozenset())
    unknown = sorted(set(supplied) - applicable)
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=(
                f"params {unknown} not applicable to slug={req.slug!r} "
                f"(accepted: {sorted(applicable) or 'none'})"
            ),
        )
    return supplied


def _params_key_fragment(supplied: dict[str, Any]) -> str:
    """Deterministic GCS-key fragment for a supplied params dict.

    Empty → ``""`` (legacy key shape, so pre-params cache entries still
    hit). Non-empty → ``".top_n-5"`` / ``".window-3m"`` (sorted,
    ``+``-joined). Values are validated ints/enums, so the fragment is
    path-safe.
    """
    if not supplied:
        return ""
    return "." + "+".join(f"{k}-{supplied[k]}" for k in sorted(supplied))


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


def _adapter_for(
    slug: str, subject_kind: str, params: dict[str, Any] | None = None
) -> Callable[[Any], Any]:
    """Resolve the adapter for ``(slug, subject_kind)``.

    ``params`` carries the validated request params (Phase 3); today only
    ``top_n`` reaches an adapter (the holdings adapters slice server-side
    before the artifact module applies its own cap).

    Currently wired:
      - fund: ``top_holdings_erm_stacked``, ``cumulative_return_strip``
      - client_portfolio: ``top_holdings_erm_stacked``

    Filer / ETF / cohort adapters land alongside their Phase 2 artifact
    rows in ``BWMACRO/src/bwmacro/snapshots/artifacts/adapters.py``.
    """
    from bwmacro.snapshots.artifacts import adapters

    top_n = (params or {}).get("top_n", 12)

    if subject_kind == "fund":
        if slug == "top_holdings_erm_stacked":
            return lambda fd: adapters.holdings_from_fund_data(fd, top_n=top_n)
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
                positions, top_n=top_n
            )
        raise HTTPException(
            status_code=501,
            detail=(
                f"No client_portfolio adapter wired for slug={slug!r} "
                f"(only top_holdings_erm_stacked is widened so far)"
            ),
        )

    if subject_kind == "filer_13f":
        if slug == "top_holdings_erm_stacked":
            return lambda fd: adapters.holdings_from_filer_data(fd, top_n=top_n)
        if slug == "cumulative_return_strip":
            return adapters.cumulative_return_series_from_filer_data
        if slug == "entity_header":
            return adapters.entity_header_from_filer_data
        if slug == "return_composition_bars":
            return adapters.attribution_waterfall_from_filer_data
        if slug == "active_risk_composition":
            return adapters.active_risk_composition_from_filer_data
        if slug == "risk_summary_panel":
            return adapters.risk_summary_panel_from_filer_data
        raise HTTPException(
            status_code=501,
            detail=(
                f"No filer_13f adapter wired for slug={slug!r} "
                f"(widen APPLICABLE_SUBJECT_KINDS on the artifact module + "
                f"add the matching adapter in BWMACRO adapters.py)"
            ),
        )

    if subject_kind == "stock":
        if slug == "l3_explained_risk_hbar":
            return adapters.stock_l3_exposure_from_decompose
        if slug == "hedge_notionals_hbar":
            return adapters.stock_hedge_notionals_from_decompose
        if slug == "hedge_depth_retained":
            return adapters.stock_l3_exposure_from_decompose
        if slug == "watchlist_er_stacked":
            return adapters.watchlist_er_stacked_from_decomposes
        raise HTTPException(
            status_code=501,
            detail=(
                f"No stock adapter wired for slug={slug!r} "
                f"(O.6 panels: l3_explained_risk_hbar, hedge_notionals_hbar, "
                f"hedge_depth_retained, watchlist_er_stacked)"
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


# Subject kinds with no SDK loader inside render-svc. Pre-rendered artifacts
# (explicit as_of, bytes already in GCS) serve via the cache-hit path; cache
# miss raises 501. filer_13f data lives behind the private BWMACRO surface;
# cohort covers research artifacts (BW-COHORT-RES-* — published by
# BWMACRO research/papers/build_artifacts.py).
# ``stock`` was removed from this set 2026-07-14 (O.6): live decompose loader.
_PRERENDERED_SUBJECT_KINDS: tuple[str, ...] = ("filer_13f", "cohort")


def _resolve_prerendered_subject(
    req: "ArtifactRenderRequest", subject_kind: str
) -> tuple[None, str, str]:
    """Validate + resolve a request for a loaderless subject kind.

    Returns ``(subject_data=None, resolved_subject_id, resolved_as_of)``.

    These subjects have **no SDK loader inside render-svc** — e.g. filer
    data lives behind `bwmacro.snapshots.filers._data.get_data_for_f1_filer`
    which reads from local zarrs and is part of the private BWMACRO surface.
    The cache-hit path doesn't need subject data (it returns bytes directly
    from GCS), so pre-rendered artifacts work end-to-end. Cache miss raises
    501 — live-render requires the corresponding loader landing in
    render-svc (Phase 2 follow-on).

    For LANDING's Berkshire anonymous preload: the daily refresh job
    pre-renders the artifact to GCS at an explicit `as_of` date (e.g.
    `2026-03-31` for Berkshire's Q1 2026 13F); the workspace then
    requests that exact date and gets a cache hit. `as_of="latest"`
    is rejected because the server has no way to resolve "latest"
    without a loader.
    """
    if req.as_of == "latest":
        raise HTTPException(
            status_code=400,
            detail=(
                f"as_of='latest' not supported for subject_kind={subject_kind!r} "
                "(no SDK loader inside render-svc to resolve the latest "
                "data date). Pass an explicit ISO date matching a "
                "pre-rendered artifact."
            ),
        )
    return None, req.subject_id, req.as_of


def _load_subject_data(subject_id: str, subject_kind: str, as_of: str) -> Any:
    """Load subject data + verify the loader's resolved as_of.

    Wired today:
      - ``fund`` via ``get_data_for_f1`` (as_of=latest or matching teo)
      - ``stock`` via live ``POST /api/decompose`` (as_of=latest or matching data_as_of)
    """
    if subject_kind == "stock":
        return _load_stock_decompose(subject_id, as_of)

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


def _ticker_from_stock_subject_id(subject_id: str) -> str:
    """BW-STOCK-CRM → CRM."""
    prefix = "BW-STOCK-"
    if not subject_id.startswith(prefix):
        raise HTTPException(
            status_code=422,
            detail=f"stock subject_id must start with {prefix!r}",
        )
    ticker = subject_id[len(prefix) :].strip().upper()
    if not ticker or ticker == "WATCHLIST":
        raise HTTPException(
            status_code=422,
            detail=(
                "BW-STOCK-WATCHLIST requires subject_payload.tickers; "
                "single-name panels use BW-STOCK-{TICKER}"
            ),
        )
    return ticker


def _fetch_decompose(ticker: str) -> dict[str, Any]:
    """Call RiskModels ``POST /api/decompose`` with service credentials."""
    import os

    import requests

    api_key = (
        os.environ.get("RISKMODELS_API_KEY")
        or os.environ.get("RENDER_SVC_RISKMODELS_API_KEY")
        or ""
    ).strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="RISKMODELS_API_KEY not configured on render-svc for stock panels",
        )
    base = os.environ.get("RISKMODELS_BASE_URL", "https://riskmodels.app/api").rstrip("/")
    try:
        resp = requests.post(
            f"{base}/decompose",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={"ticker": ticker},
            timeout=45,
        )
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001
        log.exception("decompose failed for %s", ticker)
        raise HTTPException(
            status_code=502,
            detail=f"decompose failed for {ticker!r}: {exc}",
        ) from exc
    if "ticker" not in payload:
        payload = {**payload, "ticker": ticker}
    return payload


def _load_stock_decompose(
    subject_id: str, as_of: str
) -> tuple[dict[str, Any], str]:
    """Load a single-name decompose payload for stock panel artifacts."""
    ticker = _ticker_from_stock_subject_id(subject_id)
    payload = _fetch_decompose(ticker)
    resolved = str(payload.get("data_as_of") or "").strip()
    if not resolved:
        resolved = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if as_of != "latest" and as_of != resolved:
        # Decompose is latest-only today; refuse mismatched historical pins.
        raise HTTPException(
            status_code=501,
            detail=(
                f"as_of={as_of!r} differs from decompose data_as_of={resolved!r}; "
                f"historical stock panel as_of is not yet supported. "
                f"Use as_of='latest' or as_of={resolved!r}."
            ),
        )
    return payload, resolved


def _resolve_stock_watchlist(
    req: "ArtifactRenderRequest",
) -> tuple[list[dict[str, Any]], str, str]:
    """Inline watchlist: subject_payload.tickers → list of decompose payloads."""
    if req.subject_payload is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "watchlist_er_stacked requires subject_payload.tickers "
                "(list of US equity tickers)"
            ),
        )
    tickers = req.subject_payload.get("tickers")
    if not isinstance(tickers, list) or not tickers:
        raise HTTPException(
            status_code=400,
            detail="subject_payload.tickers must be a non-empty list",
        )
    if len(tickers) > 12:
        raise HTTPException(status_code=400, detail="at most 12 watchlist tickers")
    payloads = [_fetch_decompose(str(t).strip().upper()) for t in tickers]
    as_ofs = {str(p.get("data_as_of") or "") for p in payloads}
    as_ofs.discard("")
    if req.as_of == "latest":
        resolved_as_of = (
            next(iter(as_ofs))
            if len(as_ofs) == 1
            else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        )
    else:
        resolved_as_of = req.as_of
    # Stable subject id from ticker set
    key = ",".join(sorted(str(t).strip().upper() for t in tickers))
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    resolved_subject_id = f"BW-STOCK-WATCHLIST-{digest}"
    return payloads, resolved_subject_id, resolved_as_of


def _render_bytes(
    mod: Any, data: Any, fmt: str, params: dict[str, Any] | None = None
) -> bytes:
    """Materialize the artifact in the requested format.

    Supplied params are passed to the module's ``render_data`` /
    ``render_figure`` as keyword args, gated on the module's declared
    ``RENDER_PARAMS``: a module too old to declare them means a deploy
    skew (render-svc image ahead of its ``bwmacro-src``), so fail 501
    rather than silently serve the default render.

    ``format="figure"`` returns the Plotly figure spec (``fig.to_json()``)
    so a browser can render it client-side via plotly.js without a
    server-side kaleido/matplotlib rasterization round-trip. Only
    Plotly-backed artifacts support it — some slugs' ``render_figure``
    returns a PIL Image (``dd_peer_dna``) or a matplotlib Figure
    (``variance_shares_bars``, ``lag_erosion``, ``turnover_bars``,
    ``cumulative_panels``, ``rolling_residual_share``), neither of which
    has ``.to_json()``. Detected by duck-typing on ``hasattr(fig,
    "to_json")`` rather than a hardcoded slug list, since the artifact
    module's own ``RENDER_FORMATS`` enum doesn't yet have a FIGURE member
    to gate on (bwmacro._contract.RenderFormat is JSON/PNG/SVG today).
    """
    supplied = params or {}
    if supplied:
        declared = set(getattr(mod, "RENDER_PARAMS", ()) or ())
        unsupported = sorted(set(supplied) - declared)
        if unsupported:
            raise HTTPException(
                status_code=501,
                detail=(
                    f"Artifact module for this slug does not declare "
                    f"RENDER_PARAMS support for {unsupported} (deploy skew: "
                    f"rebuild the render-svc image with the bwmacro-src "
                    f"revision that declares it)"
                ),
            )
    if fmt == "json":
        return json.dumps(
            mod.render_data(data, **supplied), separators=(",", ":")
        ).encode("utf-8")
    fig = mod.render_figure(data, **supplied)
    if fmt == "png":
        return fig.to_image(format="png", scale=2.0)
    if fmt == "svg":
        return fig.to_image(format="svg")
    if fmt == "figure":
        to_json = getattr(fig, "to_json", None)
        if to_json is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"format='figure' is only supported for Plotly-backed "
                    f"artifacts; this slug's render_figure() returned a "
                    f"{type(fig).__name__} (no .to_json()). Use format="
                    f"'png' (or 'svg', if declared) instead."
                ),
            )
        return to_json().encode("utf-8")
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
    is_dd_panel = subject_kind == "stock" and req.slug.startswith("dd_")
    # Validate params against the slug before any loader work (422 fast).
    supplied_params = _supplied_params(req)

    if subject_kind == "client_portfolio":
        # Subject data is supplied inline; cache key is payload-hash-derived.
        subject_data, resolved_subject_id, resolved_as_of = _resolve_client_portfolio(req)
    elif subject_kind == "stock" and req.slug == "watchlist_er_stacked":
        subject_data, resolved_subject_id, resolved_as_of = _resolve_stock_watchlist(req)
    elif is_dd_panel:
        # Institutional DD figure units (dd_peer_dna@v1, …) — Tier-1 batch
        # pre-rendered by `bulk_dd_render --panels` (same in-memory DDData as
        # the letter page); no live loader here (DDData needs the private
        # zarr path). `as_of=latest` resolves via the batch-written
        # `latest.{fmt}` alias key, refreshed each batch run — so unlike
        # the loaderless subject kinds below, `latest` is allowed.
        # See BWMACRO docs/ceo/DD_PANEL_REGISTRY_EXPOSE_PROJECT.md.
        subject_data, resolved_subject_id, resolved_as_of = None, req.subject_id, req.as_of
    elif subject_kind in _PRERENDERED_SUBJECT_KINDS:
        # No SDK loader in render-svc — cache-hit path works for pre-rendered
        # artifacts; cache miss raises 501 (live-render is Phase 2 follow-on).
        subject_data, resolved_subject_id, resolved_as_of = _resolve_prerendered_subject(
            req, subject_kind
        )
    else:
        # Loader-resolved path (fund + stock today; etf to follow).
        subject_data, resolved_as_of = _load_subject_data(
            req.subject_id, subject_kind, req.as_of
        )
        resolved_subject_id = req.subject_id

    gcs_path = _artifact_gcs_path(
        prefix,
        req.slug,
        req.version,
        resolved_subject_id,
        resolved_as_of,
        req.format,
        _params_key_fragment(supplied_params),
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
    if is_dd_panel:
        # Tier-2 contract: not pre-rendered → explicit error with the full-page
        # pointer AND the request path. Misses are the demand signal for
        # widening the Tier-1 cohort.
        ticker = _ticker_from_stock_subject_id(req.subject_id)
        raise HTTPException(
            status_code=501,
            detail=(
                f"{req.slug}@{req.version} is not pre-rendered for {ticker} "
                f"(institutional DD panels are batch-rendered for a hot ticker "
                f"cohort only). The full institutional page is at "
                f"https://www.riskmodels.org/snapshots/{ticker.lower()}_dd_latest.png. "
                f"To have {ticker} added to the panel cohort, email "
                f"service@riskmodels.app."
            ),
        )
    if subject_kind in _PRERENDERED_SUBJECT_KINDS:
        # No SDK loader inside render-svc means the adapter has no subject
        # data to consume. Pre-render the artifact (LANDING daily refresh for
        # filers; BWMACRO research/papers/build_artifacts.py --publish for
        # research cohort/stock artifacts) so subsequent requests cache-hit.
        raise HTTPException(
            status_code=501,
            detail=(
                f"Live render not supported for subject_kind={subject_kind!r}. "
                f"Pre-render the artifact to GCS at "
                f"{gcs_path!r} via the daily refresh job (filers) or "
                f"BWMACRO research/papers/build_artifacts.py --publish "
                f"(research cohort/stock artifacts); "
                f"subsequent requests will cache-hit. "
                f"(SDK loader inside render-svc is a Phase 2 follow-on.)"
            ),
        )

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

    adapter = _adapter_for(req.slug, subject_kind, supplied_params)
    normalized = adapter(subject_data)
    rendered = _render_bytes(mod, normalized, req.format, supplied_params)

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
