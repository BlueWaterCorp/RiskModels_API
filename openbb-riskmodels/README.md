# openbb-riskmodels

OpenBB **Platform** commands for RiskModels. Audience: a notebook that already uses `from openbb import obb`. This package is not the Workspace app at `https://riskmodels.app/openbb` (widgets, dashboards, Analyst copilot).

Install is free. Data access uses a RiskModels API key and the existing capability billing on `riskmodels-py`.

Homebrew Python is PEP 668-managed; do not `pip install` into it. Use a venv (gitignored as `.venv/`):

```bash
cd /Users/conradgann/BW_Code/RiskModels_API/openbb-riskmodels
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ../sdk -e .
openbb-build
```

`openbb-build` is the console script from `openbb-core`. After a rebuild, `from openbb import obb` exposes `obb.risk_models.decompose`, `decompose_historical`, and `fundamentals`.

If this machine aliases `python` to `BWMACRO/.venv` (common here), `activate` will not change the interpreter. Use `.venv/bin/python` (and `.venv/bin/openbb-build`) explicitly, or `unalias python python3` after activate.

Set `RISKMODELS_API_KEY`, or save it as `riskmodels_api_key` in OpenBB's credential store (`obb.user.credentials.riskmodels_api_key`).

## Commands

```python
from openbb import obb

obb.risk_models.decompose("NVDA")
obb.risk_models.decompose_historical("CRM", years=2)
obb.risk_models.fundamentals("NVDA", as_of="2024-12-31", periods=8)
```

- `decompose` — latest ERM3 market / sector / subsector / residual snapshot, hedge map, recommended hedge level. Residual is unexplained variance.
- `decompose_historical` — daily explained-risk and hedge-ratio series (`GET /l3-decomposition`).
- `fundamentals` — point-in-time quarterly derived fundamentals (`GET /fundamentals/{ticker}`). Rows keep `filed_date`, `filed_date_source`, and `sec_facts`. Panel-wide: point-in-time normalized fundamentals derived from SEC filings and licensed sources. `SEC-sourced` applies only to the four SEC-primary concepts and quantities computed only from them.

These commands wrap `riskmodels-py` (`>=0.4.0`). They do not implement PIT logic or hedge-map math.

## Not in this package

Workspace widgets, the marketplace listing, WACC sensitivity grid, portfolio, rankings, tearsheet, and the copilot. Those live on `https://riskmodels.app/openbb` or on `RiskModelsClient` directly. Users who are not already on OpenBB Platform should use `riskmodels-py`.
