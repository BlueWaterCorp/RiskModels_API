"""Minimal RiskModels CLI wrapper over the SDK.

Usage:
    python -m riskmodels.cli metrics NVDA
    python -m riskmodels.cli returns NVDA --window 21
    python -m riskmodels.cli l3 NVDA
    python -m riskmodels.cli rankings NVDA
    python -m riskmodels.cli macro NVDA
    python -m riskmodels.cli batch NVDA AAPL XOM

Auth: reads RISKMODELS_API_KEY from env, or pass --api-key.
Output: JSON to stdout. Pipe to `jq` for pretty-printing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any


def _print(obj: Any) -> None:
    json.dump(obj, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")


def _client(args: argparse.Namespace):
    from riskmodels import RiskModelsClient

    api_key = args.api_key or os.environ.get("RISKMODELS_API_KEY")
    if not api_key:
        sys.stderr.write(
            "error: no API key — pass --api-key or set RISKMODELS_API_KEY\n"
        )
        sys.exit(2)
    base_url = args.base_url or os.environ.get("RISKMODELS_API_URL")
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return RiskModelsClient(**kwargs)


def cmd_metrics(args: argparse.Namespace) -> int:
    _print(_client(args).get_metrics(args.ticker))
    return 0


def cmd_returns(args: argparse.Namespace) -> int:
    c = _client(args)
    kwargs = {}
    if args.window is not None:
        kwargs["window_days"] = args.window
    _print(c.get_ticker_returns(args.ticker, **kwargs))
    return 0


def cmd_l3(args: argparse.Namespace) -> int:
    _print(_client(args).get_l3_decomposition(args.ticker))
    return 0


def cmd_rankings(args: argparse.Namespace) -> int:
    _print(_client(args).get_rankings(args.ticker))
    return 0


def cmd_macro(args: argparse.Namespace) -> int:
    _print(_client(args).get_macro_factor_series(args.ticker))
    return 0


def cmd_batch(args: argparse.Namespace) -> int:
    c = _client(args)
    metrics = args.metrics.split(",") if args.metrics else ["metrics-snapshot"]
    _print(c.batch_analyze(args.tickers, metrics=metrics))
    return 0


def cmd_health(args: argparse.Namespace) -> int:
    import urllib.request

    base = args.base_url or os.environ.get(
        "RISKMODELS_API_URL", "https://riskmodels.app"
    )
    with urllib.request.urlopen(f"{base}/api/health", timeout=15) as r:
        _print(json.loads(r.read().decode()))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="riskmodels", description=__doc__.splitlines()[0])
    p.add_argument("--api-key", help="RiskModels API key (default: $RISKMODELS_API_KEY)")
    p.add_argument("--base-url", help="API base URL (default: $RISKMODELS_API_URL or https://riskmodels.app)")

    sub = p.add_subparsers(dest="command", required=True)

    for name, fn, help_ in [
        ("metrics", cmd_metrics, "Latest risk metrics for a ticker"),
        ("l3", cmd_l3, "L3 risk decomposition time series"),
        ("rankings", cmd_rankings, "Cross-sectional rankings for a ticker"),
        ("macro", cmd_macro, "Macro factor correlations for a ticker"),
    ]:
        sp = sub.add_parser(name, help=help_)
        sp.add_argument("ticker")
        sp.set_defaults(func=fn)

    sp = sub.add_parser("returns", help="Daily ticker returns time series")
    sp.add_argument("ticker")
    sp.add_argument("--window", type=int, help="Window days (default: API default)")
    sp.set_defaults(func=cmd_returns)

    sp = sub.add_parser("batch", help="Batch-analyze multiple tickers")
    sp.add_argument("tickers", nargs="+")
    sp.add_argument("--metrics", help="Comma-separated capability ids (default: metrics-snapshot)")
    sp.set_defaults(func=cmd_batch)

    sp = sub.add_parser("health", help="API health check (no auth)")
    sp.set_defaults(func=cmd_health)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
