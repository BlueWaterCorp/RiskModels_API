#!/usr/bin/env python3
"""Email the API-audit result (summary + findings) via Resend.

Reads a report dir produced by api_audits.sh (summary.json + per-check JSON) and
sends a digest to the audit recipient. Reports each check as PASS / FAIL /
SKIPPED so a green email can't hide a check that silently didn't run (e.g.
migration-drift with no creds).

Env:
  RESEND_API_KEY     required to actually send
  RESEND_FROM_EMAIL  verified sender (e.g. "RiskModels <service@riskmodels.app>")
  AUDIT_EMAIL_TO     recipient (default conrad@bwmacro.com)

Usage:
  python scripts/audit/send_audit_email.py --report-dir audit-reports/<ts> [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx

DEFAULT_TO = "conrad@bwmacro.com"


def _load(p: Path):
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def build_body(report_dir: Path) -> tuple[str, str, str]:
    """(subject, text, html)."""
    summary = _load(report_dir / "summary.json") or {"overall": "UNKNOWN", "steps": [], "timestamp": "?"}
    drift = _load(report_dir / "migration_drift.json")
    routes = _load(report_dir / "route_drift.json")
    docs = _load(report_dir / "docs_conformity.json")
    schema = _load(report_dir / "schema_check.json")
    smoke = _load(report_dir / "smoke" / "smoke_report.json")

    overall = summary.get("overall", "UNKNOWN")
    ts = summary.get("timestamp", "?")

    # Per-check status; override migration-drift to SKIPPED if it self-skipped.
    rows = []
    for step in summary.get("steps", []):
        name, status = step.get("name", "?"), step.get("status", "?")
        if name == "migration-drift" and drift and drift.get("summary", {}).get("skipped"):
            status = "SKIP"
        rows.append((name, status))

    # Findings highlights (defensive — any file may be absent).
    findings: list[str] = []
    if routes:
        s = routes.get("summary", {})
        findings.append(f"route-drift: {s.get('missing_handlers', 0)} undocumented-untracked, "
                        f"{s.get('known_issues', 0)} known issue(s), {s.get('undocumented_handlers', 0)} undocumented handlers")
    if docs:
        s = docs.get("summary", {})
        findings.append(f"docs-conformity: {s.get('phantom_paths', 0)} phantom, "
                        f"{s.get('cost_mismatches', 0)} cost mismatch(es), {s.get('known_issues', 0)} known issue(s)")
    if schema:
        s = schema.get("summary", {})
        findings.append(f"schema-check: {s.get('endpoints_with_violations', 0)} endpoint(s) violating schema "
                        f"(validated {s.get('validated', 0)}/{s.get('json_2xx_responses', 0)})")
    if drift and not drift.get("summary", {}).get("skipped"):
        s = drift.get("summary", {})
        cols = drift.get("missing_columns", [])
        findings.append(f"migration-drift: {s.get('missing_columns', 0)} unapplied column(s)"
                        + (": " + ", ".join(f"{c['table']}.{c['column']}" for c in cols[:10]) if cols else "")
                        + f"; {s.get('missing_tables', 0)} table lead(s)")
    elif drift:
        findings.append(f"migration-drift: SKIPPED ({drift.get('summary', {}).get('reason', 'no creds')})")

    # Actionable failure detail — name the specific endpoints so an agent can fix
    # without re-running the audit. (Previously the email gave only counts, e.g.
    # "smoke-endpoints FAIL", forcing a live re-run to find the offending call.)
    detail: list[str] = []
    for b in (smoke or {}).get("meta", {}).get("likely_bugs", []):
        d = str(b.get("detail") or b.get("note") or "").strip().replace("\n", " ")
        detail.append(
            f"smoke  {b.get('method', '')} {b.get('path', '')} → {b.get('status')}"
            + (f"  · {d[:180]}" if d else "")
        )
    if schema:
        for f in schema.get("findings", [])[:12]:
            errs = "; ".join(
                f"{e.get('loc')}: {str(e.get('msg', ''))[:90]}" for e in (f.get("errors") or [])[:2]
            )
            detail.append(
                f"schema {str(f.get('method', '')).upper()} {f.get('path', '')} "
                f"({f.get('error_count', 0)} err)" + (f"  · {errs}" if errs else "")
            )

    subject = f"[RiskModels API audit] {overall} — {ts}"

    status_lines = "\n".join(f"  {n:<18} {s}" for n, s in rows)
    finding_lines = "\n".join(f"  - {f}" for f in findings) or "  (no finding files)"
    detail_block = ""
    if detail:
        detail_block = "Failure detail (specific endpoints):\n" + "\n".join(f"  • {d}" for d in detail) + "\n\n"
    text = (
        f"RiskModels API audit — {overall}  ({ts})\n\n"
        f"Checks:\n{status_lines}\n\n"
        f"Findings:\n{finding_lines}\n\n"
        f"{detail_block}"
        f"Full reports: {summary.get('reports_dir', report_dir)} (CI artifact)\n"
    )

    def badge(s: str) -> str:
        color = {"PASS": "#16a34a", "FAIL": "#dc2626", "SKIP": "#d97706"}.get(s, "#71717a")
        return f'<span style="color:{color};font-weight:600">{s}</span>'

    overall_color = "#16a34a" if overall == "PASS" else "#dc2626"
    rows_html = "".join(
        f'<tr><td style="padding:2px 12px 2px 0;font-family:monospace">{n}</td>'
        f'<td style="padding:2px 0">{badge(s)}</td></tr>'
        for n, s in rows
    )
    findings_html = "".join(f"<li style='margin:2px 0'>{f}</li>" for f in findings) or "<li>(no finding files)</li>"

    def esc(s: str) -> str:
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    detail_html = ""
    if detail:
        items = "".join(f"<li style='margin:2px 0;font-family:monospace;font-size:13px'>{esc(d)}</li>" for d in detail)
        detail_html = (
            '<h3 style="margin:16px 0 4px">Failure detail</h3>'
            f'<ul style="margin:0;padding-left:18px">{items}</ul>'
        )
    html = (
        f'<div style="font-family:system-ui,sans-serif;max-width:640px">'
        f'<h2 style="margin:0 0 4px">RiskModels API audit — '
        f'<span style="color:{overall_color}">{overall}</span></h2>'
        f'<p style="color:#71717a;margin:0 0 16px">{ts}</p>'
        f'<table style="border-collapse:collapse;margin-bottom:16px">{rows_html}</table>'
        f'<h3 style="margin:0 0 4px">Findings</h3><ul style="margin:0;padding-left:18px">{findings_html}</ul>'
        f'{detail_html}'
        f'<p style="color:#71717a;font-size:12px;margin-top:16px">Full reports in the workflow run artifact.</p>'
        f"</div>"
    )
    return subject, text, html


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report-dir", type=Path, required=True)
    ap.add_argument("--to", default=os.environ.get("AUDIT_EMAIL_TO", DEFAULT_TO))
    ap.add_argument("--dry-run", action="store_true", help="print the email, don't send")
    args = ap.parse_args()

    if not args.report_dir.is_dir():
        print(f"report dir not found: {args.report_dir}", file=sys.stderr)
        return 2

    subject, text, html = build_body(args.report_dir)

    if args.dry_run:
        print(f"To: {args.to}\nSubject: {subject}\n\n{text}")
        return 0

    api_key = os.environ.get("RESEND_API_KEY")
    # Same verified-sender fallback the admin app uses when RESEND_FROM_EMAIL is unset.
    sender = os.environ.get("RESEND_FROM_EMAIL", "").strip() or "RiskModels <service@riskmodels.app>"
    if not api_key:
        print("ERROR: RESEND_API_KEY required to send (use --dry-run to preview).", file=sys.stderr)
        return 2

    r = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"from": sender, "to": [args.to], "subject": subject, "text": text, "html": html},
        timeout=30,
    )
    if r.status_code >= 300:
        print(f"Resend error {r.status_code}: {r.text[:300]}", file=sys.stderr)
        return 1
    print(f"Sent audit email to {args.to} (id={r.json().get('id', '?')})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
