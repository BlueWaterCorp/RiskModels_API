#!/usr/bin/env python3
"""Iterative refinement loop for snapshot PDFs.

Caches the (expensive) API fetch as a JSON sidecar, then re-renders in a
tight loop — each iteration takes < 1 second.

Usage
-----
    # First run — fetches from API, caches JSON, renders PDF v1:
    python -m riskmodels.snapshots.refine NVDA

    # Subsequent runs — reads cached JSON, prompt for direction:
    python -m riskmodels.snapshots.refine NVDA

    # Supply a prompt inline (no interactive input):
    python -m riskmodels.snapshots.refine NVDA -p "make the bars thinner, increase table font"

    # Force a fresh API fetch even if cache exists:
    python -m riskmodels.snapshots.refine NVDA --refetch

    # Change snapshot page (default: r1):
    python -m riskmodels.snapshots.refine NVDA --page r1

The refinement prompt is written into a sidecar `_refine_log.jsonl` so you
have a complete history of every iteration + what was requested.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Registry of snapshot pages — add new pages here
# ---------------------------------------------------------------------------

PAGE_REGISTRY: dict[str, dict[str, Any]] = {
    "r1": {
        "label": "R1 Factor Risk Profile",
        "module": "riskmodels.snapshots.r1_risk_profile",
        "data_cls": "R1Data",
        "fetch_fn": "get_data_for_r1",
        "render_fn": "render_r1_to_pdf",
        "render_png_fn": "render_r1_to_png",
        "render_json_fn": "render_r1_to_json",
    },
    "p1": {
        "label": "P1 Stock Performance",
        "module": "riskmodels.snapshots.p1_stock_performance",
        "data_cls": "P1Data",
        "fetch_fn": "get_data_for_p1",
        "render_fn": "render_p1_to_pdf",
        "render_png_fn": "render_p1_to_png",
    },
    # Future pages:
    # "r2": { ... },
}


def _load_page(page_key: str) -> dict[str, Any]:
    """Dynamically import the page module and return callables."""
    import importlib
    spec = PAGE_REGISTRY[page_key]
    mod = importlib.import_module(spec["module"])
    result = {
        "data_cls": getattr(mod, spec["data_cls"]),
        "fetch_fn": getattr(mod, spec["fetch_fn"]),
        "render_fn": getattr(mod, spec["render_fn"]),
        "label": spec["label"],
    }
    if "render_png_fn" in spec:
        result["render_png_fn"] = getattr(mod, spec["render_png_fn"])
    return result


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def _output_dir() -> Path:
    """Snapshot output lives inside the repo."""
    d = Path(__file__).resolve().parent / "output"
    d.mkdir(exist_ok=True)
    return d


def _json_path(ticker: str, page: str) -> Path:
    return _output_dir() / f"{ticker.upper()}_{page}_cache.json"


def _pdf_path(ticker: str, page: str) -> Path:
    return _output_dir() / f"{ticker.upper()}_{page.upper()}_latest.pdf"


def _png_path(ticker: str, page: str) -> Path:
    return _output_dir() / f"{ticker.upper()}_{page.upper()}_latest.png"


def _log_path(ticker: str, page: str) -> Path:
    return _output_dir() / f"{ticker.upper()}_{page}_refine_log.jsonl"


# ---------------------------------------------------------------------------
# Fetch / cache
# ---------------------------------------------------------------------------

def _fetch_and_cache(ticker: str, page: str, *, force: bool = False) -> Any:
    """Fetch data from API (or load cache). Returns the data object."""
    jp = _json_path(ticker, page)
    pg = _load_page(page)

    if jp.exists() and not force:
        print(f"  ↳ Using cached JSON: {jp.name}")
        data = pg["data_cls"].from_json(str(jp))
        return data

    # Need env + client
    _ensure_env()
    from riskmodels import RiskModelsClient
    client = RiskModelsClient.from_env()

    print(f"  ↳ Fetching {pg['label']} data for {ticker} …")
    t0 = time.time()
    data = pg["fetch_fn"](ticker, client)
    elapsed = time.time() - t0
    print(f"  ↳ Fetched in {elapsed:.1f}s")

    data.to_json(str(jp))
    print(f"  ↳ Cached → {jp.name}")
    return data


def _ensure_env():
    """Load .env.local if RISKMODELS_API_KEY is not set."""
    if os.environ.get("RISKMODELS_API_KEY"):
        return
    try:
        from riskmodels.env import load_repo_dotenv
        load_repo_dotenv()
    except Exception:
        # Manual fallback
        env_path = Path(__file__).resolve().parents[3] / ".env.local"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def _render(data: Any, ticker: str, page: str, *, png: bool = True) -> Path:
    """Render to fixed 'latest' filenames — overwrites previous build in place."""
    pg = _load_page(page)
    out = _pdf_path(ticker, page)

    t0 = time.time()
    pg["render_fn"](data, str(out))
    elapsed = time.time() - t0

    size_kb = out.stat().st_size / 1024
    print(f"  ↳ Rendered → {out.name}  ({size_kb:.0f} KB, {elapsed:.2f}s)")

    if png and "render_png_fn" in pg:
        png_out = _png_path(ticker, page)
        pg["render_png_fn"](data, str(png_out))
        png_kb = png_out.stat().st_size / 1024
        print(f"  ↳ PNG → {png_out.name}  ({png_kb:.0f} KB)")

    return out


# ---------------------------------------------------------------------------
# Refinement log
# ---------------------------------------------------------------------------

def _log_iteration(ticker: str, page: str, prompt: str, pdf_path: str):
    """Append one line to the JSONL refinement log."""
    lp = _log_path(ticker, page)
    entry = {
        "ts": datetime.datetime.now().isoformat(),
        "prompt": prompt,
        "pdf": pdf_path,
    }
    with open(lp, "a") as f:
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Interactive loop
# ---------------------------------------------------------------------------

def _print_header(ticker: str, page: str, label: str):
    print()
    print("=" * 60)
    print(f"  Snapshot Refiner — {label}")
    print(f"  Ticker: {ticker}")
    print(f"  Output: {_output_dir()}")
    print("=" * 60)


def run(ticker: str, page: str, *, prompt: str | None = None,
        refetch: bool = False, once: bool = False):
    """Main entry point.

    Parameters
    ----------
    ticker  : Stock ticker.
    page    : Snapshot page key (e.g. "r1").
    prompt  : If provided, skip interactive input and use this prompt.
    refetch : Force re-fetch from API.
    once    : If True, render once and exit (no loop).
    """
    pg = _load_page(page)
    _print_header(ticker, page, pg["label"])

    # Step 1: Fetch or load cache
    data = _fetch_and_cache(ticker, page, force=refetch)

    # Step 2: Initial render
    pdf = _render(data, ticker, page)
    _log_iteration(ticker, page, prompt or "(initial render)", str(pdf))

    if once:
        return pdf

    # Step 3: Refinement loop
    print()
    print("  Ready for refinement. Type your direction and press Enter.")
    print("  Commands:  'open' = open latest PDF,  'refetch' = re-pull API,")
    print("             'quit' = exit")
    print()

    while True:
        try:
            direction = prompt or input(f"  [{ticker} {page.upper()}] → ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n  Done.")
            break

        if not direction:
            continue

        # Meta commands
        cmd = direction.lower()
        if cmd in ("quit", "exit", "q"):
            print("  Done.")
            break
        if cmd == "open":
            _open_pdf(pdf)
            prompt = None
            continue
        if cmd == "refetch":
            data = _fetch_and_cache(ticker, page, force=True)
            pdf = _render(data, ticker, page)
            _log_iteration(ticker, page, "refetch", str(pdf))
            prompt = None
            continue

        print(f"\n  Direction logged: \"{direction}\"")
        print(f"  → Edit the render code, then press Enter to re-render.")
        print()

        try:
            input(f"  [Press Enter when code edits are done] ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n  Done.")
            break

        _hot_reload(page)

        pdf = _render(data, ticker, page)
        _log_iteration(ticker, page, direction, str(pdf))

        if prompt:
            break


def _hot_reload(page: str):
    """Force-reload the snapshot modules so code edits take effect."""
    import importlib
    spec = PAGE_REGISTRY[page]
    mod_name = spec["module"]

    # Reload the Plotly chart/theme primitives first
    primitives = [
        "riskmodels.snapshots._plotly_theme",
        "riskmodels.snapshots._plotly_charts",
        # Legacy (still used by S1/S2)
        "riskmodels.snapshots._theme",
        "riskmodels.snapshots._charts",
        "riskmodels.snapshots._page",
    ]
    for name in primitives:
        if name in sys.modules:
            importlib.reload(sys.modules[name])

    # Reload the page module itself
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])


def _open_pdf(path: Path):
    """Try to open the PDF with the system viewer."""
    import subprocess
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        elif sys.platform == "linux":
            subprocess.Popen(["xdg-open", str(path)])
        else:
            subprocess.Popen(["start", str(path)], shell=True)
        print(f"  Opened {path.name}")
    except Exception as e:
        print(f"  Could not open PDF: {e}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        prog="python -m riskmodels.snapshots.refine",
        description="Iterative refinement loop for snapshot PDFs",
    )
    parser.add_argument("ticker", help="Stock ticker (e.g. NVDA)")
    parser.add_argument(
        "--page", default="r1", choices=list(PAGE_REGISTRY.keys()),
        help=f"Snapshot page to refine (default: r1) — choices: {', '.join(PAGE_REGISTRY.keys())}",
    )
    parser.add_argument(
        "-p", "--prompt", default=None,
        help="Refinement direction (skip interactive input)",
    )
    parser.add_argument(
        "--refetch", action="store_true",
        help="Force re-fetch from API even if cache exists",
    )
    parser.add_argument(
        "--once", action="store_true",
        help="Render once and exit (no interactive loop)",
    )

    args = parser.parse_args()
    run(
        ticker=args.ticker.upper(),
        page=args.page,
        prompt=args.prompt,
        refetch=args.refetch,
        once=args.once,
    )


if __name__ == "__main__":
    main()
