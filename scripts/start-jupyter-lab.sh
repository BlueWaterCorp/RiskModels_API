#!/usr/bin/env bash
# Start JupyterLab for repo notebooks (default http://127.0.0.1:4200).
#
# Works from any working directory if you invoke this script by path, e.g.:
#   bash ~/BW_Code/RiskModels_API/scripts/start-jupyter-lab.sh
#   bash ../RiskModels_API/scripts/start-jupyter-lab.sh
# Or pin the repo (nonstandard layouts):
#   RISKMODELS_API_ROOT=/path/to/RiskModels_API bash scripts/start-jupyter-lab.sh
# From anywhere via npm (cwd must be repo root, or use --prefix /path/to/RiskModels_API):
#   npm run ipynb
#   npm --prefix "$HOME/BW_Code/RiskModels_API" run ipynb
#
# One-time setup (use a venv you prefer):
#   pip install -r notebooks/requirements-jupyter.txt
#   pip install -e "./sdk[viz,dotenv]"
#
# Optional: register a named kernel (pick the same python as above):
#   python -m ipykernel install --user --name riskmodels-sdk \
#     --display-name "Python (RiskModels SDK)"
#
# Env overrides:
#   RISKMODELS_API_ROOT=...   force repo root (optional)
#   PYTHON=python3.12         interpreter that has jupyter + riskmodels (default: python3)
#   JUPYTER_PORT=4200         (default)
#   JUPYTER_IP=127.0.0.1
#   JUPYTER_NOTEBOOK_DIR=/path   (default: repo root)
#   JUPYTER_NO_AUTH=1   disable token on localhost only (not for shared machines)
#   JUPYTER_CONFIG_DIR=...  default: repo .jupyter-local/ so stale ~/.jupyter (e.g. nbconvert_path)
#                     does not crash JupyterLab; set to ~/.jupyter to use your global config
set -euo pipefail

if [[ -n "${RISKMODELS_API_ROOT:-}" ]]; then
  ROOT="$(cd "$RISKMODELS_API_ROOT" && pwd -P)"
else
  SOURCE="${BASH_SOURCE[0]:-$0}"
  case "$SOURCE" in
    /*) ;;
    *) SOURCE="${PWD%/}/$SOURCE" ;;
  esac
  _SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd -P)"
  ROOT="$(cd "$_SCRIPT_DIR/.." && pwd -P)"
fi

cd "$ROOT"

if [[ -z "${JUPYTER_CONFIG_DIR:-}" ]]; then
  export JUPYTER_CONFIG_DIR="$ROOT/.jupyter-local"
  mkdir -p "$JUPYTER_CONFIG_DIR"
fi

PYTHON="${PYTHON:-python3}"
PORT="${JUPYTER_PORT:-4200}"
IP="${JUPYTER_IP:-127.0.0.1}"
NOTEBOOK_DIR="${JUPYTER_NOTEBOOK_DIR:-$ROOT}"

if ! "$PYTHON" -m jupyterlab --version >/dev/null 2>&1; then
  echo "JupyterLab not found for ${PYTHON}. Install with:" >&2
  echo "  ${PYTHON} -m pip install -r $ROOT/notebooks/requirements-jupyter.txt" >&2
  exit 1
fi

# Editable SDK layout: package lives under sdk/riskmodels
export PYTHONPATH="${ROOT}/sdk:${PYTHONPATH:-}"

ARGS=(
  --port="${PORT}"
  --ip="${IP}"
  --no-browser
  --notebook-dir="${NOTEBOOK_DIR}"
)

if [[ "${JUPYTER_NO_AUTH:-}" == "1" ]]; then
  ARGS+=(--ServerApp.token='' --ServerApp.password='')
  echo "JUPYTER_NO_AUTH=1: no token (localhost only). Open http://${IP}:${PORT}/"
else
  echo "Open the URL printed below (includes access token)."
fi

exec "$PYTHON" -m jupyterlab "${ARGS[@]}"
