#!/usr/bin/env python3
"""
Download a one-page portfolio risk snapshot PDF from the RiskModels API.

Discovery path (no repo insider knowledge):
  1. Open https://riskmodels.app — API docs + OpenAPI describe POST /api/portfolio/risk-snapshot.
  2. Get an API key: https://riskmodels.app/get-key (Account → Usage after login).
  3. Set RISKMODELS_API_KEY and run this script.

Request body (see OPENAPI_SPEC.yaml): ``positions`` [{ticker, weight}], optional ``title``,
optional ``as_of_date`` (YYYY-MM-DD), ``format``: ``json`` | ``pdf`` | ``png`` (png → 501).

Uses only the standard library (urllib) so it runs without pip install requests.
For SDK usage: ``pdf_bytes, _ = RiskModelsClient.from_env().post_portfolio_risk_snapshot_pdf(...)``.

Examples::

    export RISKMODELS_API_KEY=rm_...
    python examples/python/portfolio_risk_snapshot_pdf.py
    RISKMODELS_BASE_URL=http://localhost:3000/api python examples/python/portfolio_risk_snapshot_pdf.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def _base_url() -> str:
    raw = (os.environ.get("RISKMODELS_BASE_URL") or "https://riskmodels.app/api").rstrip("/")
    if not raw.endswith("/api"):
        if raw.endswith("/api/"):
            return raw.rstrip("/")
        # allow bare origin e.g. https://riskmodels.app
        if "/api" not in raw:
            return f"{raw}/api"
    return raw


def _api_key() -> str:
    key = (os.environ.get("RISKMODELS_API_KEY") or "").strip()
    if not key:
        print(
            "Missing RISKMODELS_API_KEY. Get a key at https://riskmodels.app/get-key",
            file=sys.stderr,
        )
        sys.exit(1)
    return key


def fetch_risk_snapshot_pdf(
    *,
    positions: list[dict[str, float | str]],
    title: str | None = None,
    as_of_date: str | None = None,
) -> bytes:
    url = f"{_base_url()}/portfolio/risk-snapshot"
    payload: dict[str, object] = {"positions": positions, "format": "pdf"}
    if title is not None:
        payload["title"] = title
    if as_of_date is not None:
        payload["as_of_date"] = as_of_date

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {_api_key()}",
            "Content-Type": "application/json",
            "Accept": "application/pdf, application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            body = resp.read()
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(err_body)
            msg = detail.get("message") or detail.get("error") or err_body
        except json.JSONDecodeError:
            msg = err_body or str(e.reason)
        print(f"HTTP {e.code}: {msg}", file=sys.stderr)
        sys.exit(1)

    if ctype != "application/pdf":
        print(
            f"Expected application/pdf, got {ctype!r}. Body (first 500 chars): {body[:500]!r}",
            file=sys.stderr,
        )
        sys.exit(1)

    if not body.startswith(b"%PDF"):
        print("Response does not look like a PDF (missing %PDF header).", file=sys.stderr)
        sys.exit(1)

    return body


def main() -> None:
    positions = [
        {"ticker": "NVDA", "weight": 0.30},
        {"ticker": "AAPL", "weight": 0.25},
        {"ticker": "MSFT", "weight": 0.25},
        {"ticker": "GOOGL", "weight": 0.20},
    ]
    title = os.environ.get("RISKMODELS_SNAPSHOT_TITLE", "Sample portfolio snapshot")
    out_dir = Path(os.environ.get("RISKMODELS_SNAPSHOT_OUTDIR", "."))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_path = out_dir / f"risk_snapshot_{stamp}.pdf"

    pdf_bytes = fetch_risk_snapshot_pdf(positions=positions, title=title)
    out_path.write_bytes(pdf_bytes)
    print(f"Wrote {len(pdf_bytes)} bytes to {out_path.resolve()}")


if __name__ == "__main__":
    main()
