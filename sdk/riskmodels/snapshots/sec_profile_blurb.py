"""
SEC / LLM company profile plain text for Stock Deep Dive left panel.

When ``ERM3_ROOT`` is on ``sys.path``, uses :func:`erm3.shared.company_profiles.build_company_snapshot_plain_text`
so the blurb matches Supabase ``symbols.company_snapshot`` and GCS public uploads. Otherwise falls back to
``profile_summary`` / ``profile_plain`` only.

Keep behavior aligned with ERM3 ``company_profiles`` pipeline when changing field logic.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# DD sidebar budget — full 12k snapshot would overflow the panel
MAX_DD_PANEL_CHARS = 1200


def load_sec_profile_blurb(symbol: str, version_root: Path) -> str | None:
    """
    ``version_root`` is the company_profiles dataset version directory (contains ``json/``).

    Returns None if no JSON for ``symbol`` or empty blurb after build.
    """
    safe = str(symbol).replace("/", "_")
    p = version_root / "json" / f"symbol={safe}.json"
    if not p.is_file():
        return None
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    text = ""
    erm3_raw = (os.environ.get("ERM3_ROOT") or "").strip()
    if erm3_raw:
        er = Path(erm3_raw).expanduser().resolve()
        s = str(er)
        if s not in sys.path:
            sys.path.insert(0, s)
        try:
            from erm3.shared.company_profiles import build_company_snapshot_plain_text

            text = build_company_snapshot_plain_text(doc)
        except Exception:
            text = ""
    if not (text and str(text).strip()):
        text = (
            str(doc.get("profile_summary") or doc.get("profile_plain") or "").strip()
        )
    if not text:
        return None
    text = text.strip()
    if len(text) > MAX_DD_PANEL_CHARS:
        text = text[: MAX_DD_PANEL_CHARS - 3].rstrip() + "..."
    return text
