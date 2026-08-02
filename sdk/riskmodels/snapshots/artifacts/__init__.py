"""Public-SDK artifact renderer modules (registry contract).

Same module contract as the private ``bwmacro.snapshots.artifacts.*``
renderers (``ARTIFACT_SLUG`` / ``APPLICABLE_SUBJECT_KINDS`` /
``RENDER_PARAMS`` / ``render_data`` / ``render_figure``): render-svc's
``_import_artifact_module`` resolves ``bwmacro.snapshots.artifacts.
{slug}.{version}`` first and falls back to
``riskmodels.snapshots.artifacts.{slug}.{version}``.

A renderer lives here (rather than in BWMACRO) when everything it
consumes is already public API surface — the first case is
``holdings_active_panel`` (G.45), a wrapper over the public
``GET /api/data/benchmark-fit`` payload.
"""
