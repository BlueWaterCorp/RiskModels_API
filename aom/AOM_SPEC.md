# Analysis Object Model (AOM) Specification

**Status**: Stable (v1)  
**Updated**: 2026-04-29  

**AOM v1 Stability Note:**

This specification is considered stable. All future changes must preserve backward compatibility of primitives and semantics.

---

## Normative rules (v1 freeze)

The following rules are **explicit** and **non-negotiable** for compilers, SDKs, and agents.

1. **`attribution_mode`** — Values: `"incremental"` \| `"cumulative"`. **Default:** `"incremental"` (omitted means incremental for lenses where it applies). **Valid only when** `lens` ∈ {`return_attribution`, `risk_decomposition`}. Ignored for `exposure`.

2. **`as_of` (snapshot)** — When `view` = `'snapshot'` and `as_of` is present, it selects the effective observation date and overrides `date_range` for that analysis.

3. **Comparison execution** — Comparison subjects are executed independently as full analyses and aligned post hoc according to alignment rules.

4. **`ChainStage` typing** — Discriminator is **`kind` only** — never a JSON key named `"stage"`. Canonical form:

```typescript
type ChainStage =
  | {
      kind: "analyze";
      lens: Lens;
      resolution?: Resolution;
      view?: View;
      attribution_mode?: AttributionMode;
    }
  | {
      kind: "hedge_action";
      depends_on?: "previous" | string;
    };
```

5. **Explanation output** — When `output_mode` is `explanation`, output **must** include: `headline`, `key_drivers`, `optional_metrics`, and `confidence` where `confidence` ∈ {`"high"`, `"medium"`, `"low"`}.

6. **Error / explanation consistency** — If structured output is unavailable or partial, explanation **must** degrade gracefully and **must not** contradict available data.

7. **Chain execution order** — Chains execute sequentially by default. `depends_on` overrides execution order when present.

---

RiskModels expresses every analysis as: **a subject under a scope, through an analytic lens**, with orthogonal controls for **depth (resolution)**, **measurement (attribution mode)**, **data shape (view)**, and **rendering (output_mode)**. Optional **intent** labels presets without replacing primitives.

AOM is a **reasoning model**, not a REST façade. Endpoint paths belong only in compiler mapping docs ([AOM_MIGRATION.md](./AOM_MIGRATION.md)).

---

## Design principles

1. **Composability over endpoints** — compose primitives; compile to stable API calls.
2. **Minimal primitives** — no duplicate concepts across lens, view, output_mode, or attribution_mode.
3. **Separation of depth vs measurement** — **resolution** = hierarchy depth; **attribution_mode** = incremental vs cumulative (explained-share style).
4. **Separation of shape vs rendering** — **view** = data topology; **output_mode** = structured vs narrative vs visual.
5. **Hedge is chain-based, not a lens** — hedge workflows use **`ChainStage`** with **`kind: "hedge_action"`** after **`kind: "analyze"`** steps when needed.
6. **Agent-first naming** — semantic enums (`market_only`, `incremental`), never raw `L1/L2/L3` in user/agent payloads unless interoperating with legacy column names at compile time.
7. **AOM is not an API wrapper** — it describes intent; the compiler binds intent to tables and filters.

---

## Core primitives

### Subject

| Variant | Purpose |
|---------|---------|
| `stock` | Single equity by `ticker` and/or internal `symbol`. |
| `portfolio` | Weighted basket — inline holdings or external id. |
| `universe` | Named universe for screening-style workflows. |
| `comparison` | Two or more nested subjects with optional alignment rules. |

**Stock**

```json
{ "type": "stock", "ticker": "TSLA" }
```

**Portfolio**

```json
{
  "type": "portfolio",
  "source": "inline",
  "holdings": [{ "ticker": "AAPL", "weight": 0.6 }, { "ticker": "MSFT", "weight": 0.4 }]
}
```

```json
{
  "type": "portfolio",
  "source": "id",
  "portfolio_id": "my_book_001"
}
```

**Universe**

```json
{ "type": "universe", "universe_id": "uni_mc_3000" }
```

**Comparison**

```json
{
  "type": "comparison",
  "subjects": [
    { "type": "stock", "ticker": "AAPL" },
    { "type": "stock", "ticker": "NVDA" }
  ],
  "alignment": {
    "date_range": "shared",
    "normalize": true
  }
}
```

**Comparison semantics**

Comparison subjects are executed independently as full analyses and aligned post hoc according to alignment rules.

Additional constraints:

- **`alignment.date_range`**: `shared` means identical scope dates across legs (default contract).
- **`alignment.normalize`**: when true, comparative outputs use comparable scales (e.g. per-dollar or indexed series); exact normalization is compiler-defined per lens.
- The compiler **must not invent ad hoc merge logic** beyond what this spec and product-specific compiler tables define.

**Agents**: Prefer **`comparison`** when the user asks “vs”, “relative to”, or ranks peers on the same window. Use separate single-subject requests only when workflows are intentionally independent.

---

### Scope

```json
{
  "date_range": { "preset": "ytd" },
  "as_of": "latest",
  "frequency": "daily",
  "benchmark": "SPY"
}
```

**Fields**

| Field | Description |
|-------|-------------|
| `date_range` | `{ "preset": "ytd" \| "mtd" \| "1y" \| ... }` **or** `{ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }`. |
| `as_of` | `"latest"` **or** `"YYYY-MM-DD"` — observation / snapshot anchor. |
| `frequency` | Optional: `daily`, `monthly`, … |
| `benchmark` | Optional benchmark symbol for relative attribution where applicable. |

**`as_of` vs `date_range`**

- **`date_range`** defines the **analytic window** (history) when a series or windowed aggregation is requested.
- **`as_of`** selects the **effective observation date** for snapshot-style reads (`latest` or explicit calendar date).

**Normative snapshot rule (repeat):** When `view` = `'snapshot'` and `as_of` is present, it selects the effective observation date and overrides `date_range` for that analysis.

Product compilers map `as_of` to table-specific filters (e.g. latest row on or before `as_of`) consistent with this rule.

**Timeseries**: **`date_range`** bounds the series along the time dimension. If **`as_of`** is also set, it acts as the **inclusive end date** of the series (series ends at `as_of`). **`as_of`** does not reinterpret earlier points as snapshot overrides—those remain period-wise observations within the bounded range.

**Conflict rule**: **`as_of`** must not resolve **before** an explicit **`date_range.start`** when both are present; compilers **reject or coerce** per validation rules.

If **`as_of` is `latest`**, resolve using the newest available observation consistent with scope and table freshness rules.

---

### Lens

Exactly three analytic lenses:

| Lens | Intent |
|------|--------|
| `return_attribution` | How returns split across factors / levels over scope. |
| `risk_decomposition` | How variance / explained risk partitions across hierarchy. |
| `exposure` | Current or window-sensitive exposures (betas, balances relative to factors). |

**Hedge** is not a lens. Use **`ChainStage`** with `kind: "hedge_action"` after `risk_decomposition` or `exposure` when the user needs hedge notionals or ratios.

---

### Attribution mode

**Normative rule (repeat):**

- **Values:** `"incremental"` \| `"cumulative"`
- **Default:** `"incremental"` (omit field ⇒ incremental for lenses where applicable)
- **Valid only when** `lens` ∈ {`return_attribution`, `risk_decomposition`}. Ignored for `exposure`.

| Value | Meaning |
|-------|---------|
| `incremental` | **Default.** Orthogonal **per-period** contributions within the window (each period interpretable on its own). Period-wise series do not imply a single consolidated “share of total” unless combined under explicit cumulative semantics. |
| `cumulative` | **Window-level** attribution appropriate for **explained share / total-over-period** questions—one aggregated interpretation over **`date_range`** (CFR-style explained share where applicable). |

**Default**: **`incremental`** — omitting `attribution_mode` implies incremental for eligible lenses.

**Same request, two modes (only `attribution_mode` changes)**

Incremental — “what happened **period by period**?”

```json
{
  "subject": { "type": "stock", "ticker": "TSLA" },
  "scope": { "date_range": { "preset": "ytd" }, "frequency": "daily" },
  "lens": "return_attribution",
  "attribution_mode": "incremental",
  "resolution": "full_stack",
  "view": "timeseries",
  "output_mode": "structured"
}
```

Cumulative — “what share of **total** movement over YTD is attributed each way?”

```json
{
  "subject": { "type": "stock", "ticker": "TSLA" },
  "scope": { "date_range": { "preset": "ytd" }, "frequency": "daily" },
  "lens": "return_attribution",
  "attribution_mode": "cumulative",
  "resolution": "full_stack",
  "view": "timeseries",
  "output_mode": "structured"
}
```

**Output interpretation**: Under **`incremental`**, structured output emphasizes **orthogonal per-period** decomposition along `teo`. Under **`cumulative`**, structured output emphasizes **window-aggregated** attribution consistent with cumulative semantics for that lens (exact formulas live in compiler/product docs). Charts and explanations **must** label which mode was used.

**Agents**: Use **`cumulative`** for **share of total over the window**; use **`incremental`** for **what drove each period**.

---

### Resolution

Semantic depth (maps internally to L1/L2/L3; never expose raw `L*` in AOM payloads):

| Resolution | Role |
|------------|------|
| `market_only` | Deepest factor stack truncated to market level. |
| `market_sector` | Market + sector. |
| `full_stack` | Market + sector + subsector (ERM3 full hierarchy). |

---

### View

**Shape of data only** — no rendering implied:

| View | Meaning |
|------|---------|
| `snapshot` | Single point or cross-section. |
| `timeseries` | Ordered series over scope. |
| `distribution` | Distribution / histogram / cross-sectional spread shape. |

There is **no** `summary` view — summaries live under **`output_mode: explanation`** or structured aggregates.

---

### Output mode

**Rendering / consumer**:

| Mode | Meaning |
|------|---------|
| `structured` | Machine-facing rows/columns for APIs and tools. |
| `explanation` | Narrative bundle per **Explanation output contract** below. |
| `visual` | Chart/dashboard-oriented payloads or hints. |

---

### Optional intent

Optional string shorthand for presets — **does not** replace primitives:

```json
"intent": "explain_return"
```

Allowed values are defined in [AOM_SKILLS.md](./AOM_SKILLS.md). Compiler expands `intent` → full `AOMRequest` fields **before** execution; if both `intent` and explicit fields exist, **explicit fields win**.

---

## Chain

Multi-step analysis uses **`AOMChainRequest`**: ordered **`chain`** array of **`ChainStage`** values.

```typescript
type ChainStage =
  | {
      kind: "analyze";
      lens: Lens;
      resolution?: Resolution;
      view?: View;
      attribution_mode?: AttributionMode;
    }
  | {
      kind: "hedge_action";
      depends_on?: "previous" | string;
    };
```

**Execution**

Chains execute sequentially by default. `depends_on` overrides execution order when present.

**`kind: "analyze"`** entries carry lens-specific fields; omit optional fields where chain-level defaults apply (product-defined).

**`kind: "hedge_action"`** does not specify a lens; hedge notionals/ratios are derived from **structured outputs** of prior **`analyze`** entries (same REST HR/ER facets). Binding **which symbol or notionals** to hedge when the subject is a portfolio is **compiler-defined** from prior outputs—no extra primitive.

---

### Example — portfolio risk timeseries then hedge largest residual name

Illustrative workflow: (1) portfolio **`risk_decomposition`** as **`timeseries`**; (2) **from structured output**, identify the **largest residual-risk contributor** among constituents (product logic); (3) **`hedge_action`** applies hedge ratios **with respect to that symbol** using outputs chained from step 1–2. Step (2) is **not** a third `ChainStage` kind—it is **deterministic compiler orchestration** documented by product between **`analyze`** and **`hedge_action`**.

```json
{
  "subject": {
    "type": "portfolio",
    "source": "inline",
    "holdings": [
      { "ticker": "JPM", "weight": 0.5 },
      { "ticker": "BAC", "weight": 0.5 }
    ]
  },
  "scope": { "date_range": { "preset": "ytd" }, "as_of": "latest", "frequency": "monthly" },
  "chain": [
    {
      "kind": "analyze",
      "lens": "risk_decomposition",
      "attribution_mode": "incremental",
      "resolution": "full_stack",
      "view": "timeseries"
    },
    { "kind": "hedge_action", "depends_on": "previous" }
  ],
  "output_mode": "structured"
}
```

---

## Explanation output contract

When **`output_mode === "explanation"`**, producers **MUST** include:

| Field | Requirement |
|-------|----------------|
| `headline` | One sentence. |
| `key_drivers` | Ordered list (most important first). |
| `optional_metrics` | References / keys into structured output (not duplicated numeric derivations). |
| `confidence` | One of `high`, `medium`, `low`. |

**Partial or missing structured data**

- **Normative rule (repeat):** If structured output is unavailable or partial, explanation **must** degrade gracefully and **must not** contradict available data.
- Explanation **should** use shorter headline, fewer drivers, **`confidence`** lowered, **`caveats`** encouraged when partial.

**Failures**

- **Analysis failure**: return a **structured error** in the API/SDK envelope (no silent failure).
- If emitting explanation alongside partial failure modes allowed by product policy: diagnostic headline + **`confidence: low`**.

---

## Error contract (runtime)

| Situation | Requirement |
|-----------|-------------|
| Validation error | Structured error; no masked defaults that change meaning of primitives. |
| Execution failure | Structured error; explanation channel may carry human-readable diagnostic consistent with rules above. |

---

## AOM Compiler Contract

The compiler **maps** **`AOMSingleRequest` | `AOMChainRequest`** to a **deterministic `ExecutionPlan`** (ordered steps: resolve subjects, query facets, aggregate per `attribution_mode`, align comparisons, chain hand-offs).

**Rules**

1. **`ExecutionPlan` → one or more REST calls** against existing tables ([AOM_MIGRATION.md](./AOM_MIGRATION.md)); no undocumented side channels.
2. **Determinism**: same AOM + same data version → same plan shape (modulo explicit `as_of: latest` freshness).
3. **No hidden state**: transformations are explicit in plan steps (filters, joins, aggregations); agents and SDKs can log/replay plans.
4. **Implicit transforms forbidden**: anything not derivable from primitives + published compiler tables is an **error** or **explicit product extension** documented elsewhere—not silently injected.

---

## AOM Compiler (conceptual overview)

Compact pipeline reference:

```
AOMRequest | AOMChain → ExecutionPlan → REST calls (existing tables)
```

- **Lens → data source facet**: maps to return streams vs HR/ER tables vs snapshot metrics (see [AOM_MIGRATION.md](./AOM_MIGRATION.md)).
- **Resolution → hierarchy filter**: selects which level columns participate.
- **Attribution_mode → aggregation**: incremental vs cumulative aggregation semantics.
- **Chain**: **`ChainStage`** entries execute per normative rules above; **`hedge_action`** consumes prior structured outputs.

---

## JSON Schema (informative)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$defs": {
    "Lens": { "enum": ["return_attribution", "risk_decomposition", "exposure"] },
    "Resolution": { "enum": ["market_only", "market_sector", "full_stack"] },
    "View": { "enum": ["snapshot", "timeseries", "distribution"] },
    "OutputMode": { "enum": ["structured", "explanation", "visual"] },
    "AttributionMode": { "enum": ["incremental", "cumulative"] },
    "ChainStage": {
      "oneOf": [
        {
          "type": "object",
          "required": ["kind", "lens"],
          "properties": {
            "kind": { "const": "analyze" },
            "lens": { "$ref": "#/$defs/Lens" },
            "resolution": { "$ref": "#/$defs/Resolution" },
            "view": { "$ref": "#/$defs/View" },
            "attribution_mode": { "$ref": "#/$defs/AttributionMode" }
          },
          "additionalProperties": false
        },
        {
          "type": "object",
          "required": ["kind"],
          "properties": {
            "kind": { "const": "hedge_action" },
            "depends_on": {
              "oneOf": [{ "const": "previous" }, { "type": "string" }]
            }
          },
          "additionalProperties": false
        }
      ]
    }
  },
  "type": "object",
  "required": ["subject", "scope", "lens", "resolution", "view", "output_mode"],
  "properties": {
    "intent": { "type": "string" },
    "subject": { "type": "object" },
    "scope": { "type": "object" },
    "lens": { "$ref": "#/$defs/Lens" },
    "attribution_mode": { "$ref": "#/$defs/AttributionMode" },
    "resolution": { "$ref": "#/$defs/Resolution" },
    "view": { "$ref": "#/$defs/View" },
    "output_mode": { "$ref": "#/$defs/OutputMode" }
  }
}
```

The fragment above validates **`AOMSingleRequest`** only. **`AOMChainRequest`** uses **`chain`** instead of top-level **`lens` / `resolution` / `view`**; validate those payloads with a **`oneOf`** schema or separate `$defs` entry.

---

## Canonical examples

### 1. TSLA — incremental daily attribution (explain move)

```json
{
  "subject": { "type": "stock", "ticker": "TSLA" },
  "scope": {
    "date_range": { "preset": "ytd" },
    "as_of": "latest",
    "frequency": "daily"
  },
  "lens": "return_attribution",
  "attribution_mode": "incremental",
  "resolution": "full_stack",
  "view": "timeseries",
  "output_mode": "structured"
}
```

### 2. TSLA — cumulative explained share over YTD

```json
{
  "subject": { "type": "stock", "ticker": "TSLA" },
  "scope": { "date_range": { "preset": "ytd" }, "as_of": "latest" },
  "lens": "risk_decomposition",
  "attribution_mode": "cumulative",
  "resolution": "market_sector",
  "view": "snapshot",
  "output_mode": "explanation"
}
```

### 3. Comparison — AAPL vs NVDA

```json
{
  "subject": {
    "type": "comparison",
    "subjects": [
      { "type": "stock", "ticker": "AAPL" },
      { "type": "stock", "ticker": "NVDA" }
    ],
    "alignment": { "date_range": "shared", "normalize": true }
  },
  "scope": { "date_range": { "preset": "1y" }, "as_of": "latest" },
  "lens": "return_attribution",
  "attribution_mode": "incremental",
  "resolution": "full_stack",
  "view": "timeseries",
  "output_mode": "structured"
}
```

### 4. Portfolio — exposure then hedge (chain)

```json
{
  "chain": [
    {
      "kind": "analyze",
      "lens": "exposure",
      "resolution": "full_stack",
      "view": "snapshot"
    },
    { "kind": "hedge_action", "depends_on": "previous" }
  ],
  "subject": {
    "type": "portfolio",
    "source": "inline",
    "holdings": [{ "ticker": "XOM", "weight": 1.0 }]
  },
  "scope": { "date_range": { "preset": "mtd" }, "as_of": "latest" },
  "output_mode": "structured"
}
```

### 5. Universe — distribution of residual risk

```json
{
  "subject": { "type": "universe", "universe_id": "uni_mc_3000" },
  "scope": { "as_of": "latest" },
  "lens": "risk_decomposition",
  "attribution_mode": "incremental",
  "resolution": "full_stack",
  "view": "distribution",
  "output_mode": "visual"
}
```

---

## Naming conventions

- JSON keys: **`snake_case`**.
- Enum values: **`snake_case`** lowercase.
- Comparison alignment `date_range`: **`shared`** string literal.
