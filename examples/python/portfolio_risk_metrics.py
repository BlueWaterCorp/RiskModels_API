#!/usr/bin/env python3
"""
RiskModels SDK — Portfolio Risk Metrics

Computes portfolio-level risk metrics that don't ship with `analyze_portfolio`:

  - Tracking error vs SPY (annualized)
  - Marginal contribution to risk (MCR) per position
  - Factor-budget decomposition (variance share by L3 layer)
  - Diversification ratio (weighted-avg single-name vol / portfolio vol)
  - Concentration: Herfindahl index, effective number of names
  - Annualized return, vol, Sharpe (rf = 0 by default)

Always prints a per-ticker residual-Sharpe diagnostic on L3 residuals
(gross_return - l3_combined_factor_return) so the user can sanity-check the
factor model before drawing inferences from anything downstream.

Optional ``--optimize`` flag does walk-forward out-of-sample evaluation:

  1. Splits the history with ``--oos-split FRAC`` (default 0.75).
  2. Fits weights on the *train* slice of L3 residual returns using
     ``--mu-mode`` (default ``equal`` → constant μ + min-variance, the
     methodologically honest choice; ``historical`` → mean × 252 +
     max-Sharpe, which overfits in-sample and is kept for comparison only).
  3. Reports all metrics on both the in-sample (train) and out-of-sample
     (test) slices, then calls ``analyze_portfolio`` on the optimized
     weights for the implied L3 hedge ratios.

Auth: reads ``RISKMODELS_API_KEY`` from the environment (or ``.env.local``
at the repo root). Never hardcode keys.

pip install riskmodels-py pandas numpy xarray pyarrow
pip install PyPortfolioOpt        # only required for --optimize
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from dataclasses import dataclass

import numpy as np
import pandas as pd

from riskmodels import RiskModelsClient

TRADING_DAYS = 252

# ── Default portfolio (MAG6 + JPM + JNJ + XOM — multi-sector, ~equal-ish) ─────
DEFAULT_PORTFOLIO: dict[str, float] = {
    "AAPL":  0.15,
    "MSFT":  0.15,
    "NVDA":  0.15,
    "GOOG":  0.10,
    "AMZN":  0.10,
    "JPM":   0.15,
    "JNJ":   0.10,
    "XOM":   0.10,
}


# ── Data panel ────────────────────────────────────────────────────────────────
@dataclass
class Panel:
    """Aligned daily returns + rolling L3 HRs for the portfolio + SPY benchmark.

    The hedge-ratio series (``market_hr``, ``sector_hr``, ``subsector_hr``) are
    loaded for completeness — they're surfaced so callers extending this
    script can do hedge-implied analyses (residual-return decomposition with
    rolling HRs, hedge-stability checks, or optimizer constraints driven by
    factor exposures) without re-fetching the same daily series from
    ``get_dataset``. The metric path in this file does not consume them;
    residual returns are computed separately via ``compute_residual_returns``
    using ``get_ticker_returns`` so the residual is L3-combined-factor-return
    consistent with the published L3 model rather than reconstructed from
    HRs at this granularity.
    """
    returns: pd.DataFrame      # date × ticker, gross daily returns
    spy_returns: pd.Series      # date-indexed SPY daily returns
    market_hr: pd.DataFrame     # date × ticker, rolling L3 market HR
    sector_hr: pd.DataFrame
    subsector_hr: pd.DataFrame


def build_panel(client: RiskModelsClient, tickers: list[str], years: int) -> Panel:
    """Pull get_dataset() for the names + ticker_returns for SPY, align dates."""
    ds = client.get_dataset(tickers, years=years)

    def _wide(var: str) -> pd.DataFrame:
        if var not in ds.data_vars:
            raise KeyError(
                f"get_dataset missing data_var {var!r}; have {list(ds.data_vars)}"
            )
        # DataArray dims are (ticker, date) → transpose to (date × ticker)
        return ds[var].to_pandas().T.astype(float)

    rets = _wide("returns_gross")
    mhr  = _wide("l3_market_hr")
    shr  = _wide("l3_sector_hr")
    bhr  = _wide("l3_subsector_hr")
    rets.index = pd.to_datetime(rets.index)
    mhr.index  = pd.to_datetime(mhr.index)
    shr.index  = pd.to_datetime(shr.index)
    bhr.index  = pd.to_datetime(bhr.index)

    spy_df = client.get_ticker_returns("SPY", years=years)
    spy = (
        spy_df.assign(date=pd.to_datetime(spy_df["date"]))
        .set_index("date")["returns_gross"]
        .astype(float)
        .sort_index()
    )

    common = rets.dropna(how="any").index.intersection(spy.index)
    rets = rets.reindex(common)
    spy  = spy.reindex(common)
    mhr  = mhr.reindex(common)
    shr  = shr.reindex(common)
    bhr  = bhr.reindex(common)
    return Panel(rets, spy, mhr, shr, bhr)


def slice_panel(panel: Panel, idx: pd.DatetimeIndex) -> Panel:
    """Return a Panel restricted to ``idx`` (used for train/test splits)."""
    return Panel(
        returns=panel.returns.reindex(idx),
        spy_returns=panel.spy_returns.reindex(idx),
        market_hr=panel.market_hr.reindex(idx),
        sector_hr=panel.sector_hr.reindex(idx),
        subsector_hr=panel.subsector_hr.reindex(idx),
    )


def fetch_per_ticker_er(client: RiskModelsClient, tickers: list[str]) -> pd.DataFrame:
    """Latest L3 ER fractions per ticker via analyze_portfolio's per_ticker frame."""
    pa = client.analyze_portfolio({t: 1.0 / len(tickers) for t in tickers}, years=1)
    df = pa.per_ticker.copy()
    df["ticker"] = df["ticker"].str.upper()
    needed = ["l3_market_er", "l3_sector_er", "l3_subsector_er", "l3_residual_er"]
    for c in needed:
        if c not in df.columns:
            df[c] = float("nan")
    return df.set_index("ticker")[needed]


# ── Metrics ───────────────────────────────────────────────────────────────────
def compute_summary_stats(port_rets: pd.Series, rf: float = 0.0) -> dict[str, float]:
    """Annualized return / vol / Sharpe with a mixed-convention annualization.

    Convention used here (the de facto industry default; CFA-style):
        annualized_return = (1 + R̄_daily) ** 252 − 1        (compound)
        annualized_vol    = σ_daily × √252                    (square-root-of-time)
        sharpe            = (annualized_return − rf) / annualized_vol

    These two annualizations are not mathematically self-consistent — pure
    arithmetic Sharpe would use ``R̄_daily × 252`` in the numerator. We keep
    the compound return because it matches the cumulative-return narrative
    most readers expect, and label the convention explicitly in the printed
    output (see ``run_metrics``) so downstream comparisons are unambiguous.
    """
    daily_mean = float(port_rets.mean())
    daily_std  = float(port_rets.std(ddof=0))
    ann_ret = (1.0 + daily_mean) ** TRADING_DAYS - 1.0
    ann_vol = daily_std * math.sqrt(TRADING_DAYS)
    sharpe  = (ann_ret - rf) / ann_vol if ann_vol > 0 else float("nan")
    return {"annualized_return": ann_ret, "annualized_vol": ann_vol, "sharpe": sharpe}


def compute_tracking_error(port_rets: pd.Series, bench_rets: pd.Series) -> float:
    diff = (port_rets - bench_rets).dropna()
    return float(diff.std(ddof=0) * math.sqrt(TRADING_DAYS))


def compute_mcr(weights: pd.Series, cov: pd.DataFrame) -> tuple[pd.Series, float]:
    """Marginal contribution to (annualized) risk per position. Sums to port vol."""
    w = weights.reindex(cov.index).fillna(0.0).values
    Sigma = cov.values
    daily_var = float(w @ Sigma @ w)
    daily_vol = math.sqrt(daily_var) if daily_var > 0 else 0.0
    if daily_vol == 0:
        return pd.Series(0.0, index=cov.index), 0.0
    sigma_w = Sigma @ w
    mcr_daily = (w * sigma_w) / daily_vol           # vector, sums to daily_vol
    return (
        pd.Series(mcr_daily * math.sqrt(TRADING_DAYS), index=cov.index),
        daily_vol * math.sqrt(TRADING_DAYS),
    )


def compute_diversification_ratio(weights: pd.Series, cov: pd.DataFrame) -> float:
    sigmas = pd.Series(np.sqrt(np.diag(cov.values)), index=cov.index)
    weighted_avg_vol = float((weights.reindex(sigmas.index).fillna(0.0) * sigmas).sum())
    w = weights.reindex(cov.index).fillna(0.0).values
    port_vol = math.sqrt(float(w @ cov.values @ w))
    return weighted_avg_vol / port_vol if port_vol > 0 else float("nan")


def compute_concentration(weights: pd.Series) -> dict[str, float]:
    hhi = float((weights ** 2).sum())
    return {"herfindahl": hhi, "effective_n": (1.0 / hhi) if hhi > 0 else float("nan")}


def compute_factor_budget(
    weights: pd.Series, sigmas_daily: pd.Series, ers: pd.DataFrame,
) -> pd.Series:
    """Approximate share of portfolio variance from each L3 layer.

    Uses the additive approximation specified in the task brief:
        contribution_L  =  Σ_i w_i × σ_i² × ER_iL
        share_L         =  contribution_L / Σ_L contribution_L
    Ignores cross-asset covariance — i.e. it answers "if you summed up each
    name's own variance weighted by its ER share, where would the budget go?".
    """
    var_i = sigmas_daily ** 2
    raw = ers.multiply((weights * var_i).reindex(ers.index).fillna(0.0), axis=0).sum(axis=0)
    total = float(raw.sum())
    return raw / total if total > 0 else raw * 0.0


# ── Optimize on residuals (optional) ──────────────────────────────────────────
L3_CFR_COLS = ("l3_combined_factor_return", "l3_cfr")  # newer SDK / older SDK


def compute_residual_returns(
    client: RiskModelsClient, tickers: list[str], years: int, panel: Panel,
) -> pd.DataFrame:
    """L3 residual returns: gross_return - l3 combined-factor return, per ticker."""
    parts: dict[str, pd.Series] = {}
    for t in tickers:
        df = client.get_ticker_returns(t, years=years)
        cfr_col = next((c for c in L3_CFR_COLS if c in df.columns), None)
        if cfr_col is None:
            raise RuntimeError(
                f"{t}: ticker-returns response missing L3 combined-factor return "
                f"(looked for {L3_CFR_COLS}; got {list(df.columns)})"
            )
        s = (
            df.assign(date=pd.to_datetime(df["date"]))
            .set_index("date")
            .sort_index()
        )
        parts[t] = s["returns_gross"].astype(float) - s[cfr_col].astype(float)
    return pd.DataFrame(parts).reindex(panel.returns.index).dropna(how="any")


# ── Output ────────────────────────────────────────────────────────────────────
def print_section(title: str) -> None:
    print("\n" + "─" * 78)
    print(title)
    print("─" * 78)


def period_label(idx: pd.DatetimeIndex, kind: str, scope: str) -> str:
    """E.g. ``in-sample (full window: 2024-01-02 → 2026-04-29, 506 days)``."""
    if len(idx) == 0:
        return f"{kind} ({scope}: empty)"
    return f"{kind} ({scope}: {idx[0].date()} → {idx[-1].date()}, {len(idx)} days)"


def _row(label: str, value: str, formula: str | None = None) -> str:
    """Format ``label …… value`` with optional indented formula line."""
    line = f"  {label:<46}{value:>12}"
    if formula:
        line += f"\n      = {formula}"
    return line


def print_residual_sharpe_diagnostic(residuals: pd.DataFrame) -> None:
    """Per-ticker annualized Sharpe on L3 residuals — sanity check on the factor model.

    If the L3 factors are doing their job the residuals should look like noise:
    Sharpes near zero, distributed symmetrically around the mean. Wide dispersion
    is a tell that the factor model is missing return drivers, or that the window
    is too short to be reliable.
    """
    daily_mean = residuals.mean()
    daily_std  = residuals.std(ddof=0)
    ann_ret  = (1.0 + daily_mean) ** TRADING_DAYS - 1.0
    ann_vol  = daily_std * math.sqrt(TRADING_DAYS)
    sharpe   = ann_ret / ann_vol.where(ann_vol > 0)

    print_section("Residual Sharpe diagnostic")
    print("Per-ticker annualized Sharpe on L3 residuals:")
    for tkr in sharpe.index:
        s = float(sharpe.loc[tkr])
        sign = "+" if s >= 0 else "-"
        print(f"  {tkr:<6}  {sign}{abs(s):.2f}")
    print(
        f"\n  Mean: {sharpe.mean():+.2f}  |  Std: {sharpe.std(ddof=0):.2f}  |  "
        f"Min: {sharpe.min():+.2f}  |  Max: {sharpe.max():+.2f}"
    )
    print(
        "\nNote: residuals should cluster near zero. Wide dispersion suggests\n"
        "the factor model is missing return drivers, or the window is too short."
    )
    print(
        "Convention: diagnostic uses raw residual Sharpe (no rf subtraction) —\n"
        "residuals are factor-orthogonal returns and the benchmark is zero, not rf.\n"
        "Portfolio-level Sharpe blocks below respect --rf as set on the CLI."
    )


def run_metrics(
    label: str,
    weights: pd.Series,
    panel: Panel,
    er_table: pd.DataFrame,
    rf: float,
    period_note: str | None = None,
) -> None:
    """Compute and print the full metric block for a given weight vector + window.

    ``period_note`` is shown right under the section header so the reader can
    tell at a glance whether they're looking at in-sample, train-slice, or
    test-slice numbers.
    """
    rets = panel.returns[weights.index]
    cov  = rets.cov(ddof=0)
    sigmas_daily = rets.std(ddof=0)
    port_rets    = rets.mul(weights, axis=1).sum(axis=1)

    summary = compute_summary_stats(port_rets, rf=rf)
    te      = compute_tracking_error(port_rets, panel.spy_returns.reindex(port_rets.index))
    mcr_ann, port_vol_ann = compute_mcr(weights, cov)
    div_ratio = compute_diversification_ratio(weights, cov)
    conc      = compute_concentration(weights)
    fbudget   = compute_factor_budget(weights, sigmas_daily, er_table.reindex(weights.index))

    print_section(f"{label} — portfolio summary")
    if period_note:
        print(f"Period: {period_note}\n")
    print(_row("Annualized return", f"{summary['annualized_return']*100:.2f}%"))
    print(_row("Annualized vol",    f"{summary['annualized_vol']*100:.2f}%"))
    print(_row(
        f"Sharpe (annualized, rf={rf:.2%})",
        f"{summary['sharpe']:.3f}",
        "((1 + R̄_daily)^252 - 1 - rf) / (σ_daily × √252)  — compound return / √n vol",
    ))
    print(_row(
        "Tracking error vs SPY (annualized)",
        f"{te*100:.2f}%",
        "std(port - SPY) × √252",
    ))
    print(_row(
        "Diversification ratio",
        f"{div_ratio:.3f}",
        "Σᵢ wᵢσᵢ / σ_p   (>1 means covariance is helping)",
    ))
    print(_row("Herfindahl index", f"{conc['herfindahl']:.4f}", "Σᵢ wᵢ²"))
    print(_row("Effective # of names", f"{conc['effective_n']:.2f}", "1 / HHI"))

    print_section(f"{label} — marginal contribution to risk (annualized)")
    if period_note:
        print(f"Period: {period_note}\n")
    pct = (mcr_ann / port_vol_ann) if port_vol_ann > 0 else mcr_ann * 0
    mcr_df = pd.DataFrame({
        "weight":      weights.round(4),
        "single_vol":  (sigmas_daily * math.sqrt(TRADING_DAYS)).round(4),
        "MCR":         mcr_ann.round(5),
        "% port vol":  (pct * 100).round(2),
    }).loc[weights.index]
    print(mcr_df.to_string())
    print(f"\nSum(MCR) = {mcr_ann.sum():.5f}   (matches port vol {port_vol_ann:.5f})")
    print("MCRᵢ = wᵢ × (Σw)ᵢ / σ_p   (per-position MCRs sum to portfolio vol)")

    print_section(f"{label} — factor-budget decomposition (% of total)")
    if period_note:
        print(f"Period: {period_note}\n")
    fb = (fbudget * 100).round(2)
    fb.index = [c.replace("l3_", "").replace("_er", "") for c in fb.index]
    print(fb.to_string())
    print(f"\nFactor shares sum: {fb.sum():.2f}%")
    print(
        "share_L = Σᵢ wᵢ × σᵢ² × ER_iL  (additive approx, normalized to 100%;\n"
        "  ignores cross-asset covariance)"
    )
    print(
        "Caveat — time mixing: ER_iL comes from the latest analyze_portfolio\n"
        "  snapshot (as-of today), while σᵢ is computed on the window above.\n"
        "  Reading: ER as-of snapshot, vol/cov window-specific. Treat the\n"
        "  decomposition as illustrative when ER drifts inside the window."
    )


# ── CLI ───────────────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Portfolio risk metrics demo (RiskModels SDK)")
    p.add_argument(
        "--tickers", type=str, default=None,
        help="Comma-separated tickers (e.g. AAPL,MSFT,NVDA). Default = MAG6+JPM+JNJ+XOM.",
    )
    p.add_argument(
        "--weights", type=str, default=None,
        help="Comma-separated weights matching --tickers (default = equal-weight when --tickers is given).",
    )
    p.add_argument("--years", type=int, default=2, help="Years of history (default 2).")
    p.add_argument(
        "--rf", type=float, default=0.0,
        help="Risk-free rate (annual decimal) for Sharpe (default 0.0 — flagged in output).",
    )
    p.add_argument(
        "--optimize", action="store_true",
        help="Fit weights on L3 residual returns and run walk-forward OOS evaluation.",
    )
    p.add_argument(
        "--mu-mode", choices=["equal", "historical"], default="equal", dest="mu_mode",
        help=(
            "Expected-return assumption for --optimize. "
            "'equal' (default) → constant μ, min-variance on residual covariance "
            "(avoids using historical means as forecasts — methodologically honest). "
            "'historical' → mean × 252, max-Sharpe (overfits in-sample, comparison only)."
        ),
    )
    p.add_argument(
        "--oos-split", type=float, default=0.75, dest="oos_split",
        help="Fraction of days used for training in walk-forward OOS (default 0.75).",
    )
    return p.parse_args()


def resolve_portfolio(args: argparse.Namespace) -> dict[str, float]:
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
        if not tickers:
            sys.exit("--tickers parsed empty")
        if args.weights:
            ws = [float(x) for x in args.weights.split(",")]
            if len(ws) != len(tickers):
                sys.exit("--weights length must match --tickers length")
        else:
            ws = [1.0 / len(tickers)] * len(tickers)
        port = dict(zip(tickers, ws))
    else:
        port = dict(DEFAULT_PORTFOLIO)
    total = sum(port.values())
    if total <= 0:
        sys.exit("Weights must sum to a positive value")
    if not math.isclose(total, 1.0, abs_tol=1e-3):
        port = {k: v / total for k, v in port.items()}
    return port


def main() -> int:
    args = parse_args()
    portfolio = resolve_portfolio(args)
    tickers = list(portfolio.keys())
    weights = pd.Series(portfolio, name="weight")

    # Load .env / .env.local (no-op if python-dotenv missing) so the upfront
    # check sees keys placed in repo dotenv files.
    try:
        from riskmodels.env import load_repo_dotenv
        load_repo_dotenv()
    except ImportError:
        pass
    if not (
        os.environ.get("RISKMODELS_API_KEY")
        or (os.environ.get("RISKMODELS_CLIENT_ID") and os.environ.get("RISKMODELS_CLIENT_SECRET"))
    ):
        sys.exit(
            "Set RISKMODELS_API_KEY (or RISKMODELS_CLIENT_ID + RISKMODELS_CLIENT_SECRET) "
            "in the environment or in .env.local at the repo root."
        )

    client = RiskModelsClient.from_env()

    print(f"Pulling {args.years}yr panel for {len(tickers)} names: {', '.join(tickers)}")
    panel = build_panel(client, tickers, years=args.years)
    print(
        f"Panel: {panel.returns.shape[0]} aligned trading days × "
        f"{panel.returns.shape[1]} tickers (SPY benchmark aligned)."
    )

    er_table = fetch_per_ticker_er(client, tickers)

    # Residuals are computed on every run — they power the diagnostic block
    # and (when --optimize is set) feed the optimizer's covariance estimate.
    print_section("L3 residual returns")
    residuals = compute_residual_returns(client, tickers, args.years, panel)
    print(f"Residual panel: {residuals.shape[0]} days × {residuals.shape[1]} tickers")
    print_residual_sharpe_diagnostic(residuals)

    full_period = period_label(panel.returns.index, "in-sample", "full window")
    run_metrics("Input portfolio", weights, panel, er_table, rf=args.rf,
                period_note=full_period)

    if args.optimize:
        try:
            from pypfopt import EfficientFrontier
        except ImportError:
            sys.exit("Install PyPortfolioOpt for --optimize: pip install PyPortfolioOpt")

        if not 0.0 < args.oos_split < 1.0:
            sys.exit("--oos-split must be in (0, 1)")

        all_dates = panel.returns.index
        n = len(all_dates)
        split_idx = int(n * args.oos_split)
        if split_idx < 30 or n - split_idx < 30:
            sys.exit(
                f"OOS split would leave too few days (train={split_idx}, "
                f"test={n - split_idx}); increase --years or adjust --oos-split."
            )
        train_dates = all_dates[:split_idx]
        test_dates  = all_dates[split_idx:]
        train_panel = slice_panel(panel, train_dates)
        test_panel  = slice_panel(panel, test_dates)
        train_residuals = residuals.reindex(train_dates).dropna(how="any")

        print_section(
            f"Optimization — μ-mode={args.mu_mode}, "
            f"train: {train_dates[0].date()} → {train_dates[-1].date()} "
            f"({len(train_dates)} days), "
            f"test: {test_dates[0].date()} → {test_dates[-1].date()} "
            f"({len(test_dates)} days)"
        )

        Sigma = train_residuals.cov(ddof=0) * TRADING_DAYS
        if args.mu_mode == "equal":
            # With equal expected returns the Sharpe-max objective collapses to
            # min-variance — μ cancels out. Calling min_volatility() directly is
            # the honest expression of that, and avoids using historical mean
            # returns as forecasts (the textbook backtest trap Conrad flagged).
            mu = pd.Series(0.0, index=train_residuals.columns)
            ef = EfficientFrontier(mu, Sigma, weight_bounds=(0, 1))
            ef.min_volatility()
        else:  # historical
            print(
                "WARNING: --mu-mode historical uses in-sample mean returns as "
                "expected\n"
                "         returns. Known to overfit to the training window. "
                "For comparison only."
            )
            mu = train_residuals.mean() * TRADING_DAYS
            ef = EfficientFrontier(mu, Sigma, weight_bounds=(0, 1))
            ef.max_sharpe(risk_free_rate=args.rf)

        cleaned = ef.clean_weights()
        new_w = pd.Series(cleaned, name="weight").reindex(tickers).fillna(0.0)
        if new_w.sum() <= 0:
            sys.exit("Optimizer returned a zero-weight vector; aborting --optimize")
        new_w = new_w / new_w.sum()

        print("\nOptimized weights:")
        print(new_w.round(4).to_string())

        # In-sample (train) — what the optimizer saw
        run_metrics(
            "Optimized portfolio", new_w, train_panel, er_table, rf=args.rf,
            period_note=period_label(train_dates, "in-sample", "train"),
        )
        # Out-of-sample (test) — the honest evaluation
        run_metrics(
            "Optimized portfolio", new_w, test_panel, er_table, rf=args.rf,
            period_note=period_label(test_dates, "out-of-sample", "test"),
        )

        oos_port_rets = test_panel.returns[new_w.index].mul(new_w, axis=1).sum(axis=1)
        oos_summary   = compute_summary_stats(oos_port_rets, rf=args.rf)
        print_section("Headline — out-of-sample Sharpe")
        print(_row(
            f"Optimized portfolio Sharpe (rf={args.rf:.2%})",
            f"{oos_summary['sharpe']:.3f}",
            "((1 + R̄_daily)^252 - 1 - rf) / (σ_daily × √252)  ·  OOS test slice",
        ))
        print(
            f"  test window: {test_dates[0].date()} → {test_dates[-1].date()} "
            f"({len(test_dates)} days)"
        )

        active = {k: float(v) for k, v in new_w.items() if v > 1e-6}
        if active:
            pa_opt = client.analyze_portfolio(active, years=1)
            print_section("Optimized portfolio — implied L3 hedge ratios (analyze_portfolio)")
            phr = pd.Series(pa_opt.portfolio_hedge_ratios)
            print(phr.dropna().round(4).to_string())

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
