#!/usr/bin/env bash
# scripts/check-raw-field-gate.sh
#
# Guards the EODHD Exhibit B(e) raw-field policy on user-facing surfaces.
#
# Two raw vendor fields — end-of-day close price and market capitalization —
# may be served ONLY (1) within authenticated environments, (2) on a per-symbol,
# per-request basis, (3) ancillary to derived analytics outputs. Everything else
# in the metric dictionary is Derived Data and is unrestricted.
#
# The policy itself lives in `lib/data-license.ts`. The failure mode this check
# exists for: that gate is *import-based*, so a new route that never imports it
# silently bypasses it. That is exactly how a public ticker page, a public OG
# card, a 100-symbol batch endpoint, and an anonymous chat tool each ended up
# serving raw fields (backlog V.1-V.6, fixed 2026-07-16).
#
# Rule enforced here: any file under a user-facing scan path that references a
# raw field name must EITHER import `lib/data-license` (and therefore gate it)
# OR carry an allowlist marker stating why it is safe.
#
# Allowlist markers (case-insensitive):
#
#   `raw-field-ok: <reason>`        — line-level skip
#   `raw-field-ok-file: <reason>`   — file-level skip when in the first 40 lines
#
# Always state the reason in Exhibit-B terms — which condition is met, or why
# the reference is not a raw vendor value at all (a doc example, a field name in
# a schema, a server-side input that is never emitted). `AUDIT-PENDING` in a
# marker surfaces it as a warning so gray calls stay grep-able instead of
# hardening into precedent.
#
# Contract: RiskModels_IP/docs/licensing/EODHD_Agreement_v3_Complete_DocuSign.pdf

set -uo pipefail

# Raw vendor field names, including the `close_price` alias spelling. The alias
# matters: it is NOT in RAW_RESTRICTED_KEYS, so the runtime strip helpers do not
# catch it — /api/batch/analyze emitted raw close under that name (V.3).
PATTERN='price_close|market_cap|close_price'

# User-facing surfaces: route handlers, rendered pages, React components.
SCAN_PATHS=(
    app
    components
)

EXCLUDES=(
    --exclude-dir=node_modules
    --exclude-dir=__pycache__
    --exclude-dir=.next
    --exclude-dir=dist
    --exclude-dir=build
    --exclude-dir=tests
    --exclude-dir=__tests__
    --exclude='*.test.ts'
    --exclude='*.test.tsx'
    --exclude='*.spec.ts'
    --exclude='*.spec.tsx'
)

existing_paths=()
for p in "${SCAN_PATHS[@]}"; do
    if [[ -e "$p" ]]; then existing_paths+=("$p"); fi
done
if [[ ${#existing_paths[@]} -eq 0 ]]; then
    echo "✓ No paths to scan (check-raw-field-gate.sh)"
    exit 0
fi

# Pre-pass: files carrying a file-level marker, and files that import the gate.
# Bash-3 compatible sentinel-string lookups (no associative arrays).
FILE_ALLOWLIST_LIST=""
FILE_AUDIT_PENDING_LIST=""
GATED_FILE_LIST=""
collect_file_state() {
    local f="$1"
    [[ -f "$f" ]] || return 0
    if grep -q 'data-license' "$f" 2>/dev/null; then
        GATED_FILE_LIST+="|$f|"
    fi
    local head_text
    head_text=$(head -40 "$f" 2>/dev/null)
    if echo "$head_text" | grep -iqE 'raw-field-ok-file:'; then
        FILE_ALLOWLIST_LIST+="|$f|"
        if echo "$head_text" | grep -iqE 'AUDIT-PENDING'; then
            FILE_AUDIT_PENDING_LIST+="$f"$'\n'
        fi
    fi
}

for path in "${existing_paths[@]}"; do
    if [[ -f "$path" ]]; then
        collect_file_state "$path"
    elif [[ -d "$path" ]]; then
        while IFS= read -r f; do
            collect_file_state "$f"
        done < <(find "$path" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null)
    fi
done

raw_matches=$(grep -rinwE "$PATTERN" "${EXCLUDES[@]}" "${existing_paths[@]}" 2>/dev/null || true)

violations=""
audit_pending=""
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    file_part="${line%%:*}"

    # File imports lib/data-license → it participates in the gate.
    if [[ "$GATED_FILE_LIST" == *"|$file_part|"* ]]; then
        continue
    fi
    if [[ "$FILE_ALLOWLIST_LIST" == *"|$file_part|"* ]]; then
        continue
    fi
    if echo "$line" | grep -iqE 'raw-field-ok'; then
        if echo "$line" | grep -iqE 'AUDIT-PENDING'; then
            audit_pending+="$line"$'\n'
        fi
        continue
    fi
    violations+="$line"$'\n'
done <<<"$raw_matches"

if [[ -n "$violations" ]]; then
    echo "::error::Raw-field gate check FAILED (EODHD Exhibit B(e))"
    echo ""
    echo "These user-facing lines reference a raw vendor field but the file"
    echo "neither imports lib/data-license nor carries an allowlist marker:"
    echo ""
    echo "$violations"
    echo "Resolution — pick one:"
    echo "  - Don't serve it. Derived metrics are unrestricted; raw close and"
    echo "    market cap usually aren't needed on the surface at all."
    echo "  - Gate it. Import lib/data-license and use rawEodhdPermitted() /"
    echo "    stripRawRestricted() / stripRawRestrictedDeep() at the call site."
    echo "  - Allowlist it with 'raw-field-ok: <reason>' if it is safe, e.g. a"
    echo "    doc example, a schema field name, or a server-side value that is"
    echo "    computed with but never emitted."
    echo ""
    echo "Exhibit B(e): raw close / market cap may be displayed ONLY within"
    echo "authenticated environments, per-symbol and per-request, ancillary to"
    echo "derived outputs. B(f): per-symbol, per-call delivery is not 'bulk'."
    echo "B(c)/(d): Derived Data may be redistributed via our API without limit."
    exit 1
fi

if [[ -n "$audit_pending" ]]; then
    echo "::warning::Raw-field references with AUDIT-PENDING markers:"
    echo ""
    echo "$audit_pending"
fi

if [[ -n "$FILE_AUDIT_PENDING_LIST" ]]; then
    echo "::warning::Files with file-level raw-field-ok-file: AUDIT-PENDING markers:"
    echo ""
    echo "$FILE_AUDIT_PENDING_LIST"
fi

echo "✓ No ungated raw-field references on user-facing surfaces"
exit 0
