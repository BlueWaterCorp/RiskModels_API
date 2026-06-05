#!/usr/bin/env bash
#
# api_audits.sh — run the full RiskModels API audit suite and write reports.
#
# Steps (static first, then live):
#   1. openapi-yaml    OPENAPI_SPEC.yaml parses
#   2. cli-openapi     CLI-covered routes ⊆ OpenAPI spec        (scripts/cli-openapi-check.mjs)
#   3. route-drift     spec paths ↔ app/ route handlers          (scripts/audit/openapi_route_drift.py --strict)
#   4. schema-selftest the response-schema validator has teeth   (scripts/audit/live_schema_check.py --self-test)
#   5. smoke-endpoints hit every endpoint live                   (sdk/scripts/smoke_v3_all_endpoints.py)
#   6. schema-check    validate live 2xx bodies vs schemas       (consumes step 5's smoke_report.json)
#
# Reports are written to audit-reports/<timestamp>/. Exit is nonzero if any
# step fails (SKIP does not fail).
#
# Env / flags:
#   AUDIT_SKIP_LIVE=1   run only the static audits (no API key / no billing)
#   SKIP_EXPENSIVE=0    include snapshots/PDFs/batch in the smoke (default: 1, skipped — they bill)
#   SMOKE_WRITE_PDF=1   also emit the smoke PDF report (default: 0)
#   RISKMODELS_API_KEY  used by the live steps; auto-loaded from .env / .env.local if unset
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Resolve a Python with the SDK + audit deps (shared BWMACRO venv preferred).
PY=""
for c in "../BWMACRO/.venv/bin/python" ".venv/bin/python" "$(command -v python3 || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && PY="$c" && break
done
[ -z "$PY" ] && { echo "ERROR: no python interpreter found (need ../BWMACRO/.venv or .venv)"; exit 2; }

TS="$(date +%Y%m%d_%H%M%S)"
OUT="audit-reports/$TS"
mkdir -p "$OUT"

NAMES=(); CODES=()
record() { NAMES+=("$1"); CODES+=("$2"); }
step() {  # step <name> <cmd...>
  local name="$1"; shift
  echo; echo "──────── $name ────────"
  "$@"
  local code=$?
  record "$name" "$code"
}

echo "RiskModels API audits → $OUT"

# ---- static audits (no API key) -----------------------------------------
step "openapi-yaml" "$PY" -c "import yaml; yaml.safe_load(open('OPENAPI_SPEC.yaml')); print('OPENAPI_SPEC.yaml parses OK')"

if command -v node >/dev/null 2>&1; then
  step "cli-openapi" node scripts/cli-openapi-check.mjs
else
  echo "skip cli-openapi (node not found)"; record "cli-openapi" "skip"
fi

step "route-drift" "$PY" scripts/audit/openapi_route_drift.py --strict --out-dir "$OUT"

step "schema-selftest" "$PY" scripts/audit/live_schema_check.py --self-test

# ---- live audits (need an API key; cost money) ---------------------------
if [ "${AUDIT_SKIP_LIVE:-0}" = "1" ]; then
  echo; echo "AUDIT_SKIP_LIVE=1 — skipping live smoke + schema check."
  record "smoke-endpoints" "skip"; record "schema-check" "skip"
else
  HAS_KEY="$("$PY" -c "import sys,os; sys.path.insert(0,'sdk/scripts'); import smoke_v3_all_endpoints as s; s.load_env_files(); print('1' if os.environ.get('RISKMODELS_API_KEY') else '0')" 2>/dev/null || echo 0)"
  if [ "$HAS_KEY" != "1" ]; then
    echo; echo "No RISKMODELS_API_KEY found (env or .env/.env.local) — skipping live steps. Set AUDIT_SKIP_LIVE=1 to silence."
    record "smoke-endpoints" "skip"; record "schema-check" "skip"
  else
    export SMOKE_REPORT_DIR="$OUT/smoke"
    export SMOKE_JSON_BODY_MAX="${SMOKE_JSON_BODY_MAX:-200000}"  # fuller bodies → fewer truncation skips
    export SKIP_EXPENSIVE="${SKIP_EXPENSIVE:-1}"                 # snapshots/PDFs/batch bill — opt-in
    export SMOKE_WRITE_PDF="${SMOKE_WRITE_PDF:-0}"
    step "smoke-endpoints" "$PY" sdk/scripts/smoke_v3_all_endpoints.py
    if [ -f "$OUT/smoke/smoke_report.json" ]; then
      # Reporting only (no --strict): schema drift is surfaced + written to
      # schema_check.json but does not fail the gate (often spec staleness).
      # Add --strict to enforce once the spec/responses are reconciled.
      step "schema-check" "$PY" scripts/audit/live_schema_check.py \
        --smoke-report "$OUT/smoke/smoke_report.json" --out-dir "$OUT"
    else
      echo "smoke_report.json not found — skipping schema-check"; record "schema-check" "skip"
    fi
  fi
fi

# ---- summary ------------------------------------------------------------
echo; echo "════════ API AUDIT SUMMARY ($TS) ════════"
fail=0
for i in "${!NAMES[@]}"; do
  c="${CODES[$i]}"
  case "$c" in
    0)        s="PASS" ;;
    skip)     s="SKIP" ;;
    *)        s="FAIL"; fail=1 ;;
  esac
  printf "  %-18s %s\n" "${NAMES[$i]}" "$s"
done
echo "Reports: $OUT/"
[ "$fail" = "0" ] && echo "Overall: PASS" || echo "Overall: FAIL"
exit "$fail"
