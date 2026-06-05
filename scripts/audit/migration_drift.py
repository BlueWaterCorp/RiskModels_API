#!/usr/bin/env python3
"""Static-ish audit: Supabase migrations vs the live prod schema.

Same method as BWMACRO/supabase/MIGRATION_DRIFT_AUDIT.md: parse the migration
SQL (CREATE TABLE / ALTER … ADD COLUMN) and diff against the live schema exposed
by PostgREST's OpenAPI document. Catches the recurring "column declared in a
migration but never applied to prod" failure mode (C.7 `tier`, C.9
`stripe_payment_method_id`) before it breaks a feature for a customer.

Reads migrations from $AUDIT_MIGRATIONS_DIR, else ../BWMACRO/supabase/migrations.
Reads prod via SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).
If either the migrations dir or the creds are missing it SKIPS (exit 0) with a
clear note — a weekly run must show "skipped", never a false green.

Caveats (carried from the audit doc — treat findings as leads, not verdicts):
  * Only public / API-exposed objects are visible via PostgREST. Functions,
    triggers, RLS policies, indexes, enums, and RLS-hidden tables are NOT checked.
  * A rename looks like drop+create here; a "missing" object may have been
    dropped by a later migration this parser didn't resolve.

Usage:
  python scripts/audit/migration_drift.py [--out-dir DIR] [--strict]

Exit: 0 = no drift / skipped; 1 = --strict and drift found; 2 = error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MIGRATIONS = REPO_ROOT.parent / "BWMACRO" / "supabase" / "migrations"

# SQL keywords the table-name regex can false-positive on (per the audit doc).
_TABLE_NOISE = {"as", "if", "only", "exists"}

_CREATE_TABLE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"']?([A-Za-z0-9_.]+)[\"']?",
    re.IGNORECASE,
)
_ALTER_TABLE = re.compile(
    r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?[\"']?([A-Za-z0-9_.]+)[\"']?(.*?);",
    re.IGNORECASE | re.DOTALL,
)
_ADD_COLUMN = re.compile(
    r"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"']?([A-Za-z0-9_]+)[\"']?",
    re.IGNORECASE,
)


def _bare(table: str) -> str:
    return table.split(".")[-1].strip().lower()


def parse_migrations(mig_dir: Path) -> tuple[set[str], dict[str, set[str]]]:
    """(declared tables, {table: {columns declared via ALTER ADD COLUMN}})."""
    tables: set[str] = set()
    alter_cols: dict[str, set[str]] = {}
    for sql_file in sorted(mig_dir.glob("*.sql")):
        text = sql_file.read_text(errors="ignore")
        for m in _CREATE_TABLE.finditer(text):
            t = _bare(m.group(1))
            if t and t not in _TABLE_NOISE:
                tables.add(t)
        for m in _ALTER_TABLE.finditer(text):
            t = _bare(m.group(1))
            if not t or t in _TABLE_NOISE:
                continue
            cols = {c.lower() for c in _ADD_COLUMN.findall(m.group(2))}
            if cols:
                alter_cols.setdefault(t, set()).update(cols)
    return tables, alter_cols


def fetch_prod_schema() -> dict[str, set[str]] | None:
    """{table: {columns}} from the PostgREST OpenAPI doc, or None if no creds."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SERVICE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        return None
    r = httpx.get(
        f"{url.rstrip('/')}/rest/v1/",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=40,
    )
    r.raise_for_status()
    spec = r.json()
    defs = spec.get("definitions") or spec.get("components", {}).get("schemas", {})
    return {t.lower(): set((d.get("properties") or {}).keys()) for t, d in defs.items()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-dir", type=Path, default=None)
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()

    def _skip(reason: str) -> int:
        print(f"SKIP migration-drift: {reason}")
        if args.out_dir:
            args.out_dir.mkdir(parents=True, exist_ok=True)
            (args.out_dir / "migration_drift.json").write_text(
                json.dumps({"summary": {"skipped": True, "reason": reason}}, indent=2)
            )
        return 0

    mig_dir = Path(os.environ.get("AUDIT_MIGRATIONS_DIR") or DEFAULT_MIGRATIONS)
    if not mig_dir.is_dir():
        return _skip(f"migrations dir not found ({mig_dir}); set AUDIT_MIGRATIONS_DIR or check out BWMACRO")

    try:
        prod = fetch_prod_schema()
    except Exception as e:  # noqa: BLE001
        print(f"migration-drift error fetching prod schema: {e}", file=sys.stderr)
        return 2
    if prod is None:
        return _skip("no SUPABASE_URL / service key in env")

    tables, alter_cols = parse_migrations(mig_dir)

    missing_tables = sorted(t for t in tables if t not in prod)
    missing_columns = []  # [{table, column}]
    for table, cols in sorted(alter_cols.items()):
        if table not in prod:
            continue  # table itself missing — reported above; column check moot
        for col in sorted(cols):
            if col not in prod[table]:
                missing_columns.append({"table": table, "column": col})

    report = {
        "summary": {
            "migrations_dir": str(mig_dir),
            "declared_tables": len(tables),
            "prod_tables": len(prod),
            "missing_tables": len(missing_tables),
            "missing_columns": len(missing_columns),
        },
        "missing_columns": missing_columns,
        "missing_tables": missing_tables,
        "caveats": [
            "Only public/API-exposed objects visible via PostgREST.",
            "Renames look like drop+create; treat findings as leads, not verdicts.",
        ],
    }

    print(f"Migrations: {len(tables)} tables declared  |  prod exposes {len(prod)} tables")
    print(f"Columns declared via ADD COLUMN but ABSENT from prod: {len(missing_columns)}")
    for x in missing_columns:
        print(f"  ✗ {x['table']}.{x['column']}")
    print(f"Tables declared but ABSENT from prod (verify — may be renamed/dropped): {len(missing_tables)}")
    for t in missing_tables:
        print(f"  · {t}")

    if args.out_dir:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        (args.out_dir / "migration_drift.json").write_text(json.dumps(report, indent=2))
        print(f"\nWrote {args.out_dir / 'migration_drift.json'}")

    # Only ABSENT columns are high-confidence drift; missing tables are leads.
    if args.strict and missing_columns:
        print(f"\nFAIL: {len(missing_columns)} migration column(s) not applied to prod.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
