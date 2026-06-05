#!/usr/bin/env python3
"""Static audit: the human-facing docs (content/docs/*.mdx) vs the OpenAPI spec.

The MDX docs are hand-maintained — the /docs/api endpoint table, curl examples,
and cross-links drift from the actual API without anything noticing. This checks
them, no network:

  HARD (fail --strict):
    * every /api/... path mentioned in the docs matches an OpenAPI path template
      (concrete example values like /api/metrics/AAPL match /metrics/{ticker});
      catches typo'd / renamed / phantom endpoints
    * every internal /docs/<slug> link resolves to a content/docs/<slug>.mdx file
      (catches broken doc-to-doc links after a docs refactor)

  REPORT (informational):
    * endpoint-table cost vs the spec's x-pricing.cost_usd
    * method in the table vs the spec
    * coverage — spec paths never mentioned anywhere in the docs

Usage:
  python scripts/audit/docs_conformity.py [--out-dir DIR] [--strict]
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
DOCS_DIR = REPO_ROOT / "content" / "docs"
ALLOWLIST_PATH = Path(__file__).resolve().parent / "docs_conformity_allowlist.json"

_API_PATH = re.compile(r"/api/[A-Za-z0-9_./{}\-]+")
# /docs/<slug> as a leaf doc route — NOT /docs/readme/x.png (asset) or /docs/api.mdx
_DOCS_LINK = re.compile(r"/docs/([a-z0-9][a-z0-9\-]*)(?![A-Za-z0-9\-/.])")
_METHOD = re.compile(r"\b(GET|POST|PUT|PATCH|DELETE)\b")
_COST = re.compile(r"\$\s*([0-9]+(?:\.[0-9]+)?)")


def split_segs(p: str) -> list[str]:
    return [s for s in p.strip("/").split("/") if s]


def is_param(seg: str) -> bool:
    return seg.startswith("{") and seg.endswith("}")


def unescape_mdx(text: str) -> str:
    """Render JSX string expressions to literal text: {'{ticker}'} -> {ticker},
    {'$'} -> $, {"x"} -> x."""
    text = re.sub(r"\{'([^']*)'\}", r"\1", text)
    text = re.sub(r'\{"([^"]*)"\}', r"\1", text)
    return text


def strip_tags(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


def normalize_doc_path(p: str) -> list[str]:
    p = p.split("?")[0].split("#")[0].rstrip(").,;:'\"`")
    if p == "/api" or p.startswith("/api/"):
        p = p[len("/api") :] or "/"
    return split_segs(p)


def load_spec() -> tuple[dict[int, list[tuple[str, list[str]]]], dict[tuple[str, str], dict[str, Any]]]:
    """(segment_count -> [(original_path, segments)], (path, METHOD) -> x-pricing)."""
    spec = json.loads(OPENAPI_PATH.read_text())
    by_count: dict[int, list[tuple[str, list[str]]]] = {}
    pricing: dict[tuple[str, str], dict[str, Any]] = {}
    for p, ops in (spec.get("paths") or {}).items():
        segs = split_segs(p)
        by_count.setdefault(len(segs), []).append((p, segs))
        for m, op in ops.items():
            if m.upper() in ("GET", "POST", "PUT", "PATCH", "DELETE") and isinstance(op, dict):
                pricing[(p, m.upper())] = op.get("x-pricing") or {}
    return by_count, pricing


def match_spec(doc_path: str, by_count: dict[int, list[tuple[str, list[str]]]]) -> str | None:
    """Original spec path whose template matches this doc path (params = wildcard)."""
    segs = normalize_doc_path(doc_path)
    for original, tsegs in by_count.get(len(segs), []):
        if all(is_param(t) or t == s for t, s in zip(tsegs, segs)):
            return original
    return None


def spec_cost(original: str, pricing: dict[tuple[str, str], dict[str, Any]]) -> float | None:
    for mm in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        pr = pricing.get((original, mm))
        if pr and "cost_usd" in pr:
            return float(pr["cost_usd"])
    return None


def _norm_join(p: str) -> str:
    return "/" + "/".join(normalize_doc_path(p))


def load_allowlist() -> tuple[set[str], set[str]]:
    """(phantom_ok, known_issues) as normalized path strings."""
    if not ALLOWLIST_PATH.exists():
        return set(), set()
    data = json.loads(ALLOWLIST_PATH.read_text())
    return (
        {_norm_join(p) for p in (data.get("phantom_ok") or [])},
        {_norm_join(p) for p in (data.get("known_issues") or [])},
    )


def extract_table_rows(text: str) -> list[dict[str, Any]]:
    rows = []
    for tr in re.findall(r"<tr\b.*?</tr>", text, re.S):
        cells = [strip_tags(td) for td in re.findall(r"<td\b.*?</td>", tr, re.S)]
        path_cell = next((c for c in cells if _API_PATH.search(c)), None)
        if not path_cell:
            continue
        rows.append(
            {
                "paths": _API_PATH.findall(path_cell),
                "methods": [m for c in cells if c != path_cell for m in _METHOD.findall(c)],
                "cost": next((c for c in cells if "$" in c or "Free" in c), ""),
            }
        )
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-dir", type=Path, default=None)
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()

    by_count, pricing = load_spec()
    all_originals = {p for lst in by_count.values() for (p, _) in lst}
    mdx_files = sorted(DOCS_DIR.glob("*.mdx"))
    doc_slugs = {f.stem for f in mdx_files}
    phantom_ok, known_issue_keys = load_allowlist()

    matched: set[str] = set()
    phantom: list[dict[str, str]] = []
    known_issues: list[dict[str, str]] = []
    broken_links: list[dict[str, str]] = []
    cost_mismatch: list[dict[str, Any]] = []
    method_mismatch: list[dict[str, Any]] = []

    for f in mdx_files:
        raw = unescape_mdx(f.read_text())
        rel = str(f.relative_to(REPO_ROOT))

        seen_phantom: set[str] = set()
        for m in _API_PATH.findall(raw):
            original = match_spec(m, by_count)
            if original:
                matched.add(original)
                continue
            norm = "/" + "/".join(normalize_doc_path(m))
            if norm in phantom_ok or norm in seen_phantom:
                continue
            seen_phantom.add(norm)
            if norm in known_issue_keys:
                known_issues.append({"file": rel, "path": m})
            else:
                phantom.append({"file": rel, "path": m})

        for slug in sorted(set(_DOCS_LINK.findall(raw))):
            if slug not in doc_slugs:
                broken_links.append({"file": rel, "link": f"/docs/{slug}"})

        for row in extract_table_rows(raw):
            for i, p in enumerate(row["paths"]):
                original = match_spec(p, by_count)
                if not original:
                    continue
                method = row["methods"][i] if i < len(row["methods"]) else (row["methods"][0] if row["methods"] else None)
                if method and (original, method.upper()) not in pricing:
                    have = sorted({mm for (pp, mm) in pricing if pp == original})
                    method_mismatch.append({"file": rel, "path": p, "doc_method": method.upper(), "spec_methods": have})
                sc = spec_cost(original, pricing)
                cost = row["cost"]
                if sc is None or not cost:
                    continue
                if "free" in cost.lower():
                    doc_cost = 0.0
                else:
                    nums = [float(x) for x in _COST.findall(cost)]
                    if not nums:
                        continue
                    doc_cost = nums[0]  # range "a–b" → low end
                if abs(sc - doc_cost) > 1e-9:
                    cost_mismatch.append({"file": rel, "path": p, "doc_cost": cost.strip(), "spec_cost_usd": sc})

    coverage_gap = sorted(all_originals - matched)

    report = {
        "summary": {
            "mdx_files": len(mdx_files),
            "phantom_paths": len(phantom),
            "known_issues": len(known_issues),
            "broken_docs_links": len(broken_links),
            "cost_mismatches": len(cost_mismatch),
            "method_mismatches": len(method_mismatch),
            "undocumented_spec_paths": len(coverage_gap),
        },
        "phantom_paths": phantom,
        "known_issues": known_issues,
        "broken_docs_links": broken_links,
        "cost_mismatches": cost_mismatch,
        "method_mismatches": method_mismatch,
        "undocumented_spec_paths": coverage_gap,
    }

    print(f"Docs scanned: {len(mdx_files)} mdx files")
    print(f"Phantom /api paths (in docs, not in spec, untracked): {len(phantom)}")
    for x in phantom:
        print(f"  ✗ {x['path']}  ({x['file']})")
    if known_issues:
        print(f"Known issues (tracked, non-blocking): {len(known_issues)}")
        for x in known_issues:
            print(f"  ⚠ {x['path']}  ({x['file']})")
    print(f"Broken /docs links: {len(broken_links)}")
    for x in broken_links:
        print(f"  ✗ {x['link']}  ({x['file']})")
    print(f"Cost mismatches (report): {len(cost_mismatch)}")
    for x in cost_mismatch:
        print(f"  · {x['path']}: docs {x['doc_cost']} vs spec ${x['spec_cost_usd']}")
    print(f"Method mismatches (report): {len(method_mismatch)}")
    for x in method_mismatch:
        print(f"  · {x['path']}: docs {x['doc_method']} vs spec {x['spec_methods']}")
    print(f"Spec paths not mentioned in docs (report): {len(coverage_gap)}")

    if args.out_dir:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        (args.out_dir / "docs_conformity.json").write_text(json.dumps(report, indent=2))
        print(f"\nWrote {args.out_dir / 'docs_conformity.json'}")

    hard = len(phantom) + len(broken_links)
    if args.strict and hard:
        print(f"\nFAIL: {len(phantom)} phantom path(s), {len(broken_links)} broken doc link(s).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
