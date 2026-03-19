# Validation Helpers

Data quality checks for RiskModels API responses. Use these before consuming data in production workflows.

---

## Python

### 1. Freshness Check

Verify that data is not older than a configurable threshold.

```python
from datetime import datetime

def validate_freshness(metadata, max_age_days=7):
    """
    Check that data is not older than max_age_days.
    metadata: dict with 'as_of' key (ISO date string)
    Returns True if data is fresh enough.
    """
    as_of_date = datetime.fromisoformat(metadata['as_of'])
    age_days = (datetime.utcnow().date() - as_of_date.date()).days
    return age_days <= max_age_days

# Usage with response body containing '_agent' block:
def check_response_freshness(body, max_age_days=3):
    freshness_str = body.get('_agent', {}).get('data_freshness', '')
    if not freshness_str:
        return True
    as_of = datetime.fromisoformat(freshness_str.replace('Z', '+00:00'))
    age_days = (datetime.utcnow().date() - as_of.date()).days
    if age_days > max_age_days:
        print(f"Warning: Data is {age_days} days old (limit: {max_age_days})")
        return False
    return True
```

---

### 2. ER Component Sum Check

The four L3 explained-risk components must sum to approximately 1.0. A large deviation indicates a data quality issue.

```python
def validate_er_components(metrics, tolerance=0.05):
    """
    Check that L3 ER components sum to ~1.0.
    metrics: dict from GET /api/metrics/{ticker}
    Returns (is_valid: bool, actual_sum: float)
    """
    fields = ['l3_market_er', 'l3_sector_er', 'l3_subsector_er', 'l3_residual_er']
    values = [metrics.get(f) for f in fields]

    if any(v is None for v in values):
        print("Warning: one or more ER fields is null — ticker may be partially modelled")
        return False, None

    total = sum(values)
    is_valid = abs(total - 1.0) < tolerance
    if not is_valid:
        print(f"Warning: L3 ER sum = {total:.4f} (expected 1.0 ± {tolerance})")
    return is_valid, total
```

---

### 3. HR Sign Convention Check

Market and sector hedge ratios should be positive (short positions). Subsector can be negative (long). Flag unusual values.

```python
def check_hr_signs(metrics):
    """
    Check hedge ratio sign conventions.
    l3_subsector_hr can be legitimately negative.
    Returns list of warning strings (empty = all ok).
    """
    issues = []
    always_positive = ['l1_market_hr', 'l2_market_hr', 'l2_sector_hr',
                        'l3_market_hr', 'l3_sector_hr']
    for field in always_positive:
        val = metrics.get(field)
        if val is not None and val < 0:
            issues.append(f"{field} = {val:.4f} (negative — unusual, verify ticker)")

    subsector = metrics.get('l3_subsector_hr')
    if subsector is not None and abs(subsector) > 1.0:
        issues.append(f"l3_subsector_hr = {subsector:.4f} (magnitude > 1.0 — verify)")

    return issues
```

---

### 4. Universe Coverage Check

Verify a ticker is in the universe before making metered data calls.

```python
import requests

def check_ticker_in_universe(ticker, headers):
    """
    Returns True if ticker is in uni_mc_3000.
    Use before querying /metrics or /ticker-returns to avoid 404 charges.
    """
    resp = requests.get(
        "https://riskmodels.net/api/tickers",
        params={"search": ticker},
        headers=headers
    )
    if resp.status_code != 200:
        return False
    result = resp.json()
    tickers = result.get('tickers', [])
    return ticker.upper() in [t.upper() for t in tickers]
```

---

### 5. Return Series Date Gap Check

Detect unexpected gaps in a daily return series (beyond normal market holidays).

```python
import pandas as pd

def check_date_gaps(dates, max_gap_days=5):
    """
    Find unexpected gaps in a return series date list.
    Gaps of 1-3 days are normal (weekends/holidays).
    Gaps > max_gap_days may indicate missing data.
    Returns DataFrame of suspicious gaps.
    """
    df = pd.DataFrame({'date': pd.to_datetime(dates)})
    df = df.sort_values('date').reset_index(drop=True)
    df['gap_days'] = df['date'].diff().dt.days
    suspicious = df[df['gap_days'] > max_gap_days].copy()
    if not suspicious.empty:
        print(f"Found {len(suspicious)} gaps > {max_gap_days} days:")
        print(suspicious[['date', 'gap_days']].to_string())
    return suspicious
```

---

### 6. Batch Result Null Guard

When using `/batch/analyze`, some tickers may return null `hedge_ratios` if they are not in the universe. Always null-check before computing notionals.

```python
def compute_portfolio_hedges(results, portfolio_weights, position_size_usd=100_000):
    """
    Compute per-ticker hedge notionals from batch results.
    Skips tickers with null hedge_ratios.
    """
    hedge_trades = []
    for ticker, weight in portfolio_weights.items():
        r = results.get(ticker, {})
        hr = r.get('hedge_ratios')
        if hr is None:
            print(f"Warning: {ticker} hedge_ratios is null — skipping")
            continue

        pos = position_size_usd * weight
        hedge_trades.append({
            'ticker':         ticker,
            'position_usd':   pos,
            'spy_hedge_l1':   pos * (hr.get('l1_market') or 0),
            'spy_hedge_l3':   pos * (hr.get('l3_market') or 0),
            'sector_hedge':   pos * (hr.get('l3_sector') or 0),
            'sub_hedge':      pos * (hr.get('l3_subsector') or 0),
        })
    return hedge_trades
```

---

## TypeScript

### Null Guard for Batch Results

```typescript
interface HedgeRatios {
  l1_market: number | null;
  l2_market: number | null;
  l2_sector: number | null;
  l3_market: number | null;
  l3_sector: number | null;
  l3_subsector: number | null;
}

interface BatchResult {
  status: string;
  hedge_ratios: HedgeRatios | null;
}

function computeHedgeNotional(
  results: Record<string, BatchResult>,
  ticker: string,
  positionSizeUsd: number
): { spy: number; sector: number; subsector: number } | null {
  const result = results[ticker];
  if (!result || !result.hedge_ratios) {
    console.warn(`${ticker}: hedge_ratios is null — ticker may not be in universe`);
    return null;
  }
  const hr = result.hedge_ratios;
  return {
    spy:       positionSizeUsd * (hr.l3_market ?? 0),
    sector:    positionSizeUsd * (hr.l3_sector ?? 0),
    subsector: positionSizeUsd * (hr.l3_subsector ?? 0),
  };
}
```

### ER Sum Validation

```typescript
interface TickerMetrics {
  l3_market_er: number | null;
  l3_sector_er: number | null;
  l3_subsector_er: number | null;
  l3_residual_er: number | null;
}

function validateErComponents(metrics: TickerMetrics, tolerance = 0.05): boolean {
  const fields: (keyof TickerMetrics)[] = [
    'l3_market_er', 'l3_sector_er', 'l3_subsector_er', 'l3_residual_er'
  ];
  const values = fields.map(f => metrics[f]);
  if (values.some(v => v === null)) {
    console.warn('One or more ER fields is null');
    return false;
  }
  const total = (values as number[]).reduce((a, b) => a + b, 0);
  const isValid = Math.abs(total - 1.0) < tolerance;
  if (!isValid) {
    console.warn(`L3 ER sum = ${total.toFixed(4)} (expected 1.0 ± ${tolerance})`);
  }
  return isValid;
}
```
