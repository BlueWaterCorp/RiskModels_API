#!/usr/bin/env python3
"""
RiskModels article demo — public API only (riskmodels.app).

Uses the published Python SDK (`riskmodels` / `riskmodels-py`). No internal data
feeds or private backends.

Setup:
  pip install riskmodels-py pandas
  # or from this repo: pip install -e ./sdk

Auth (pick one):
  export RISKMODELS_API_KEY=rm_...
  # or OAuth:
  export RISKMODELS_CLIENT_ID=... RISKMODELS_CLIENT_SECRET=...

Optional:
  export RISKMODELS_BASE_URL=https://riskmodels.app/api

This script loads `.env.local` / `.env` from the current working directory only for
variables that are not already set in the environment (so a bad `export` wins
until you `unset RISKMODELS_API_KEY`).
"""

from __future__ import annotations

import json
import os
import re
import sys

from riskmodels import APIError, RiskModelsClient

# API keys are long-lived Bearer tokens (see OPENAPI BearerAuth: rm_agent_* / rm_user_*).
_KEY_RE = re.compile(r"^rm_(?:agent|user)_[a-z0-9_]+$", re.IGNORECASE)


def _wrong_key_hint(key: str) -> str | None:
    """Spot common mix-ups (same shell as other tools / .env)."""
    if key.startswith("re_"):
        return (
            "This value looks like a Vercel `re_...` token — not RiskModels. "
            "Use a key that starts with `rm_agent_` or `rm_user_` from riskmodels.app (Account → Usage)."
        )
    if key.startswith("sk-"):
        return "This looks like an OpenAI-style `sk-...` key. RiskModels keys use the `rm_` prefix."
    if key.startswith("rm_") and not _KEY_RE.match(key):
        return "Starts with `rm_` but shape does not match `rm_agent_*` / `rm_user_*` — paste the full key from the portal."
    return None


def _load_dotenv_file(path: str) -> None:
    """Load KEY=value lines into os.environ if the key is not already set."""
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            if "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip()
            if v.startswith('"') and v.endswith('"'):
                v = v[1:-1]
            elif v.startswith("'") and v.endswith("'"):
                v = v[1:-1]
            if k and k not in os.environ:
                os.environ[k] = v


def _load_local_env() -> None:
    """Pick up .env.local from cwd (Next.js convention) so `python ...` works without manual export."""
    root = os.getcwd()
    _load_dotenv_file(os.path.join(root, ".env.local"))
    _load_dotenv_file(os.path.join(root, ".env"))


def _print_auth_help() -> None:
    key = os.environ.get("RISKMODELS_API_KEY")
    if key is not None:
        key = key.strip()
    print("\n  Auth help (billed endpoints failed):")
    print("    • Export a real API key in this shell, e.g.")
    print("        export RISKMODELS_API_KEY='rm_agent_live_...'")
    print("      (from https://riskmodels.app/get-key — Account → Usage after login)")
    if key:
        ok = bool(_KEY_RE.match(key))
        preview = key[:24] + "…" if len(key) > 24 else key
        print(f"    • Current RISKMODELS_API_KEY prefix: {preview!r} — {'looks OK' if ok else 'format may be wrong'}")
        hint = _wrong_key_hint(key)
        if hint:
            print(f"    • {hint}")
    else:
        print("    • RISKMODELS_API_KEY is not set in the environment.")
    print("    • Or run from repo root so `.env.local` is loaded (this script loads it if vars are unset).")
    print("    • OAuth: set RISKMODELS_CLIENT_ID and RISKMODELS_CLIENT_SECRET instead.")


class ArticleDemo:
    """Demonstrates article concepts using the public RiskModels API."""

    auth_ok: bool

    # Large, liquid names — stable sector exposures; NVDA/TSLA are valid tickers but often
    # noisier (valuation, idiosyncratic factor) for demo screenshots and ER completeness.
    DEMO_METRICS_TICKER = "AAPL"
    PORTFOLIO = {
        "AAPL": {"shares": 100},
        "MSFT": {"shares": 120},
        "JPM": {"shares": 180},
        "XOM": {"shares": 280},
    }

    def __init__(self) -> None:
        self.client = RiskModelsClient.from_env()
        print("✓ Client ready")
        print(f"  Base URL: {os.environ.get('RISKMODELS_BASE_URL', 'https://riskmodels.app/api')}")
        self.auth_ok = self._preflight_auth()

    def _preflight_auth(self) -> bool:
        """Billed routes require a valid Bearer key or OAuth; /tickers does not."""
        try:
            self.client._transport.request("GET", "/balance")
            return True
        except APIError as e:
            code = getattr(e, "status_code", None)
            if code == 402:
                print("  Note: /balance returned 402 (insufficient balance) — key is accepted.")
                return True
            if code in (401, 403):
                print("  ⚠️  /balance rejected credentials — batch/metrics need a valid key or OAuth.")
                _print_auth_help()
                return False
            print(f"  ⚠️  /balance: {e}")
            return False

    def _get_json(self, path: str) -> dict | None:
        """GET a public JSON endpoint (SDK transport handles Bearer / OAuth)."""
        body, _, _ = self.client._transport.request("GET", path)
        return body if isinstance(body, dict) else None

    def test_endpoint(self, name: str, path: str) -> dict | None:
        print(f"\n  Testing {name} ({path})...")
        try:
            result = self._get_json(path)
            if result is None:
                print("  ⚠️  Empty response")
                return None
            keys = list(result.keys())[:8]
            print(f"  ✓ Success — sample keys: {keys}")
            return result
        except APIError as e:
            print(f"  ⚠️  {e}")
            return None

    def run(self) -> None:
        print("\n" + "=" * 60)
        print("RISKMODELS API DEMO (public)")
        print("=" * 60)

        if self.auth_ok:
            bal = self.test_endpoint("Balance", "/balance")
            if bal and "balance_usd" in bal:
                print(f"  Balance: ${bal.get('balance_usd', 'N/A')}")

            print(f"\n  Testing Metrics {self.DEMO_METRICS_TICKER} (SDK get_metrics)...")
            try:
                # validate="warn" surfaces ER sum / market HR sign issues for API/data QA.
                row = self.client.get_metrics(self.DEMO_METRICS_TICKER, validate="warn")
                if isinstance(row, dict):
                    sample = {k: row[k] for k in list(row)[:6]}
                    print(f"  ✓ Success — sample fields: {json.dumps(sample, default=str)[:200]}...")
            except APIError as e:
                print(f"  ⚠️  {e}")
        else:
            print("\n  Skipping balance and metrics (fix auth first).")

        print("\n  Testing ticker universe (GET /tickers, mag7)...")
        try:
            df = self.client.search_tickers(mag7=True, as_dataframe=True)
            print(f"  ✓ MAG7 rows: {len(df)}")
        except APIError as e:
            print(f"  ⚠️  {e}")

        tickers = list(self.PORTFOLIO.keys())
        shares = {t: float(d["shares"]) for t, d in self.PORTFOLIO.items()}

        if self.auth_ok:
            print("\n  Testing POST /batch/analyze (SDK batch_analyze)...")
            try:
                batch = self.client.batch_analyze(
                    tickers,
                    ["full_metrics", "hedge_ratios"],
                    years=1,
                    format="json",
                )
                if isinstance(batch, dict):
                    results = batch.get("results") or {}
                    print(f"  ✓ Tickers in results: {list(results.keys())[:8]}")
            except APIError as e:
                print(f"  ⚠️  {e}")

            print("\n  Testing portfolio aggregation (SDK analyze_portfolio)...")
            try:
                pa = self.client.analyze_portfolio(shares, validate="warn")
                phr = pa.portfolio_hedge_ratios
                l3_keys = ("l3_market_hr", "l3_sector_hr", "l3_subsector_hr")
                l3_sample = {k: phr.get(k) for k in l3_keys}
                print(f"  ✓ Portfolio hedge ratios (L3 w-mean): {l3_sample}")
                if not pa.per_ticker.empty:
                    print(f"  ✓ per_ticker columns: {list(pa.per_ticker.columns)[:10]}")
            except APIError as e:
                print(f"  ⚠️  {e}")
        else:
            print("\n  Skipping batch analyze and portfolio (fix auth first).")

        print("\n" + "=" * 60)
        print("DONE")
        print("=" * 60)


def main() -> None:
    try:
        _load_local_env()
        demo = ArticleDemo()
        demo.run()
    except ValueError as e:
        print(f"\n❌ Configuration error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
