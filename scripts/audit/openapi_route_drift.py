#!/usr/bin/env python3
"""Static audit: OpenAPI paths vs Next.js `app/` route handlers.

Two directions of drift, no network:

  * documented (spec) paths with **no** implementing `route.ts` and not served
    by a `next.config.mjs` rewrite/redirect — the promise-breaking direction
    (hard-fails under ``--strict``). A documented endpoint that 404s is worse
    than an undocumented one.
  * implemented handlers with **no** OpenAPI documentation — informational
    (lots of internal routes are intentionally undocumented).

Also writes a cross-reference matrix: spec path -> handler file -> present in
capabilities.json? -> present in the SDK capability registry?

Matching is param-agnostic: every dynamic segment (`{ticker}` in the spec,
`[ticker]` / `[...slug]` / `[[...slug]]` in the filesystem) is normalized to
`{}`, so param-name differences (`[id]` vs `{bw_fund_id}`) don't create false
drift. Handler paths have a leading `/api` stripped so they unify with the
spec's `/api` server base (root-served paths like `/.well-known/*` stay as-is).

Usage:
  python scripts/audit/openapi_route_drift.py [--out-dir DIR] [--strict]

Exit codes: 0 = no missing handlers (or non-strict); 1 = --strict and missing.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = REPO_ROOT / "mcp" / "data" / "openapi.json"
APP_DIR = REPO_ROOT / "app"
NEXT_CONFIG = REPO_ROOT / "next.config.mjs"
CAPABILITIES_JSON = REPO_ROOT / "mcp" / "data" / "capabilities.json"
SDK_CAPABILITIES = REPO_ROOT / "sdk" / "riskmodels" / "capabilities.py"
ALLOWLIST_PATH = Path(__file__).resolve().parent / "drift_allowlist.json"

_DYNAMIC_SEG = re.compile(r"^\[\[?\.{0,3}[^\]]+\]\]?$")  # [x] [...x] [[...x]]


def normalize_key(path: str) -> str:
    """Param-agnostic comparison key: every dynamic segment -> '{}'."""
    segs = [s for s in path.strip("/").split("/") if s != ""]
    out = []
    for s in segs:
        if (s.startswith("{") and s.endswith("}")) or _DYNAMIC_SEG.match(s):
            out.append("{}")
        else:
            out.append(s)
    return "/" + "/".join(out)


def spec_paths() -> dict[str, str]:
    """{normalized_key: original_spec_path}."""
    spec = json.loads(OPENAPI_PATH.read_text())
    return {normalize_key(p): p for p in (spec.get("paths") or {})}


def _handler_url(route_file: Path) -> str | None:
    """Derive the served URL path from an app/**/route.ts file, or None if the
    route is excluded from routing (private `_dir`, parallel `@slot`)."""
    rel = route_file.parent.relative_to(APP_DIR)
    segs: list[str] = []
    for part in rel.parts:
        if part.startswith("_") or part.startswith("@"):
            return None  # private folder / parallel slot — not a public URL
        if part.startswith("(") and part.endswith(")"):
            continue  # route group — invisible in the URL
        segs.append(part)
    url = "/" + "/".join(segs)
    # Unify with the spec's /api server base; root-served paths keep their prefix.
    if url == "/api" or url.startswith("/api/"):
        url = url[len("/api") :] or "/"
    return url


def handler_paths() -> dict[str, list[str]]:
    """{normalized_key: [repo-relative route.ts paths]} across all of app/."""
    out: dict[str, list[str]] = {}
    for route_file in sorted(APP_DIR.rglob("route.ts")):
        url = _handler_url(route_file)
        if url is None:
            continue
        key = normalize_key(url)
        out.setdefault(key, []).append(str(route_file.relative_to(REPO_ROOT)))
    return out


def config_satisfied_keys() -> set[str]:
    """Normalized keys served by a next.config rewrite/redirect source."""
    keys: set[str] = set()
    if not NEXT_CONFIG.exists():
        return keys
    text = NEXT_CONFIG.read_text()
    for m in re.finditer(r"source:\s*'([^']+)'", text):
        src = m.group(1)
        # Next.js rewrite/redirect params: :file*, :path, :id -> dynamic
        src = re.sub(r":[A-Za-z0-9_]+\*?", "{}", src)
        keys.add(normalize_key(src))
    return keys


def load_allowlist() -> dict[str, list[str]]:
    if ALLOWLIST_PATH.exists():
        data = json.loads(ALLOWLIST_PATH.read_text())
        return {
            "missing_ok": list(data.get("missing_ok") or []),
            "undocumented_ok": list(data.get("undocumented_ok") or []),
            "known_issues": list(data.get("known_issues") or []),
        }
    return {"missing_ok": [], "undocumented_ok": [], "known_issues": []}


def build_matrix(
    spec: dict[str, str], handlers: dict[str, list[str]]
) -> list[dict[str, Any]]:
    cap_text = CAPABILITIES_JSON.read_text() if CAPABILITIES_JSON.exists() else ""
    sdk_text = SDK_CAPABILITIES.read_text() if SDK_CAPABILITIES.exists() else ""
    rows = []
    for key, original in sorted(spec.items(), key=lambda kv: kv[1]):
        files = handlers.get(key, [])
        rows.append(
            {
                "spec_path": original,
                "key": key,
                "handler_files": files,
                "implemented": bool(files),
                "in_capabilities_json": original in cap_text,
                "in_sdk_capabilities": original in sdk_text,
            }
        )
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-dir", type=Path, default=None)
    ap.add_argument("--strict", action="store_true", help="exit 1 if any spec path lacks a handler")
    args = ap.parse_args()

    spec = spec_paths()
    handlers = handler_paths()
    config_keys = config_satisfied_keys()
    allow = load_allowlist()
    allow_missing = {normalize_key(p) for p in allow["missing_ok"]}
    allow_undoc = {normalize_key(p) for p in allow["undocumented_ok"]}
    known_issue_keys = {normalize_key(p) for p in allow["known_issues"]}

    missing = []        # documented, no handler/rewrite, not tracked — blocks --strict
    known_issues = []   # documented, no handler, but a tracked defect — reported, non-blocking
    for key, original in sorted(spec.items(), key=lambda kv: kv[1]):
        if key in handlers or key in config_keys or key in allow_missing:
            continue
        if key in known_issue_keys:
            known_issues.append(original)
        else:
            missing.append(original)

    spec_keys = set(spec)
    undocumented = []  # handler with no spec path
    for key, files in sorted(handlers.items()):
        if key in spec_keys or key in allow_undoc:
            continue
        undocumented.append({"key": key, "files": files})

    matrix = build_matrix(spec, handlers)

    report = {
        "summary": {
            "spec_paths": len(spec),
            "handler_routes": len(handlers),
            "missing_handlers": len(missing),
            "known_issues": len(known_issues),
            "undocumented_handlers": len(undocumented),
            "config_satisfied_keys": sorted(config_keys),
        },
        "missing_handlers": missing,
        "known_issues": known_issues,
        "undocumented_handlers": undocumented,
        "cross_reference": matrix,
    }

    # ---- output -----------------------------------------------------------
    print(f"OpenAPI paths: {len(spec)}  |  app/ route handlers: {len(handlers)}")
    print(f"Documented-but-unimplemented (untracked): {len(missing)}")
    for p in missing:
        print(f"  ✗ {p}  (no route.ts, no rewrite/redirect)")
    if known_issues:
        print(f"Known issues (tracked, non-blocking): {len(known_issues)}")
        for p in known_issues:
            print(f"  ⚠ {p}  (tracked — see drift_allowlist.json)")
    print(f"Undocumented handlers (informational): {len(undocumented)}")
    for u in undocumented:
        print(f"  · {u['key']}  ({u['files'][0]})")

    if args.out_dir:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        (args.out_dir / "route_drift.json").write_text(json.dumps(report, indent=2))
        print(f"\nWrote {args.out_dir / 'route_drift.json'}")

    if args.strict and missing:
        print(f"\nFAIL: {len(missing)} documented path(s) have no handler.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
