# One Position, Four Bets

The core RiskModels claim is simple: one stock position is not one bet. It is a stack of market, sector, subsector, and residual risk.

The live paper flow lets an agent read the argument, call the RiskModels API, and render chart-ready comparisons as it goes.

Start here:

1. Compare AAPL and NVDA.
2. Decompose AAPL, NVDA, and CRWD.
3. Scale the NVDA hedge ratios to a $10,000 position.
4. Roll the same lens into a small portfolio.

Whenever tool output includes `chart_data`, render the suggested chart and explain the result in plain English.
