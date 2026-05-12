# syntax=docker/dockerfile:1.7
#
# Cloud Run render service image.
#
# Build context: repo root (so the SDK at ./sdk/ is reachable). Build via:
#   gcloud builds submit --config services/render-svc/cloudbuild.yaml .
#
# Or locally:
#   docker build -f services/render-svc/Dockerfile -t render-svc .

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

# matplotlib needs freetype + libpng. fonts-dejavu-core is the fallback when
# the bundled Inter font isn't present (the F1 renderer logs warnings but
# falls through cleanly).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libfreetype6 \
        libpng16-16 \
        fonts-dejavu-core \
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

# 2. Install the service.
COPY services/render-svc/pyproject.toml services/render-svc/README.md /app/
COPY services/render-svc/render_svc /app/render_svc
RUN pip install /app

# 3. Build-time import smoke. If aom or snapshots can't import, fail the
#    BUILD here (with full traceback in build logs) instead of getting a
#    masked Cloud Run startup error.
RUN python -c "import riskmodels.aom; print('aom OK')" && \
    python -c "import riskmodels.snapshots; print('snapshots OK')" && \
    python -c "import render_svc.app; print('app OK')"

# 4. Run as non-root.
RUN groupadd --system app && useradd --system --gid app --no-create-home app
USER app

EXPOSE 8080

CMD ["uvicorn", "render_svc.app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
