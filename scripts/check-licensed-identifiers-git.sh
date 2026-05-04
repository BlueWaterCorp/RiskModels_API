#!/usr/bin/env bash
# scripts/check-licensed-identifiers-git.sh
#
# Companion to check-licensed-identifiers.sh: scrubs git COMMIT MESSAGES
# (subject + body) for licensed third-party identifiers. Catches the case
# where a CUSIP or ISIN value is leaked through a commit message even
# though the code itself is clean — commit messages are public on GitHub
# and indexed forever, so a leak there is just as bad as a leak in code.
#
# Range:
#   - On a PR (GITHUB_BASE_REF set):  origin/$GITHUB_BASE_REF..HEAD
#   - Locally / push to default:      HEAD~20..HEAD
#
# Override the range via GIT_LOG_RANGE env var if needed.
#
# Allowlist marker (case-insensitive):
#   `licensed-id-ok: <reason>`  — placed inside the commit message itself
#                                  on a line near the offending token.
# Use AUDIT-PENDING in the reason to surface the commit as a warning
# (does not fail the check).

set -uo pipefail

PATTERN='cusip|fsym_id|factset_fund_id|factset_entity_id|isin'

# Resolve the git log range.
if [[ -n "${GIT_LOG_RANGE:-}" ]]; then
    range="$GIT_LOG_RANGE"
elif [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    # PR context. Make sure the base ref is fetched.
    git fetch --quiet origin "$GITHUB_BASE_REF" 2>/dev/null || true
    range="origin/${GITHUB_BASE_REF}..HEAD"
else
    range="HEAD~20..HEAD"
fi

# Collect commit hashes in range.
if ! commits=$(git log --format=%H "$range" 2>/dev/null); then
    echo "::warning::Could not enumerate commits in range '$range' — skipping git history scan"
    exit 0
fi

if [[ -z "$commits" ]]; then
    echo "✓ No commits in range '$range' — nothing to scan"
    exit 0
fi

violations=""
audit_pending=""

while IFS= read -r sha; do
    [[ -z "$sha" ]] && continue
    # Full message: subject + body. %B includes both with a blank line.
    msg=$(git show --no-patch --format=%B "$sha" 2>/dev/null || true)
    [[ -z "$msg" ]] && continue

    # Find tokens that match the pattern, line by line, case-insensitive,
    # whole-word.
    matches=$(echo "$msg" | grep -inwE "$PATTERN" 2>/dev/null || true)
    [[ -z "$matches" ]] && continue

    # Filter pandas .isin( false positives (rare in commit messages but
    # technically possible if the message quotes code).
    matches=$(echo "$matches" | sed -E 's/\.isin[[:space:]]*\(/.METHOD(/g' | grep -inwE "$PATTERN" || true)
    [[ -z "$matches" ]] && continue

    # If the message body contains the allowlist marker, treat all matches
    # in this commit as allowlisted. (Per-line markers don't make sense
    # in commit messages — a message is the unit of authorship.)
    if echo "$msg" | grep -iqE 'licensed-id-ok'; then
        if echo "$msg" | grep -iqE 'AUDIT-PENDING'; then
            audit_pending+="commit ${sha:0:12} — $(git log -1 --format=%s "$sha")"$'\n'
        fi
        continue
    fi

    short=${sha:0:12}
    subject=$(git log -1 --format=%s "$sha")
    violations+="commit $short — $subject"$'\n'
    while IFS= read -r m; do
        [[ -z "$m" ]] && continue
        violations+="    $m"$'\n'
    done <<<"$matches"
    violations+=$'\n'
done <<<"$commits"

if [[ -n "$violations" ]]; then
    echo "::error::Licensed-identifier leak in commit message(s) — range: $range"
    echo ""
    echo "$violations"
    echo "Resolution:"
    echo "  - Rewrite the offending commit message(s) (interactive rebase or amend)"
    echo "  - OR add 'licensed-id-ok: <reason>' INSIDE the commit message body"
    echo "    (re-commit with --amend or rebase to add the marker)"
    echo ""
    echo "Commit messages are public on GitHub and indexed by search engines"
    echo "indefinitely — leaking a CUSIP/ISIN/FactSet ID value here has the"
    echo "same compliance impact as leaking it in code."
    exit 1
fi

if [[ -n "$audit_pending" ]]; then
    echo "::warning::Commit messages with AUDIT-PENDING licensed-id markers:"
    echo ""
    echo "$audit_pending"
fi

echo "✓ No licensed-identifier leaks in commit messages — range: $range"
exit 0
