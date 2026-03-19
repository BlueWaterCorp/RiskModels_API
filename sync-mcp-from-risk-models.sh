#!/usr/bin/env bash
#
# Sync MCP server data from the Risk_Models repo into this (RiskModels_API) repo.
# Run from RiskModels_API root: ./sync-mcp-from-risk-models.sh
#
# Prerequisites:
#   - Risk_Models repo path: set RISK_MODELS_REPO, or defaults to ../Risk_Models
#   - In Risk_Models: riskmodels_com has deps installed (npm install) and generate-mcp-data works
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
RISK_MODELS_REPO="${RISK_MODELS_REPO:-$ROOT_DIR/../Risk_Models}"
RM_COM="$RISK_MODELS_REPO/riskmodels_com"
SRC_DATA="$RM_COM/mcp-server/data"
DST_DATA="$ROOT_DIR/mcp-server/data"

if [[ ! -d "$RISK_MODELS_REPO" ]]; then
  echo "Error: Risk_Models repo not found at: $RISK_MODELS_REPO"
  echo "Set RISK_MODELS_REPO to the path of the Risk_Models repo, or clone it next to this repo."
  exit 1
fi

if [[ ! -d "$RM_COM" ]]; then
  echo "Error: riskmodels_com not found at: $RM_COM"
  exit 1
fi

echo "Risk_Models repo: $RISK_MODELS_REPO"
echo "Generating MCP data in riskmodels_com..."
(cd "$RM_COM" && npm run generate-mcp-data)

if [[ ! -f "$SRC_DATA/capabilities.json" ]]; then
  echo "Error: generate-mcp-data did not produce $SRC_DATA/capabilities.json"
  exit 1
fi

echo "Copying MCP data into RiskModels_API..."
mkdir -p "$DST_DATA/schemas"
cp "$SRC_DATA/capabilities.json" "$DST_DATA/"
cp "$SRC_DATA/schema-paths.json" "$DST_DATA/"
for f in "$SRC_DATA/schemas"/*.json; do
  [[ -f "$f" ]] && cp "$f" "$DST_DATA/schemas/"
done

echo "Done. Updated: capabilities.json, schema-paths.json, schemas/*.json"
echo "Note: openapi.json is not overwritten; update it from OPENAPI_SPEC.yaml if needed."
echo "Note: Supabase table list (including erm3_betas, erm3_rankings) is in AUTHENTICATION_GUIDE.md and SUPABASE_TABLES.md; update those when Risk_Models adds or renames tables."
