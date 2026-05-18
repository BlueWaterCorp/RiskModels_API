# Portfolio Optimization Library Review

A survey of open-source Python libraries for portfolio optimization, conducted as part of evaluating which library to adopt for SDK demos and eventual integration. Written April 2026.

## Scope

The brief was to review the open-source landscape and recommend a library for two use cases:

1. **Demo / example code** — what to use in `examples/python/portfolio_risk_metrics.py` for the optional `--optimize` flag.
2. **Future SDK integration** — what to consider when promoting optimization into the SDK as a first-class feature.

These two use cases have different constraints, and the right choice for each is different.

## Summary recommendation

- **For demo code:** `PyPortfolioOpt`. Three-line API, accepts μ and Σ directly, most popular and best-documented. Used in the current `--optimize` implementation.
- **For SDK integration:** `skfolio` or `Riskfolio-Lib`. Both expose richer risk-measure menus (CVaR, EVaR, HRP, Black-Litterman) than PyPortfolioOpt, with cleaner architectures for production use. `skfolio` for sklearn-style pipelines and walk-forward CV; `Riskfolio-Lib` if breadth of risk measures is the priority.
- **Skip:** `scikit-portfolio` (dominated by skfolio).
- **Use as escape hatch only:** raw `CVXPY` (when no high-level library covers the need).
- **Reserve for future:** `cvxportfolio` (multi-period optimization with realistic transaction costs — useful only if multi-period is on the roadmap).

## Libraries reviewed

### PyPortfolioOpt

**One-line take:** Best for fast Markowitz demos. Lightweight, three-line API, accepts μ and Σ directly.

The classic Markowitz problem (mean-variance optimization) wrapped in a clean API:

```python
from pypfopt import EfficientFrontier
ef = EfficientFrontier(mu, Sigma)
weights = ef.max_sharpe(risk_free_rate=0.0)
```

**Strengths:**

- Lowest friction for single-step optimization
- Accepts pre-computed μ and Σ as pandas Series/DataFrames — important for the SDK use case where inputs are already derived from L3 residual returns
- Most popular library (~5k GitHub stars), so users likely already know it
- Supports multiple objectives (`max_sharpe`, `min_volatility`, `efficient_return`, `efficient_risk`)
- Supports several covariance estimators (sample, Ledoit-Wolf shrinkage, exponential weighting)
- Beyond mean-variance: Black-Litterman, Hierarchical Risk Parity, mean-CVaR

**Weaknesses:**

- Less rich risk-measure menu than Riskfolio-Lib
- API is functional rather than sklearn-style, which limits pipeline integration
- Constraint API (sector caps, group constraints) is less ergonomic than Riskfolio-Lib

**Verdict:** First choice for demos. Used in `examples/python/portfolio_risk_metrics.py --optimize`.

### skfolio

**One-line take:** sklearn-style API. Good candidate for production SDK integration when we want walk-forward CV.

Built explicitly for production usage in the sklearn ecosystem. Optimizers behave like estimators (`fit`, `predict`, `score`), which makes them composable into pipelines.

**Strengths:**

- Native sklearn integration — works with `Pipeline`, `GridSearchCV`, `cross_val_score`
- Built-in walk-forward and combinatorial cross-validation
- Modern codebase with type hints, comprehensive tests
- Wide risk-measure menu (mean-variance, CVaR, EVaR, max drawdown, etc.)
- Backtesting module with realistic constraints

**Weaknesses:**

- Newer (less battle-tested) than alternatives
- Smaller community than PyPortfolioOpt
- Heavier dependency tree

**Verdict:** Strong candidate for Phase 2 / 3 SDK integration if we want pipeline-friendly optimizers.

### Riskfolio-Lib

**One-line take:** Most feature-rich. Heavier. Other production candidate.

Built primarily for academic/research use but extended for practitioner workflows. Exposes the widest set of risk measures of any library reviewed (24+).

**Strengths:**

- Widest risk-measure menu (CVaR, EVaR, CDaR, MAD, semivariance, kurtosis, etc.)
- Black-Litterman, HRP, Risk Parity, NCO all built in
- Constraint API supports complex real-world cases (sector limits, exposure constraints, turnover constraints)
- Active community in academic finance

**Weaknesses:**

- Denser API — requires configuring a `Portfolio` object before optimization
- Documentation dense, learning curve steeper
- More dependencies (CVXPY, mosek if you want it)

**Verdict:** Strong candidate for Phase 2 / 3 SDK integration if breadth of risk measures matters more than sklearn-style pipelines.

### cvxportfolio

**One-line take:** Multi-period optimization. Use only if multi-period is on the roadmap.

Built by the Stanford CVX group. Designed for realistic multi-period optimization with transaction costs, holding costs, and tax effects.

**Strengths:**

- Best-in-class for multi-period optimization
- Realistic cost modeling (proportional, fixed, market impact)
- Backtesting with proper time-series simulation

**Weaknesses:**

- Steep learning curve (paper-style docs)
- Overkill for single-period optimization
- Smaller user base outside academia

**Verdict:** Reserve for future use only if SDK adds multi-period optimization features.

### CVXPY (raw)

**One-line take:** Escape hatch when prebuilt optimizers don't fit.

The underlying convex optimization library that most of the above libraries use under the hood. Maximum flexibility, but also maximum verbosity.

**Strengths:**

- Can express any convex optimization problem
- Useful for non-standard objectives or constraints not exposed by higher-level libraries

**Weaknesses:**

- 20–40 lines of variable / constraint declarations per optimization
- Easy to formulate problems incorrectly
- No portfolio-specific helpers (covariance estimation, walk-forward, etc.)

**Verdict:** Only when no higher-level library covers the need. Not recommended for the SDK or demos.

### scikit-portfolio

**One-line take:** Dominated by skfolio. Skip.

Earlier sklearn-style portfolio optimization library. Smaller community, less active development since skfolio matured.

**Verdict:** Skip. skfolio supersedes it on every dimension.

## Why these constraints matter for the SDK use case

The SDK already produces specific outputs that the optimizer needs as inputs: rolling L3 hedge ratios, residual returns, per-ticker explained-risk fractions. Three implications for library choice:

1. **The library must accept pre-computed μ and Σ directly.** It shouldn't try to estimate them from prices because we already have better estimates from the factor model.
2. **The covariance matrix is residual covariance, not return covariance.** This means library defaults that auto-estimate covariance from prices are actively wrong for our use case.
3. **For Phase 2 SDK integration, we want a library that doesn't fight the dependency surface.** PyPortfolioOpt has the lightest dependencies; Riskfolio-Lib pulls in mosek if you want it; skfolio is in between.

## Decision log

| Use case | Choice | Reason |
|----------|--------|--------|
| Phase 1 example (`--optimize` flag) | PyPortfolioOpt | Lowest friction, accepts μ/Σ directly, most familiar to users |
| Phase 2 SDK integration (TBD) | skfolio or Riskfolio-Lib | Wider risk-measure menu, more production-ready architectures |
| Phase 3 server endpoint (TBD) | TBD | Library choice depends on Phase 2 outcome and infra constraints |

## References

- PyPortfolioOpt: https://pyportfolioopt.readthedocs.io/
- skfolio: https://skfolio.org/
- Riskfolio-Lib: https://riskfolio-lib.readthedocs.io/
- cvxportfolio: https://www.cvxportfolio.com/
- CVXPY: https://www.cvxpy.org/
- scikit-portfolio: https://github.com/scikit-portfolio/scikit-portfolio
