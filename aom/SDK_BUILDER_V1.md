# SDK Builder — v1 minimal scope

**Status**: Stable (v1)  
**Updated**: 2026-04-29  

This document defines the **minimal SDK builder** that sits on [AOM_SPEC.md](./AOM_SPEC.md) and [AOM_TYPES.ts](./AOM_TYPES.ts). It is the execution bridge from **design → shipping code**.

---

## 1. Minimal interface (Python-style)

Illustrative fluent surface — implementations may use plain dicts/literals that conform to `AOMSingleRequest`.

```python
(
    rm.subject(stock("TSLA"))
    .scope(date_range_preset="ytd", as_of="latest")
    .return_attribution(
        attribution_mode="incremental",
        resolution="full_stack",
        view="timeseries",
    )
    .explain()   # sets output_mode="explanation"
)
```

Equivalent terminating calls: `.structured()`, `.visual()` for other `output_mode` values.

Builders **must** construct a valid **`AOMSingleRequest`** or **`AOMChainRequest`** object matching [AOM_TYPES.ts](./AOM_TYPES.ts).

---

## 2. Internal flow

1. **Build AOM object** — populate primitives only (no REST paths in user-facing API).
2. **Compile** — `AOMRequest → ExecutionPlan` (deterministic; see **AOM Compiler Contract** in [AOM_SPEC.md](./AOM_SPEC.md)).
3. **Execute** — `ExecutionPlan →` one or more calls to **existing** PostgREST resources ([AOM_MIGRATION.md](./AOM_MIGRATION.md)).

No hidden transforms outside published compiler rules.

---

## 3. Supported operations (v1 only)

| Operation | Subjects | Notes |
|-----------|----------|--------|
| `return_attribution` | `stock`, `portfolio` | Portfolio = weighted aggregation client-side or via existing patterns until dedicated API exists. |
| `exposure` | `stock`, `portfolio` | Snapshot / series per SPEC. |
| `comparison` | `comparison` | Independent legs + post hoc alignment per SPEC. |
| Simple chain | `exposure` → `hedge_action` | Two-entry `chain[]`; `depends_on: "previous"` as needed. |

Out of scope for v1 builder surface: arbitrary multi-branch graphs beyond **`depends_on`** as implemented.

---

## 4. Explicit non-goals

- No portfolio optimization or solver layer.
- No full query DSL beyond AOM primitives.
- No arbitrary DAG chaining beyond SPEC + minimal `depends_on`.
- No website/UI refactor — SDK-only boundary.

---

## 5. Relation to broader SDK refactor

See [SDK_REFACTOR_PLAN.md](./SDK_REFACTOR_PLAN.md) for dual API rollout and deprecation policy. **SDK_BUILDER_V1** is the **narrow slice** to implement first.
