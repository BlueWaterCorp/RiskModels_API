#!/usr/bin/env python3
"""
Generate PNG samples for every built-in Plotly gallery recipe (``run_gallery_all``).

Use this when you want one folder of static assets to browse (admin “full gallery”, docs, or Notion).

Requirements
------------
- **Internal:** put secrets in ``RiskModels_API/.env`` (gitignored). Use a **platform** API key
  (prefix ``rm_agent_`` or ``rm_user_`` from https://riskmodels.app/get-key). Not a Supabase anon
  key, not a browser JWT, not ``rm_demo_*``. Example::

      RISKMODELS_API_KEY=rm_user_...   # or rm_agent_...
      # optional:
      # RISKMODELS_BASE_URL=http://localhost:3000/api

  By default this script **overrides** existing ``RISKMODELS_*`` shell variables with values from
  those files (so a stale key from another venv / monorepo shell does not win). Pass
  ``--no-env-override`` to preserve shell-first behavior.

  Requires ``pip install -e 'sdk[dotenv]'`` (or ``[dev]``) so ``.env`` can be read.
- ``pip install -e 'sdk[viz]'`` from repo root (Plotly + Kaleido for PNG export).

Outputs (default ``public/sdk-gallery/``)
----------------------------------------
- ``nvda_l3_risk.png`` — NVDA L3 decomposition
- ``mag7_l3_explained_risk.png`` — MAG7 explained-risk bars
- ``mag7_l3_sigma_rr.png`` — MAG7 σ-scaled RR + HR
- ``mag7_risk_cascade.png`` — MAG7 cap-weighted risk cascade
- ``mag7_attribution_cascade.png`` — MAG7 attribution cascade
- ``gallery-manifest.json`` — titles + filenames for a static gallery UI

Other PNG pipelines (not run here)
----------------------------------
- Matplotlib rankings / macro heatmaps: ``python scripts/generate_readme_assets.py``
  → writes under ``assets/`` and mirrors to ``public/docs/readme/``.
- PDF snapshot pages (R1, P1, …): use ``riskmodels.snapshots`` render helpers with ``[pdf]`` / ``[snapshots]`` extras.

Run from **RiskModels_API** repo root (after ``.env`` is configured)::

    python scripts/generate_sdk_visual_gallery.py

Custom output directory::

    python scripts/generate_sdk_visual_gallery.py --out-dir ./tmp/gallery

Prefer shell exports over repo ``.env`` (not recommended from BWMACRO venv)::

    python scripts/generate_sdk_visual_gallery.py --no-env-override
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SDK_SRC = ROOT / "sdk"
if SDK_SRC.is_dir() and str(SDK_SRC) not in sys.path:
    sys.path.insert(0, str(SDK_SRC))


def _normalize_api_key(key: str) -> str:
    """Strip whitespace, outer quotes, accidental ``Bearer ``, CR/LF/BOM, and zero-width chars."""
    key = key.strip()
    key = key.replace("\ufeff", "").replace("\r", "").replace("\n", "")
    key = re.sub(r"[\u200b-\u200d\ufeff]", "", key)
    if len(key) >= 2 and key[0] == key[-1] and key[0] in "'\"":
        key = key[1:-1].strip()
    if key.lower().startswith("bearer "):
        key = key[7:].strip()
    return key


def _diagnose_api_key_shape(key: str) -> None:
    """Best-effort checks; checksum is the segment after the *final* underscore (matches server logic)."""
    if key.startswith("rm_agent_"):
        rest = key[len("rm_agent_") :]
        env_end = rest.find("_")
        if env_end < 0:
            print("  Diagnostics: rm_agent key malformed (missing env segment).", file=sys.stderr)
            return
        env = rest[:env_end]
        body = rest[env_end + 1 :]
        last_u = body.rfind("_")
        if last_u < 0:
            print("  Diagnostics: rm_agent key malformed (no checksum separator).", file=sys.stderr)
            return
        random_part = body[:last_u]
        checksum = body[last_u + 1 :]
        issues: list[str] = []
        if env not in ("live", "test"):
            issues.append(f"env={env!r} (expected live or test)")
        if len(checksum) != 8:
            issues.append(f"checksum length {len(checksum)} (expected 8)")
        else:
            bad_c = [c for c in checksum if not (c.isascii() and c.isalnum())]
            if bad_c:
                issues.append(f"checksum has non-alphanumeric: {set(bad_c)!r}")
        _b64url = frozenset("-_")
        bad_r = [
            c for c in random_part if not (c.isascii() and (c.isalnum() or c in _b64url))
        ]
        if bad_r:
            issues.append(f"random segment has unexpected chars: {set(bad_r)!r}")
        if issues:
            print("  Diagnostics: " + "; ".join(issues), file=sys.stderr)
            return
        if len(random_part) == 32 and all(c.isascii() and c.isalnum() for c in random_part):
            print(
                "  Diagnostics: rm_agent key matches current issued shape (live|test + 32 alnum + 8 alnum). "
                "401 => server rejected checksum or no DB row (revoked / wrong project / rotate at get-key).",
                file=sys.stderr,
            )
        elif len(random_part) == 32 and all(
            c.isascii() and (c.isalnum() or c in _b64url) for c in random_part
        ):
            print(
                "  Diagnostics: 32-char middle segment contains '-' or '_'. Newly issued keys use "
                "A–Z a–z 0–9 only in that segment; a hyphen is usually a corrupted paste. "
                "Re-copy the full key from https://riskmodels.app/get-key into .env on one line.",
                file=sys.stderr,
            )
        else:
            print(
                f"  Diagnostics: rm_agent structure parses OK (random segment len={len(random_part)}, may include _). "
                "401 => rotate key or confirm it exists in production agent_api_keys.",
                file=sys.stderr,
            )
    elif key.startswith("rm_user_"):
        print(
            f"  Diagnostics: rm_user_ key length={len(key)}. If 401 persists, regenerate the user key "
            "in Account or confirm it is not revoked/expired.",
            file=sys.stderr,
        )


def _warn_if_unusual_api_key_prefix(key: str) -> None:
    """riskmodels.app accepts ``rm_agent_*`` and ``rm_user_*`` Bearer tokens."""
    if key.startswith("rm_agent_") or key.startswith("rm_user_"):
        return
    if key.startswith("rm_demo_"):
        print(
            "  Key prefix rm_demo_* is blocked on authenticated routes. Use rm_user_* / rm_agent_* "
            "from https://riskmodels.app/get-key",
            file=sys.stderr,
        )
        return
    print(
        "  Key does not look like rm_agent_* or rm_user_*. If auth keeps failing, paste a platform "
        "API key (not a Supabase anon key, not a raw JWT from the browser session, not legacy rm_live_*). "
        "Issue: https://riskmodels.app/get-key",
        file=sys.stderr,
    )


def _apply_env_files(*, override: bool) -> bool:
    """Load RiskModels_API .env files. Returns False if python-dotenv is missing."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return False
    load_dotenv(ROOT / ".env", override=override)
    load_dotenv(ROOT / ".env.local", override=override)
    return True


def _print_auth_failure_hint() -> None:
    base = os.environ.get("RISKMODELS_BASE_URL", "https://riskmodels.app/api")
    key = _normalize_api_key(os.environ.get("RISKMODELS_API_KEY", ""))
    tail = (key[-4:] if len(key) >= 4 else "????") if key else "(empty)"
    prefix = (key[:12] + "…") if len(key) > 12 else key
    print(
        f"  Using RISKMODELS_BASE_URL={base!r}; key prefix {prefix!r} (ends …{tail})",
        file=sys.stderr,
    )
    print(
        "  Fix: put rm_agent_* or rm_user_* in RiskModels_API/.env for that host. "
        "Omit --no-env-override so repo .env overrides a stray shell key.",
        file=sys.stderr,
    )


def _print_gallery_failure(exc: BaseException) -> None:
    from riskmodels.exceptions import APIError, AuthError

    msg_l = str(exc).lower()
    if isinstance(exc, (APIError, AuthError)):
        print(f"gallery failed: {exc}", file=sys.stderr)
        body = getattr(exc, "body", None)
        if body is not None:
            try:
                detail = json.dumps(body, indent=2) if isinstance(body, dict) else str(body)
                if len(detail) > 2000:
                    detail = detail[:2000] + "…"
                print(f"  Server response: {detail}", file=sys.stderr)
            except Exception:
                print(f"  Server response: {body!r}", file=sys.stderr)
        if getattr(exc, "status_code", None) in (401, 403):
            _print_auth_failure_hint()
        return
    if "api key" in msg_l or "authentication" in msg_l:
        print(f"gallery failed: {exc}", file=sys.stderr)
        _print_auth_failure_hint()
        return
    if isinstance(exc, ImportError) or "kaleido" in msg_l:
        print(f"gallery failed: {exc}", file=sys.stderr)
        print(
            "Install viz extras:  pip install -e 'sdk[viz]'  (needs kaleido for PNG export).",
            file=sys.stderr,
        )
        return
    print(f"gallery failed: {exc}", file=sys.stderr)
    print(
        "If this is not a Plotly/Kaleido error, see messages above; otherwise: "
        "pip install -e 'sdk[viz]'",
        file=sys.stderr,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Write run_gallery_all PNGs + manifest.")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT / "public" / "sdk-gallery",
        help="Directory for PNGs and gallery-manifest.json",
    )
    parser.add_argument(
        "--no-env-override",
        action="store_true",
        help="Do not override existing env vars (shell exports win over RiskModels_API/.env).",
    )
    args = parser.parse_args()

    if args.no_env_override:
        from riskmodels.env import load_repo_dotenv

        if not load_repo_dotenv(ROOT) and not load_repo_dotenv(ROOT / "sdk"):
            try:
                from dotenv import load_dotenv
            except ImportError:
                pass
            else:
                load_dotenv(ROOT / ".env", override=False)
                load_dotenv(ROOT / ".env.local", override=False)
    else:
        if not _apply_env_files(override=True):
            print(
                "python-dotenv is required to read .env. Run: pip install -e 'sdk[dotenv]'",
                file=sys.stderr,
            )
            return 1

    key = _normalize_api_key(os.environ.get("RISKMODELS_API_KEY") or "")
    if not key:
        print(
            "RISKMODELS_API_KEY is required. Internal use: add it to .env in the repo root "
            f"({ROOT / '.env'}).",
            file=sys.stderr,
        )
        if args.no_env_override:
            print(
                "Tip: omit --no-env-override so RiskModels_API/.env overrides an empty shell variable.",
                file=sys.stderr,
            )
        return 1

    os.environ["RISKMODELS_API_KEY"] = key
    _warn_if_unusual_api_key_prefix(key)
    _diagnose_api_key_shape(key)

    from riskmodels.client import RiskModelsClient
    from riskmodels.visuals.gallery import run_gallery_all

    base = (os.environ.get("RISKMODELS_BASE_URL") or "").strip() or "https://riskmodels.app/api"
    client = RiskModelsClient(base_url=base, api_key=key)
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        client.get_metrics("NVDA")
    except Exception as e:
        print("Auth check via GET /metrics/NVDA failed (gallery needs the same credentials):", file=sys.stderr)
        _print_gallery_failure(e)
        return 2

    meta = [
        {
            "id": "nvda_l3",
            "file": "nvda_l3_risk.png",
            "title": "NVDA — L3 risk decomposition",
            "recipe": "run_gallery_nvda_l3 / save_l3_decomposition_png",
        },
        {
            "id": "mag7_l3_er",
            "file": "mag7_l3_explained_risk.png",
            "title": "MAG7 — L3 explained risk",
            "recipe": "run_gallery_mag7_l3_er",
        },
        {
            "id": "mag7_l3_sigma_rr",
            "file": "mag7_l3_sigma_rr.png",
            "title": "MAG7 — L3 σ-scaled RR + HR",
            "recipe": "run_gallery_mag7_l3_sigma_rr",
        },
        {
            "id": "mag7_risk_cascade",
            "file": "mag7_risk_cascade.png",
            "title": "MAG7 — portfolio risk cascade",
            "recipe": "run_gallery_mag7_risk_cascade",
        },
        {
            "id": "mag7_attribution_cascade",
            "file": "mag7_attribution_cascade.png",
            "title": "MAG7 — attribution cascade",
            "recipe": "run_gallery_mag7_attribution_cascade",
        },
    ]

    try:
        paths = run_gallery_all(client, out_dir)
    except Exception as e:
        _print_gallery_failure(e)
        return 2

    if len(paths) != len(meta):
        print(
            f"Warning: expected {len(meta)} outputs, got {len(paths)} (update manifest metadata).",
            file=sys.stderr,
        )

    manifest = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url_hint": base,
        "output_dir": str(out_dir.resolve()),
        "items": [
            {
                **meta[i],
                "path": str(paths[i].resolve()),
                "file": paths[i].name,
            }
            for i in range(min(len(meta), len(paths)))
        ],
    }
    if len(paths) > len(meta):
        for j in range(len(meta), len(paths)):
            manifest["items"].append(
                {
                    "id": f"extra_{j}",
                    "file": paths[j].name,
                    "title": paths[j].stem.replace("_", " ").title(),
                    "recipe": "run_gallery_all (unlisted)",
                    "path": str(paths[j].resolve()),
                }
            )
    manifest_path = out_dir / "gallery-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print("Wrote:", *[str(p) for p in paths], manifest_path, sep="\n  ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
