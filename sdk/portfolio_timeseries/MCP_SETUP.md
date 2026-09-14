# RiskModels MCP — Setup & Replication Guide

_For teammates who want to point a Claude agent at the RiskModels API and reproduce
the 13F overlay / hedge analysis. Written 2026-07-19 against `riskmodels-py 0.3.11`
and `@riskmodels/mcp`._

---

## What the MCP server is (two sentences)

The RiskModels MCP server exposes the RiskModels API's **schema and capabilities** to an
agent — it tells the agent which endpoints exist, what parameters they take, and what the
responses look like, so the agent can call them correctly without guessing. It ships two
tool classes: **discovery** tools (list endpoints, read capabilities, fetch response
schemas — free, no key) and **data** tools (live decomposition, metrics, portfolio risk —
metered, API key required).

> **Scope note.** The MCP server covers the *single-stock / portfolio* decomposition
> surface (`decompose`, `metrics`, `portfolio risk-snapshot`). The **13F filer** work in
> this folder (`get_filer_holdings`, `get_filer_portfolio`, `get_ticker_returns`) runs
> through the **`riskmodels-py` Python SDK**, not the MCP tools. Use MCP to let the agent
> *discover* the API; use the SDK to *run* the overlay pipeline. Both read the same key.

---

## Setup steps

### 1. One-time prerequisites

```bash
# Node LTS (for the MCP server) + an API key
npm install -g riskmodels@latest
riskmodels config init          # stores the key at ~/.config/riskmodels/config.json

# Build the MCP server from this repo
cd RiskModels_API/mcp
npm install && npm run build    # produces mcp/dist/index.js
```

The key lives once at `~/.config/riskmodels/config.json` and is picked up by **both** the
MCP server and the Python SDK — no need to paste it into every client config or (ever)
inline it on a shell command.

### 2. Wire the MCP server to your client

**Claude Code (the `claude` CLI):**
```bash
claude mcp add --scope user --transport stdio riskmodels -- npx -y @riskmodels/mcp
# restart claude, then:  claude mcp list   → riskmodels should show "connected"
```

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "riskmodels": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/RiskModels_API/mcp/dist/index.js"]
    }
  }
}
```
Fully quit and relaunch (stdio servers spawn at client start — a reload is not enough).

**Cursor** — this repo ships `.cursor/mcp.json`; opening `RiskModels_API/` as the workspace
auto-wires it. Settings → MCP → Reload.

Verify by asking the agent: *"List all RiskModels tools."* You should see the three
discovery tools (`riskmodels_list_endpoints`, `riskmodels_get_capability`,
`riskmodels_get_schema`) and the data tools (`get_metrics`, `get_l3_decomposition`,
`get_portfolio_risk_snapshot`).

### 3. Credentials the agent needs

| What | Where | Notes |
|---|---|---|
| API key | `~/.config/riskmodels/config.json` (`apiKey`) | Set once via `riskmodels config init`. MCP + SDK both read it. |
| Per-client override | `RISKMODELS_API_KEY` env in the MCP config block | Optional; env wins over the config file. |
| Base URL | `RISKMODELS_API_BASE` → CLI config → `https://riskmodels.app` | Only set to override. |
| Supabase (SDK only, optional) | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` | Needed for `get_ticker_metadata` / peer-group; the overlay pipeline does **not** require it. |

---

## Replication prompt (copy-paste to your agent)

> You have the **RiskModels MCP server** connected and the **`riskmodels-py` (0.3.11)**
> Python SDK installed. The API covers US-equity **factor risk decomposition**: every
> stock is split into **market / sector / subsector / residual** risk, each with an **ETF
> hedge ratio** (SPY for market, a sector ETF, a subsector ETF). It also serves **13F
> filer holdings** and **daily returns**.
>
> **Discover first, then call.** Run `riskmodels_list_endpoints`, and
> `riskmodels_get_capability { id: "<endpoint>" }` before writing any SDK call, so you
> use the real parameter names.
>
> **Key endpoints / SDK methods:**
> - `client.decompose(ticker)` → `exposure.{market,sector,subsector,residual}.{er,hr,hedge_etf}`,
>   `hedge` (`{etf: per-dollar short ratio}`), `hedge_levels.{L1,L2,L3}`.
> - `client.get_filer_holdings(bw_filer_id, *, as_of=None, limit=None)` → holdings snapshot.
> - `client.get_filer_portfolio(bw_filer_id, *, start_date, end_date)` → portfolio-level
>   time series (`weight_hhi`, `top5/top10_weight_sum`, `effective_n`) — no per-ticker weights.
> - `client.get_ticker_returns(ticker, years=N)` → daily gross returns (stocks **and** ETFs;
>   `get_etf_returns` is deprecated).
> - `client.get_metrics(ticker)` → latest L1/L2/L3 hedge ratios + ER fractions.
>
> **Filer id format:** methods are keyed by `bw_filer_id` = `BW-FILER-CIK{cik.zfill(10)}`,
> **not** raw CIK. Resolve with that deterministic id (confirm via `get_filer`), or
> `search_filers(q="name")` — see gotchas.
>
> **To build a market-neutral overlay** for a filer's long book: pull the holdings, get
> each name's `decompose().hedge` per-dollar ratios, multiply by the position's dollars,
> and net across ETFs. This folder's `MarketNeutralOverlay` does exactly that (worked
> example below).

---

## Known gotchas (read before trusting a number)

1. **`as_of` refers to REPORT dates; TEO ≠ `as_of`.** `as_of` filters on when a filing
   *became knowable* (report/filing basis). **TEO (Time of Effective Observation)** is the
   bitemporal axis that accounts for the **SEC reporting lag** — a 13F for a Q-end report
   date is not public until ~45 days later. Passing `as_of=<report_date>` where TEO/filing
   basis is meant introduces **look-ahead bias**. If you want "what was knowable on date D,"
   you want the TEO/filing-date basis, not the raw report date. Agents get this wrong
   constantly — verify which basis a method uses before back-testing.

2. **`search_filers` does not match a zero-padded CIK string.** `q="0001067983"` → 0
   results. Reliable resolution is the deterministic `BW-FILER-CIK{cik.zfill(10)}` id
   (confirmed via `get_filer`), or a **name** search with a name-token check. Two of four
   seed CIKs in the original brief did not resolve at all — e.g. Appaloosa's brief CIK
   `0001006438` is "Filer not found"; the working entity is `0001656456` ("Appaloosa LP").

3. **`adj_mv` has a scale inconsistency across filers (and across periods).** Same report
   date 2025-12-31: Appaloosa `sum(adj_mv)` reads in **raw dollars** (~$5.5B, plausible)
   while Berkshire and Pershing read **~1000× compressed** (~$176M, ~$11.5M). There is **no
   single multiplier** to correct it downstream — it appears inherited per-filer from the
   raw 13F (some file in thousands, some in dollars). **Weights and hedge ratios are
   scale-invariant and correct; absolute-dollar labels are not reliable across filers.**

4. **`filing_date` is null on the full-holdings fetch, but populated with `limit=5` (or
   when `as_of=` is passed).** If you need the filing date, request a limited page or read
   it off the `get_filer_portfolio` series — don't assume the full fetch carries it.

5. **`get_filer_holdings` below a filer's holdings floor raises `APIError`, not `[]`.**
   Catch it; testing for an empty list will miss the error. The holdings floor is much
   shallower than the portfolio floor and the gap varies by filer (Berkshire ~1 quarter;
   Pershing ~7.5 years — portfolio back to 2005-12-31, holdings only to 2013-06-30).

6. **`decompose` exposes no size/value/quality betas or stock-specific Sharpe** — only
   `style.explained_variance` and `stock_specific.explained_variance` (both
   `hedgeable:false`). The hedgeable axis is **industry only** (market + sector + subsector).

7. **Confidential-treatment holdings** appear as rows with `ticker: null` /
   `security_id: "BW-RESTRICTED"` (and occasionally unresolved `BW-BBG...` FIGIs). They have
   no ticker, so they carry **no returns and no decomposition** — drop them from any return
   series and note the dropped weight (Greenlight's top ~27.5% line is one of these).

8. **The vendored `sdk/riskmodels/` in this repo is 0.3.10 and shadows pip 0.3.11 under
   pytest** (because `sdk/` lands first on `sys.path`). Scripts here use an import-order
   shim (`import riskmodels` *before* adding `sdk/` to the path) so the `as_of`-capable
   0.3.11 client wins. If `as_of` raises `unexpected keyword argument`, you're on the shadow.

---

## Worked example — three-line overlay construction

```python
from datetime import date
from portfolio_timeseries import PortfolioTimeSeries, MarketNeutralOverlay

pts     = PortfolioTimeSeries.from_cik("0001067983", client=client)  # Berkshire CIK
snap    = pts.as_of(date.today())                                     # latest holdings snapshot
overlay = MarketNeutralOverlay(snap).construct(client)               # decompose fan-out → netted shorts
```

**Expected output shape:**

```python
overlay.etf_shorts        # dict[str, float] — {etf_ticker: signed dollars}, positive = short
# → {'SPY': 44_243_759, 'XLF': 41_739_073, 'IYG': 41_498_692, 'XLP': 31_617_333,
#    'RSPT': -12_619_183, ...}   # negative = a LONG ETF leg (see the long-ETF explainer chart)

sum(overlay.etf_shorts.values())   # net overlay $ (Berkshire ≈ 89% of gross long → net short)
# residual/idiosyncratic exposure is left in by construction — that's the manager's selection.
```

Feed those shorts, dollar-weighted by `short_j / gross_long`, against `get_ticker_returns`
to get the empirical raw-vs-hedged proof (see `charts_raw_vs_hedged*.py`). A correct overlay
drives the hedged series' realized β to SPY toward ~0 while the raw book's β sits near
0.6–0.9.
