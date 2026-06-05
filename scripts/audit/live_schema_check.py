#!/usr/bin/env python3
"""Validate captured live API responses against their OpenAPI response schemas.

Offline: consumes a ``smoke_report.json`` produced by
``sdk/scripts/smoke_v3_all_endpoints.py`` (which already hit every endpoint),
so there is no second round of billable API calls. For each JSON 2xx response
it looks up the operation's 2xx ``application/json`` schema and validates the
body against it.

OpenAPI 3.0 dialect handling: ``nullable: true`` is translated to "also allow
null" before validation; unknown keywords (``example``, ``discriminator``) are
ignored by jsonschema. Validation is permissive on extra properties (OpenAPI
schemas rarely set ``additionalProperties: false``), so findings are real
shape violations: a missing required field or a wrong type on a present field.

Coverage is reported as a headline (validated / skipped / total) so a green run
can't hide "checked nothing" — a high truncation-skip rate means the audit is
hollow, bump SMOKE_JSON_BODY_MAX upstream.

Usage:
  python scripts/audit/live_schema_check.py --smoke-report PATH [--out-dir DIR] [--strict]
  python scripts/audit/live_schema_check.py --self-test   # prove the validator has teeth

Exit codes: 0 = no violations (or non-strict); 1 = --strict and violations;
2 = could not load inputs.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

REPO_ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = REPO_ROOT / "mcp" / "data" / "openapi.json"


def _resolve_pointer(spec: dict[str, Any], ref: str) -> Any:
    """Resolve an intra-document JSON pointer like '#/components/schemas/X'."""
    if not ref.startswith("#/"):
        raise KeyError(f"unsupported $ref: {ref}")
    node: Any = spec
    for seg in ref[2:].split("/"):
        seg = seg.replace("~1", "/").replace("~0", "~")
        node = node[seg]
    return node


def inline_refs(node: Any, spec: dict[str, Any], seen: tuple[str, ...] = ()) -> Any:
    """Inline '#/...' $refs into a self-contained schema. A $ref repeated on the
    current resolution path (a cycle) collapses to '{}' (permissive) so deep or
    recursive component graphs can't loop forever."""
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/"):
            if ref in seen:
                return {}
            return inline_refs(_resolve_pointer(spec, ref), spec, seen + (ref,))
        return {k: inline_refs(v, spec, seen) for k, v in node.items()}
    if isinstance(node, list):
        return [inline_refs(v, spec, seen) for v in node]
    return node


def normalize_openapi_dialect(node: Any) -> Any:
    """Recursively translate OpenAPI-3.0 ``nullable`` into JSON-Schema null-union
    so a documented-nullable field doesn't produce a false type violation."""
    if isinstance(node, dict):
        node = {k: normalize_openapi_dialect(v) for k, v in node.items()}
        if node.pop("nullable", False):
            t = node.get("type")
            if isinstance(t, str):
                node["type"] = [t, "null"]
            elif isinstance(t, list) and "null" not in t:
                node["type"] = [*t, "null"]
            else:
                # no concrete type (e.g. only $ref/anyOf) — widen with anyOf
                inner = {k: v for k, v in node.items()}
                node = {"anyOf": [inner, {"type": "null"}]}
        return node
    if isinstance(node, list):
        return [normalize_openapi_dialect(v) for v in node]
    return node


def compile_schema(raw_schema: Any, spec: dict[str, Any]) -> Any:
    """Inline $refs then translate OpenAPI-3.0 nullable → a self-contained,
    validatable JSON Schema."""
    return normalize_openapi_dialect(inline_refs(copy.deepcopy(raw_schema), spec))


def response_schema(spec: dict[str, Any], path: str, method: str, status: int | None) -> Any:
    op = (spec.get("paths") or {}).get(path, {}).get(method.lower())
    if not op:
        return None
    responses = op.get("responses") or {}
    candidates = [str(status), "2XX", "200", "201", "default"]
    resp = next((responses[c] for c in candidates if c in responses), None)
    if resp is None:
        # any 2xx
        resp = next((v for k, v in responses.items() if k.startswith("2")), None)
    if not resp:
        return None
    content = (resp.get("content") or {}).get("application/json") or {}
    return content.get("schema")


def validate_report(smoke_report: Path, *, strict: bool, out_dir: Path | None) -> int:
    try:
        payload = json.loads(smoke_report.read_text())
        spec = json.loads(OPENAPI_PATH.read_text())
    except Exception as e:  # noqa: BLE001
        print(f"could not load inputs: {e}", file=sys.stderr)
        return 2

    calls = payload.get("calls") or []
    total_json_2xx = 0
    validated = 0
    skipped_no_schema = 0
    skipped_truncated = 0
    findings: list[dict[str, Any]] = []

    for c in calls:
        status = c.get("status")
        if c.get("body_kind") != "json" or not (status and 200 <= int(status) < 300):
            continue
        total_json_2xx += 1
        path = c.get("path_template") or ""
        method = c.get("method") or "get"
        raw_schema = response_schema(spec, path, method, status)
        if not raw_schema:
            skipped_no_schema += 1
            continue
        try:
            body = json.loads(c.get("body_text") or "")
        except Exception:  # truncated / unparseable
            skipped_truncated += 1
            continue
        validator = Draft202012Validator(compile_schema(raw_schema, spec))
        errors = sorted(validator.iter_errors(body), key=lambda e: list(e.path))
        validated += 1
        if errors:
            findings.append(
                {
                    "method": method,
                    "path": path,
                    "status": status,
                    "errors": [
                        {"loc": "/".join(str(p) for p in e.path) or "<root>", "msg": e.message}
                        for e in errors[:8]
                    ],
                    "error_count": len(errors),
                }
            )

    report = {
        "summary": {
            "json_2xx_responses": total_json_2xx,
            "validated": validated,
            "skipped_no_schema": skipped_no_schema,
            "skipped_truncated": skipped_truncated,
            "endpoints_with_violations": len(findings),
        },
        "findings": findings,
    }

    print(
        f"Schema check: validated {validated} / skipped {skipped_no_schema} (no schema) "
        f"+ {skipped_truncated} (truncated) of {total_json_2xx} JSON 2xx responses"
    )
    if skipped_truncated:
        print(
            f"  note: {skipped_truncated} body(ies) were truncated/unparseable — "
            "raise SMOKE_JSON_BODY_MAX for fuller coverage"
        )
    print(f"Endpoints with schema violations: {len(findings)}")
    for f in findings:
        print(f"  ✗ {f['method'].upper()} {f['path']} ({f['error_count']} error(s))")
        for e in f["errors"][:3]:
            print(f"      {e['loc']}: {e['msg'][:140]}")

    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "schema_check.json").write_text(json.dumps(report, indent=2))
        print(f"\nWrote {out_dir / 'schema_check.json'}")

    if strict and findings:
        print(f"\nFAIL: {len(findings)} endpoint(s) violated their response schema.", file=sys.stderr)
        return 1
    return 0


def self_test() -> int:
    """Prove the validator flags a deliberately-broken body (not green-but-hollow)."""
    schema = {
        "type": "object",
        "required": ["ticker"],
        "properties": {"ticker": {"type": "string"}, "n": {"type": "integer", "nullable": True}},
    }
    v = Draft202012Validator(normalize_openapi_dialect(schema))
    missing = list(v.iter_errors({}))                 # required field absent
    wrong = list(v.iter_errors({"ticker": 5}))        # wrong type
    nullable_ok = list(v.iter_errors({"ticker": "X", "n": None}))  # nullable honored
    good = list(v.iter_errors({"ticker": "X", "n": 3}))
    ok = (len(missing) == 1 and len(wrong) == 1 and not nullable_ok and not good)
    print("self-test:", "PASS" if ok else "FAIL",
          f"(missing={len(missing)} wrongtype={len(wrong)} nullable_err={len(nullable_ok)} good_err={len(good)})")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--smoke-report", type=Path, help="path to smoke_report.json")
    ap.add_argument("--out-dir", type=Path, default=None)
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--self-test", action="store_true", help="validate the validator and exit")
    args = ap.parse_args()

    if args.self_test:
        return self_test()
    if not args.smoke_report or not args.smoke_report.exists():
        print("--smoke-report PATH is required (and must exist)", file=sys.stderr)
        return 2
    return validate_report(args.smoke_report, strict=args.strict, out_dir=args.out_dir)


if __name__ == "__main__":
    raise SystemExit(main())
