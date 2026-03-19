# API Endpoint Testing Guide

**Last Updated:** 2026-02-26

Practical examples for testing the Risk Models API endpoints with real ticker data.

## Quick Start

All endpoints require the development server to be running:
```bash
cd riskmodels_com && npm run dev
```

## Ticker-Specific Examples

### Get Market Hedge Ratio for AAPL

Fetch the L3 market hedge ratio for Apple (how much SPY to short for hedging):

```bash
curl http://localhost:3000/api/metrics/AAPL
```

**Extract market hedge ratio:**
```bash
curl http://localhost:3000/api/metrics/AAPL | grep -o '"l3_market_hr":[0-9.-]*'
```

**Expected Response:**
```json
{
  "ticker": "AAPL",
  "l3_market_hr": -1.48813,
  "l3_market_er": 0.525427,
  "l3_sector_er": -0.00560234,
  "l3_subsector_er": 0.0106941,
  "l3_residual_er": 0.469481,
  "l2_market_hr": -1.32649,
  "l2_sector_hr": 0.223446,
  "l1_market_hr": -1.03185,
  "volatility": 0.316431,
  "market_cap": 3995778154496,
  "close_price": 259.48
}
```

**Key Metrics:**
- `l3_market_hr`: Market hedge ratio (short ~1.49x SPY to hedge)
- `l3_residual_er`: L3 residual/excess return (0.47%)
- `l3_market_er`: Market component of return (0.53%)

### Fetch Residual Returns for NVDA

Get the L3 residual returns (idiosyncratic/excess returns) for NVIDIA:

```bash
curl http://localhost:3000/api/metrics/NVDA
```

**Extract all residual return levels:**
```bash
curl http://localhost:3000/api/metrics/NVDA | jq '{l1_residual_er, l2_residual_er, l3_residual_er}'
```

**Expected Response:**
```json
{
  "ticker": "NVDA",
  "l1_residual_er": 0.0023,
  "l2_residual_er": 0.0018,
  "l3_residual_er": 0.0012,
  "l3_market_hr": 1.45,
  "volatility": 0.045,
  "market_cap": 1800000000000
}
```

**Interpretation:**
- Positive residual return → Stock outperformed model expectations
- L3 captures most granular factor model (market + sector + subsector)

### Time Series Decomposition for AAPL

Fetch the complete L3 risk decomposition time series for Apple:

```bash
curl "http://localhost:3000/api/l3-decomposition?ticker=AAPL&from=2024-01-01&to=2024-12-31"
```

**Expected Response:**
```json
{
  "ticker": "AAPL",
  "market_factor_etf": "SPY",
  "universe": "uni_mc_3000",
  "dates": ["2024-01-01", "2024-02-01", "2024-03-01", ...],
  "l3_residual_er": [0.0012, -0.0008, 0.0021, ...],
  "l3_market_er": [0.0005, 0.0015, 0.0009, ...],
  "l3_sector_er": [0.0003, 0.0001, 0.0004, ...],
  "l3_subsector_er": [0.0001, -0.0002, 0.0003, ...]
}
```

### Compare AAPL and NVDA Side-by-Side

```bash
# Get both tickers' metrics
curl -s http://localhost:3000/api/metrics/AAPL | jq '{ticker, beta: .beta_market, residual: .l3_residual_er, market_cap}' > aapl.json
curl -s http://localhost:3000/api/metrics/NVDA | jq '{ticker, beta: .beta_market, residual: .l3_residual_er, market_cap}' > nvda.json

# View comparison
echo "=== AAPL ===" && cat aapl.json && echo -e "\n=== NVDA ===" && cat nvda.json

# Clean up
rm aapl.json nvda.json
```

**Output:**
```
=== AAPL ===
{
  "ticker": "AAPL",
  "beta": 1.23,
  "residual": 0.0008,
  "market_cap": 3500000000000
}

=== NVDA ===
{
  "ticker": "NVDA",
  "beta": 1.45,
  "residual": 0.0012,
  "market_cap": 1800000000000
}
```

### Query via SQL (Advanced)

Use the CLI API to query multiple tickers directly from the database:

```bash
curl -X POST http://localhost:3000/api/cli/query \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT ticker, beta_market, volatility, l3_residual_er FROM ticker_factor_metrics WHERE ticker IN ('AAPL', 'NVDA') ORDER BY date DESC LIMIT 2"
  }'
```

**Expected Response:**
```json
{
  "results": [
    {
      "ticker": "NVDA",
      "beta_market": 1.45,
      "volatility": 0.045,
      "l3_residual_er": 0.0012
    },
    {
      "ticker": "AAPL",
      "beta_market": 1.23,
      "volatility": 0.025,
      "l3_residual_er": 0.0008
    }
  ],
  "count": 2,
  "sql": "SELECT ticker, beta_market, volatility, l3_residual_er FROM ticker_factor_metrics WHERE ticker IN ('AAPL', 'NVDA') ORDER BY date DESC LIMIT 2"
}
```

## Common Data Fields

| Field | Description | Example (AAPL) | Example (NVDA) |
|-------|-------------|----------------|----------------|
| `beta_market` | Market beta coefficient | 1.23 | 1.45 |
| `l1_residual_er` | L1 residual/excess return | -0.0008 | 0.0023 |
| `l2_residual_er` | L2 residual/excess return | -0.0009 | 0.0018 |
| `l3_residual_er` | L3 residual/excess return | 0.0008 | 0.0012 |
| `l3_market_hr` | L3 market hedge ratio | 0.85 | 0.95 |
| `l3_sector_hr` | L3 sector hedge ratio | 0.25 | 0.35 |
| `l3_subsector_hr` | L3 subsector hedge ratio | 0.08 | 0.12 |
| `volatility` | 30-day volatility | 0.025 | 0.045 |
| `market_cap` | Market capitalization | $3.5T | $1.8T |

## Development Tips

### Best Practices
1. **Always use uppercase ticker symbols** (AAPL, NVDA, TSLA, MSFT)
2. **Check data availability** - Not all tickers have complete L3 decomposition data
3. **Use date filters** for time series queries to limit response size
4. **Use `jq` for parsing JSON** responses in the terminal

### Troubleshooting

**Error: "No data found"**
- Verify ticker exists in the database: `curl http://localhost:3000/api/tickers`
- Check date range for time series queries
- Ensure database is populated with recent data

**Error: "Invalid ticker format"**
- Use uppercase letters only
- Common format: `[A-Z]{1,5}` (e.g., AAPL, NVDA, BRK.B)

### Performance Notes

| Query Type | Expected Latency | Notes |
|------------|------------------|-------|
| Single ticker metrics | 50-200ms | Includes all factor exposures |
| L3 decomposition (1 year) | 200-500ms | ~12 data points for monthly data |
| Batch comparison (2 tickers) | 100-400ms | Parallel requests recommended |
| SQL query (2 tickers) | 100-300ms | Direct database access |

## Additional Resources

- **API Documentation**: `riskmodels_com/docs/api/`
- **Authentication Guide**: `AGENT_API_TESTING_GUIDE.md`
- **CLI Testing**: `cli/CLI_COMMAND_TESTING.md`
