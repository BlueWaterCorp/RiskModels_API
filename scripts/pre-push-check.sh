#!/usr/bin/env bash
# Optional: run before git push to keep OpenAPI JSON in sync with the YAML spec.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> npm run build:openapi"
npm run build:openapi

PY_VER="$(python3 -c 'import importlib.metadata as m; print(m.version("riskmodels-py"))' 2>/dev/null || true)"
PKG_VER="$(python3 -c "import tomllib, pathlib; print(tomllib.loads(pathlib.Path(\"$ROOT/sdk/pyproject.toml\").read_text())[\"project\"][\"version\"])")"
if [[ -n "$PY_VER" && "$PY_VER" != "$PKG_VER" ]]; then
  echo "WARN: installed riskmodels-py ($PY_VER) != sdk/pyproject.toml ($PKG_VER). Bump version or reinstall -e ./sdk"
fi

echo "==> OK (review git diff for public/openapi.json and mcp/data/openapi.json)"
