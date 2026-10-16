#!/usr/bin/env python3
"""Export the ERM3 ETF register to mcp/data/etf_register.json.

The ERM3 register (``erm3/shared/etf_register.py``) lists every ETF whose daily
returns ERM3 prices into its ETF store: market, sectors, subsectors, style,
macro sleeves, broad-market price-coverage funds and proxy ETFs. The API uses
this list to tell a known-but-unpriced ETF apart from a ticker on no list
(``/portfolio/exposure`` reason codes, RMAPI-14).

The module is parsed statically (``ast.literal_eval`` of ``ETF_HIERARCHY`` and
``ETF_METADATA``); nothing from ERM3 is imported, so no heavy dependencies are
needed.

Usage:
    python3 scripts/export_etf_register_json.py --erm3-root <path to ERM3 repo>
    ERM3_ROOT=<path> python3 scripts/export_etf_register_json.py
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sys
from pathlib import Path

REGISTER_REL = Path("erm3") / "shared" / "etf_register.py"
OUT = Path(__file__).resolve().parent.parent / "mcp" / "data" / "etf_register.json"
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")


def _literal(tree: ast.Module, name: str):
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == name for t in node.targets
        ):
            return ast.literal_eval(node.value)
    raise SystemExit(f"{name} not found in the register module")


def build(register_path: Path) -> dict:
    tree = ast.parse(register_path.read_text(encoding="utf-8"))
    hierarchy = _literal(tree, "ETF_HIERARCHY")
    metadata = _literal(tree, "ETF_METADATA")

    roles: dict[str, str] = {}

    def put(ticker: str, role: str) -> None:
        t = ticker.upper()
        if TICKER_RE.match(t):
            roles.setdefault(t, role)

    for t in hierarchy.get("market", []):
        put(t, "market")
    for t in hierarchy.get("sectors", {}).get("primary", []):
        put(t, "sector")
    for subs in hierarchy.get("sectors", {}).get("subsectors", {}).values():
        for t in subs:
            put(t, "subsector")
    for t in hierarchy.get("style", []):
        put(t, "style")
    for cat, ts in hierarchy.get("macro", {}).items():
        for t in ts:
            put(t, f"macro:{cat}")
    for t in hierarchy.get("broad_market", []):
        put(t, "broad_market")
    for meta in metadata.values():
        proxies = [meta.get("proxy")] + [p.get("proxy") for p in meta.get("proxy_chain", [])]
        for p in proxies:
            if p:
                put(p, "proxy")

    return {
        "schema_version": "etf-register/1.0",
        "source": "ERM3 erm3/shared/etf_register.py (ETF_HIERARCHY + ETF_METADATA proxies)",
        "generated_by": "scripts/export_etf_register_json.py",
        "n_entries": len(roles),
        "etfs": {t: {"role": roles[t]} for t in sorted(roles)},
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--erm3-root", default=os.environ.get("ERM3_ROOT"), help="ERM3 repo root (or ERM3_ROOT)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    if not args.erm3_root:
        print("Pass --erm3-root or set ERM3_ROOT", file=sys.stderr)
        return 2
    src = Path(args.erm3_root) / REGISTER_REL
    if not src.exists():
        print(f"Register not found under the ERM3 root: {REGISTER_REL}", file=sys.stderr)
        return 2
    doc = build(src)
    Path(args.out).write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {doc['n_entries']} ETFs to {Path(args.out).name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
