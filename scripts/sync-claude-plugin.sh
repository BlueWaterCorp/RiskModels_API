#!/usr/bin/env bash
# Sync RiskModels_API/claude-plugin → BlueWaterCorp/riskmodels-plugin checkout.
# Edit SSOT under RiskModels_API/claude-plugin; publish with this script + git push
# in the thin plugin repo (directory + marketplace add URL).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$API_ROOT/claude-plugin"

DEST="${RISKMODELS_PLUGIN_DEST:-$API_ROOT/../riskmodels-plugin}"

if [[ ! -d "$SRC/.claude-plugin" ]]; then
  echo "error: missing SSOT at $SRC/.claude-plugin" >&2
  exit 1
fi

if [[ ! -d "$DEST/.git" ]]; then
  echo "error: destination is not a git checkout: $DEST" >&2
  echo "Clone BlueWaterCorp/riskmodels-plugin next to RiskModels_API, or set RISKMODELS_PLUGIN_DEST." >&2
  exit 1
fi

echo "Syncing $SRC → $DEST"
rsync -a --delete \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  --exclude='node_modules' \
  "$SRC/" "$DEST/"

echo "Done. Review and push from $DEST:"
echo "  cd \"$DEST\" && git status && git add -A && git commit -m '…' && git push"
