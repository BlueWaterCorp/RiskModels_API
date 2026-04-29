# SDK refactor plan (AOM-aligned)

**Status**: Draft  
**Updated**: 2026-04-29  

This plan aligns Python-first and TypeScript SDKs with [`AOM_SPEC.md`](./AOM_SPEC.md) and [`AOM_TYPES.ts`](./AOM_TYPES.ts). **No execution in this document** — structure only.

**First implementation slice:** [`SDK_BUILDER_V1.md`](./SDK_BUILDER_V1.md) (minimal builder, supported ops, non-goals).

---

## Target interface (Python — illustrative)

Fluent builder compiles to **`AOMSingleRequest` | `AOMChainRequest`** then to **`ExecutionPlan`** (see [`AOM_MIGRATION.md`](./AOM_MIGRATION.md)):

```python
# Single request
rm.subject(stock("TSLA")).scope(preset="ytd", as_of="latest").analyze(
    lens="return_attribution",
    attribution_mode="incremental",
    resolution="full_stack",
    view="timeseries",
).emit(output_mode="structured")

# Chain
rm.subject(portfolio_inline([...])).scope(preset="mtd", as_of="latest").chain(
    analyze(lens="exposure", resolution="full_stack", view="snapshot"),
    hedge_action(depends_on="previous"),
).emit(output_mode="structured")
```

TypeScript mirrors with typed builders returning **`AOMRequest`** objects suitable for `compile()` in the Risk_Models client.

---

## Mapping SDK → API

| Builder terminal / field | Compiler uses |
|--------------------------|----------------|
| `lens`, `attribution_mode`, `resolution`, `view`, `scope` | Row selection + aggregation per [`AOM_MIGRATION.md`](./AOM_MIGRATION.md) |
| `chain[]` | Sequential compile; hedge stage consumes prior analyze outputs |
| `intent` | Expanded to defaults before compile — explicit builder args win |

---

## Migration strategy

1. **Preserve** existing helpers (`getReturns`, `getLatestMetrics`, …) unchanged signatures.
2. **Introduce** `request_from_aom(aom: AOMRequest)` **or** fluent builder that **only** emits `AOMRequest` + compile layer.
3. **Implement compiler once** — shared by SDK, agents, and MCP.
4. **Deprecate** ad hoc parameter bags after dual period (TBD).

---

## Risks

| Risk | Mitigation |
|------|------------|
| Website breakage (riskmodels_com) | Ship dual API; migrate screens method-by-method |
| Complexity vs usability | Fluent builder optional; plain `AOMRequest` JSON always valid |
| Attribution semantics drift | Single compiler module; tests incremental vs cumulative |

---

## Rollout

| Phase | Scope |
|-------|--------|
| 1 | AOM types + compiler internal to SDK alpha |
| 2 | Dual interface — legacy + `from_aom` |
| 3 | Default entry points emit AOM; deprecations |

---

## Repositories

- **RiskModels_API** — [`aom/`](.) holds [`AOM_SPEC.md`](./AOM_SPEC.md), [`AOM_TYPES.ts`](./AOM_TYPES.ts), and migration docs — source of truth for the Analysis Object Model contract next to the HTTP API ([`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml)).
- **ERM3** — data pipeline / zarr producers only; does not own `aom/` (avoid drift).
- **Risk_Models / riskmodels_com** — consume types (copy or package) and implement compiler-backed client.
