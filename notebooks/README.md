# RiskModels notebooks

## Quickstart — automated “Run All”

The quickstart notebook reads the API key from the environment when set (so CI and scripts never need to edit the file):

| Variable | Notes |
|----------|--------|
| `RISKMODELS_API_KEY` | Same name as the Python SDK; put in `.env.local` for `npm run test:notebook` |
| `RISKMODELS_QUICKSTART_API_KEY` | Explicit name for the harness only |
| `TEST_API_KEY` | GitHub Actions smoke / notebook workflows |

The harness loads **`.env.local`** automatically (does not override vars already exported).

```bash
cd /path/to/RiskModels_API
python -m venv .venv && source .venv/bin/activate
pip install -r notebooks/requirements-notebook-test.txt

# Option A: key already in .env.local as RISKMODELS_API_KEY=...
python scripts/execute_quickstart_notebook.py

# Option B: export explicitly
export RISKMODELS_QUICKSTART_API_KEY="rm_user_…"
python scripts/execute_quickstart_notebook.py
```

Optional: save the executed notebook with output:

```bash
python scripts/execute_quickstart_notebook.py --output notebooks/.quickstart-executed.ipynb
```

Cells tagged **`skip-ci`** (OpenAI bonus, Colab `!npm` install) are replaced with a stub unless you pass **`--no-skip-ci`**.

The harness sets a temporary **`IPYTHONDIR`** so a broken `~/.ipython` profile or startup scripts cannot fail the run (common when IPython upgraded).

From the repo root, npm shortcut:

```bash
npm run test:notebook
```
