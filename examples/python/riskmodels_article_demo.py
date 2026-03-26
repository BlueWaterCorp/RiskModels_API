#!/usr/bin/env python3
"""
RiskModels article demo — public API only (riskmodels.app).

Uses the published Python SDK (`riskmodels` / `riskmodels-py`). No internal data
feeds or private backends.

Setup:
  pip install riskmodels-py pandas
  # optional (10y chart: per-ticker + share-weighted portfolio cumulative returns):
  pip install matplotlib
  # or from this repo: pip install -e ./sdk

Auth (pick one):
  export RISKMODELS_API_KEY=rm_...
  # or OAuth:
  export RISKMODELS_CLIENT_ID=... RISKMODELS_CLIENT_SECRET=...

Optional:
  export RISKMODELS_BASE_URL=https://riskmodels.app/api
  export RISKMODELS_DEMO_OUTPUT_DIR=.   # where PNG is written

This script loads `.env.local` / `.env` from the current working directory only for
variables that are not already set in the environment (so a bad `export` wins
until you `unset RISKMODELS_API_KEY`).
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pandas as pd

from riskmodels import APIError, RiskModelsClient
from riskmodels.mapping import (
    merge_batch_hedge_ratios_into_full_metrics,
    normalize_metrics_v3,
    omit_nan_float_fields,
)
from riskmodels.portfolio_math import normalize_positions

# API keys are long-lived Bearer tokens (see OPENAPI BearerAuth: rm_agent_* / rm_user_*).
_KEY_RE = re.compile(r"^rm_(?:agent|user)_[a-z0-9_]+$", re.IGNORECASE)

# History window for batch returns + cumulative portfolio chart (API max 15y).
RETURNS_YEARS = 10

_METRICS_TABLE_COLS = (
    "ticker",
    "date",
    "volatility",
    "l3_market_hr",
    "l3_sector_hr",
    "l3_subsector_hr",
    "l3_market_er",
    "l3_sector_er",
    "l3_subsector_er",
    "l3_residual_er",
    "market_cap",
    "close_price",
)


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


def _section(title: str) -> None:
    print("\n" + "─" * 72)
    print(f"  {title}")
    print("─" * 72)


def _print_df_table(df: pd.DataFrame, *, max_rows: int | None = None) -> None:
    if df.empty:
        print("  (empty)")
        return
    out = df if max_rows is None else df.head(max_rows)
    # Fixed-width monospace table
    with pd.option_context(
        "display.max_columns",
        None,
        "display.width",
        200,
        "display.max_colwidth",
        18,
        "display.float_format",
        lambda x: f"{x:,.6g}",
    ):
        print(out.to_string(index=False))


def _portfolio_daily_returns(
    returns_long: pd.DataFrame,
    weights: dict[str, float],
) -> tuple[pd.Series, pd.DataFrame]:
    """
    Share-normalized weights × daily gross returns; inner-join dates where all tickers have a row.
    Returns (portfolio daily return series indexed by date, wide panel used).
    """
    if returns_long.empty or "returns_gross" not in returns_long.columns:
        return pd.Series(dtype=float), returns_long
    df = returns_long.copy()
    df["ticker"] = df["ticker"].astype(str).str.upper()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["ticker", "date"]).drop_duplicates(subset=["ticker", "date"], keep="last")
    tickers = [t for t in weights if t in df["ticker"].unique()]
    if not tickers:
        return pd.Series(dtype=float), df
    sub = df[df["ticker"].isin(tickers)]
    wide = sub.pivot(index="date", columns="ticker", values="returns_gross")
    wide = wide[tickers].dropna(how="any").sort_index()
    w = pd.Series({t: weights[t] for t in tickers}, dtype=float)
    w = w / w.sum()
    port = wide.mul(w, axis=1).sum(axis=1)
    return port, wide


def _cumulative_total_return(daily: pd.Series) -> pd.Series:
    """Cumulative total return: prod(1+r)-1 over time."""
    if daily.empty:
        return daily
    return (1.0 + daily).cumprod() - 1.0


def _cumulative_total_return_by_ticker(wide: pd.DataFrame) -> pd.DataFrame:
    """Per-column cumulative total return; columns share the same date index (aligned panel)."""
    if wide.empty:
        return wide
    return wide.apply(_cumulative_total_return, axis=0)


def _save_cumulative_returns_multiline(
    cum_by_ticker: pd.DataFrame,
    cum_portfolio: pd.Series,
    *,
    out_path: Path,
    title: str,
) -> bool:
    """Plot each name's cumulative return plus the share-weighted portfolio (same start date)."""
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return False
    fig, ax = plt.subplots(figsize=(11, 5.5), layout="constrained")
    ax.axhline(0.0, color="#94a3b8", linewidth=0.8, linestyle="--")
    cmap = plt.get_cmap("tab10")
    for i, col in enumerate(cum_by_ticker.columns):
        s = cum_by_ticker[col].dropna()
        if s.empty:
            continue
        ax.plot(
            s.index,
            100.0 * s.values,
            color=cmap(i % 10),
            linewidth=1.0,
            alpha=0.9,
            label=str(col),
        )
    cp = cum_portfolio.dropna()
    if not cp.empty:
        ax.plot(
            cp.index,
            100.0 * cp.values,
            color="#0f172a",
            linewidth=2.0,
            linestyle="--",
            label="Portfolio (w-mean)",
        )
    ax.set_title(title)
    ax.set_xlabel("Date")
    ax.set_ylabel("Cumulative total return (%)")
    ax.grid(True, alpha=0.35)
    ax.legend(loc="upper left", fontsize=8, ncol=2)
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    return True


class ArticleDemo:
    """Demonstrates article concepts using the public RiskModels API."""

    auth_ok: bool

    # Large, liquid names across tech, financials, energy, and growth (NVDA/TSLA).
    DEMO_METRICS_TICKER = "AAPL"
    PORTFOLIO = {
        "AAPL": {"shares": 100},
        "MSFT": {"shares": 120},
        "NVDA": {"shares": 90},
        "TSLA": {"shares": 110},
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

    def run(self) -> None:
        print("\n" + "=" * 72)
        print("  RISKMODELS API DEMO (public)")
        print("=" * 72)

        tickers = list(self.PORTFOLIO.keys())
        shares = {t: float(d["shares"]) for t, d in self.PORTFOLIO.items()}
        weights = normalize_positions(shares)

        # --- Positions (always printable)
        _section("Portfolio positions (normalized weights)")
        pos_df = pd.DataFrame(
            [{"ticker": t, "shares": shares[t], "weight": weights[t]} for t in tickers]
        )
        pos_df["weight_pct"] = (pos_df["weight"] * 100.0).map(lambda x: f"{x:.2f}%")
        _print_df_table(pos_df.drop(columns=["weight"]).rename(columns={"weight_pct": "weight"}))

        if self.auth_ok:
            bal = self._get_json("/balance")
            _section("Account balance")
            if bal:
                bdf = pd.DataFrame(
                    [
                        {
                            "balance_usd": bal.get("balance_usd"),
                            "balance_tokens": bal.get("balance_tokens"),
                            "currency": bal.get("currency"),
                            "account_type": bal.get("account_type"),
                        }
                    ]
                )
                _print_df_table(bdf)
            else:
                print("  ⚠️  No balance payload")

            _section(f"Metrics snapshot — {self.DEMO_METRICS_TICKER} (SDK get_metrics)")
            try:
                row = self.client.get_metrics(self.DEMO_METRICS_TICKER, validate="warn")
                if isinstance(row, dict):
                    cols = [c for c in _METRICS_TABLE_COLS if c in row]
                    mdf = pd.DataFrame([{c: row.get(c) for c in cols}])
                    _print_df_table(mdf)
            except APIError as e:
                print(f"  ⚠️  {e}")
        else:
            print("\n  Skipping balance and metrics (fix auth first).")

        _section("Ticker universe (GET /tickers, mag7)")
        try:
            df = self.client.search_tickers(mag7=True, as_dataframe=True)
            if df.empty:
                print("  (empty)")
            else:
                mag = df.head(12)
                print(f"  Rows: {len(df)} (showing up to 12)\n")
                keep = [c for c in ("ticker", "name", "sector") if c in mag.columns]
                if keep:
                    _print_df_table(mag[keep])
                else:
                    _print_df_table(mag.iloc[:, : min(6, mag.shape[1])])
        except APIError as e:
            print(f"  ⚠️  {e}")

        if self.auth_ok:
            _section("POST /batch/analyze — fundamentals & hedge ratios (SDK batch_analyze)")
            try:
                batch = self.client.batch_analyze(
                    tickers,
                    ["full_metrics", "hedge_ratios"],
                    years=1,
                    format="json",
                )
                if isinstance(batch, dict):
                    results = batch.get("results") or {}
                    print(f"  Tickers in results: {list(results.keys())}\n")
                    rows_out: list[dict[str, object]] = []
                    for tk, entry in results.items():
                        if not isinstance(entry, dict) or entry.get("status") != "success":
                            continue
                        fm_raw = dict(entry.get("full_metrics") or {})
                        merged = merge_batch_hedge_ratios_into_full_metrics(
                            fm_raw,
                            entry.get("hedge_ratios"),
                        )
                        merged = omit_nan_float_fields(merged)
                        norm = normalize_metrics_v3(merged)
                        rows_out.append(
                            {
                                "ticker": tk,
                                "date": norm.get("date") or fm_raw.get("date"),
                                "l3_market_hr": norm.get("l3_market_hr"),
                                "l3_sector_hr": norm.get("l3_sector_hr"),
                                "l3_subsector_hr": norm.get("l3_subsector_hr"),
                                "l3_market_er": norm.get("l3_market_er"),
                                "l3_sector_er": norm.get("l3_sector_er"),
                                "l3_subsector_er": norm.get("l3_subsector_er"),
                            }
                        )
                    if rows_out:
                        _print_df_table(pd.DataFrame(rows_out))
            except APIError as e:
                print(f"  ⚠️  {e}")

            try:
                pa = self.client.analyze_portfolio(shares, validate="warn")
                phr = pa.portfolio_hedge_ratios
                pt = pa.per_ticker.reset_index(drop=True) if not pa.per_ticker.empty else pd.DataFrame()

                _section("Portfolio aggregation — L1 hedge ratios (SDK analyze_portfolio)")
                l1_port = {"l1_market_hr": phr.get("l1_market_hr")}
                print("  Holdings-weighted mean (portfolio):\n")
                _print_df_table(pd.DataFrame([l1_port]))
                if not pt.empty:
                    l1_cols = [c for c in ("ticker", "weight", "l1_market_hr") if c in pt.columns]
                    if len(l1_cols) > 2:
                        print("\n  Per name:\n")
                        _print_df_table(pt[l1_cols])

                _section("Portfolio aggregation — L2 hedge ratios (SDK analyze_portfolio)")
                l2_keys = ("l2_market_hr", "l2_sector_hr")
                l2_port = {k: phr.get(k) for k in l2_keys}
                print("  Holdings-weighted mean (portfolio):\n")
                _print_df_table(pd.DataFrame([l2_port]))
                if not pt.empty:
                    l2_cols = [c for c in ("ticker", "weight", *l2_keys) if c in pt.columns]
                    if len(l2_cols) > 2:
                        print("\n  Per name:\n")
                        _print_df_table(pt[l2_cols])

                _section("Portfolio aggregation — L3 hedge ratios (SDK analyze_portfolio)")
                l3_keys = ("l3_market_hr", "l3_sector_hr", "l3_subsector_hr")
                l3_port = {k: phr.get(k) for k in l3_keys}
                print("  Holdings-weighted mean (portfolio):\n")
                _print_df_table(pd.DataFrame([l3_port]))
                if not pt.empty:
                    l3_cols = [
                        c
                        for c in [
                            "ticker",
                            "weight",
                            "l3_market_hr",
                            "l3_sector_hr",
                            "l3_subsector_hr",
                        ]
                        if c in pt.columns
                    ]
                    if len(l3_cols) > 2:
                        print("\n  Per name:\n")
                        _print_df_table(pt[l3_cols])
            except APIError as e:
                print(f"  ⚠️  {e}")

            _section(f"Total return — last {RETURNS_YEARS} years (per ticker + portfolio)")
            out_dir = Path(os.environ.get("RISKMODELS_DEMO_OUTPUT_DIR", ".")).resolve()
            png_path = out_dir / "riskmodels_demo_cumulative_returns_portfolio_and_names_10y.png"
            try:
                raw = self.client.batch_analyze(
                    tickers,
                    ["returns"],
                    years=RETURNS_YEARS,
                    format="parquet",
                )
                if isinstance(raw, tuple):
                    ret_df, _lin = raw
                else:
                    ret_df = raw
                if not isinstance(ret_df, pd.DataFrame) or ret_df.empty:
                    print("  ⚠️  No returns rows from batch (parquet).")
                else:
                    port_daily, wide = _portfolio_daily_returns(ret_df, weights)
                    cum_port = _cumulative_total_return(port_daily)
                    cum_by_name = _cumulative_total_return_by_ticker(wide)
                    if cum_port.empty:
                        print("  ⚠️  Could not align daily returns across all names (missing dates).")
                    else:
                        total = float(cum_port.iloc[-1])
                        n_years = RETURNS_YEARS
                        cagr = (1.0 + total) ** (1.0 / n_years) - 1.0 if n_years > 0 else float("nan")
                        stats = pd.DataFrame(
                            [
                                {
                                    "trading_days": len(cum_port),
                                    "start": str(cum_port.index.min().date()),
                                    "end": str(cum_port.index.max().date()),
                                    "total_return": total,
                                    "total_return_pct": total * 100.0,
                                    f"cagr_{n_years}y": cagr,
                                    "cagr_pct": cagr * 100.0,
                                }
                            ]
                        )
                        print("  Portfolio summary (share-weighted daily returns):\n")
                        _print_df_table(stats)
                        if _save_cumulative_returns_multiline(
                            cum_by_name,
                            cum_port,
                            out_path=png_path,
                            title=(
                                f"Cumulative total return by name + portfolio ({RETURNS_YEARS}y, "
                                "same calendar dates; weights = share counts normalized)"
                            ),
                        ):
                            print(f"\n  Chart saved: {png_path}")
                        else:
                            print(
                                "\n  (Install matplotlib to write PNG: pip install matplotlib)\n"
                                f"  Intended path: {png_path}"
                            )
            except APIError as e:
                print(f"  ⚠️  {e}")
        else:
            print("\n  Skipping batch analyze, portfolio, and returns history (fix auth first).")

        print("\n" + "=" * 72)
        print("  DONE")
        print("=" * 72)


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
