# riskmodels-py

[![PyPI version](https://img.shields.io/pypi/v/riskmodels-py.svg)](https://pypi.org/project/riskmodels-py/)

Published on PyPI as [`riskmodels-py`](https://pypi.org/project/riskmodels-py/) (import package `riskmodels`).

Python SDK for the [RiskModels API](https://riskmodels.app) (ERM3 factor model: hedge ratios, explained risk, batch portfolio analysis).

## Install

```bash
pip install riskmodels-py
# Optional xarray panel interface:
pip install riskmodels-py[xarray]
```

From this monorepo:

```bash
cd sdk && pip install -e ".[dev]"
```

Requires **Python 3.10+**.

## Quickstart

```python
from riskmodels import RiskModelsClient

client = RiskModelsClient.from_env()  # RISKMODELS_API_KEY or OAuth client env vars
df = client.get_metrics("NVDA", as_dataframe=True)
pa = client.analyze({"NVDA": 0.5, "AAPL": 0.5})  # alias for analyze_portfolio
print(pa.portfolio_hedge_ratios["l3_market_hr"])
print(pa.to_llm_context())
```

## Recursive Visual Refinement (MatPlotAgent)

Generate professional financial visualizations through automated Vision-LLM feedback:

```python
from openai import OpenAI
from riskmodels import RiskModelsClient

client = RiskModelsClient.from_env()
llm = OpenAI(api_key="...")

result = client.generate_refined_plot(
    plot_description="L3 risk decomposition stacked area chart for NVDA over 2 years",
    output_path="nvda_risk.png",
    llm_client=llm,
    max_iterations=5,
)

print(f"Generated in {result.iterations} iterations")
print(f"Saved to: {result.output_path}")
```

The `generate_refined_plot` method implements the **MatPlotAgent Pattern**:
1. **Execute**: Runs generated matplotlib code in a subprocess
2. **Capture**: Collects execution errors or output PNG
3. **See**: Sends the image to a Vision-LLM (GPT-4o or Claude 3.5 Sonnet)
4. **Evaluate**: LLM audits for overlapping text, legibility, legend accuracy, styling
5. **Refine**: Iterates until "COMPLETE" or max iterations reached

**Requirements**: `pip install openai matplotlib` (or `anthropic`)

**Financial Color Standards** (enforced automatically):
- Market Risk (SPY): **Indigo** (#4B0082)
- Sector Risk: **Green** (#228B22)  
- Residual/Idiosyncratic: **Gray** (#808080)

Environment variables:

- `RISKMODELS_API_KEY` — static Bearer token, or
- `RISKMODELS_CLIENT_ID` + `RISKMODELS_CLIENT_SECRET` — OAuth2 client credentials (JWT ~15m),
- `RISKMODELS_BASE_URL` (default `https://riskmodels.app/api`),
- `RISKMODELS_OAUTH_SCOPE` (optional).

## Agent-native helpers (vibe coding)

Use these so agents and humans **never guess wire names or ERM3 semantics**:

| Tool | Purpose |
|------|---------|
| **`client.discover()`** | Markdown or **JSON** digest (`format="json"`, `to_stdout=False`): each method includes **`description`**, **`parameters`** (name, type, required, defaults, enums), **`returns`**, plus **`tool_definition_hints`** for Claude Desktop / MCP-style tool synthesis. |
| **Ticker alias** | Curated remap (e.g. GOOGL→GOOG) logs `info` and emits **`ValidationWarning`** (`Warning:` … `Fix:`) so agents refresh symbols. |
| **`to_llm_context(obj)`** | One call → Markdown tables + lineage + **semantic cheatsheet** + ERM3 legend (`obj` = `DataFrame`, `PortfolioAnalysis`, `xarray.Dataset`, or `dict`). |
| **`df.attrs["legend"]`** | Short ERM3 text on **every** tabular result from the client (same as `SHORT_ERM3_LEGEND`). |
| **`df.attrs["riskmodels_semantic_cheatsheet"]`** | Wire→semantic map + column hints + units (JSON + bullet list). Ground truth for field names. |
| **`df.attrs["riskmodels_lineage"]`** | JSON string: model version, as-of, factor set, universe size when the API sent them. |
| **`df.attrs["riskmodels_kind"]`** | What produced the frame (`ticker_returns`, `portfolio_per_ticker`, `tickers_universe`, …). |
| **`validate="warn"` \| `"error"` \| `"off"`** | ER sum + HR sign checks; **`Error:` / `Warning:` … `Fix:`** strings for self-correction. |
| **`attach_sdk_metadata` / `ensure_dataframe_legend`** | If you build a `DataFrame` manually, attach the same attrs so `to_llm_context` stays consistent. |
| **`build_semantic_cheatsheet_md()`** | Standalone cheatsheet string for custom prompts. |

**Semantic names (always use in code and LLM explanations):** `l3_market_hr`, `l3_sector_hr`, `l3_subsector_hr`, `l3_market_er`, … — not raw V3 keys like `l3_mkt_hr`. Batch Parquet/CSV wire columns `l1`/`l2`/`l3` are renamed to those three **L3 component** HR series (not “L1/L2/L3 model levels”). Full reference (repo root):

- [`SEMANTIC_ALIASES.md`](https://github.com/Cerebellum-Archive/RiskModels_API/blob/main/SEMANTIC_ALIASES.md) (same file as [`../../SEMANTIC_ALIASES.md`](../../SEMANTIC_ALIASES.md) when this README is viewed inside the monorepo)
- [`docs/ERM3_ZARR_API_PARITY.md`](https://github.com/Cerebellum-Archive/RiskModels_API/blob/main/docs/ERM3_ZARR_API_PARITY.md)

**Tip for agents:** Prefer `get_metrics(..., as_dataframe=True)` so you get attrs; the plain `dict` return has no `attrs`.

**Cursor:** [`.cursorrules`](https://github.com/Cerebellum-Archive/RiskModels_API/blob/main/.cursorrules) (math, naming, batch semantics).

## PyPI distribution name vs import

- **Install from PyPI:** `pip install riskmodels-py` (and optionally `pip install riskmodels-py[xarray]`).
- **Import in Python:** `from riskmodels import …` — the **distribution** on PyPI is `riskmodels-py`; the **package** directory is `riskmodels`.

Core runtime dependencies are **pandas**, **pyarrow**, and **httpx** (HTTP). **xarray** is optional (`[xarray]` extra). The SDK does not depend on `requests`.

## Publishing to PyPI (maintainers)

Build and upload from this directory (**`sdk/`**, not `packages/riskmodels/` — that layout was retired; see repo `CHANGELOG.md`).

1. Bump **`version`** in [`pyproject.toml`](./pyproject.toml) for every upload (PyPI rejects duplicate versions).
2. Build and verify:

```bash
cd sdk
python3 -m pip install -U build twine
python3 -m build
python3 -m twine check dist/*
```

3. **TestPyPI (optional):** `python3 -m twine upload --repository testpypi dist/*` — install with  
   `pip install --index-url https://test.pypi.org/simple/ riskmodels-py`
4. **Production:** `python3 -m twine upload dist/*` — use PyPI username `__token__` and an API token as the password.

## License

Proprietary — same terms as RiskModels API access.
