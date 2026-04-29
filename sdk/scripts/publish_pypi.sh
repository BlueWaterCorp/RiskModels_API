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

if [[ -z "${TWINE_PASSWORD:-}" ]]; then
  echo "TWINE_PASSWORD is not set. Add your PyPI API token to Doppler, then run e.g.:" >&2
  echo "  doppler run -p erm3 -c prd -- bash sdk/scripts/publish_pypi.sh" >&2
  exit 1
fi

if [[ "${1:-}" == "--build" ]]; then
  rm -rf dist
  python -m build
fi

shopt -s nullglob
artifacts=(dist/riskmodels_py-*.whl dist/riskmodels_py-*.tar.gz)
shopt -u nullglob

if [[ "${#artifacts[@]}" -eq 0 ]]; then
  echo "No files matching dist/riskmodels_py-*.{whl,tar.gz}. Run:" >&2
  echo "  (cd sdk && python -m build)" >&2
  echo "or pass --build to this script." >&2
  exit 1
fi

python -m twine upload "${artifacts[@]}"
echo "Uploaded ${#artifacts[@]} file(s). https://pypi.org/project/riskmodels-py/"
