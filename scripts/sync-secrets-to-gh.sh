#!/usr/bin/env bash
# Sync env vars to GitHub Actions secrets
# Source: RiskModels_API/.env.local, fallback to Risk_Models/riskmodels_com/.env.local
# Requires: gh cli (brew install gh), gh auth login
# Usage: ./scripts/sync-secrets-to-gh.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO="Cerebellum-Archive/RiskModels_API"

# Prefer local .env.local, then copy from Risk_Models
LOCAL_ENV="$REPO_ROOT/.env.local"
RISK_MODELS_ENV="$REPO_ROOT/../Risk_Models/riskmodels_com/.env.local"

if [ ! -f "$LOCAL_ENV" ] && [ ! -f "$RISK_MODELS_ENV" ]; then
  echo "❌ No .env.local found in RiskModels_API or Risk_Models/riskmodels_com"
  exit 1
fi

if ! command -v gh &> /dev/null; then
  echo "❌ GitHub CLI (gh) not installed. Run: brew install gh"
  exit 1
fi

echo "Syncing secrets to $REPO..."
echo ""

# Keys we want to sync (safe to expose in CI: anon key, URL)
# Never sync: SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, API_KEY_SECRET
for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_APP_URL; do
  val=$(grep -E "^${key}=" "$LOCAL_ENV" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -z "$val" ] && [ -f "$RISK_MODELS_ENV" ]; then
    val=$(grep -E "^${key}=" "$RISK_MODELS_ENV" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
  fi
  if [ -n "$val" ]; then
    echo "$val" | gh secret set "$key" --repo "$REPO"
    echo "✓ $key"
  else
    echo "⊘ $key (not found)"
  fi
done

echo ""
echo "Done. CI will use these for builds."
