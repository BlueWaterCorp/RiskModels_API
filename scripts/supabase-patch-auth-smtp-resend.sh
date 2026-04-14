#!/usr/bin/env bash
# Patch hosted Supabase Auth to send magic links (and other auth email) via Resend SMTP,
# using a verified From address on riskmodels.app. Does not touch site_url or redirect URLs.
#
# Prereqs: jq, curl. Token: Supabase Dashboard, Account, Access tokens (same idea as supabase login).
#
# Usage (manual env):
#   export SUPABASE_MANAGEMENT_ACCESS_TOKEN='sbp_...'   # preferred
#   export RESEND_API_KEY='re_...'
#   (optional fallback name: SUPABASE_ACCESS_TOKEN)
#   export SUPABASE_PROJECT_REF='...'   # optional if NEXT_PUBLIC_SUPABASE_URL or supabase link ref exists
#   bash scripts/supabase-patch-auth-smtp-resend.sh
#
# With Doppler (project erm3 by default; run `doppler setup` in repo root if not linked):
#   SUPABASE_MANAGEMENT_ACCESS_TOKEN — personal token (Dashboard, Account, Access tokens)
#   RESEND_API_KEY — portal already uses this
#   Optional: SUPABASE_PROJECT_REF — else derived from NEXT_PUBLIC_SUPABASE_URL
#   DOPPLER_CONFIG=prd npm run supabase:auth-smtp:resend:doppler
#   DOPPLER_PROJECT=myproj DOPPLER_CONFIG=stg ./scripts/supabase-auth-smtp-doppler.sh
#
# Optional overrides:
#   SMTP_ADMIN_EMAIL=service@riskmodels.app SMTP_SENDER_NAME="RiskModels"
#
# After success: try magic link on https://riskmodels.app/get-key
# Then raise Auth rate limits in Supabase Dashboard under Authentication, Rate Limits if needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (brew install jq)." >&2
  exit 1
fi

# Prefer explicit maintainer name so a stray SUPABASE_ACCESS_TOKEN in the shell (or old paste-* value)
# does not override Doppler when using npm run supabase:auth-smtp:resend:doppler.
TOKEN="${SUPABASE_MANAGEMENT_ACCESS_TOKEN:-${SUPABASE_ACCESS_TOKEN:-}}"
KEY="${RESEND_API_KEY:-}"
# Doppler / Windows line endings
TOKEN="${TOKEN//$'\r'/}"
KEY="${KEY//$'\r'/}"
# Trim leading/trailing whitespace (common copy-paste / secret manager issues)
TOKEN="${TOKEN#"${TOKEN%%[![:space:]]*}"}"
TOKEN="${TOKEN%"${TOKEN##*[![:space:]]}"}"
KEY="${KEY#"${KEY%%[![:space:]]*}"}"
KEY="${KEY%"${KEY##*[![:space:]]}"}"

if [[ -z "$TOKEN" || -z "$KEY" ]]; then
  echo "Set SUPABASE_MANAGEMENT_ACCESS_TOKEN (or SUPABASE_ACCESS_TOKEN) and RESEND_API_KEY." >&2
  echo "Tip: npm run supabase:auth-smtp:resend:doppler (after storing secrets in Doppler)." >&2
  exit 1
fi

if [[ "$TOKEN" == *paste* || "$TOKEN" == *YOUR_* || "$TOKEN" == *your_actual* || "$TOKEN" == '...' || "$TOKEN" == *ellipsis* ]]; then
  echo "Token value looks like placeholder text from docs, not a real sbp_ token." >&2
  echo "In Doppler: set SUPABASE_MANAGEMENT_ACCESS_TOKEN. If your shell still has SUPABASE_ACCESS_TOKEN from a bad paste, run: unset SUPABASE_ACCESS_TOKEN" >&2
  exit 1
fi

if [[ "$TOKEN" != sbp_* ]]; then
  echo "Error: Supabase personal access tokens start with sbp_. Got: ${TOKEN:0:20}…" >&2
  echo "Do not use anon key, service_role JWT, or Vercel token — only Account → Access tokens." >&2
  exit 1
fi

REF="${SUPABASE_PROJECT_REF:-}"
if [[ -z "$REF" ]]; then
  url="${NEXT_PUBLIC_SUPABASE_URL:-}"
  url="${url%/}"
  if [[ "$url" =~ ^https?://([a-zA-Z0-9_-]+)\.supabase\.co$ ]]; then
    REF="${BASH_REMATCH[1]}"
  fi
fi
if [[ -z "$REF" && -f supabase/.temp/project-ref ]]; then
  REF="$(tr -d '[:space:]' < supabase/.temp/project-ref)"
fi
if [[ -z "$REF" ]]; then
  echo "Could not resolve project ref. Set SUPABASE_PROJECT_REF, or NEXT_PUBLIC_SUPABASE_URL (https://<ref>.supabase.co), or run supabase link." >&2
  exit 1
fi

ADMIN="${SMTP_ADMIN_EMAIL:-service@riskmodels.app}"
NAME="${SMTP_SENDER_NAME:-RiskModels}"

BODY="$(jq -n \
  --arg pass "$KEY" \
  --arg admin "$ADMIN" \
  --arg name "$NAME" \
  --arg port "${SMTP_PORT:-465}" \
  '{
    external_email_enabled: true,
    smtp_admin_email: $admin,
    smtp_host: "smtp.resend.com",
    smtp_port: $port,
    smtp_user: "resend",
    smtp_pass: $pass,
    smtp_sender_name: $name
  }')"

URL="https://api.supabase.com/v1/projects/${REF}/config/auth"
code="$(curl -sS -o /tmp/supabase-auth-smtp-patch.json -w '%{http_code}' -X PATCH "$URL" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY")"

if [[ "$code" != "200" && "$code" != "204" ]]; then
  echo "PATCH failed (HTTP $code). Response:" >&2
  cat /tmp/supabase-auth-smtp-patch.json >&2
  echo >&2
  if [[ "$code" == "401" ]]; then
    echo "HTTP 401: invalid or unauthorized token for the Management API." >&2
    echo "  • Create a personal access token: https://supabase.com/dashboard/account/tokens" >&2
    echo "  • Store it in Doppler as SUPABASE_MANAGEMENT_ACCESS_TOKEN (not service_role / anon)." >&2
    echo "  • The account that minted the token must have access to project ref: ${REF}" >&2
  fi
  exit 1
fi

echo "OK — Supabase Auth SMTP updated for project ${REF} (From: ${NAME} <${ADMIN}> via Resend)."
rm -f /tmp/supabase-auth-smtp-patch.json
