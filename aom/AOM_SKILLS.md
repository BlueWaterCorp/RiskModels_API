# AOM skills (intent shorthand)

**Status**: Draft  
**Updated**: 2026-04-29  

**Skills** are **optional `intent` labels** that expand to preset **`AOMRequest`** fields. They **do not** add ontology — see [`AOM_SPEC.md`](./AOM_SPEC.md).

---

## Rules

1. **`intent` is optional** on any request.
2. **Explicit AOM fields override** preset defaults from intent.
3. **Compilation**: `intent` → expand presets → merge with explicit fields → validate → compile per [`AOM_MIGRATION.md`](./AOM_MIGRATION.md).

---

## Presets

| intent | Default expansion (illustrative) |
|--------|-----------------------------------|
| `explain_return` | `lens: return_attribution`, `attribution_mode: incremental`, `output_mode: explanation` |
| `reduce_risk` | chain: `analyze(risk_decomposition, snapshot)` → `hedge_action(previous)` |
| `find_hidden_bets` | `lens: exposure`, `view: distribution`, `resolution: full_stack` |
| `compare_peers` | requires `subject.type: comparison`; default `alignment` shared + normalize true |
| `screen_universe` | requires `subject.type: universe`; lens/risk defaults product-defined |

---

## Non-goals

- Skills do **not** define new lenses, views, or endpoints.
- Skills do **not** replace chains — hedge workflows remain **`ChainStage`**.
