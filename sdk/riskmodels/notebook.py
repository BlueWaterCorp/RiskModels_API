"""Jupyter / Colab quickstart helpers — keep notebook cells short and on-message.

Use after ``pip install riskmodels-py requests python-dotenv`` (Colab: see quickstart notebook).
"""

from __future__ import annotations

import getpass
import os
from pathlib import Path
from typing import Any

GET_KEY_URL = "https://riskmodels.app/get-key"


def load_notebook_dotenv() -> None:
    """Load ``.env`` then ``.env.local`` walking up from :func:`os.getcwd` (first directory with files).

    Stops at the RiskModels_API repo root (``sdk/pyproject.toml`` + ``OPENAPI_SPEC.yaml``) even when
    no env files exist there, so we do not walk the whole filesystem.

    Requires ``python-dotenv``; no-op if missing.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    here = Path.cwd().resolve()
    for root in (here, *here.parents):
        env_f = root / ".env"
        loc_f = root / ".env.local"
        hit = False
        if env_f.is_file():
            load_dotenv(env_f, override=False)
            hit = True
        if loc_f.is_file():
            load_dotenv(loc_f, override=True)
            hit = True
        if hit:
            return
        if (root / "sdk" / "pyproject.toml").is_file() and (root / "OPENAPI_SPEC.yaml").is_file():
            return


def ensure_riskmodels_api_key() -> str:
    """Resolve ``RISKMODELS_API_KEY``: env / dotenv / Colab Secret / prompt."""
    load_notebook_dotenv()
    for name in ("RISKMODELS_API_KEY", "RISKMODELS_QUICKSTART_API_KEY", "TEST_API_KEY"):
        v = (os.environ.get(name) or "").strip()
        if v and v != "PASTE_YOUR_KEY_HERE":
            return v
    try:
        from google.colab import userdata

        sec = userdata.get("RISKMODELS_API_KEY")
        if sec:
            s = str(sec).strip()
            os.environ["RISKMODELS_API_KEY"] = s
            print("Loaded RISKMODELS_API_KEY from Colab Secrets.")
            return s
    except ImportError:
        pass
    except Exception as e:  # pragma: no cover - Colab UI
        print("Colab Secrets:", e)
    try:
        entered = getpass.getpass(
            "RISKMODELS_API_KEY (hidden; press Enter if already in environment): "
        ).strip()
    except Exception:
        entered = input("RISKMODELS_API_KEY: ").strip()
    if not entered or entered == "PASTE_YOUR_KEY_HERE":
        raise ValueError(
            "Missing API key. Use .env.local, export, Colab Secret, or paste here — "
            f"{GET_KEY_URL}"
        )
    os.environ["RISKMODELS_API_KEY"] = entered
    return entered


def quickstart_api_base_url() -> str:
    """API origin ending in ``/api`` (overrides via env, default production)."""
    raw = (
        os.environ.get("RISKMODELS_QUICKSTART_BASE_URL")
        or os.environ.get("RISKMODELS_API_BASE_URL")
        or "https://riskmodels.app"
    ).strip()
    raw = raw.removesuffix("/api").rstrip("/")
    return raw + "/api"


def quickstart_connect(
    *,
    verify_balance: bool = True,
    announce: bool = True,
) -> tuple[Any, str, str]:
    """Authenticated :mod:`requests` session + base URL for REST + quickstarts.

    Returns:
        ``(session, base_url, api_key)`` where ``base_url`` ends with ``/api``.

    Raises:
        ImportError: if ``requests`` is not installed.
    """
    try:
        import requests
    except ImportError as e:
        raise ImportError(
            "quickstart_connect() needs the `requests` package. "
            "Install: pip install requests"
        ) from e

    api_key = ensure_riskmodels_api_key()
    base_url = quickstart_api_base_url()
    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {api_key}"
    if verify_balance:
        r = session.get(f"{base_url}/balance", params={"include_usage": "false"})
        r.raise_for_status()
    if announce:
        prefix = (api_key or "")[:16]
        print(f"RiskModels REST session ready (key prefix {prefix}…). Keys & plans: {GET_KEY_URL}")
    return session, base_url, api_key
