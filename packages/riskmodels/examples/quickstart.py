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
import urllib.error
import urllib.request
from datetime import datetime, timezone

_DEFAULT_TICKER = "NVDA"

MIN_RISKMODELS_PY_VERSION = os.environ.get("RISKMODELS_PY_MIN_VERSION", "0.2.4")

_DEFAULT_SDK_UPGRADE_MESSAGE = (
    "Upgrade the Python SDK (riskmodels-py) so you have the latest helpers (e.g. format_metrics_snapshot). "
    f"Run: pip install -U \"riskmodels-py>={MIN_RISKMODELS_PY_VERSION}\". "
    "Editable from this repo: pip install -e ../../sdk (RiskModels_API/sdk). "
    "From BWMACRO: pip install -r requirements-sdk-tests.txt"
)


def _pypi_gap_note(installed_version: str) -> str:
    if installed_version in ("0.2.0", "0.1.0"):
        return (
            "The PyPI release riskmodels-py "
            f"{installed_version} does not include format_metrics_snapshot; "
            "pip install -U riskmodels-py will not add it until a newer release is published. "
        )
    return ""


def log_event(message: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] [{level}] {message}", file=sys.stderr, flush=True)


def _parse_version_tuple(v: str) -> tuple[int, ...]:
    parts: list[int] = []
    for seg in v.split(".")[:4]:
        num = ""
        for c in seg:
            if c.isdigit():
                num += c
            else:
                break
        parts.append(int(num) if num else 0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


def _require_min_riskmodels_py_version() -> str:
    from importlib.metadata import PackageNotFoundError, version

    try:
        installed = version("riskmodels-py")
    except PackageNotFoundError:
        log_event(
            "riskmodels-py is not installed. "
            f'Install: pip install "riskmodels-py>={MIN_RISKMODELS_PY_VERSION}"',
            level="ERROR",
        )
        raise SystemExit(1) from None
    if _parse_version_tuple(installed) < _parse_version_tuple(MIN_RISKMODELS_PY_VERSION):
        log_event(
            f"riskmodels-py {installed} is below the minimum {MIN_RISKMODELS_PY_VERSION}. "
            f'Update: pip install -U "riskmodels-py>={MIN_RISKMODELS_PY_VERSION}"',
            level="ERROR",
        )
        raise SystemExit(1) from None
    log_event(f"riskmodels-py version OK ({installed}, minimum {MIN_RISKMODELS_PY_VERSION})")
    return installed


def _fetch_sdk_python_upgrade_message() -> str:
    """Canonical copy from GET {RISKMODELS_BASE_URL}/sdk/python; falls back to _DEFAULT_SDK_UPGRADE_MESSAGE."""
    base = os.environ.get("RISKMODELS_BASE_URL", "https://riskmodels.app/api").rstrip("/")
    url = f"{base}/sdk/python"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        msg = data.get("upgrade_message")
        api_msg = str(msg).strip() if msg else ""
        return api_msg or _DEFAULT_SDK_UPGRADE_MESSAGE
    except (OSError, urllib.error.URLError, ValueError, json.JSONDecodeError, TypeError, AttributeError):
        return _DEFAULT_SDK_UPGRADE_MESSAGE


def _require_format_metrics_snapshot():
    try:
        from riskmodels import format_metrics_snapshot

        return format_metrics_snapshot
    except ImportError:
        pass
    try:
        from riskmodels.metrics_snapshot import format_metrics_snapshot

        return format_metrics_snapshot
    except ImportError:
        ver = "unknown"
        try:
            from importlib.metadata import version

            ver = version("riskmodels-py")
        except Exception:
            pass
        upgrade_msg = _pypi_gap_note(ver) + _fetch_sdk_python_upgrade_message()
        log_event(
            f"`format_metrics_snapshot` is not available (installed riskmodels-py: {ver}). {upgrade_msg}",
            level="ERROR",
        )
        raise SystemExit(1) from None


def main() -> None:
    _require_min_riskmodels_py_version()

    from riskmodels import APIError, RiskModelsClient

    format_metrics_snapshot = _require_format_metrics_snapshot()

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
