
"""Regime-aware sector rotation (HMM forward-beta).

Public entry points:
    get_forward_beta      -- data -> returns -> regime fit -> forward betas
    backtest_result_HMM   -- walk-forward backtest + plot
    live_allocation       -- next-period target weights for live use
"""

from .forward_beta import get_forward_beta
from .portfolio_fb import backtest_result_HMM
from .live_hmm_holdings import live_allocation

__all__ = ["get_forward_beta", "backtest_result_HMM", "live_allocation"]
