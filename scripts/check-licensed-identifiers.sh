#!/usr/bin/env bash
# scripts/check-licensed-identifiers.sh
#
# Guards against accidental exposure of LICENSED third-party identifiers
# in public API surfaces. Specifically:
#
#   - CUSIP             (licensed by CUSIP Global Services / S&P; redistribution prohibited)
#   - ISIN              (licensed by ANNA / national numbering agencies)
#   - fsym_id           (FactSet proprietary security identifier)
#   - factset_fund_id   (FactSet proprietary fund identifier)
#   - factset_entity_id (FactSet proprietary entity identifier)
#
# Internal compute layers (Funds_DAG, ERM3) reference these freely — they're
# inputs we license. The contract this check enforces:
# **none of these identifiers leaves through a public API response.**
#
# Scope: API route handlers, the public DAL, the OpenAPI spec, the MCP
# spec mirror, and the public-facing SDKs/packages. Migrations, tests,
# fixtures, and internal admin paths are NOT scanned (those legitimately
# carry the columns; the contract is downstream of them).
#
# Two allowlist markers (case-insensitive):
#
#   `licensed-id-ok: <reason>`         — line-level skip
#   `licensed-id-ok-file: <reason>`    — file-level skip when in first 40 lines
#
# Use file-level for translator endpoints that accept CUSIP/ISIN as INPUT
# and return our internal identifier (ticker / bw_sym_id / FIGI) — that's
# not redistribution of the licensed value, the user already had it.
# Use line-level for one-off exposures (comments, single field references).
# Always include a short reason — `AUDIT-PENDING` flags items for license
# review and is grep-able later.

set -uo pipefail

# Tokens to flag (case-insensitive whole-word match).
# `_id` variants and a bare `cusip` / `isin` are sufficient — partial
# matches inside camelCase or snake_case won't fire because of `-w`.
PATTERN='cusip|fsym_id|factset_fund_id|factset_entity_id|isin'

# Paths the public API surfaces or that downstream consumers can read.
SCAN_PATHS=(
    app/api
    lib
    sdk/riskmodels
    packages
    OPENAPI_SPEC.yaml
    mcp/data/openapi.json
)

# Exclusions (path globs + directories). Tests carry mock data legitimately.
EXCLUDES=(
    --exclude-dir=node_modules
    --exclude-dir=__pycache__
    --exclude-dir=.venv
    --exclude-dir=.next
    --exclude-dir=dist
    --exclude-dir=build
    --exclude-dir=tests
    --exclude='*.test.ts'
    --exclude='*.test.tsx'
    --exclude='*.test.py'
    --exclude='*.spec.ts'
    --exclude='*.spec.tsx'
    --exclude-dir=__tests__
)

# Filter only existing paths (so the grep doesn't fail when one's absent).
existing_paths=()
for p in "${SCAN_PATHS[@]}"; do
    if [[ -e "$p" ]]; then existing_paths+=("$p"); fi
done
if [[ ${#existing_paths[@]} -eq 0 ]]; then
    echo "✓ No paths to scan (license-guard.sh)"
    exit 0
fi

# Pre-pass: collect files with a file-level allowlist marker in their
# first 40 lines. Bash-3 compatible: a single-string sentinel lookup.
# Files whose marker mentions AUDIT-PENDING are also surfaced as warnings
# at the end so they're not silently buried.
FILE_ALLOWLIST_LIST=""
FILE_AUDIT_PENDING_LIST=""
collect_file_allowlist() {
    local f="$1"
    if [[ -f "$f" ]]; then
        local head_text
        head_text=$(head -40 "$f" 2>/dev/null)
        if echo "$head_text" | grep -iqE 'licensed-id-ok-file:'; then
            FILE_ALLOWLIST_LIST+="|$f|"
            if echo "$head_text" | grep -iqE 'AUDIT-PENDING'; then
                FILE_AUDIT_PENDING_LIST+="$f"$'\n'
            fi
        fi
    fi
}

for path in "${existing_paths[@]}"; do
    if [[ -f "$path" ]]; then
        collect_file_allowlist "$path"
    elif [[ -d "$path" ]]; then
        while IFS= read -r f; do
            collect_file_allowlist "$f"
        done < <(find "$path" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.py' -o -name '*.yaml' -o -name '*.yml' -o -name '*.json' \) 2>/dev/null)
    fi
done

raw_matches=$(grep -rinwE "$PATTERN" "${EXCLUDES[@]}" "${existing_paths[@]}" 2>/dev/null || true)

# Filter out:
#  1. Lines with the allowlist marker `licensed-id-ok` (case-insensitive)
#  2. False positives where `isin` is the pandas DataFrame.isin() method,
#     not the security identifier — pattern: `.isin(`
violations=""
audit_pending=""
while IFS= read -r line; do
    if [[ -z "$line" ]]; then continue; fi
    # Extract file path (everything before the first colon)
    file_part="${line%%:*}"
    if [[ "$FILE_ALLOWLIST_LIST" == *"|$file_part|"* ]]; then
        continue
    fi
    if echo "$line" | grep -iqE 'licensed-id-ok'; then
        # Surface AUDIT-PENDING markers in summary so they don't get forgotten
        if echo "$line" | grep -iqE 'AUDIT-PENDING'; then
            audit_pending+="$line"$'\n'
        fi
        continue
    fi
    # Drop pandas `.isin(` method calls (NOT the security ISIN identifier).
    # Strip `.isin(` occurrences before re-checking the remaining hits.
    stripped=$(echo "$line" | sed -E 's/\.isin[[:space:]]*\(/.METHOD(/g')
    if ! echo "$stripped" | grep -inwE "$PATTERN" > /dev/null; then
        continue
    fi
    violations+="$line"$'\n'
done <<<"$raw_matches"

if [[ -n "$violations" ]]; then
    echo "::error::Licensed-identifier exposure check FAILED"
    echo ""
    echo "The following lines reference LICENSED third-party identifiers"
    echo "(CUSIP / FactSet ID / ISIN) in API-exposed paths:"
    echo ""
    echo "$violations"
    echo ""
    echo "Resolution: either"
    echo "  - Remove the identifier from the public surface, OR"
    echo "  - Add 'licensed-id-ok: <reason>' on the line if it's a legitimate"
    echo "    internal reference (e.g., admin-only endpoint not in OpenAPI,"
    echo "    or a comment that names the identifier without exposing values)"
    echo ""
    echo "License context:"
    echo "  CUSIP            — licensed by CUSIP Global Services; redistribution prohibited"
    echo "  ISIN             — licensed by ANNA / national numbering agencies"
    echo "  fsym_id / factset_*_id — FactSet proprietary; redistribution requires license"
    exit 1
fi

if [[ -n "$audit_pending" ]]; then
    echo "::warning::Licensed-identifier exposures with AUDIT-PENDING markers:"
    echo ""
    echo "$audit_pending"
    echo "These are tolerated for now but should be reviewed by the license"
    echo "team. To clear: either remove the exposure or change the marker"
    echo "comment to a definitive reason."
    echo ""
fi

if [[ -n "$FILE_AUDIT_PENDING_LIST" ]]; then
    echo "::warning::Files with file-level licensed-id-ok-file: AUDIT-PENDING markers:"
    echo ""
    echo "$FILE_AUDIT_PENDING_LIST"
    echo "Each of these files contains licensed-identifier references that"
    echo "are silently allowlisted at the file level pending license review."
    echo "To clear: resolve the exposure or rewrite the file marker without"
    echo "AUDIT-PENDING."
    echo ""
fi

echo "✓ No licensed-identifier leaks in API-exposed paths"
exit 0
