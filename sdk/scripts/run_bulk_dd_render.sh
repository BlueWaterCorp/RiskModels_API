#!/usr/bin/env bash
# Bulk DD snapshots — paste-safe runner for zsh (no trailing spaces after '\').
#
# Python: defaults to BWMACRO monorepo venv (sibling repo ../BWMACRO/.venv).
# Override with BWMACRO_ROOT=/path/to/BWMACRO and/or PYTHON=/path/to/python.
#
# Example (from RiskModels_API root):
#   export ERM3_ZARR_ROOT=/Volumes/ext_2t/factset/processed
#   ./sdk/scripts/run_bulk_dd_render.sh \
#       --out-dir /Volumes/ext_2t/Stock_Snapshots \
#       --limit 1000 --upload-mode batch --resume --force --workers 8
#
# One-liner using BWMACRO .venv (replace BW_Code paths if yours differ):
#   export ERM3_ZARR_ROOT=/Volumes/ext_2t/factset/processed && cd /Users/conradgann/BW_Code/RiskModels_API && mkdir -p /Volumes/ext_2t/Stock_Snapshots && PYTHONPATH=sdk /Users/conradgann/BW_Code/BWMACRO/.venv/bin/python sdk/scripts/bulk_dd_render.py --out-dir /Volumes/ext_2t/Stock_Snapshots --limit 1000 --upload-mode batch --resume --force --workers 8 2>&1 | tee "$HOME/_bulk_stdout.log"

set -euo pipefail

: "${ERM3_ZARR_ROOT:?Set ERM3_ZARR_ROOT to the directory containing ds_daily.zarr}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SDK_DIR/.." && pwd)"

# Monorepo: shared Python lives in BWMACRO/.venv (see BWMACRO/README.md setup_venv.sh).
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
  echo "error: Python not found or not executable." >&2
  echo "  Tried: ${PY:-'(empty)'}" >&2
  echo "  Set BWMACRO_ROOT to your BWMACRO repo root, or PYTHON=/path/to/BWMACRO/.venv/bin/python" >&2
  exit 1
fi

cd "$REPO_ROOT"
export PYTHONPATH=sdk

exec "$PY" sdk/scripts/bulk_dd_render.py "${@}"
