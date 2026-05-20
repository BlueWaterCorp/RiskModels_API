# Anthropic cloud agents + RiskModels API

**Canonical strategy (cross-repo):** **Client Memory Layer (CML)** vs vendor **managed-runtime thread memory**, **`.net`** vs **`.app`** ownership, activation-first sequencing, and phased build live in the **BWMACRO** hub: `docs/architecture/intelligence_runtime/MANAGED_COGNITIVE_RUNTIME_STRATEGY.md` (sibling clone per `docs/SUBMODULES.md`). **This file** stays **implementation-only**: Anthropic SKUs, spike, billing hooks, compliance — not CML schema.

**Status:** Engineering design — captures SKU decision, spike procedure, billing model for a future **Claude Managed Agents** integration, and compliance notes. Does not change runtime behavior of `POST /api/chat` (OpenAI) until Option A is explicitly scheduled.

---

## 1. SKU decision (Options A / B / C)

| Option | Description | Decision |
|--------|-------------|----------|
| **A** | **Claude Messages API** — replace the OpenAI loop in `app/api/chat` with Anthropic `messages` + `tool_use` / `tool_result`; same stateless request shape. | **Primary near-term** when we invest in “Claude in `/api/chat`”: smallest billing surface, no Anthropic session-runtime meter. |
| **B** | **Claude Managed Agents** — Anthropic-hosted sessions (SSE, persisted history, agent toolsets, optional MCP); see [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview). | **Phase 2 / gated**: run [`scripts/spike-claude-managed-agents.mjs`](../scripts/spike-claude-managed-agents.mjs), compare token + **active session time** + RiskModels MCP debits vs. product value. API is **beta** (`anthropic-beta: managed-agents-2026-04-01`). |
| **C** | **MCP-only** — clients use Cursor, Claude Desktop, or any MCP host against `https://riskmodels.app/api/mcp/...` with their API key. | **Always-on distribution**: already shipped; keep docs and install UX strong. **No substitute** for hosted `/api/chat` but lowest lift for “cloud shift” narratives. |

**Resolved:** Ship **C** continuously; pursue **A** on the existing chat path when product asks for Claude quality / prompt caching without session economics; pursue **B** only after a successful internal spike and pricing sign-off.

### Phase alignment (see BWMACRO strategy §5)

| Build phase | Typical LLM path on `.app` | Managed agents (Option B) |
|-------------|--------------------------|---------------------------|
| **Phase 1 — activation + CML** | **A** or current OpenAI loop for thin chat copy; prioritize `/snapshot` | **Defer** — not on cold onboarding path |
| **Phase 2 — retained research** | **A** stays valid for developers | **B** gated on spike +$/session proof; `.net`-side sessions |
| **Phase 3 — workspace scale** | Unchanged MCP + REST | Optional hybrid |

---

## 2. Current product baseline (unchanged by this doc)

- **`POST /api/chat`** — OpenAI tool loop, capability `chat-risk-analyst`: per-token LLM + per-tool debits aligned with REST capabilities (`lib/agent/billing-middleware.ts`, `lib/agent/capabilities.ts`).
- **MCP** — Bearer `Authorization`; each tool call bills like the underlying REST route (`mcp/data/openapi.json`).

---

## 3. Time-boxed spike (Option B)

**Goal:** Validate create agent → environment → session → send message → stream until idle; record wall time and IDs for cost follow-up in Anthropic Console.

**Prerequisites:**

- `ANTHROPIC_API_KEY` with Managed Agents access (beta header required on all calls).
- Optional: `ANTHROPIC_MANAGED_AGENTS_SPIKE_MODEL` (default `claude-haiku-4-5` in script).
- **RiskModels MCP inside the agent** is a follow-on: configure MCP servers on the [agent definition](https://platform.claude.com/docs/en/managed-agents/quickstart) per Anthropic docs; use a test `RISKMODELS_API_KEY` and monitor **billing_events** / balance for MCP tool traffic.

**Run:**

```bash
export ANTHROPIC_API_KEY=...
node scripts/spike-claude-managed-agents.mjs
```

**Measure:** Wall-clock session duration (script logs), then reconcile with Anthropic usage/billing for **tokens** and **managed session runtime** (verify current rates on [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)). Compare with a comparable task via **`POST /api/chat`** (token + tool USD).

---

## 4. Billing design (Option B — when/if enabled)

Upstream Anthropic charges at least:

- **Tokens** (input/output/cache) at published model rates.
- **Managed session runtime** while the session status is **running** (verify latest $/hour or $/minute on Anthropic pricing; third-party summaries are not contractual).

Downstream RiskModels charges (unchanged):

- **MCP / REST tools** — same as today per capability.

Customer-facing packaging options:

1. **BYO Anthropic + our MCP** — customer pays Anthropic directly; we bill only RiskModels tool usage (simplest).
2. **RiskModels-hosted sessions** — we pay Anthropic; customer pays prepaid balance with **pass-through + margin** on tokens + session time + existing tool debits.

**Proposed capability IDs** (register in `lib/agent/capabilities.ts` + OpenAPI only when product ships B):

| Capability id | Meter | Notes |
|---------------|-------|--------|
| `managed-agent-input-tokens` | Per 1K tokens (in) | Map from Anthropic usage logs. |
| `managed-agent-output-tokens` | Per 1K tokens (out) | Same. |
| `managed-agent-session-minute` | Per minute **running** | Round up/down per finance policy; confirm vs Anthropic meter. |
| *(existing)* `metrics-snapshot`, `ticker-returns`, … | Per MCP/REST call | Unchanged. |

**Preflight / caps:** Extend `agent_accounts` (or a new table) with **max concurrent sessions** and **daily session-time budget** before creating a session server-side.

**Internal ops:** Dashboard line: Anthropic invoice vs. revenue (tokens + session + tool); alert when tool/MCP cost dominates margin.

**Code pointer:** Design constants live in [`lib/agent/managed-agent-billing-design.ts`](../lib/agent/managed-agent-billing-design.ts) until capabilities are wired.

---

## 5. Data residency, subprocessors, and session state (Option B)

When using **Claude Managed Agents**, **user prompts, assistant outputs, and tool traces** for the session are processed and **persisted by Anthropic’s managed session store** (with their container/runtime for built-in tools). That is a different data boundary than stateless `POST /api/chat` today.

**Action items before enterprise sales of hosted B:**

1. Update customer-facing **subprocessor / DPA** list to include **Anthropic** for managed-agent workloads (and any MCP hosts if not already covered).
2. Document in Terms / security page: **what** is sent to Anthropic (prompts, holdings/tickers from tool args, etc.).
3. Offer **BYO key / BYO Anthropic org** where customers require **zero** RiskModels-hosted LLM spend (pattern 1 in §4).
4. Review **branding** constraints for partners ([Anthropic Managed Agents branding guidelines](https://platform.claude.com/docs/en/managed-agents/overview)).

---

## 6. Next steps (product)

1. **Phase 1 / activation:** Prefer **snapshot latency + Client Memory Layer** on `.net` (`MANAGED_COGNITIVE_RUNTIME_STRATEGY.md` §3–§5). For Claude on `.app` chat only: **Option A** behind flag; avoid session-meter paths on first visit.
2. **Phase 2:** Complete **managed-agents spike** metrics + pricing; then bridge routes (`/api/managed-sessions/...`) + billing capability IDs — only if `.net` product adopts Option B for retained threads.
3. Keep **Option C** on [quickstart](https://riskmodels.app/quickstart) and MCP install flows.

---

*Last updated: aligned with `MANAGED_COGNITIVE_RUNTIME_STRATEGY.md` (Client Memory Layer, phased build).*
