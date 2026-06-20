#!/usr/bin/env bash
#
# ETF catalog schema check.
#
# The public ETF catalog (mcp/data/etf_master.json) is a minimal ticker -> name
# index used by /api/data/etf/search. Each entry must contain ONLY the
# allowlisted keys and carry no embedded URLs, so the public projection stays a
# lean lookup table and never accretes internal data-plumbing fields.
#
# Local run:  bash scripts/check-etf-catalog-schema.sh
set -uo pipefail

f="mcp/data/etf_master.json"
[ -f "$f" ] || { echo "skip: $f not present"; exit 0; }

python3 - "$f" <<'PY'
import json, sys

ALLOWED = {"bw_etf_id", "ticker", "name"}
doc = json.load(open(sys.argv[1]))
violations = []
for eid, rec in doc.get("entries", {}).items():
    extra = set(rec) - ALLOWED
    if extra:
        violations.append(f"{eid}: unexpected key(s) {sorted(extra)}")
    for k, v in rec.items():
        if isinstance(v, str) and ("http://" in v or "https://" in v):
            violations.append(f"{eid}: embedded URL in '{k}'")

if violations:
    print("ETF catalog schema violations (entries must be bw_etf_id/ticker/name only):")
    for v in violations:
        print("  -", v)
    sys.exit(1)

print(f"ETF catalog schema OK — {doc.get('n_entries')} entries, keys {sorted(ALLOWED)}")
PY
