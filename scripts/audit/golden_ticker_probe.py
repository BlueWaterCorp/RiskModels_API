"""Golden-ticker probe: call the live API for a few complete names and check the numbers.

RMAPI-30 returned beta_to_spy = 0 on every sector leg for months. Every response was a
200, so smoke tests that check status codes passed. This probe checks values, on names
whose inputs are complete:

  hedge-basket   every hedge leg has a finite, nonzero beta_to_spy, or a data-quality flag
                 explaining the null; a hedge level is recommended; as_of = release session
  decompose      market + sector + subsector + residual ER sum to 1; teo = release session;
                 no hedge ratio is exactly 0
  metrics        L1, L2 and L3 ER each sum to 1; a hedge level is recommended; no level is
                 incomplete; teo = release session; no hedge ratio or ER is exactly 0
  batch/analyze  status ok; date = release session; no hedge ratio is exactly 0

The release session is the newest teo of ds_daily.zarr on GCS (scripts/audit/store_freshness.py).

Usage:
  RISKMODELS_API_KEY=... python scripts/audit/golden_ticker_probe.py
  RISKMODELS_BASE_URL (default https://riskmodels.app/api), PROBE_TICKERS (default NVDA,XOM,CAT),
  PROBE_SESSION=YYYY-MM-DD to skip the GCS read. Exit 1 on any failure. Each call is billed.
"""

from __future__ import annotations

import json
import math
import os
import sys
import urllib.error
import urllib.request

TOL = 1e-6


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def check_hedge_basket(resp: dict, session: str) -> list[str]:
    out = []
    if resp.get("as_of") != session:
        out.append(f"as_of {resp.get('as_of')} != release session {session}")
    if resp.get("recommended_hedge_level") is None:
        out.append("recommended_hedge_level is null")
    flags = resp.get("data_quality_flags") or []
    for leg in (resp.get("legs") or [])[1:]:  # legs[0] is the stock itself
        b = leg.get("beta_to_spy")
        if _finite(b) and b != 0:
            continue
        if b is None and any("link_beta" in f or "beta" in f for f in flags):
            continue
        out.append(f"leg {leg.get('leg')}: beta_to_spy={b!r} with no explaining flag ({flags})")
    return out


def check_decompose(resp: dict, session: str) -> list[str]:
    out = []
    if resp.get("teo") != session:
        out.append(f"teo {resp.get('teo')} != release session {session}")
    exp = resp.get("exposure") or {}
    ers = [(exp.get(k) or {}).get("er") for k in ("market", "sector", "subsector", "residual")]
    if not all(_finite(e) for e in ers):
        out.append(f"missing ER component: {ers}")
    elif abs(sum(ers) - 1.0) > TOL:
        out.append(f"ER shares sum to {sum(ers):.9f}, not 1")
    for k in ("market", "sector", "subsector"):
        if (exp.get(k) or {}).get("hr") == 0:
            out.append(f"{k} hedge ratio is exactly 0")
    return out


def check_metrics(resp: dict, session: str) -> list[str]:
    out = []
    if resp.get("teo") != session:
        out.append(f"teo {resp.get('teo')} != release session {session}")
    hl = resp.get("hedge_levels") or {}
    if hl.get("recommended_level") is None:
        out.append("hedge_levels.recommended_level is null")
    if hl.get("incomplete_levels"):
        out.append(f"incomplete_levels {hl['incomplete_levels']}")
    for lvl in ("L1", "L2", "L3"):
        block = hl.get(lvl) or {}
        ers = [block.get(k) for k in ("market_er", "sector_er", "subsector_er", "residual_er")]
        present = [e for e in ers if e is not None]
        if not present or not all(_finite(e) for e in present):
            out.append(f"{lvl}: non-finite ER {ers}")
        elif abs(sum(present) - 1.0) > TOL:
            out.append(f"{lvl}: ER shares sum to {sum(present):.9f}, not 1")
        for k in ("market_hr", "sector_hr", "subsector_hr", "market_er", "sector_er", "subsector_er"):
            if block.get(k) == 0:
                out.append(f"{lvl}.{k} is exactly 0")
    return out


def check_batch(resp: dict, ticker: str, session: str) -> list[str]:
    r = (resp.get("results") or {}).get(ticker) or {}
    out = []
    if r.get("status") not in ("ok", "success"):
        out.append(f"status {r.get('status')!r} ({r.get('error_code')})")
        return out
    fm = r.get("full_metrics") or {}
    if fm.get("date") != session:
        out.append(f"full_metrics.date {fm.get('date')} != release session {session}")
    for k, v in (r.get("hedge_ratios") or {}).items():
        if v == 0:
            out.append(f"hedge_ratios.{k} is exactly 0")
    return out


def _call(base: str, key: str, method: str, path: str, body=None) -> dict:
    req = urllib.request.Request(
        base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def release_session() -> str:
    if os.environ.get("PROBE_SESSION"):
        return os.environ["PROBE_SESSION"]
    sys.path.insert(0, os.path.dirname(__file__))
    import gcsfs
    import store_freshness as sf

    return sf.latest_date(gcsfs.GCSFileSystem(), "ds_daily.zarr").isoformat()


def _load_env_files() -> None:
    """Same key lookup as the smoke test (.env, .env.local, BWMACRO env files)."""
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sys.path.insert(0, os.path.join(root, "sdk", "scripts"))
    try:
        import smoke_v3_all_endpoints as smoke

        smoke.load_env_files()
    except Exception:
        pass


def main() -> int:
    _load_env_files()
    key = os.environ.get("RISKMODELS_API_KEY")
    if not key:
        print("RISKMODELS_API_KEY is not set", file=sys.stderr)
        return 2
    base = os.environ.get("RISKMODELS_BASE_URL", "https://riskmodels.app/api").rstrip("/")
    tickers = [t.strip().upper() for t in os.environ.get("PROBE_TICKERS", "NVDA,XOM,CAT").split(",") if t.strip()]
    session = release_session()
    print(f"release session {session}; base {base}")
    fails = 0
    for t in tickers:
        checks = [
            ("hedge-basket", lambda: check_hedge_basket(_call(base, key, "GET", f"/hedge-basket/{t}"), session)),
            ("decompose", lambda: check_decompose(_call(base, key, "POST", "/decompose", {"ticker": t}), session)),
            ("metrics", lambda: check_metrics(_call(base, key, "GET", f"/metrics/{t}"), session)),
            ("batch/analyze", lambda: check_batch(_call(base, key, "POST", "/batch/analyze", {
                "tickers": [t], "metrics": ["full_metrics", "hedge_ratios"], "years": 1, "format": "json"}), t, session)),
        ]
        for route, fn in checks:
            try:
                problems = fn()
            except (urllib.error.URLError, ValueError) as exc:
                problems = [f"request failed: {exc}"]
            fails += bool(problems)
            print(f"{'FAIL' if problems else 'OK  '}  {t:5} {route:14} {'; '.join(problems)}")
    print(f"\n{fails} failing checks")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
