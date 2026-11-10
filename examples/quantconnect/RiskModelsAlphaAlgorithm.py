# region imports
from AlgorithmImports import *
from riskmodels_alpha import get_alpha
# endregion


class RiskModelsAlphaAlgorithm(QCAlgorithm):
    """Daily plumbing and timing test for get_alpha: a short book of buy and sell signals, each traded as the stock
    against its L* ETF basket from RiskModels.

    The API serves today's basket, so a backtest over past dates reads the current ratios (look-ahead) and is not a
    performance test. The point of this run is the per-call latency from the QuantConnect cloud, which the log records.
    Point-in-time baskets need the history file.

    Project parameter: riskmodels_api_key (a dedicated key with a spend cap).
    """

    SIGNALS = [("NVDA", "buy"), ("CAT", "buy"), ("AAPL", "sell"), ("JPM", "buy"), ("UNH", "sell")]
    SIZE = 20_000  # dollars of stock per signal

    def initialize(self):
        self.set_start_date(2026, 10, 19)
        self.set_end_date(2026, 11, 6)
        self.set_cash(1_000_000)
        self.universe_settings.leverage = 5
        self.add_equity("SPY", Resolution.DAILY)
        for sym, _ in self.SIGNALS:
            self.add_equity(sym, Resolution.DAILY)
        self.schedule.on(self.date_rules.every_day("SPY"), self.time_rules.after_market_open("SPY", 5), self.rebalance)
        self.ms = []

    def rebalance(self):
        targets = {}
        for sym, direction in self.SIGNALS:
            try:
                legs = get_alpha(self, sym, direction, self.SIZE)
            except Exception as e:  # a failed call leaves that name unchanged
                self.log("get_alpha %s failed: %s" % (sym, e))
                continue
            for leg, usd in legs.items():
                targets[leg] = targets.get(leg, 0.0) + usd
        value = self.portfolio.total_portfolio_value
        for leg, usd in targets.items():
            if leg not in self.securities:
                self.add_equity(leg, Resolution.DAILY)
            self.set_holdings(leg, usd / value)
