#!/usr/bin/env bash
# Reconcile allowlisted env vars across Doppler, Vercel (linked project), and local .env.local.
# Prints presence only (no secret values). Optional SHA256 fingerprints for Doppler vs local.
#
# Prerequisites: doppler login, vercel login, jq, .vercel/project.json (vercel link).
#
# Usage (repo root):
#   ./scripts/recon-env.sh
#   LOCAL_ENV=../BWMACRO/web/.env.local ./scripts/recon-env.sh
#   ALLOWLIST=scripts/doppler-vercel-allowlist-email.txt ./scripts/recon-env.sh
#   ./scripts/recon-env.sh --fingerprints
#
# Env:
#   DOPPLER_PROJECT (default erm3), DOPPLER_CONFIG (default prd)
#   VERCEL_TARGET   (default production) — passed to `vercel env ls <target>`
#   LOCAL_ENV       (default <repo>/.env.local)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FINGERPRINTS=0
for arg in "$@"; do
  case "$arg" in
    --fingerprints|-f) FINGERPRINTS=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

if [[ -n "${ALLOWLIST:-}" && "${ALLOWLIST}" != /* ]]; then
  ALLOWLIST="$REPO_ROOT/$ALLOWLIST"
fi
ALLOWLIST="${ALLOWLIST:-$SCRIPT_DIR/doppler-vercel-allowlist.txt}"

DOPPLER_PROJECT="${DOPPLER_PROJECT:-erm3}"
DOPPLER_CONFIG="${DOPPLER_CONFIG:-prd}"
VERCEL_TARGET="${VERCEL_TARGET:-production}"
LOCAL_ENV="${LOCAL_ENV:-$REPO_ROOT/.env.local}"

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

VERCEL_JSON="$(vercel env ls "$VERCEL_TARGET" --format json 2>/dev/null)" || {
  echo "❌ vercel env ls failed — run vercel login and link this directory"
  exit 1
}

if ! echo "$VERCEL_JSON" | jq -e '.envs' >/dev/null 2>&1; then
  echo "❌ Unexpected Vercel JSON output"
  exit 1
fi

VERCEL_KEYS_JSON="$(echo "$VERCEL_JSON" | jq -c '[.envs[].key] | unique')"

doppler_has() {
  local key=$1
  [[ -n "$DOPPLER_JSON" ]] && echo "$DOPPLER_JSON" | jq -e --arg k "$key" '(.[$k] // "") | tostring | length > 0' >/dev/null 2>&1
}

vercel_has() {
  local key=$1
  echo "$VERCEL_KEYS_JSON" | jq -e --arg k "$key" 'index($k) != null' >/dev/null 2>&1
}

local_value() {
  local key=$1
  [[ ! -f "$LOCAL_ENV" ]] && return 1
  # First line matching KEY= (optional whitespace); strip optional quotes from value
  local line
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$LOCAL_ENV" 2>/dev/null | head -1)" || return 1
  local v="${line#*=}"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  if [[ ${#v} -ge 2 && ${v:0:1} == '"' && ${v: -1} == '"' ]]; then
    v="${v#\"}"
    v="${v%\"}"
  elif [[ ${#v} -ge 2 && ${v:0:1} == "'" && ${v: -1} == "'" ]]; then
    v="${v#\'}"
    v="${v%\'}"
  fi
  printf '%s' "$v"
}

short_sha() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | cut -c1-8
  else
    printf '%s' "$1" | sha256sum | cut -c1-8
  fi
}

DOPPLER_JSON=""
if DOPPLER_JSON="$(doppler secrets download --no-file --format json -p "$DOPPLER_PROJECT" -c "$DOPPLER_CONFIG" 2>/dev/null)"; then
  :
else
  echo "⚠️  Doppler download failed (doppler login? project $DOPPLER_PROJECT config $DOPPLER_CONFIG?). Doppler column will show —."
  DOPPLER_JSON=""
fi

mark() {
  if "$@"; then
    printf 'yes'
  else
    printf '—'
  fi
}

printf '\n'
printf 'Env recon  Doppler: %s/%s  Vercel: %s  Local: %s\n' \
  "$DOPPLER_PROJECT" "$DOPPLER_CONFIG" "$VERCEL_TARGET" "$LOCAL_ENV"
printf '%s\n' "Allowlist: $ALLOWLIST"
printf '\n'

if [[ "$FINGERPRINTS" -eq 1 ]]; then
  printf '%-40s %8s %8s %8s  %s\n' "KEY" "doppler" "vercel" "local" "fp (dop/loc match)"
else
  printf '%-40s %8s %8s %8s\n' "KEY" "doppler" "vercel" "local"
fi

printf '%s\n' "$(printf '=%.0s' {1..72})"

missing_any=0
while IFS= read -r raw || [[ -n "$raw" ]]; do
  line="${raw%%#*}"
  key="${line//[[:space:]]/}"
  [[ -z "$key" ]] && continue

  d_cell="$(mark doppler_has "$key")"
  v_cell="$(mark vercel_has "$key")"
  if [[ -f "$LOCAL_ENV" ]] && grep -E "^[[:space:]]*${key}[[:space:]]*=" "$LOCAL_ENV" >/dev/null 2>&1; then
    l_cell="yes"
  else
    l_cell="—"
  fi

  fp_note=""
  if [[ "$FINGERPRINTS" -eq 1 && "$d_cell" == "yes" && "$l_cell" == "yes" && -n "$DOPPLER_JSON" ]]; then
    dv="$(echo "$DOPPLER_JSON" | jq -r --arg k "$key" '.[$k] // empty')"
    lv="$(local_value "$key" || true)"
    ds="$(short_sha "$dv")"
    ls="$(short_sha "$lv")"
    if [[ "$ds" == "$ls" ]]; then
      fp_note="match $ds"
    else
      fp_note="DIFF $ds vs $ls"
      missing_any=1
    fi
  elif [[ "$FINGERPRINTS" -eq 1 ]]; then
    fp_note="n/a"
  fi

  if [[ "$FINGERPRINTS" -eq 1 ]]; then
    printf '%-40s %8s %8s %8s  %s\n' "$key" "$d_cell" "$v_cell" "$l_cell" "$fp_note"
  else
    printf '%-40s %8s %8s %8s\n' "$key" "$d_cell" "$v_cell" "$l_cell"
  fi

  if [[ "$d_cell" == "—" || "$v_cell" == "—" ]]; then
    missing_any=1
  fi
done < "$ALLOWLIST"

printf '\n'
if [[ "$missing_any" -eq 1 ]]; then
  echo "Legend: yes = present / set, — = missing. Sync: npm run vercel:sync-env:doppler (or :email for Resend-only allowlist)."
  echo "Local fill: npm run doppler:env (overwrites $REPO_ROOT/.env.local — backup first if needed)."
  [[ "$FINGERPRINTS" -eq 1 ]] && echo "Fingerprints: DIFF = Doppler vs local value mismatch (first 8 chars of SHA-256)."
else
  echo "All allowlisted keys are present in Doppler and Vercel ($VERCEL_TARGET)."
fi

exit "$missing_any"
