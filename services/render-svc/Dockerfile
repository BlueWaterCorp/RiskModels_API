# syntax=docker/dockerfile:1.7
#
# Cloud Run render service image.
#
# Build context: repo root.
#   - ./sdk/ — public riskmodels-py SDK
#   - ./bwmacro-src/ — BWMACRO clone (cloudbuild clones it; locally use a
#                       symlink: `ln -s ../BWMACRO bwmacro-src` from repo root).
#                       Only the leaf-clean `bwmacro.snapshots.artifacts.*`
#                       subtree is exercised; a build-time import-firewall
#                       smoke (below) asserts no Supabase / Moonshot /
#                       requests-via-_data symbols transit at module scope.
#
# Build via:
#   gcloud builds submit --config services/render-svc/cloudbuild.yaml .
#
# Or locally (from repo root, with the bwmacro-src symlink in place):
#   docker build -f services/render-svc/Dockerfile -t render-svc .

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

# matplotlib needs freetype + libpng. fonts-dejavu-core stays as a last-resort
# fallback, but the house faces are installed system-wide below and should be
# what actually renders — a DejaVu panel is the bug, not the baseline.
#
# librsvg2-bin supplies rsvg-convert, the only route from a Plotly figure to a
# PDF whose text is real embedded text: Kaleido renders through headless
# Chrome, whose PDF writer emits Type 3 fonts carrying no font file — glyph
# drawings that cannot be searched, copied, or accepted by a print workflow.
# Plotly's SVG export is fine, so the path is SVG -> rsvg-convert -> PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libfreetype6 \
        libpng16-16 \
        fonts-dejavu-core \
        librsvg2-bin \
        fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Install the public SDK from the in-tree source. Two-step install to
#    avoid any ambiguity between `/tmp/sdk[extras]` path-with-extras parsing
#    and an older `riskmodels-py` on PyPI:
#       a) Install the local package with --no-deps (so no PyPI lookup of
#          riskmodels-py happens at all).
#       b) Install the runtime deps explicitly.
#    Switch to a PyPI pin once F1 is published.
COPY sdk/ /tmp/sdk/
RUN echo '=== /tmp/sdk top ===' && ls /tmp/sdk/ && \
    echo '=== /tmp/sdk/riskmodels/ ===' && ls /tmp/sdk/riskmodels/ && \
    echo '=== /tmp/sdk/riskmodels/aom/ ===' && (ls /tmp/sdk/riskmodels/aom/ || echo 'AOM MISSING IN COPIED SOURCE')
# Install the SDK's bundled faces system-wide.
#
# matplotlib does not need this — _typography binds each role to an explicit
# file path inside the installed package, precisely so rendering never depends
# on what the host has. rsvg-convert does: it resolves families through
# fontconfig, so without this step every Plotly panel converted to PDF silently
# falls back to DejaVu and the house typography is lost on exactly the output
# that gets printed. Copy before the pip install so a failed font step is
# visible on its own layer.
RUN mkdir -p /usr/local/share/fonts/riskmodels && \
    cp /tmp/sdk/riskmodels/snapshots/fonts/*.otf /usr/local/share/fonts/riskmodels/ && \
    fc-cache -f > /dev/null && \
    for family in Charter Inter "Inter Tabular"; do \
        fc-list : family | grep -q "$family" \
            || { echo "FONT MISSING AFTER INSTALL: $family"; exit 1; }; \
    done && \
    echo "house faces registered with fontconfig"

RUN pip install --no-deps /tmp/sdk && \
    pip install \
        'httpx>=0.27,<1' \
        'pandas>=2.0,<3' \
        'pyarrow>=14,<22' \
        'matplotlib>=3.8,<4' \
        'plotly>=5.18,<7' \
        'kaleido>=0.2,<1' \
        'qrcode[pil]>=7.0' \
        'xarray>=2024.1' \
        'python-dotenv>=1.0,<2' && \
    rm -rf /tmp/sdk

# 2. Install BWMACRO narrowly. Only the artifact subtree is invoked at
#    runtime (the artifact registry endpoint imports
#    `bwmacro.snapshots.artifacts.{slug}.v{N}`). Install with --no-deps
#    since BWMACRO's pyproject doesn't declare deps (managed by the shared
#    BWMACRO venv in dev); the SDK + the runtime deps installed above are
#    sufficient for the artifact-import path.
COPY bwmacro-src/ /tmp/bwmacro/
RUN pip install --no-deps /tmp/bwmacro && rm -rf /tmp/bwmacro

# 3. Install the service.
COPY services/render-svc/pyproject.toml services/render-svc/README.md /app/
COPY services/render-svc/render_svc /app/render_svc
RUN pip install /app && \
    python -c "import gcsfs; import zarr; print('gcsfs+zarr OK')"

# 4. Build-time import smoke. If aom or snapshots can't import, fail the
#    BUILD here (with full traceback in build logs) instead of getting a
#    masked Cloud Run startup error.
RUN python -c "import riskmodels.aom; print('aom OK')" && \
    python -c "import riskmodels.snapshots; print('snapshots OK')" && \
    python -c "import render_svc.app; print('app OK')"

# 5. Build-time import firewall — the artifact subtree must import without
#    transitively dragging in the heavy BWMACRO private surface (Supabase,
#    Moonshot, `requests` via `bwmacro.snapshots.funds._data`). If a future
#    refactor reintroduces those at module scope, fail the BUILD instead of
#    discovering it in production via image-size bloat or cold-start crash.
RUN python -c "import sys; \
import bwmacro.snapshots.artifacts; \
import bwmacro.snapshots.artifacts.top_holdings_erm_stacked.v1; \
import bwmacro.snapshots.artifacts.cumulative_return_strip.v1; \
import bwmacro.snapshots.artifacts.l3_explained_risk_hbar.v1; \
import bwmacro.snapshots.artifacts.hedge_notionals_hbar.v1; \
import bwmacro.snapshots.artifacts.hedge_depth_retained.v1; \
import bwmacro.snapshots.artifacts.watchlist_er_stacked.v1; \
forbidden = ['bwmacro.snapshots.funds._ai_insight', 'bwmacro.snapshots.funds._data', 'supabase']; \
hit = [m for m in forbidden if m in sys.modules]; \
assert not hit, f'forbidden modules imported at artifact import: {hit}'; \
print('artifact import firewall OK')"

# 6. Run as non-root.
RUN groupadd --system app && useradd --system --gid app --no-create-home app
USER app

EXPOSE 8080

CMD ["uvicorn", "render_svc.app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
