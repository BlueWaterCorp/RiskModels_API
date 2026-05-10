"""riskmodels-render-svc — Cloud Run render service for canonical snapshot artifacts.

Single endpoint (``POST /render``) that re-renders a canonical-snapshot artifact
(P1, F1, C1) into the requested format (json | pdf | png), reading the
canonical object from a fixed GCS path and writing the rendered format back
to the same prefix on cache misses.

Architecture: companion to the public SDK (``riskmodels.snapshots``). Imports
only from ``riskmodels.snapshots`` and standard libs — never from
``bwmacro.*``. This service ships in a container that runs alongside the
Vercel front-end; Vercel calls it on canonical-artifact cache miss.

See ``BWMACRO/docs/architecture/GCS_PRERENDER_OPERATIONS.md`` for the
full publication-pipeline architecture.
"""

__version__ = "0.1.0"
