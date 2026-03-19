#!/usr/bin/env bash
# Copy env vars from Risk_Models to RiskModels_API/.env.local
# Usage: ./scripts/copy-env-from-risk-models.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$REPO_ROOT/../Risk_Models/riskmodels_com/.env.local"
DEST="$REPO_ROOT/.env.local"

if [ ! -f "$SRC" ]; then
  echo "❌ $SRC not found"
  exit 1
fi

# Keys to copy (public + needed for portal)
KEYS="NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_APP_URL STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET SUPABASE_SERVICE_ROLE_KEY"

TMP=$(mktemp)
# Keep existing dest lines that we're NOT overwriting
if [ -f "$DEST" ]; then
  grep -vE "^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|NEXT_PUBLIC_APP_URL|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|SUPABASE_SERVICE_ROLE_KEY)=" "$DEST" 2>/dev/null >> "$TMP" || true
fi

# Append keys from Risk_Models
for key in $KEYS; do
  line=$(grep -E "^${key}=" "$SRC" 2>/dev/null || true)
  if [ -n "$line" ]; then
    echo "$line" >> "$TMP"
    echo "✓ $key"
  else
    echo "⊘ $key (not in source)"
  fi
done

mv "$TMP" "$DEST"
echo ""
echo "Updated $DEST"
