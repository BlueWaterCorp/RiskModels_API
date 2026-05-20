# Analysis Object Model (AOM) — Implementation Plan

**Status:** Superseded for day-to-day execution — see [aom_v1_sdk_execution_plan.md](./aom_v1_sdk_execution_plan.md) (locked SDK plan).  
**Verdict (historical):** Approximately 90–95% there — good enough to build on.

> Remaining work before SDK was structural clarity, not new ontology: close ambiguity leaks so implementations do not diverge.

---

## What is clearly solid (commit)

| Element | Status |
|---------|--------|
| AOM sits above the API (compiler → PostgREST tables) | Committed |
| Lens = three only (return_attribution, risk_decomposition, exposure) | Committed |
| Hedge moved to chain (kind: "hedge_action"), not a lens | Committed |
| View vs OutputMode clean (no summary view) | Committed |
| Subjects usable (stock, portfolio, universe, comparison) | Committed |
| Compiler formalized (AOM → ExecutionPlan → REST) | Committed |
| Agents doctrine defined (docs/agents.md) | Committed |

This is a coherent reasoning model, not only a schema.

---

## Normative checklist — seven items before SDK

These are blocking for SDK freeze as documented behavior (not optional opinions).

### Five structural fixes

| # | Requirement | Normative content |
|---|-------------|-------------------|
| 1 | attribution_mode | `"incremental"` \| `"cumulative"` — default incremental. Valid only when lens ∈ return_attribution, risk_decomposition. |
| 2 | Typed chain (no stringly stages) | `ChainStage = kind: "analyze"` (with lens, optional resolution, view, attribution_mode) or `kind: "hedge_action"` (optional depends_on). Forbidden: top-level key "stage" as stage discriminator. |
| 3 | as_of on scope | `"latest"` \| `"YYYY-MM-DD"`. Rule (normative): when view is snapshot and as_of is present, as_of overrides date_range for selecting the snapshot row / effective observation date (avoids hacks for "latest exposure", "month-end risk", "current snapshot"). Timeseries rules remain as in SPEC. |
| 4 | Comparison execution | Structure includes alignment: e.g. `{ "date_range": "shared", "normalize": true }`. Normative sentence: Comparison subjects are executed as independent analyses per leg and aligned post hoc according to alignment rules (SDK/compiler must not invent divergent merge semantics). |
| 5 | Explanation contract | Includes `confidence: high \| medium \| low` in addition to headline, key_drivers, optional_metrics. |

### Two small improvements

| # | Requirement | Normative content |
|---|-------------|-------------------|
| 6 | Error contract | If analysis cannot complete: return structured error. If output_mode: explanation still emitted: degrade gracefully (no silent failure). |
| 7 | Chain semantics | Chains execute sequentially by default. depends_on overrides straight-line ordering when a non-linear dependency is required. |

---

## Reconciliation — shipped artifacts (read when locking)

As of the last audit against **`RiskModels_API/aom/`** and cross-repo agent docs:

| # | Status |
|---|--------|
| 1–2 | attribution_mode and kind-based ChainStage appear implemented in SPEC + TS + examples (no `"stage"` key in `aom/`). |
| 3 | as_of present — confirm SPEC explicitly states snapshot override rule (§Normative #3); align wording if only precedence prose exists. |
| 4–5 | alignment + confidence present — confirm post hoc comparison sentence matches §Normative #4. |
| 6–7 | May be partially folded into explanation fallback — elevate to explicit sections per §Normative. |

---

## Reasoning axes (canonical framing)

| Axis | Primitives |
|------|------------|
| 1 — What | subject + scope |
| 2 — How | lens + resolution + attribution_mode |
| 3 — Output | view + output_mode |
| 4 — Workflow | chain + ChainStage[] |

---

## Final verdict (plan intent)

After the normative checklist is fully reflected in AOM_SPEC.md (and types/agents where needed):

> **Stop designing and start building.**

Past diminishing returns on abstraction — ship minimal SDK builder, then harden.

### Bottom line

Crossed from "good abstraction" to "system that won't collapse under real usage" once the seven items are locked in prose and types.

Suggested canonical next artifact: tight, production-ready AOM_SPEC.md as the single doc agents + SDK + users orbit — achieved by applying §Normative checklist + freeze.

---

## Execution order (post-freeze)

1. Update / finalize AOM_SPEC.md against §Normative checklist (including snapshot as_of rule and comparison sentence).
2. Lock AOM_TYPES.ts export surface (tag/version).
3. Build minimal SDK builder (avoid overbuilding).
4. Smoke tests: TSLA; portfolio; comparison; exposure → hedge chain.

---

## Strategic placement

AOM lives in **this repo** under [`aom/`](../aom/) next to [`OPENAPI_SPEC.yaml`](../../OPENAPI_SPEC.yaml). Agent constitution for callers remains in **ERM3** [`docs/agents.md`](../../../ERM3/docs/agents.md) (links back here). No breaking REST renames.

---

## Deliverables (RiskModels_API root)

| Path | Role |
|------|------|
| [`aom/AOM_SPEC.md`](../aom/AOM_SPEC.md) | Canonical spec |
| [`aom/AOM_TYPES.ts`](../aom/AOM_TYPES.ts) | Strict TS types |
| [`aom/AOM_SKILLS.md`](../aom/AOM_SKILLS.md) | Intent shorthand |
| [`aom/AOM_MIGRATION.md`](../aom/AOM_MIGRATION.md) | Compiler ↔ REST |
| [`aom/SDK_REFACTOR_PLAN.md`](../aom/SDK_REFACTOR_PLAN.md) | SDK rollout |

Related (ERM3): [`docs/agents.md`](../../../ERM3/docs/agents.md) — agent rules linking to this `aom/` folder.

---

## Diagram

```
flowchart LR
  subgraph axes [Reasoning]
    S[subject scope]
    H[lens resolution attribution_mode]
    P[view output_mode]
    W[chain]
  end
  axes --> Compiler[AOM Compiler]
  Compiler --> Plan[ExecutionPlan]
  Plan --> API[REST tables]
```

---

## Historical note

Invalid pattern from early drafts: `"stage": "analyze"`. Canonical stages use `kind: "analyze" | "hedge_action"` only.
