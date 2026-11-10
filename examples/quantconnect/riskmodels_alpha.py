"""get_alpha for QuantConnect LEAN: stdlib only, so it runs in the QuantConnect cloud without installing packages.

    from riskmodels_alpha import get_alpha

    legs = get_alpha(self, "NVDA", "buy", 20_000)      # {symbol: signed dollars}: the stock plus its L* ETF hedge legs
    # then set_holdings(symbol, dollars / self.portfolio.total_portfolio_value) for each leg

``get_alpha`` calls ``GET https://riskmodels.app/api/hedge-basket/{ticker}`` and scales the signed ratios (dollars of each
ETF per dollar of stock) by the signal size. A sell multiplies every leg by -1. The API key is read from the algorithm
parameter ``riskmodels_api_key``. The call is timed and logged.
"""

import json
import math
import time

API = "https://riskmodels.app/api"


def alpha_legs(basket, direction, dollars):
    """Pure scaling step (same arithmetic as ``riskmodels.alpha.alpha_legs``). Returns ``{symbol: signed dollars}``."""
    d = str(direction).strip().lower()
    if d not in ("buy", "sell"):
        raise ValueError("direction must be 'buy' or 'sell'")
    if not (isinstance(dollars, (int, float)) and math.isfinite(dollars) and dollars > 0):
        raise ValueError("dollars must be a positive finite number")
    level = basket.get("recommended_hedge_level")
    if level and level in (basket.get("incomplete_levels") or []):
        raise ValueError("hedge level %s is incomplete for %s" % (level, basket.get("ticker")))
    sign = 1.0 if d == "buy" else -1.0
    out = {}
    for leg in basket.get("legs") or []:
        ratio = leg.get("position")
        if leg.get("leg") is None or ratio is None or not math.isfinite(float(ratio)):
            raise ValueError("leg %r has no usable position" % (leg.get("leg"),))
        out[leg["leg"]] = sign * dollars * float(ratio)
    if abs(out.get(basket.get("ticker"), 0.0)) < 1e-9:
        raise ValueError("stock leg missing")
    return out


def fetch_basket(algo, ticker, user_segment="stat_arb"):
    """Download the hedge basket with the algorithm's HTTP client. Returns (json, seconds)."""
    key = algo.get_parameter("riskmodels_api_key")
    if not key:
        raise ValueError("set the project parameter riskmodels_api_key")
    url = "%s/hedge-basket/%s?user_segment=%s" % (API, ticker, user_segment)
    t0 = time.time()
    body = algo.download(url, {"Authorization": "Bearer " + key})
    dt = time.time() - t0
    return json.loads(body), dt


def get_alpha(algo, ticker, direction, dollars, user_segment="stat_arb"):
    """Fetch the basket for ``ticker`` and return ``{symbol: signed dollars}``. Logs the call's wall time."""
    basket, dt = fetch_basket(algo, ticker, user_segment)
    legs = alpha_legs(basket, direction, dollars)
    algo.log("get_alpha %s %s $%d: %d legs at %s, as_of %s, %.0f ms" % (
        direction, ticker, dollars, len(legs), basket.get("recommended_hedge_level"), basket.get("as_of"), dt * 1000))
    return legs
