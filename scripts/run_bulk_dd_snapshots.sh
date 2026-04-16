#!/usr/bin/env bash
# Long-running Stock Deep Dive bulk render → local tree + optional GCS upload.
#
# Usage:
#   ./scripts/run_bulk_dd_snapshots.sh              # foreground, logs to file + stdout
#   RUN_IN_BACKGROUND=1 ./scripts/run_bulk_dd_snapshots.sh   # nohup, safe to close terminal
#
# Override any default via env (see below). Requires: ERM3 zarr tree, gcloud for --upload-gcs.
#
# Env (optional):
#   PYTHON=/path/to/venv/bin/python  (defaults: ../BWMACRO/.venv, then RiskModels_API/.venv, ERM3/.venv, else python3)
#   BWMACRO_ROOT=...  (default: sibling ../BWMACRO from this repo)
#   LIMIT=1000  UNIVERSE=uni_mc_3000  UPLOAD_GCS=1  RESUME=1  FORCE=0  API_PEERS=0
#   SEC_PROFILE_JSON_ROOT=...  BULK_SNAPSHOT_DIR=...  ERM3_ZARR_ROOT=...
#   RUN_IN_BACKGROUND=1 — nohup; on macOS wraps with caffeinate -i (disable with CAFFEINATE=0).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RISKMODELS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SDK="${RISKMODELS_ROOT}/sdk"

# ── Defaults (override in environment) ─────────────────────────────────────
: "${ERM3_ROOT:=${RISKMODELS_ROOT}/../ERM3}"
if [[ -d "${ERM3_ROOT}" ]]; then
  ERM3_ROOT="$(cd "${ERM3_ROOT}" && pwd)"
fi
: "${ERM3_ZARR_ROOT:=${ERM3_ROOT}/data/stock_data/zarr/eodhd}"

: "${BWMACRO_ROOT:=${RISKMODELS_ROOT}/../BWMACRO}"
if [[ -d "${BWMACRO_ROOT}" ]]; then
  BWMACRO_ROOT="$(cd "${BWMACRO_ROOT}" && pwd)"
fi

# bulk_dd_render imports xarray — must use a venv that has ERM3/RiskModels deps (not bare python3).
: "${PYTHON:=}"
if [[ -z "${PYTHON}" ]]; then
  if [[ -x "${BWMACRO_ROOT}/.venv/bin/python" ]]; then
    PYTHON="${BWMACRO_ROOT}/.venv/bin/python"
  elif [[ -x "${RISKMODELS_ROOT}/.venv/bin/python" ]]; then
    PYTHON="${RISKMODELS_ROOT}/.venv/bin/python"
  elif [[ -x "${ERM3_ROOT}/.venv/bin/python" ]]; then
    PYTHON="${ERM3_ROOT}/.venv/bin/python"
  else
    PYTHON="python3"
  fi
fi

# Company profile JSON root (must contain json/). Prefer ext drive from gcs.company_profiles if mounted.
: "${SEC_PROFILE_JSON_ROOT:=}"
if [[ -z "${SEC_PROFILE_JSON_ROOT}" ]]; then
  if [[ -d "/Volumes/ext_2t/Company_Profiles/v1/json" ]]; then
    SEC_PROFILE_JSON_ROOT="/Volumes/ext_2t/Company_Profiles/v1"
  else
    SEC_PROFILE_JSON_ROOT="${ERM3_ROOT}/data/stock_data/company_profiles/v1"
  fi
fi

# Output tree: default external drive if present, else under repo
if [[ -z "${BULK_SNAPSHOT_DIR:-}" ]]; then
  if [[ -d "/Volumes/ext_2t" ]]; then
    BULK_SNAPSHOT_DIR="/Volumes/ext_2t/Stock_Snapshots"
  else
    BULK_SNAPSHOT_DIR="${RISKMODELS_ROOT}/.bulk_dd_snapshots_out"
  fi
fi

: "${LIMIT:=1000}"
: "${UNIVERSE:=uni_mc_3000}"
: "${UPLOAD_GCS:=1}"
: "${RESUME:=1}"
: "${FORCE:=0}"
: "${API_PEERS:=0}"
: "${RUN_IN_BACKGROUND:=0}"
: "${CAFFEINATE:=1}"

LOG_DIR="${BULK_SNAPSHOT_LOG_DIR:-${RISKMODELS_ROOT}/scripts/logs}"
mkdir -p "${LOG_DIR}"
if [[ -z "${LOG_FILE:-}" ]]; then
  STAMP="$(date +%Y%m%d_%H%M%S)"
  LOG_FILE="${LOG_DIR}/bulk_dd_${STAMP}.log"
fi
PID_FILE="${LOG_DIR}/bulk_dd_latest.pid"

export ERM3_ROOT
export ERM3_ZARR_ROOT
export BWMACRO_ROOT
export BULK_SNAPSHOT_DIR
export BULK_DD_SEC_PROFILE_ROOT="${SEC_PROFILE_JSON_ROOT}"
export PYTHONPATH="${SDK}:${ERM3_ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
export LOG_FILE
export PYTHON

# Log line: tee to file + terminal when interactive; append only when stdout is not a tty (nohup) to avoid double writes.
_log() {
  if [[ -t 1 ]]; then
    printf '%s\n' "$1" | tee -a "${LOG_FILE}"
  else
    printf '%s\n' "$1" >>"${LOG_FILE}"
  fi
}

# Detach: re-run this script so the job survives closing the terminal (machine must stay awake).
if [[ "${RUN_IN_BACKGROUND}" == "1" ]]; then
  export RUN_IN_BACKGROUND=0
  echo "Logging to: ${LOG_FILE}"
  if [[ "$(uname -s)" == "Darwin" && "${CAFFEINATE}" == "1" ]]; then
    # Keep Mac awake while the job runs (prevents idle sleep killing long renders).
    nohup caffeinate -i "$0" >>"${LOG_FILE}" 2>&1 &
  else
    nohup "$0" >>"${LOG_FILE}" 2>&1 &
  fi
  echo $! >"${PID_FILE}"
  echo "PID $(cat "${PID_FILE}")"
  echo "Monitor: tail -f ${LOG_FILE}"
  echo "Stop:    kill \$(cat ${PID_FILE})"
  exit 0
fi

_log "=== bulk_dd_snapshots $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
_log "RISKMODELS_ROOT=${RISKMODELS_ROOT}"
_log "BWMACRO_ROOT=${BWMACRO_ROOT}"
_log "ERM3_ROOT=${ERM3_ROOT}"
_log "ERM3_ZARR_ROOT=${ERM3_ZARR_ROOT}"
_log "SEC_PROFILE_JSON_ROOT=${SEC_PROFILE_JSON_ROOT}"
_log "BULK_SNAPSHOT_DIR=${BULK_SNAPSHOT_DIR}"
_log "LIMIT=${LIMIT} UNIVERSE=${UNIVERSE} UPLOAD_GCS=${UPLOAD_GCS} RESUME=${RESUME} FORCE=${FORCE}"
_log "PYTHON=${PYTHON}"
_log ""

if ! "${PYTHON}" -c "import xarray" 2>/dev/null; then
  _log "ERROR: ${PYTHON} cannot import xarray. Use a venv with xarray (e.g. BWMACRO), e.g.:"
  _log "  PYTHON=${BWMACRO_ROOT}/.venv/bin/python RUN_IN_BACKGROUND=1 $0"
  _log "Or: PYTHON=${ERM3_ROOT}/.venv/bin/python RUN_IN_BACKGROUND=1 $0"
  exit 1
fi

if [[ ! -d "${ERM3_ZARR_ROOT}/ds_daily.zarr" ]]; then
  _log "ERROR: Missing ${ERM3_ZARR_ROOT}/ds_daily.zarr — set ERM3_ZARR_ROOT."
  exit 1
fi
if [[ ! -d "${ERM3_ZARR_ROOT}/ds_masks.zarr" ]]; then
  _log "WARN: Missing ds_masks.zarr (universe discovery may fail): ${ERM3_ZARR_ROOT}"
fi
if [[ "${UPLOAD_GCS}" == "1" ]] && ! command -v gcloud &>/dev/null; then
  _log "ERROR: gcloud not found but UPLOAD_GCS=1. Install Google Cloud SDK or set UPLOAD_GCS=0."
  exit 1
fi
if [[ ! -d "${SEC_PROFILE_JSON_ROOT}/json" ]]; then
  _log "WARN: No json/ under SEC_PROFILE_JSON_ROOT=${SEC_PROFILE_JSON_ROOT} — blurbs will be empty for many names."
fi

mkdir -p "${BULK_SNAPSHOT_DIR}"

CMD=("${PYTHON}" -u "${RISKMODELS_ROOT}/sdk/scripts/bulk_dd_render.py"
  --zarr-root "${ERM3_ZARR_ROOT}"
  --out-dir "${BULK_SNAPSHOT_DIR}"
  --universe "${UNIVERSE}"
  --limit "${LIMIT}"
  --sec-profile-json-root "${SEC_PROFILE_JSON_ROOT}"
)
[[ "${RESUME}" == "1" ]] && CMD+=(--resume)
[[ "${FORCE}" == "1" ]] && CMD+=(--force)
[[ "${UPLOAD_GCS}" == "1" ]] && CMD+=(--upload-gcs)
[[ "${API_PEERS}" == "1" ]] && CMD+=(--api-peers)

_log "Running: ${CMD[*]}"
set +e
if [[ -t 1 ]]; then
  (cd "${RISKMODELS_ROOT}" && "${CMD[@]}") 2>&1 | tee -a "${LOG_FILE}"
  EX=${PIPESTATUS[0]}
else
  (cd "${RISKMODELS_ROOT}" && "${CMD[@]}") >>"${LOG_FILE}" 2>&1
  EX=$?
fi
set -e
_log "=== finished $(date -u +%Y-%m-%dT%H:%M:%SZ) exit=${EX} ==="
exit "${EX}"
