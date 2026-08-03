#!/usr/bin/env bash
# scripts/check-doctrine-boundary.sh
#
# Keeps interpretive IP out of this repository, which is PUBLIC.
#
# The line being drawn — contract in public, interpretation in private:
#
#   Contract     what a field IS. An HR is a dollar ratio; ER at L3 are
#                variance fractions summing to ~1; this endpoint takes these
#                parameters and returns these keys. A caller cannot use the
#                API without it, so it belongs in the OpenAPI spec, the SDK,
#                the MCP mirror and the tool descriptions — all public.
#
#   Interpretation   which of two valid measures to trust and why the other
#                misleads; how a reader misreads a correct number; when to
#                reach for which endpoint. That is judgment built from the
#                model, and it lives in BWMACRO's private doctrine SSOT:
#                docs/architecture/intelligence_runtime/chat_doctrine/
#                ANALYST_SYSTEM_PROMPT_APPEND.md, injected at deploy through
#                ANALYST_SYSTEM_PROMPT_APPEND.
#
# Why this check exists (G.77): roughly twenty lines of interpretation sat in
# lib/chat/load-analyst-doctrine-append.ts because the private channel was
# never wired (G.76) — someone needed the agent to behave, so the nuance went
# where it would actually run. It was still growing when it was found: G.72
# added analytical guidance to public tool descriptions on 2026-08-02.
#
# Note what this check can and cannot do. It stops accretion. It does not
# un-publish: the repository is public and git history retains every
# revision, so anything already pushed stays fetchable.
#
# Two scopes, because the first version of this check had one and missed the
# larger leak (H.153):
#
#   1. The doctrine stub — a size budget and a blocklist of named judgments.
#   2. Every tracked file — the doctrine's own section headings. A full copy
#      of the doctrine sat in tests/fixtures/analyst-doctrine-append.md from
#      2026-05-17, committed by the same change that introduced the "thin
#      public shell", and check (1) could not see it.
#
# Tool descriptions are deliberately out of scope for the blocklist: they
# legitimately name endpoints and parameters, that is the contract surface, and
# scanning them would produce noise that trains people to ignore this check.
# The heading scan is safe everywhere because a doctrine section heading is not
# something a contract surface has any reason to contain.
#
# Allowlist marker (case-insensitive, same line):
#
#   doctrine-boundary-ok: <reason>
#
# Use it when a term is genuinely contract in context. Always give a reason.

set -uo pipefail

TARGET="lib/chat/load-analyst-doctrine-append.ts"
PRIVATE_SSOT="BWMACRO/docs/architecture/intelligence_runtime/chat_doctrine/ANALYST_SYSTEM_PROMPT_APPEND.md"

# The public fallback is guardrails only. This budget is the structural half
# of the check: a blocklist catches terms someone thought to add, a budget
# catches the paragraph nobody thought to name.
MAX_DOCTRINE_LINES=20

# Terms whose presence in the doctrine stub means interpretation came back.
# Each names a judgment, not a field: a measure preference, a rendering rule,
# or a routing decision between endpoints.
PATTERN='lstar_rr|l3_rr|lstar_level|decision_trace|recommended_hedge_level|get_hedge_basket|get_industry_panel|screen_rankings|batch_lstar|get_residual_signal_basket|get_universe_members|get_etf_factor_returns|get_returns_decomposition|Vasicek|marginal-ER|rank_ordinal|mask_as_of'

if [[ ! -f "$TARGET" ]]; then
    echo "✓ doctrine boundary: $TARGET absent, nothing to scan"
    exit 0
fi

fail=0

# --- 1. Structural: the stub must stay small ------------------------------
# Counted between the constant's opening backtick and its closing one, so
# the surrounding comment (which explains the rule) is not charged for it.
doctrine_lines=$(awk '
    /^const MINIMAL_OPERATIONAL_DOCTRINE = `/ { inside = 1; next }
    inside && /^`;/ { inside = 0; next }
    inside { n++ }
    END { print n + 0 }
' "$TARGET")

if [[ "$doctrine_lines" -gt "$MAX_DOCTRINE_LINES" ]]; then
    echo "✗ doctrine boundary: MINIMAL_OPERATIONAL_DOCTRINE is ${doctrine_lines} lines (budget ${MAX_DOCTRINE_LINES})."
    echo ""
    echo "  The public fallback is guardrails only — not-an-adviser, no-fabrication,"
    echo "  field contract, formatting. Anything that tells the analyst which measure"
    echo "  to prefer, how to render a result, or which endpoint to route to is"
    echo "  interpretation and belongs in:"
    echo "    $PRIVATE_SSOT"
    echo ""
    fail=1
fi

# --- 2. Blocklist: named judgments ----------------------------------------
hits=$(grep -nEi "$PATTERN" "$TARGET" | grep -vi 'doctrine-boundary-ok:' || true)

if [[ -n "$hits" ]]; then
    echo "✗ doctrine boundary: interpretive terms in $TARGET"
    echo ""
    while IFS= read -r line; do
        echo "    $line"
    done <<< "$hits"
    echo ""
    echo "  These name a judgment rather than a field — a measure preference, a"
    echo "  rendering rule, or a routing decision. This repository is public."
    echo "  Move them to:"
    echo "    $PRIVATE_SSOT"
    echo ""
    echo "  If a term really is contract in context, append on the same line:"
    echo "    doctrine-boundary-ok: <reason>"
    echo ""
    fail=1
fi

# --- 3. Repo-wide: the doctrine's own section headings ---------------------
# `git ls-files` rather than a path list: the point is that a copy anywhere is
# a copy, and the last one arrived somewhere nobody was looking.
DOCTRINE_HEADINGS='^## You are an analyst, not an investment advisor|^## What you must NOT fabricate|^## Response shape — Aha first|^## ERM3 concepts|^## Panel and batch routing'

heading_hits=$(git ls-files -z 2>/dev/null \
    | xargs -0 grep -lE "$DOCTRINE_HEADINGS" 2>/dev/null \
    | grep -v '^scripts/check-doctrine-boundary.sh$' \
    | grep -v '^tests/system-prompt.test.ts$' \
    || true)

if [[ -n "$heading_hits" ]]; then
    echo "✗ doctrine boundary: the doctrine's own section headings appear in tracked files"
    echo ""
    while IFS= read -r f; do
        echo "    $f"
    done <<< "$heading_hits"
    echo ""
    echo "  A copy of the doctrine in this repository is a published copy,"
    echo "  whatever it is called. Test fixtures included — that is where the"
    echo "  last one was (H.153). The doctrine lives only in:"
    echo "    $PRIVATE_SSOT"
    echo ""
    echo "  For mechanics tests, use tests/fixtures/synthetic-doctrine.md, which"
    echo "  exercises loading and placeholder substitution and says nothing."
    echo ""
    fail=1
fi

if [[ "$fail" -eq 0 ]]; then
    echo "✓ doctrine boundary: stub is ${doctrine_lines} lines, no interpretive terms, no doctrine copies tracked"
fi

exit "$fail"
