#!/usr/bin/env python3
"""
Execute notebooks/riskmodels_quickstart.ipynb end-to-end (same as Jupyter "Run All").

Requires a real RiskModels API key (rm_user_* / rm_agent_*).

  # Easiest local: put RISKMODELS_API_KEY in .env.local (gitignored) — the harness loads it
  # Or export explicitly:
  export RISKMODELS_QUICKSTART_API_KEY="rm_user_…"  # preferred explicit name for this script
  export TEST_API_KEY="rm_user_…"                   # GitHub Actions secret name
  export RISKMODELS_API_KEY="rm_user_…"             # same as Python SDK / .env.local

  # Optional — point at local Next (billing middleware must match this repo) when prod not deployed yet:
  #   RISKMODELS_QUICKSTART_BASE_URL=http://127.0.0.1:3000 npm run test:notebook

  pip install -r notebooks/requirements-notebook-test.txt
  python scripts/execute_quickstart_notebook.py

Cells tagged skip-ci (OpenAI + Colab npm shell) are replaced with a no-op stub so CI
does not need OpenAI or Node. Set --no-skip-ci to run the full notebook; set OPENAI_API_KEY
in the environment for the GPT bonus cell (or leave unset — the notebook skips the LLM if
the key is missing or still a PASTE_YOUR_* placeholder).

Optional: MPLBACKEND=Agg (set automatically if unset).

The harness uses a temporary IPYTHONDIR so your global ~/.ipython config and startup
files do not break the headless kernel (avoids ZMQInteractiveShell / startup errors).
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK = REPO_ROOT / "notebooks" / "riskmodels_quickstart.ipynb"

SKIP_STUB = '''# Auto-skipped in harness (metadata tag: skip-ci)
print("[quickstart harness] skipped cell (skip-ci tag). Run in Jupyter for OpenAI / !npm sections.")
'''

KEY_CANDIDATES = (
    "RISKMODELS_QUICKSTART_API_KEY",
    "TEST_API_KEY",
    "RISKMODELS_API_KEY",  # Python SDK / typical .env.local name
)


def _load_dotenv_local(path: Path) -> None:
    """Parse .env.local without extra deps; does not override existing os.environ."""
    if not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip()
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            val = val[1:-1]
        if key and key not in os.environ:
            os.environ[key] = val


def _require_api_key() -> str:
    _load_dotenv_local(REPO_ROOT / ".env.local")
    for k in KEY_CANDIDATES:
        v = (os.environ.get(k) or "").strip()
        if v and v != "PASTE_YOUR_KEY_HERE":
            # Normalize so the notebook config cell (first env wins) sees a value
            os.environ.setdefault("RISKMODELS_QUICKSTART_API_KEY", v)
            return v
    print(
        "Missing API key. Add RISKMODELS_API_KEY to .env.local, or set one of:\n"
        "  export RISKMODELS_QUICKSTART_API_KEY='rm_user_…'\n"
        "  export TEST_API_KEY='rm_user_…'\n"
        "  export RISKMODELS_API_KEY='rm_user_…'\n"
        "Get a key at https://riskmodels.app/get-key",
        file=sys.stderr,
    )
    sys.exit(1)


def _apply_skip_ci(nb: object, no_skip_ci: bool) -> int:
    if no_skip_ci:
        return 0
    n = 0
    for cell in nb.cells:
        if getattr(cell, "cell_type", None) != "code":
            continue
        tags = (cell.get("metadata") or {}).get("tags") or []
        if "skip-ci" in tags:
            cell.source = SKIP_STUB  # type: ignore[assignment]
            n += 1
    return n


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=NOTEBOOK,
        help="Path to quickstart .ipynb",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Write executed notebook to this path (optional)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=900,
        help="Per-cell timeout in seconds (default 900)",
    )
    parser.add_argument(
        "--no-skip-ci",
        action="store_true",
        help="Execute OpenAI / !npm cells (needs keys and tools)",
    )
    args = parser.parse_args()

    _require_api_key()  # loads .env.local then checks KEY_CANDIDATES

    os.environ.setdefault("MPLBACKEND", "Agg")
    os.environ.pop("PYTHONSTARTUP", None)

    import nbformat
    from nbclient import NotebookClient

    path = args.input.resolve()
    if not path.is_file():
        print(f"Notebook not found: {path}", file=sys.stderr)
        sys.exit(1)

    nb = nbformat.read(path, as_version=4)
    skipped = _apply_skip_ci(nb, args.no_skip_ci)
    if skipped:
        print(f"[quickstart harness] stubbed {skipped} skip-ci cell(s)")

    with tempfile.TemporaryDirectory(prefix="riskmodels-quickstart-ipy-") as ipy_home:
        os.environ["IPYTHONDIR"] = ipy_home
        client = NotebookClient(
            nb,
            timeout=args.timeout,
            kernel_name="python3",
            allow_errors=False,
        )
        client.execute()
    print("[quickstart harness] OK — all cells executed")

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            nbformat.write(nb, f)
        print(f"[quickstart harness] wrote {args.output}")


if __name__ == "__main__":
    main()
