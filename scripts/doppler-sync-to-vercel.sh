#!/usr/bin/env bash
# Push allowlisted secrets from Doppler into the linked Vercel project (CLI-only path).
#
# Doppler's OAuth Vercel integration is dashboard-only:
#   https://docs.doppler.com/docs/vercel
# This script sets the same Vercel env vars using doppler + vercel CLIs.
#
# Prerequisites: doppler login, vercel login, jq, vercel link (see Risk_Models sibling script header).
#
# Usage:
#   DOPPLER_PROJECT=erm3 DOPPLER_CONFIG=prd VERCEL_ENVS=production ./scripts/doppler-sync-to-vercel.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ALLOWLIST="${ALLOWLIST:-$SCRIPT_DIR/doppler-vercel-allowlist.txt}"

DOPPLER_PROJECT="${DOPPLER_PROJECT:-erm3}"
DOPPLER_CONFIG="${DOPPLER_CONFIG:-prd}"
VERCEL_ENVS="${VERCEL_ENVS:-production}"

cd "$REPO_ROOT"

if [[ ! -f .vercel/project.json ]]; then
  echo "❌ No .vercel/project.json — run: npx vercel link"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq is required (e.g. brew install jq)"
  exit 1
fi

if [[ ! -f "$ALLOWLIST" ]]; then
  echo "❌ Allowlist not found: $ALLOWLIST"
  exit 1
fi

is_sensitive() {
  local var=$1
  case "$var" in
    *SECRET*|*KEY*|*PASSWORD*)
      if [[ "$var" != NEXT_PUBLIC_* ]]; then
        return 0
      fi
      ;;
  esac
  return 1
}

is_reserved_vercel_name() {
  case "$1" in
    AWS_REGION|AWS_DEFAULT_REGION|AWS_ACCESS_KEY_ID|AWS_SECRET_KEY|AWS_SECRET_ACCESS_KEY|AWS_EXECUTION_ENV|AWS_LAMBDA_LOG_GROUP_NAME|AWS_LAMBDA_LOG_STREAM_NAME|AWS_LAMBDA_FUNCTION_NAME|AWS_LAMBDA_FUNCTION_MEMORY_SIZE|AWS_LAMBDA_FUNCTION_VERSION|AWS_SESSION_TOKEN|NOW_REGION|TZ|LAMBDA_TASK_ROOT|LAMBDA_RUNTIME_DIR)
      return 0
      ;;
  esac
  return 1
}

sync_var() {
  local var=$1
  local value=$2
  local env=$3

  vercel env rm "$var" "$env" --yes 2>/dev/null || true

  if is_sensitive "$var"; then
    echo "🔐 $var → $env (sensitive)"
    if [[ "$env" == "development" ]]; then
      printf '%s' "$value" | vercel env add "$var" "$env" --force --yes
    else
      printf '%s' "$value" | vercel env add "$var" "$env" --force --yes --sensitive
    fi
  else
    echo "📝 $var → $env"
    printf '%s' "$value" | vercel env add "$var" "$env" --force --yes
  fi
}

echo "📥 Fetching Doppler secrets: project=$DOPPLER_PROJECT config=$DOPPLER_CONFIG"
JSON="$(doppler secrets download --no-file --no-fallback --format json -p "$DOPPLER_PROJECT" -c "$DOPPLER_CONFIG")"

IFS=',' read -ra TARGET_ENVS <<< "$VERCEL_ENVS"
for raw in "${TARGET_ENVS[@]}"; do
  env_name="$(echo "$raw" | tr -d '[:space:]')"
  [[ -z "$env_name" ]] && continue
  if [[ "$env_name" != "production" && "$env_name" != "preview" && "$env_name" != "development" ]]; then
    echo "❌ Invalid VERCEL_ENVS entry: $env_name"
    exit 1
  fi
done

synced=0
skipped=0

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(echo "$line" | tr -d '[:space:]')"
  [[ -z "$line" ]] && continue

  key="$line"
  if [[ "$key" == DOPPLER_* ]]; then
    continue
  fi
  if is_reserved_vercel_name "$key"; then
    echo "⊘ $key (reserved on Vercel — skipped)"
    skipped=$((skipped + 1))
    continue
  fi

  value="$(echo "$JSON" | jq -r --arg k "$key" '.[$k] // ""')"
  if [[ -z "$value" || "$value" == "null" ]]; then
    echo "⊘ $key (not set in Doppler)"
    skipped=$((skipped + 1))
    continue
  fi

  for raw in "${TARGET_ENVS[@]}"; do
    env_name="$(echo "$raw" | tr -d '[:space:]')"
    [[ -z "$env_name" ]] && continue
    sync_var "$key" "$value" "$env_name"
  done
  synced=$((synced + 1))
done < "$ALLOWLIST"

echo ""
echo "Done. Synced $synced allowlisted keys (skipped/missing: $skipped)."
echo "Redeploy on Vercel for new values to take effect."
