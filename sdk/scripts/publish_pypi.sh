#!/usr/bin/env bash
# Upload sdk/dist artifacts to PyPI using twine API-token auth.
#
# Prerequisites:
#   - TWINE_PASSWORD: PyPI API token (value starts with pypi-). Store in Doppler as TWINE_PASSWORD.
#   - TWINE_USERNAME: defaults to __token__ if unset (PyPI API token convention).
#
# From repo root, after adding TWINE_PASSWORD to Doppler (e.g. project erm3, config prd):
#   doppler run -p erm3 -c prd -- bash sdk/scripts/publish_pypi.sh
#
# Optional --build: rm -rf sdk/dist and run python -m build first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SDK_ROOT"

export TWINE_USERNAME="${TWINE_USERNAME:-__token__}"

# Resolve an interpreter. A bare `python` does not exist on stock macOS (and the
# system `python3` is 3.9, too old to build this package and without twine), so
# prefer the SDK venv, then PYTHON, then python3.
if [[ -n "${PYTHON:-}" ]]; then
  PY="$PYTHON"
elif [[ -x "$SDK_ROOT/.venv/bin/python" ]]; then
  PY="$SDK_ROOT/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PY="$(command -v python)"
else
  echo "No Python interpreter found. Create sdk/.venv or set PYTHON=/path/to/python." >&2
  exit 1
fi
echo "Using interpreter: $PY ($("$PY" -V 2>&1))"

if ! "$PY" -m twine --version >/dev/null 2>&1; then
  echo "twine is not installed for $PY. Install with:" >&2
  echo "  $PY -m pip install build twine" >&2
  exit 1
fi

if [[ -z "${TWINE_PASSWORD:-}" ]]; then
  echo "TWINE_PASSWORD is not set. Add your PyPI API token to Doppler, then run e.g.:" >&2
  echo "  doppler run -p erm3 -c prd -- bash sdk/scripts/publish_pypi.sh" >&2
  exit 1
fi

if [[ "${1:-}" == "--build" ]]; then
  rm -rf dist
  "$PY" -m build
fi

shopt -s nullglob
artifacts=(dist/riskmodels_py-*.whl dist/riskmodels_py-*.tar.gz)
shopt -u nullglob

if [[ "${#artifacts[@]}" -eq 0 ]]; then
  echo "No files matching dist/riskmodels_py-*.{whl,tar.gz}. Run:" >&2
  echo "  (cd sdk && .venv/bin/python -m build)" >&2
  echo "or pass --build to this script." >&2
  exit 1
fi

"$PY" -m twine upload "${artifacts[@]}"
echo "Uploaded ${#artifacts[@]} file(s). https://pypi.org/project/riskmodels-py/"
