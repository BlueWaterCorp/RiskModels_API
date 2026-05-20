# Promote FundData reader from BWMACRO to public SDK

**Status:** Ready to implement
**Owner:** Cursor Composer 2 fast (or any agent picking this up)
**Reviewer:** Conrad Gann
**Estimated:** ~3 hours mechanical
**Prerequisite:** F1 canonical schema + reference renderer landed in `feat/d8-13f-api` (commit `87e5dc0`)

This spec is **prescriptive**. The architecture is settled — your job is to move code from BWMACRO to the public SDK while preserving the public/private trust direction.

---

## Goal

Move the `FundData` reader (dataclasses + GCS-zarr I/O) from `BWMACRO/src/bwmacro/snapshots/funds/_data.py` (private, 991 lines) to `RiskModels_API/sdk/riskmodels/snapshots/_fund_data.py` (public, currently a 103-line stub). After the move:

- `from riskmodels.snapshots import FundData, FundHolding, get_data_for_f1` works
- BWMACRO's `f1_tearsheet.py` and any other importers consume the *public* `FundData`, not their own local copy
- Cloud Run can render funds in pure Python without importing from `bwmacro.*`
- Anything Supabase-credential-dependent stays private in BWMACRO

Mirrors the existing pattern where `P1Data` is public in the SDK and BWMACRO's stock institutional renderers consume it.

---

## Read these first (mandatory)

In order:

1. **`BWMACRO/src/bwmacro/snapshots/funds/_data.py`** — the source. 991 lines. Read it end-to-end before deciding what moves and what stays. The header docstring documents the design.
2. **`RiskModels_API/sdk/riskmodels/snapshots/_fund_data.py`** — the current stub (103 lines). This gets replaced.
3. **`RiskModels_API/sdk/riskmodels/snapshots/_stock_data.py`** — `P1Data` is the public-SDK pattern. Mirror this.
4. **`RiskModels_API/sdk/riskmodels/snapshots/canonical_fund.py`** — `from_fund_components(FundData)` is the consumer. After your changes, the field shapes used here must still match.
5. **`BWMACRO/src/bwmacro/snapshots/funds/f1_tearsheet.py`** (1895 lines) — the BWMACRO consumer that needs its imports updated.

---

## Public/private split — decide this first

`_data.py` mixes two kinds of code:

| Public-safe (move to SDK) | Private (stay in BWMACRO) |
|---|---|
| `FundData` dataclass | Supabase-credential-dependent calls |
| `FundHolding` dataclass | `_supabase_query` helper |
| `_open_fund_zarr` (GCS-only, no auth) | `_resolve_holdings_metadata` (uses Supabase) |
| `_funds_latest_path` (path resolution) | `_resolve_l3_decomposition` (uses Supabase) |
| `from_fixture_row` (synthetic-fixture loader) | Any function that requires `BW_SUPABASE_URL` / `BW_SUPABASE_ANON_KEY` env vars |
| `load_fund_from_fixture` (file loader) | Any function that imports `bwmacro.*` |

`get_data_for_f1` is the orchestrator. **Audit it line-by-line** to determine what calls can run with public credentials only (GCS read of `gs://rm_api_public/funds/...` is public; Supabase reads need auth). Split it accordingly:

- **`get_data_for_f1` in public SDK** — reads GCS-zarr, returns a `FundData` populated with what zarr provides. No Supabase.
- **`enrich_fund_data_with_supabase(fund_data) -> FundData`** in BWMACRO — adds the holdings-metadata and L3-decomposition fields that today require Supabase. Returns an enriched `FundData`. BWMACRO's institutional renderer chains: `fd = riskmodels.snapshots.get_data_for_f1(id); fd = bwmacro.snapshots.funds.enrich(fd); render(fd)`.

If the audit reveals that `get_data_for_f1` cannot be cleanly split without rewriting too much, **stop and surface it**. A safer fallback is: move only the dataclasses (`FundData`, `FundHolding`) and the synthetic-fixture loader (`from_fixture_row`, `load_fund_from_fixture`); leave all GCS-zarr I/O in BWMACRO as a Phase-2 task. Document this clearly in your handoff so the boundary is obvious.

---

## Constraints

- **Do not modify P1 code.** P1 is contract-frozen.
- **Do not modify the canonical contract** in `canonical_fund.py`. The `FundData` shape must still match what `from_fund_components` consumes.
- **Do not import from `bwmacro.*` in the public SDK.** This is the inviolable boundary.
- **Do not import private credentials anywhere in the public SDK.** No Supabase keys, no auth tokens, no env-var lookups for credentialed services.
- **Do not leak BWMACRO-private logic** (Judgment derivation, narrative helpers, editorial vocabulary) into the public SDK.
- **Do not break BWMACRO's existing tests.** After the import-path update, BWMACRO's f1_tearsheet must still render correctly.
- **Do not break the public SDK's existing tests.** The synthetic round-trip + contract gate must still pass.
- **Do not preserve the stub.** Replace it. The stub was a placeholder; the real `FundData` is the goal.
- **Do not add new fields to `FundData`** that don't exist in the BWMACRO source. If you find a field needed for the canonical that BWMACRO doesn't provide, surface it.

---

## Deliverables

### 1. Audit the BWMACRO source

Produce a short audit (in your handoff message, not committed) listing:
- Each function in `_data.py` and whether it requires Supabase / BWMACRO imports
- Public-safe functions you're moving
- Private-staying functions and why

This forces you to think before moving code.

### 2. Replace `RiskModels_API/sdk/riskmodels/snapshots/_fund_data.py`

The stub becomes the real implementation. Move:

- `FundHolding` dataclass — verbatim from BWMACRO
- `FundData` dataclass — verbatim from BWMACRO
- Public-safe helpers — `_open_fund_zarr`, `_funds_latest_path`, `from_fixture_row`, `load_fund_from_fixture`, and any others your audit identifies
- `get_data_for_f1` — *only the public-safe path*. If splitting cleanly is hard, make it return the unenriched `FundData` and document that Supabase enrichment lives in BWMACRO

The new file should be ~400-700 lines depending on how much survives the public/private split.

### 3. Update `from_fund_components`

If `FundData`'s field names differ from the stub's, update `from_fund_components` in `canonical_fund.py` to match. The `CanonicalFundSnapshot` contract stays unchanged — only the adapter's input-side mapping shifts.

### 4. Refactor BWMACRO's `funds/_data.py`

Two clean approaches; pick whichever the audit makes natural:

- **Re-export shim:** `from bwmacro.snapshots.funds._data import FundData, FundHolding` becomes `from riskmodels.snapshots import FundData, FundHolding` (re-exported for back-compat). The BWMACRO file shrinks to the Supabase enrichment helpers + a backward-compatible re-export block. Existing BWMACRO importers don't need to change immediately.
- **Direct refactor:** delete the BWMACRO copy entirely and update every importer to use `riskmodels.snapshots`. Cleaner end state but a larger blast radius.

**Recommend the re-export shim.** Lower risk, smaller PR, and the importer migration can be a follow-up cleanup task if desired.

### 5. Update BWMACRO importers

At minimum, `f1_tearsheet.py`. Grep for any other file that imports from `bwmacro.snapshots.funds._data` and decide based on the approach above.

If you took the re-export shim route, no importer changes are strictly needed — but it's still good practice to update at least `f1_tearsheet.py` to import directly from `riskmodels.snapshots` so the trust direction is visible in the source.

### 6. Update SDK exports

Add to `RiskModels_API/sdk/riskmodels/snapshots/__init__.py`:

```python
from ._fund_data import (
    FundData,
    FundHolding,
    get_data_for_f1,
    from_fixture_row,
    load_fund_from_fixture,
    # ...any other public helpers your audit identified
)
```

Add to `__all__`. The existing `FundData` re-export from the stub stays — it just now points at the real implementation.

### 7. Synthetic-fixture path

Verify the existing synthetic test in `sdk/tests/test_canonical_fund_snapshot.py` still works. The test builds a `CanonicalFundSnapshot` directly without calling `FundData.from_*`, so changing `FundData`'s shape shouldn't break it — but if it does, fix the test minimally (don't alter the assertion logic).

If `from_fixture_row` is in the moved code, write a small test in `sdk/tests/test_canonical_fund_snapshot.py` (or a new `test_fund_data.py`) that round-trips `FundData` via `from_fixture_row` against a small inline dict.

---

## Acceptance criteria

Run these and paste output:

```bash
# 1. Public SDK tests (full suite, no regressions)
cd RiskModels_API
python -m pytest sdk/tests/test_canonical_snapshot.py \
                  sdk/tests/test_canonical_snapshot_contract.py \
                  sdk/tests/test_canonical_fund_snapshot.py \
                  sdk/tests/test_canonical_fund_snapshot_contract.py \
                  -p no:ethereum --no-header -q

# 2. CLI gate still works (P1 + F1 paths)
python -m riskmodels.snapshots.contract_check --all
python -m riskmodels.snapshots.contract_check --all --composition f1

# 3. Public imports work
python -c "from riskmodels.snapshots import FundData, FundHolding, get_data_for_f1; print('OK')"

# 4. BWMACRO tests still pass
cd ../BWMACRO
.venv/bin/python -m pytest src/bwmacro/snapshots/funds/ tests/snapshots/funds/ \
                            -p no:ethereum --no-header -q

# 5. BWMACRO f1_tearsheet still renders (run any existing render-test or smoke script)
# If a render smoke test exists in BWMACRO, run it. If not, document that no smoke test exists.

# 6. The public SDK does not import from bwmacro.*
grep -rn "from bwmacro\|import bwmacro" RiskModels_API/sdk/
# Expected: no matches
```

All six must pass. If anything breaks, fix or surface — don't push broken code.

---

## Out of scope (do not do these)

- Cloud Run service deployment (separate task, depends on this landing)
- Modifying `CanonicalFundSnapshot` shape
- Modifying P1 code or P1 tests
- Adding new GCS data sources or new fund universes
- Refactoring the Supabase enrichment helpers themselves (just isolate them)
- Moving `f1_tearsheet.py` or any BWMACRO renderer
- Promoting `FundJudgment` / Judgment derivation — that's BWMACRO-private editorial layer

---

## Handoff back

When done:

1. Paste the audit (function-by-function: public-safe vs private-staying with reasoning) — this is the most important part of the handoff.
2. Paste the output of the six acceptance commands.
3. List files moved, files modified, files deleted (one line each).
4. Note any places where the public/private split was awkward — these are conversation points, not failures.
5. Confirm: did you take the re-export shim route or the direct refactor route?
6. Stop. Don't touch Cloud Run, M1, or the polish work the intern is doing.

---

## Style notes

- Match the existing SDK code style. Frozen dataclasses where the data is immutable, regular dataclasses where mutation is expected.
- No comments explaining what code does. Comments only for non-obvious "why."
- No emojis. Institutional voice in docstrings.
- Don't add CHANGELOG entries; this lands as part of the F1 milestone.
- Keep the moved file's docstring honest about what it provides and what it doesn't (Supabase enrichment is in BWMACRO).
