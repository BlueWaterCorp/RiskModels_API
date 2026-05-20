# AOM v1 — SDK execution plan (RiskModels API)

**Status:** Locked — design freeze; execution only  
**Updated:** 2026-04-29  

**Canonical spec & types (this repo):**

| Artifact | Path |
|----------|------|
| AOM spec (v1 stable) | [`aom/AOM_SPEC.md`](../aom/AOM_SPEC.md) |
| Strict TypeScript types | [`aom/AOM_TYPES.ts`](../aom/AOM_TYPES.ts) |
| Minimal SDK builder scope | [`aom/SDK_BUILDER_V1.md`](../aom/SDK_BUILDER_V1.md) |
| SDK refactor / rollout | [`aom/SDK_REFACTOR_PLAN.md`](../aom/SDK_REFACTOR_PLAN.md) |
| Compiler ↔ REST mapping | [`aom/AOM_MIGRATION.md`](../aom/AOM_MIGRATION.md) |

> **Rule:** No further AOM ontology redesign. Changes must preserve backward compatibility of primitives and semantics (see Stability Note in `AOM_SPEC.md`).

---

## Purpose of this document

Single **RiskModels_API** plan: what to implement after AOM v1 lock, how it relates to **`aom/`** in this repo, and explicit **non-goals**.

---

## Normative rules (verified in spec)

All seven items are explicit in `AOM_SPEC.md` § Normative rules (v1 freeze):

1. **attribution_mode** — `"incremental"` \| `"cumulative"`; default incremental; valid only for `return_attribution` and `risk_decomposition`.
2. **as_of + snapshot** — When `view = snapshot` and `as_of` is present, it selects the effective observation date and overrides `date_range` for that analysis.
3. **Comparison** — Comparison subjects are executed independently as full analyses and aligned post hoc according to alignment rules.
4. **ChainStage** — Discriminator is **`kind` only**; never a JSON key named `"stage"`.
5. **Explanation** — `headline`, `key_drivers`, `optional_metrics`, `confidence` ∈ `high` \| `medium` \| `low`.
6. **Partial structured output** — Explanation MUST degrade gracefully and MUST NOT contradict available data.
7. **Chain order** — Chains execute sequentially by default; `depends_on` overrides execution order when present.

---

## Implementation flow (consumer)

1. **Build** — Construct `AOMSingleRequest` \| `AOMChainRequest` (JSON-serializable objects aligned with `AOM_TYPES.ts`).
2. **Compile** — `AOMRequest → ExecutionPlan` (deterministic; single compiler module shared by SDK, agents, MCP).
3. **Execute** — `ExecutionPlan →` existing PostgREST resources (see `AOM_MIGRATION.md`); no breaking REST renames.

Internal fluent API (illustrative):

```python
rm.subject(stock("TSLA")).scope(...).return_attribution(...).explain()
```

Terminals: `.explain()`, `.structured()`, `.visual()` for `output_mode`.

---

## v1 supported operations

| Operation | Subjects | Notes |
|-----------|----------|--------|
| `return_attribution` | stock, portfolio | Portfolio weighting per existing patterns until dedicated aggregates exist. |
| `exposure` | stock, portfolio | Snapshot / series per spec. |
| `comparison` | comparison | Independent legs + post hoc alignment. |
| Chain | exposure → `hedge_action` | `chain[]` with `depends_on: "previous"` as needed. |

---

## Explicit non-goals (v1)

- No portfolio optimization or solver layer.
- No full query DSL beyond AOM primitives.
- No arbitrary DAG chaining beyond spec + minimal `depends_on`.
- No mandatory website/UI refactor — SDK boundary; migrate screens incrementally if desired.

---

## Rollout phases (SDK_REFACTOR_PLAN summary)

| Phase | Scope |
|-------|--------|
| 1 | AOM types + compiler internal to SDK (alpha). |
| 2 | Dual interface — legacy helpers + `from_aom` / builder. |
| 3 | Default entry points emit AOM; deprecations after dual period. |

---

## Smoke-test checklist

- Single-stock return attribution (e.g. TSLA), structured + explanation modes.
- Portfolio path (inline or id).
- Comparison (two legs, shared alignment).
- Simple chain: analyze exposure → `hedge_action`.

---

## Related local plan

Pre-lock checklist, diagram, and historical framing: [`AOM_plan.md`](./AOM_plan.md).

---

## External note (Cursor SDK)

The [cursor/cookbook](https://github.com/cursor/cookbook) repo demonstrates **Cursor’s** TypeScript SDK for coding agents (cloud/local agents, prompts). It is **not** the RiskModels PostgREST client. Use it only if integrating Cursor agents as a separate concern—not required for AOM compilation or REST execution.
