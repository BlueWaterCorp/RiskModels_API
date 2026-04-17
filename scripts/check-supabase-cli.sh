#!/usr/bin/env bash
# Verify the installed Supabase CLI can parse this repo's supabase/config.toml
# before running `supabase db push`. The config uses keys (e.g. db.health_timeout)
# that older CLIs silently fail to parse, which presents as an auth-looking error
# rather than a version error.
set -euo pipefail

MIN_VERSION="2.68.0"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not installed. Install: https://supabase.com/docs/guides/cli" >&2
  exit 1
fi

INSTALLED="$(supabase --version 2>/dev/null | head -1 | awk '{print $1}')"

# dotted-int comparison: 0 if $1 >= $2
vercmp() {
  local a="$1" b="$2"
  [ "$a" = "$b" ] && return 0
  local smaller
  smaller="$(printf '%s\n%s\n' "$a" "$b" | sort -V | head -1)"
  [ "$smaller" = "$b" ] && return 0 || return 1
}

if ! vercmp "$INSTALLED" "$MIN_VERSION"; then
  cat >&2 <<EOF
Supabase CLI $INSTALLED is older than required minimum $MIN_VERSION.

This repo's supabase/config.toml uses keys (e.g. db.health_timeout) that older
CLIs cannot parse. Older CLIs fail with a confusing "invalid keys" parse error
instead of a version hint.

Upgrade: brew upgrade supabase  (or https://supabase.com/docs/guides/cli)
EOF
  exit 1
fi

exec supabase "$@"
