#!/usr/bin/env bash
# Runs supabase-patch-auth-smtp-resend.sh with secrets from Doppler.
# Defaults match repo doppler.yaml (erm3). Override with DOPPLER_PROJECT / DOPPLER_CONFIG.
#
# Examples:
#   ./scripts/supabase-auth-smtp-doppler.sh
#   DOPPLER_CONFIG=prd ./scripts/supabase-auth-smtp-doppler.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DOPPLER_PROJECT="${DOPPLER_PROJECT:-erm3}"
DOPPLER_CONFIG="${DOPPLER_CONFIG:-dev}"
exec doppler run -p "$DOPPLER_PROJECT" -c "$DOPPLER_CONFIG" -- bash ./scripts/supabase-patch-auth-smtp-resend.sh
