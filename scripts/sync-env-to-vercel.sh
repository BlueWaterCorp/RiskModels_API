#!/usr/bin/env bash
# Sync .env.local to Vercel environment variables
# Requires: vercel CLI (npx vercel), project linked (vercel link)
# Usage: ./scripts/sync-env-to-vercel.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_ENV="$REPO_ROOT/.env.local"

# Vars to sync (matches .env.example)
KEYS=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  NEXT_PUBLIC_APP_URL
  SUPABASE_SERVICE_ROLE_KEY
  RISKMODELS_API_SERVICE_KEY
  STRIPE_SECRET_KEY
)

if [ ! -f "$LOCAL_ENV" ]; then
  echo "❌ No .env.local found at $LOCAL_ENV"
  exit 1
fi

if [ ! -f "$REPO_ROOT/.vercel/project.json" ]; then
  echo "❌ Project not linked. Run: npx vercel link"
  exit 1
fi

echo "Syncing .env.local to Vercel..."
echo ""

for key in "${KEYS[@]}"; do
  val=$(grep -E "^${key}=" "$LOCAL_ENV" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
  if [ -z "$val" ] && [ "$key" = "RISKMODELS_API_SERVICE_KEY" ]; then
    val=$(grep -E "^GATEWAY_SERVICE_KEY=" "$LOCAL_ENV" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
  fi
  if [ -z "$val" ]; then
    echo "⊘ $key (not found)"
    continue
  fi
  for env in production preview development; do
    printf '%s' "$val" | npx vercel env add "$key" "$env" --force 2>/dev/null || true
  done
  echo "✓ $key"
done

echo ""
echo "Done. Redeploy for changes to take effect."
