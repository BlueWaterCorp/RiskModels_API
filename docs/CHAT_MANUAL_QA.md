# Manual QA: Agentic POST /api/chat

Smoke-test the AI Risk Analyst chat endpoint with a **real API key** and sufficient prepaid balance. Chat is billed **per LLM token** plus **per data tool** (same rates as the matching REST capabilities). Tool `search_tickers` is **free**.

For authentication patterns, see [AUTHENTICATION_GUIDE.md](../AUTHENTICATION_GUIDE.md).

## Prerequisites

1. **Server-side:** `MOONSHOT_API_KEY` (or `ANTHROPIC_API_KEY`) must be set wherever the Next app runs (local `.env.local`, Vercel, etc.). If missing, chat returns **503** with a configuration message.
2. **Client-side:** A valid RiskModels **API key** or session JWT (`Authorization: Bearer …`). Keys are created after login at [riskmodels.app](https://riskmodels.app) (Account → Usage / API).
3. **Balance:** Enough credits for at least one chat turn (LLM estimate + 1–2 tools). Typical NVDA smoke test: roughly a few thousandths of a dollar LLM + **metrics-snapshot** + **ticker-returns** (see preflight below).
4. **Tier:** Chat uses capability `chat-risk-analyst` (premium per-token). Free-tier-only accounts may get **402** or tier limits from `withBilling`; that is expected until upgraded.

Set a base URL and key for the examples:

```bash
export BASE_URL="https://riskmodels.app"   # or http://localhost:3000 for local dev
export RISKMODELS_API_KEY="rm_agent_live_..."  # your key
```

## 1. Preflight: cost estimate (optional)

Confirms the `chat` mapping and lists **per-tool** reference prices (`available_tools`). LLM line is an estimate only; actual token usage is returned on the real chat response.

```bash
curl -sS -X POST "$BASE_URL/api/estimate" \
  -H "Authorization: Bearer $RISKMODELS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "chat",
    "params": {
      "messages": [{ "role": "user", "content": "What is NVDA'\''s L3 market hedge ratio?" }]
    }
  }' | jq .
```

Expect: `estimated_cost_usd`, `note` mentioning tool billing, and `available_tools[]` with `name`, `capability_id`, `cost_per_call_usd`.

## 2. Primary smoke test (curl)

Ask for a live metric **and** history so the model should call **get_risk_metrics** and **get_ticker_returns** (it may skip **search_tickers** when the ticker is explicit).

```bash
curl -sS -X POST "$BASE_URL/api/chat" \
  -H "Authorization: Bearer $RISKMODELS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What is NVDA'\''s current L3 market hedge ratio and how has it changed over the last year?"
      }
    ]
  }' | tee /tmp/chat-smoke.json | jq '{
    message: .message.content[:400],
    tool_calls_summary,
    _agent: ._agent
  }'
```

### Pass criteria

- **HTTP 200**
- **`message.content`:** Plain-language answer mentioning real-looking **l3_mkt_hr** (or equivalent) and some sense of change over time (not generic boilerplate only).
- **`tool_calls_summary`:** Non-null array with at least **two** entries in most runs (e.g. `get_risk_metrics`, `get_ticker_returns`). Tool names and `cost_usd` / `latency_ms` populated; `error` null unless a tool failed.
- **`_agent`:** `llm_cost_usd`, `tool_cost_usd`, `tool_calls`, `cost_usd` ≈ llm + tools, `request_id` set.
- **Cost line:** Body text often ends with a cost line; if the model omits it, the server appends **`**API tool costs:**`** (see `appendCostLineIfMissing` in the route).

Full JSON is useful for debugging:

```bash
jq . /tmp/chat-smoke.json
```

## 3. Optional request flags

```json
{
  "parallel_tool_calls": false,
  "execute_tools_sequentially": true
}
```

Add these next to `messages` to force OpenAI off parallel tool calls and/or run server-side tools one-by-one (useful if you suspect ordering or provider quirks).

## 4. Edge-case prompts (manual)

Run the same `curl` pattern; swap the user `content`:

| Scenario | Prompt (idea) | What to check |
|----------|----------------|---------------|
| Company name | “Tell me about Apple’s risk profile.” | `search_tickers` then metrics-style tools; plausible AAPL data. |
| Portfolio | “Analyze risk for 50% NVDA, 30% AAPL, 20% MSFT.” | `compute_portfolio_risk_index` in `tool_calls_summary`; structured portfolio fields in the answer. |
| Bad ticker | “Hedge ratio for ticker XYZZINVALID?” | Tool error in summary or structured error in narrative; **no invented numbers**. |
| Low balance | Use an account with ~$0 after a successful tool-heavy turn | Tool result or narrative mentions **insufficient balance** / top-up; `cost_usd` 0 on failed paid tools. |
| Large history | “Show TSLA daily context over 15 years.” | Response still bounded; returns data may show truncation / summary in tool payload. |
| Macro only | “How did gold vs bitcoin perform this year?” | Prefer **get_macro_factors** without stock tools (model-dependent). |

## 5. HTTP codes to expect

| Status | Meaning |
|--------|--------|
| **401** | Missing/invalid Bearer token. |
| **402** | Insufficient balance (or payment required) on the **chat** pre-charge. |
| **429** | Rate limit / free-tier limit (if applicable). |
| **502** | Upstream LLM error — Moonshot/Anthropic (bad key, outage, or bad model name). |
| **503** | `MOONSHOT_API_KEY` (or `ANTHROPIC_API_KEY`) not configured on the server. |

## 6. Local dev quick check

```bash
cd /path/to/RiskModels_API
# Ensure MOONSHOT_API_KEY and Supabase/env match a working deployment
npm run dev
```

Then point `BASE_URL` at `http://localhost:3000` and repeat the curl calls.

## 7. Typecheck (no live key)

```bash
npm run typecheck
```

This does not call OpenAI or Supabase; it only verifies the TypeScript build.

## 8. RiskModels portal (`riskmodels.net` / local dev)

The consumer portal proxies chat to the same RiskModels API (`POST /api/chat`) via **same-origin** `POST /chat` → `riskmodels_net` route `POST /api/chat` (see Risk_Models repo). Use this checklist in a browser (not only curl).

### Prerequisites (portal)

1. **Portal env:** `RISKMODELS_API_SERVICE_KEY` (or `GATEWAY_SERVICE_KEY`) if you want **anonymous** guest chat; otherwise guests get **503** (“sign in”). For **IP rate limits** across instances, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (anonymous: 5 requests/day/IP; authenticated users also use Redis for per-plan daily caps when configured).
2. **Logged-in test:** Cookie session on the portal; the proxy forwards the Supabase **JWT** to `riskmodels.app` so billing hits that user’s API account.
3. **Optional:** `cd Risk_Models/riskmodels_net && npm run typecheck && npm run build` (no live OpenAI).

### Logged-in UI pass

1. Open `/chat` while signed in.
2. Send the **primary** NVDA prompt (same as §2).
3. **Pass criteria:** Assistant markdown shows real metrics; expandable **Tools used** lists ≥2 tools with costs/latencies; footer badges show LLM / Tools / Total; `X-Chat-Auth: user` (DevTools → Network → `/api/chat` response headers).

### Anonymous / guest pass

1. Open `/chat` in a private window (no portal session).
2. Send a short prompt (e.g. company name or “Search for Apple”).
3. Expect **limited** responses, **amber** guest banner, and `X-Chat-Auth: anonymous` on `/api/chat`. After **5** requests/day from the same IP (with Upstash configured), expect **429** and sign-in / pricing CTAs.

### Subscription tier cap (authenticated)

Users without an **active/trialing** subscription are treated as **free** for portal daily caps (**5**/day). **Professional/Enterprise:** **100**/day. **Fintech:** no portal daily cap (`chat_queries_per_day: 0` in tier table = unlimited proxy turns; API billing still applies). Over cap → **429** with header `X-Chat-Quota: tier`.

### Edge cases (portal)

Repeat the scenarios in §4 in the **browser**; confirm tool errors appear in the tools panel and the assistant does not invent data for bad tickers.

### Streaming note

Portal UI currently consumes the **JSON** chat response. **SSE / `response_mode: hybrid`** streaming is **not** wired end-to-end until the public API exposes a stable stream contract and the portal proxy parses it; treat streaming as a follow-up.

---

**Summary:** One successful **primary** run with `tool_calls_summary` showing paid tools + sane `_agent` costs is enough for a minimal smoke pass. Use the edge-case table when hardening before release. For the portal, add §8 checks before shipping `riskmodels.net`.
