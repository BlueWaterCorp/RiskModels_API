"""Optional loading of ``.env`` / ``.env.local`` (requires ``python-dotenv``)."""

from __future__ import annotations

import os
from pathlib import Path


def load_repo_dotenv(start: Path | str | None = None) -> bool:
    """Merge ``.env`` then ``.env.local`` into :func:`os.environ` without overriding existing keys.

    Existing process environment (shell exports, ``pytest`` monkeypatch, CI secrets) always wins.
    Among files only, later ``.env.local`` values override earlier ``.env`` values for keys not
    already set in the environment.

    - If ``start`` is a directory path, read files only from that directory.
    - If omitted, walk upward from :func:`os.getcwd` and use the first directory that contains
      either file.

    Returns ``True`` if at least one file was read. No-op if ``python-dotenv`` is not installed.
    """
    try:
        from dotenv import dotenv_values
    except ImportError:
        return False

    def _apply_merged(root: Path) -> bool:
        env_f = root / ".env"
        loc_f = root / ".env.local"
        if not env_f.is_file() and not loc_f.is_file():
            return False
        merged: dict[str, str | None] = {}
        if env_f.is_file():
            merged.update(dotenv_values(env_f))
        if loc_f.is_file():
            merged.update(dotenv_values(loc_f))
        for k, v in merged.items():
            if v is None:
                continue
            if k in os.environ:
                continue
            os.environ[k] = str(v)
        return True

    if start is not None:
        return _apply_merged(Path(start).resolve())

    here = Path.cwd().resolve()
    for p in [here, *here.parents]:
        if _apply_merged(p):
            return True
    return False
