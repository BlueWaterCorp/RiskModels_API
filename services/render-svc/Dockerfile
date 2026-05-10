# syntax=docker/dockerfile:1.7
#
# Cloud Run render service — builds a slim image that ships the public SDK
# (riskmodels-py) plus the FastAPI service. Runs on PORT 8080 (Cloud Run
# default).
#
# Image size: ~700-900 MB (matplotlib + numpy + xarray dominate).

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

# System packages required by matplotlib for PDF/PNG rendering and by zarr/xarray
# for the broader public SDK surface. Slim list — no compilers required since
# we install pre-built wheels for numpy/scipy/matplotlib.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libfreetype6 \
        libpng16-16 \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the public SDK from the in-tree wheel built during the docker build
# context. Production should point this at the PyPI index once the F1 release
# is published, e.g. ``RUN pip install riskmodels-py==0.4.0``.
COPY --from=sdk-context sdk/ /sdk/
RUN pip install /sdk

# Install the service.
COPY pyproject.toml .
COPY render_svc ./render_svc
RUN pip install .

# Run as non-root.
RUN groupadd --system app && useradd --system --gid app --no-create-home app
USER app

EXPOSE 8080

# Cloud Run sends health checks on startup; uvicorn handles them via /healthz.
CMD ["uvicorn", "render_svc.app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
