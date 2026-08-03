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
# Scope is deliberately narrow — the analyst doctrine stub only. Tool
# descriptions legitimately name endpoints and parameters; that is the
# contract surface and scanning it would produce noise that trains people to
# ignore this check.
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

if [[ "$fail" -eq 0 ]]; then
    echo "✓ doctrine boundary: public stub is ${doctrine_lines} lines, no interpretive terms"
fi

exit "$fail"
