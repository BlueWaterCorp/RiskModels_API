#!/usr/bin/env node
/**
 * Time-boxed spike: create Managed Agent + environment + session, send one user message, stream until idle.
 * Requires: ANTHROPIC_API_KEY
 * Optional: ANTHROPIC_MANAGED_AGENTS_SPIKE_MODEL (default claude-haiku-4-5)
 *
 * @see docs/ANTHROPIC_CLOUD_AGENTS.md
 */

const API = "https://api.anthropic.com";
const BETA = "managed-agents-2026-04-01";
const VERSION = "2023-06-01";

function headers() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }
  return {
    "x-api-key": key,
    "anthropic-version": VERSION,
    "anthropic-beta": BETA,
    "content-type": "application/json",
  };
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} ${res.status}: non-JSON body: ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

const model =
  process.env.ANTHROPIC_MANAGED_AGENTS_SPIKE_MODEL?.trim() || "claude-haiku-4-5";

async function main() {
  const t0 = Date.now();
  console.error("[spike] model:", model);

  const agent = await post("/v1/agents", {
    name: "RiskModels Spike Agent",
    model,
    system:
      "You are a minimal test agent. Reply with a single short sentence. Do not use tools unless required.",
    tools: [{ type: "agent_toolset_20260401" }],
  });
  console.error("[spike] agent id:", agent.id, "version:", agent.version);

  const environment = await post("/v1/environments", {
    name: `rm-spike-env-${Date.now()}`,
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
    },
  });
  console.error("[spike] environment id:", environment.id);

  const session = await post("/v1/sessions", {
    agent: agent.id,
    environment_id: environment.id,
    title: "RiskModels managed-agents spike",
  });
  console.error("[spike] session id:", session.id);

  await post(`/v1/sessions/${session.id}/events`, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: "Say hello in exactly five words." }],
      },
    ],
  });

  const streamUrl = `${API}/v1/sessions/${session.id}/stream`;
  const streamRes = await fetch(streamUrl, {
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": VERSION,
      "anthropic-beta": BETA,
      Accept: "text/event-stream",
    },
  });
  if (!streamRes.ok) {
    const errText = await streamRes.text();
    throw new Error(`stream ${streamRes.status}: ${errText.slice(0, 500)}`);
  }

  const reader = streamRes.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  let sawIdle = false;

  while (!sawIdle) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev;
      try {
        ev = JSON.parse(payload);
      } catch {
        continue;
      }
      if (ev.type === "session.status_idle") {
        sawIdle = true;
        console.error("[spike] session.status_idle");
        break;
      }
      if (ev.type === "agent.message") {
        const parts = ev.content || [];
        for (const p of parts) {
          if (p.type === "text" && p.text) process.stdout.write(p.text);
        }
      }
    }
  }

  console.log("");
  const elapsedSec = (Date.now() - t0) / 1000;
  console.error("[spike] wall_clock_seconds:", elapsedSec.toFixed(2));
  console.error(
    "[spike] Next: compare Anthropic Console usage (tokens + managed session time) with this wall clock; wire RiskModels MCP per docs when validating double-billing.",
  );
}

main().catch((e) => {
  console.error("[spike] failed:", e.message || e);
  process.exit(1);
});
