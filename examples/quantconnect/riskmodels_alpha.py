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


DEPTHS = ("recommended", "lstar", "L1", "L2", "L3")


def _pairs(basket, depth):
    d = str(depth).strip()
    d = d.lower() if d.lower() in ("recommended", "lstar") else d.upper()
    if d not in DEPTHS:
        raise ValueError("depth must be one of %s" % (DEPTHS,))
    ticker = basket.get("ticker")
    if d == "recommended":
        level = basket.get("recommended_hedge_level")
        if level and level in (basket.get("incomplete_levels") or []):
            raise ValueError("hedge level %s is incomplete for %s" % (level, ticker))
        return [(leg.get("leg"), leg.get("position")) for leg in basket.get("legs") or []]
    level = basket.get("lstar") if d == "lstar" else d
    if level not in ("L1", "L2", "L3"):
        raise ValueError("no stored L* for %s" % ticker)
    levels = basket.get("hedge_levels") or {}
    if level in (levels.get("incomplete_levels") or basket.get("incomplete_levels") or []) or not levels.get(level):
        raise ValueError("hedge level %s is unavailable for %s" % (level, ticker))
    hl, etfs = levels[level], levels[level].get("hedge_etfs") or {}
    pairs = [(ticker, 1.0)]
    for layer in ("market", "sector", "subsector"):
        etf, hr = etfs.get(layer), hl.get(layer + "_hr")
        if etf is not None or hr is not None:
            pairs.append((etf, hr))
    return pairs


def alpha_legs(basket, direction, dollars, depth="recommended"):
    """Pure scaling step (same arithmetic as ``riskmodels.alpha.alpha_legs``). Returns ``{symbol: signed dollars}``.

    depth: "recommended" (stored L* with the segment leverage cap and explained-risk floor, the default), "lstar" (stored
    L*, no cap), or "L1" / "L2" / "L3" (a depth chosen directly; the cap does not apply).
    """
    d = str(direction).strip().lower()
    if d not in ("buy", "sell"):
        raise ValueError("direction must be 'buy' or 'sell'")
    if not (isinstance(dollars, (int, float)) and math.isfinite(dollars) and dollars > 0):
        raise ValueError("dollars must be a positive finite number")
    sign = 1.0 if d == "buy" else -1.0
    out = {}
    for sym, ratio in _pairs(basket, depth):
        if sym is None or ratio is None or not math.isfinite(float(ratio)):
            raise ValueError("leg %r has no usable position" % (sym,))
        out[sym] = sign * dollars * float(ratio)
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


def get_alpha(algo, ticker, direction, dollars, user_segment="stat_arb", depth="recommended"):
    """Fetch the basket for ``ticker`` and return ``{symbol: signed dollars}``. Logs the call's wall time.

    ``user_segment`` sets the gross-hedge cap used by depth="recommended": retail 1.5x, family_office 2x (the API default),
    ls_equity 3x, stat_arb 5x.
    """
    basket, dt = fetch_basket(algo, ticker, user_segment)
    legs = alpha_legs(basket, direction, dollars, depth)
    algo.log("get_alpha %s %s $%d: %d legs, depth %s, as_of %s, %.0f ms" % (
        direction, ticker, dollars, len(legs), depth, basket.get("as_of"), dt * 1000))
    return legs
