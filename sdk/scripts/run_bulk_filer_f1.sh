#!/usr/bin/env bash
# Bulk filer F1 PNG — uses BWMACRO monorepo venv + PYTHONPATH (sdk + BWMACRO/src).
#
#   export FUNDS_DAG_ZARR_ROOT=/path/to/Funds_DAG/data/sec_data/zarr
#   ./sdk/scripts/run_bulk_filer_f1.sh --scan --upload-mode batch --resume

set -euo pipefail

: "${FUNDS_DAG_ZARR_ROOT:?Set FUNDS_DAG_ZARR_ROOT (parent of bw_filer_id/)}" >&2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SDK_DIR/.." && pwd)"

BWM="${BWMACRO_ROOT:-}"
if [[ -z "$BWM" ]]; then
  if bw="$(cd "$REPO_ROOT/../BWMACRO" 2>/dev/null && pwd)" && [[ -d "$bw/.venv/bin" ]]; then
    BWM="$bw"
  fi
fi
DEFAULT_PY=""
if [[ -n "$BWM" ]]; then
  DEFAULT_PY="$BWM/.venv/bin/python"
fi
PY="${PYTHON:-$DEFAULT_PY}"
if [[ ! -x "$PY" ]]; then
  echo "error: Python not found. Set BWMACRO_ROOT or PYTHON." >&2
  exit 1
fi

BW_SRC=""
if [[ -n "$BWM" ]]; then
  BW_SRC="$BWM/src"
fi

cd "$REPO_ROOT"
export PYTHONPATH="sdk${BW_SRC:+:${BW_SRC}}"

exec "$PY" sdk/scripts/bulk_filer_f1_render.py "${@}"
