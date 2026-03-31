#!/usr/bin/env python3
"""
Runnable quickstart: env auth + get_metrics + formatted L3 snapshot on stdout.

Run from repo: ``python examples/quickstart.py`` (``cd packages/riskmodels``), or install the package and run this file by path.

Environment:

- ``RISKMODELS_API_KEY`` or OAuth client credentials (see package README).
- ``RISKMODELS_QUICKSTART_TICKER`` — optional, default ``NVDA``.
- ``DEBUG=1`` — log returned row keys to stderr.

Logs go to stderr; the metrics snapshot goes to stdout.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

_DEFAULT_TICKER = "NVDA"


def log_event(message: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] [{level}] {message}", file=sys.stderr, flush=True)


def main() -> None:
    from riskmodels import APIError, RiskModelsClient, format_metrics_snapshot

    ticker = os.environ.get("RISKMODELS_QUICKSTART_TICKER", _DEFAULT_TICKER).strip() or _DEFAULT_TICKER

    log_event("Creating client from environment (RISKMODELS_API_KEY or OAuth env vars)")
    try:
        client = RiskModelsClient.from_env()
    except ValueError as e:
        log_event(
            "Missing credentials: set RISKMODELS_API_KEY, or RISKMODELS_CLIENT_ID "
            f"and RISKMODELS_CLIENT_SECRET. ({e})",
            level="ERROR",
        )
        raise SystemExit(1) from e

    log_event(f"Calling get_metrics({ticker!r})")
    try:
        row = client.get_metrics(ticker, validate="warn")
    except APIError as e:
        log_event(f"API error: {e} (HTTP {e.status_code})", level="ERROR")
        log_event(
            "Hint: try another ticker (e.g. export RISKMODELS_QUICKSTART_TICKER=AAPL), "
            "or verify RISKMODELS_BASE_URL and that metrics exist for this environment.",
            level="ERROR",
        )
        raise SystemExit(1) from e
    finally:
        client.close()

    if os.environ.get("DEBUG"):
        log_event("DEBUG row keys: " + json.dumps(list(row.keys()), indent=None))

    log_event(f"Success for ticker={row.get('ticker', ticker)!r}")
    print(format_metrics_snapshot(row), file=sys.stdout, flush=True)


if __name__ == "__main__":
    main()
