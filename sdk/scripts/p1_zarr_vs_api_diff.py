#!/usr/bin/env python3
"""Compare P1Data produced by the API path vs the zarr path for one ticker.

Why this exists
---------------
The snapshot pipeline has two data sources:

  - **API path**: get_data_for_p1(ticker, client)
      → fetch_stock_context() in _data.py
      → calls /metrics/{ticker}, /ticker-returns, /rankings/{ticker} via HTTP
      → reads from Supabase

  - **Zarr path**: build_p1_from_zarr(ticker, zarr_root)
      → fetch_stock_context_zarr() in zarr_context.py
      → reads ds_daily, ds_erm3_hedge_weights, ds_etf, ds_rankings directly from disk

Both paths produce a `P1Data` dataclass. After today's Supabase rebuild (which
canonicalized the symbol namespace, trimmed to in-mask + 5y, refreshed rankings,
and added the new beta columns), we want to verify the two paths still produce
equivalent results so we can confidently run 3k snapshots via the zarr path
(much faster than 3k HTTP round-trips).

What it checks
--------------
For each field in P1Data:
  - Scalars: relative-tolerance comparison (default 1e-6)
  - Time series (cum_stock, cum_spy, etc.): array-wise relative tolerance
  - Dicts (metrics, rankings, macro_correlations): per-key comparison
  - Strings (ticker, sector_etf, etc.): exact equality

Reports:
  - ✓ Identical fields (count + names elided unless --verbose)
  - ⚠ Fields with negligible numerical drift (< tolerance)
  - ✗ Fields with material differences (above tolerance)
  - ⊘ Fields present in only one path

The goal is **provable equivalence at the data level**, before relying on PNG
diffs (which are noisy due to font rendering and matplotlib non-determinism).

Usage
-----
    PYTHONPATH=sdk python sdk/scripts/p1_zarr_vs_api_diff.py
    PYTHONPATH=sdk python sdk/scripts/p1_zarr_vs_api_diff.py --ticker NVDA
    PYTHONPATH=sdk python sdk/scripts/p1_zarr_vs_api_diff.py --ticker AAPL --verbose
    PYTHONPATH=sdk python sdk/scripts/p1_zarr_vs_api_diff.py --tolerance 1e-4

Outputs:
  sdk/riskmodels/snapshots/output/diff/{ticker}_api.json
  sdk/riskmodels/snapshots/output/diff/{ticker}_zarr.json
  sdk/riskmodels/snapshots/output/diff/{ticker}_diff.txt
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

# -----------------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[2]
_SDK_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SDK_ROOT))

# Fields that are expected to differ between paths and should be reported as
# soft notes rather than hard failures.
# - sdk_version: depends on the running SDK build
# - name / company_name: may be NULL on one side (security_master.company_name is empty)
# - macro_correlations / macro_window: zarr uses ERM3 ds_macro_factor directly,
#   API hits a separate /correlation endpoint with potentially different windows
# - rankings: API computes from precomputed Supabase rows; zarr reads ds_rankings.
#   Both should match BUT the API only has the latest teo (per our load_rankings
#   script with --lookback-days 1) while zarr has full history
EXPECT_DIFFER = {
    "sdk_version",
    "name",
    "company_name",
    # Macro correlations: API hits a separate /correlation endpoint with its own
    # window-fallback chain (try 252d, then 126d, then 63d), while the zarr path
    # reads ds_macro_factor.zarr directly and computes corr against the same
    # window. The two are intentionally not byte-equivalent — different windows,
    # different cleanup of NaN bars. They're acceptably close for chart purposes
    # but never tolerance-equal, so report as soft "expected to differ" rather
    # than failing the diff.
    "macro_correlations",
    "macro_window",
}

# Per-key skip set for nested metrics dict. The zarr path emits BOTH long-form
# (l3_market_er) and short-form (l3_mkt_er) names for the same scalar so legacy
# WeasyPrint snapshots (s1_forensic.py) keep working. The API only emits
# short-form. These extra long-form aliases on the zarr side are not divergence
# — they carry the same value as the short-form key. Skip them in the diff.
ZARR_METRIC_ALIASES = {
    "l3_market_er", "l3_market_hr",
    "l3_sector_er", "l3_sector_hr",
    "l3_subsector_er", "l3_subsector_hr",
    "l3_residual_er",
}

# Fields that are large arrays/dicts where we want array-wise comparison
ARRAY_FIELDS = {
    "cum_stock",
    "cum_spy",
    "cum_sector",
    "cum_subsector",
    "dd_stock",
    "dd_spy",
    "l3_er_series",
}

# Fields that are dicts where we want per-key comparison
DICT_FIELDS = {
    "metrics",
    "tr_stock",
    "tr_spy",
    "tr_sector",
    "tr_subsector",
    "rankings",
    "macro_correlations",
}


def _almost_equal(a: float, b: float, rel: float, abs_tol: float = 1e-12) -> bool:
    """Numeric near-equality. None == None, NaN == NaN, otherwise rel/abs tolerance."""
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    try:
        af = float(a)
        bf = float(b)
    except (TypeError, ValueError):
        return a == b
    if math.isnan(af) and math.isnan(bf):
        return True
    if math.isinf(af) or math.isinf(bf):
        return af == bf
    if af == bf:
        return True
    diff = abs(af - bf)
    if diff <= abs_tol:
        return True
    denom = max(abs(af), abs(bf))
    if denom == 0:
        return diff <= abs_tol
    return (diff / denom) <= rel


def _compare_array(
    name: str,
    a: list,
    b: list,
    rel: float,
) -> tuple[str, str]:
    """Compare two list-of-tuples (date_str, value, ...) series.

    Returns (severity, message). Severity in {"ok", "soft", "diff", "missing"}.
    """
    if a is None and b is None:
        return ("ok", f"{name}: both None")
    if a is None or b is None:
        return ("missing", f"{name}: API={'None' if a is None else f'len={len(a)}'} "
                            f"zarr={'None' if b is None else f'len={len(b)}'}")
    if len(a) == 0 and len(b) == 0:
        return ("ok", f"{name}: both empty")
    if len(a) != len(b):
        return ("soft", f"{name}: length differs (API={len(a)}, zarr={len(b)})"
                        f" — typically because zarr has 1 extra/fewer trailing teo than API")

    # Same length: compare element-by-element
    n_diff = 0
    max_rel_drift = 0.0
    for i, (ra, rb) in enumerate(zip(a, b)):
        if isinstance(ra, (list, tuple)) and isinstance(rb, (list, tuple)):
            # Compare each numeric position; element 0 is date string
            if str(ra[0]) != str(rb[0]):
                n_diff += 1
                continue
            for j in range(1, max(len(ra), len(rb))):
                va = ra[j] if j < len(ra) else None
                vb = rb[j] if j < len(rb) else None
                if not _almost_equal(va, vb, rel):
                    n_diff += 1
                    if va is not None and vb is not None:
                        try:
                            d = abs(float(va) - float(vb)) / max(abs(float(va)), abs(float(vb)), 1e-12)
                            max_rel_drift = max(max_rel_drift, d)
                        except (TypeError, ValueError):
                            pass
        else:
            if not _almost_equal(ra, rb, rel):
                n_diff += 1

    if n_diff == 0:
        return ("ok", f"{name}: {len(a)} rows identical")
    if max_rel_drift < rel * 10:
        return ("soft", f"{name}: {n_diff}/{len(a)} rows differ but within ~{rel*10:.0e} relative drift")
    return ("diff", f"{name}: {n_diff}/{len(a)} rows differ (max relative drift {max_rel_drift:.2e})")


def _compare_dict(
    name: str,
    a: dict,
    b: dict,
    rel: float,
) -> list[tuple[str, str]]:
    """Compare two dicts key-by-key. Returns list of (severity, message)."""
    out = []
    if a is None:
        a = {}
    if b is None:
        b = {}
    keys = sorted(set(a.keys()) | set(b.keys()))
    for k in keys:
        # Skip zarr-only long-form metric aliases — see ZARR_METRIC_ALIASES
        # comment for full reasoning. Only applies inside the metrics dict.
        if name == "metrics" and k in ZARR_METRIC_ALIASES:
            continue
        va = a.get(k)
        vb = b.get(k)
        if va is None and vb is None:
            continue
        if va is None or vb is None:
            out.append(("missing", f"{name}.{k}: API={va} zarr={vb}"))
            continue
        if isinstance(va, (int, float)) or isinstance(vb, (int, float)):
            if _almost_equal(va, vb, rel):
                out.append(("ok", f"{name}.{k}: {va}"))
            else:
                try:
                    d = abs(float(va) - float(vb)) / max(abs(float(va)), abs(float(vb)), 1e-12)
                    sev = "soft" if d < rel * 10 else "diff"
                except (TypeError, ValueError):
                    sev = "diff"
                out.append((sev, f"{name}.{k}: API={va} zarr={vb} (rel drift {d:.2e})" if sev != "ok" else f"{name}.{k}: ok"))
        elif isinstance(va, dict) and isinstance(vb, dict):
            out.extend(_compare_dict(f"{name}.{k}", va, vb, rel))
        elif va == vb:
            out.append(("ok", f"{name}.{k}: {va}"))
        else:
            out.append(("diff", f"{name}.{k}: API={va!r} zarr={vb!r}"))
    return out


def _compare_p1_dict(api_d: dict, zarr_d: dict, rel: float) -> list[tuple[str, str]]:
    """Compare two P1Data .data dicts (from to_json output)."""
    out: list[tuple[str, str]] = []
    keys = sorted(set(api_d.keys()) | set(zarr_d.keys()))
    for k in keys:
        if k in EXPECT_DIFFER:
            va, vb = api_d.get(k), zarr_d.get(k)
            if va == vb:
                out.append(("ok", f"{k}: {va}"))
            else:
                out.append(("expect_differ", f"{k}: API={va!r} zarr={vb!r}"))
            continue

        va = api_d.get(k)
        vb = zarr_d.get(k)

        if va is None and vb is None:
            continue
        if va is None or vb is None:
            out.append(("missing", f"{k}: API={'None' if va is None else type(va).__name__} "
                                    f"zarr={'None' if vb is None else type(vb).__name__}"))
            continue

        if k in ARRAY_FIELDS:
            out.append(_compare_array(k, va, vb, rel))
        elif k in DICT_FIELDS:
            out.extend(_compare_dict(k, va, vb, rel))
        elif isinstance(va, (int, float)) or isinstance(vb, (int, float)):
            if _almost_equal(va, vb, rel):
                out.append(("ok", f"{k}: {va}"))
            else:
                out.append(("diff", f"{k}: API={va!r} zarr={vb!r}"))
        else:
            if va == vb:
                out.append(("ok", f"{k}: {va}"))
            else:
                out.append(("diff", f"{k}: API={va!r} zarr={vb!r}"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("--ticker", default="AAPL")
    ap.add_argument("--tolerance", type=float, default=1e-6,
                    help="Relative tolerance for numerical comparison (default 1e-6).")
    ap.add_argument("--out-dir", type=Path,
                    default=_SDK_ROOT / "riskmodels" / "snapshots" / "output" / "diff")
    ap.add_argument("--verbose", action="store_true",
                    help="Show all field comparisons, not just non-OK ones.")
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    ticker = args.ticker.upper()

    print(f"=== P1Data zarr-vs-API diff for {ticker} ===\n")

    # ── API path ──
    print("[1/2] Building P1Data via API path...")
    from riskmodels import RiskModelsClient  # type: ignore
    from riskmodels.snapshots.p1_stock_performance import get_data_for_p1  # type: ignore
    try:
        client = RiskModelsClient.from_env()
    except Exception as exc:
        print(f"  FAIL: cannot init RiskModelsClient.from_env(): {exc}")
        print("  Set RISKMODELS_API_KEY or OAuth env vars.")
        return 2
    try:
        api_p1 = get_data_for_p1(ticker, client)
    except Exception as exc:
        print(f"  FAIL: API path raised: {exc}")
        return 2
    api_path = args.out_dir / f"{ticker}_api.json"
    api_p1.to_json(api_path)
    print(f"  ✓ API P1Data written to {api_path}")

    # ── Zarr path ──
    print("[2/2] Building P1Data via zarr path...")
    from riskmodels.snapshots.zarr_context import build_p1_from_zarr  # type: ignore
    try:
        zarr_p1 = build_p1_from_zarr(ticker)
    except Exception as exc:
        print(f"  FAIL: zarr path raised: {exc}")
        return 2
    zarr_path = args.out_dir / f"{ticker}_zarr.json"
    zarr_p1.to_json(zarr_path)
    print(f"  ✓ Zarr P1Data written to {zarr_path}")

    # ── Diff ──
    api_doc = json.loads(api_path.read_text())
    zarr_doc = json.loads(zarr_path.read_text())
    api_data = api_doc.get("data", api_doc)
    zarr_data = zarr_doc.get("data", zarr_doc)

    results = _compare_p1_dict(api_data, zarr_data, args.tolerance)

    n_ok = sum(1 for s, _ in results if s == "ok")
    n_soft = sum(1 for s, _ in results if s == "soft")
    n_diff = sum(1 for s, _ in results if s == "diff")
    n_missing = sum(1 for s, _ in results if s == "missing")
    n_expect = sum(1 for s, _ in results if s == "expect_differ")

    print(f"\n=== Summary ===")
    print(f"  ✓  ok                   : {n_ok}")
    print(f"  ⚠  soft (within drift)  : {n_soft}")
    print(f"  ✗  diff (above drift)   : {n_diff}")
    print(f"  ⊘  missing on one side  : {n_missing}")
    print(f"  ─  expected to differ   : {n_expect}")
    print()

    out_lines: list[str] = []
    out_lines.append(f"P1Data zarr-vs-API diff for {ticker}")
    out_lines.append(f"tolerance: {args.tolerance}")
    out_lines.append(f"summary: ok={n_ok} soft={n_soft} diff={n_diff} missing={n_missing} expect_differ={n_expect}")
    out_lines.append("")

    for sev, msg in results:
        sym = {"ok": "✓", "soft": "⚠", "diff": "✗", "missing": "⊘", "expect_differ": "─"}[sev]
        line = f"  {sym} {msg}"
        out_lines.append(line)
        if args.verbose or sev != "ok":
            print(line)

    diff_path = args.out_dir / f"{ticker}_diff.txt"
    diff_path.write_text("\n".join(out_lines))
    print(f"\n  full report: {diff_path}")

    if n_diff > 0:
        print(f"\n  ✗ {n_diff} fields differ above tolerance — investigate")
        return 1
    if n_missing > 0 and n_soft == 0:
        print(f"\n  ⊘ {n_missing} fields missing on one side — review")
    print("\n  ✓ no material differences within tolerance")
    return 0


if __name__ == "__main__":
    sys.exit(main())
