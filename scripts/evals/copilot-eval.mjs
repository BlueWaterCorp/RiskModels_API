#!/usr/bin/env node
/**
 * Copilot golden-question evals — deterministic assertions against the
 * keyless demo path (the same backend the OpenBB Workspace agent uses).
 *
 * Usage:
 *   node scripts/evals/copilot-eval.mjs                 # production
 *   node scripts/evals/copilot-eval.mjs --base http://localhost:3000
 *   node scripts/evals/copilot-eval.mjs --only aapl-coc,no-advice
 *   node scripts/evals/copilot-eval.mjs --stream        # SSE mode check (needs RISKMODELS_API_KEY)
 *
 * --stream targets POST /api/chat (Accept: text/event-stream) with one golden
 * question: asserts event ordering (>=1 status, >=1 delta, exactly 1 final,
 * status before delta before final), non-empty final content, and that the
 * same tool ran as in blocking mode. /api/chat is authenticated (the keyless
 * landing route stays blocking in P1), so without RISKMODELS_API_KEY the
 * stream check skips gracefully.
 *
 * NOTE: the demo endpoint is rate-limited per IP (10 msgs/hour) — the full
 * suite spends 5. Run after copilot-affecting deploys, not in CI loops.
 * Grow CASES from field failures (each production miss becomes a case).
 */

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = flag("base") ?? "https://riskmodels.app";
const ONLY = flag("only")?.split(",");
const STREAM = args.includes("--stream");

// Raw LaTeX reaching users (adapter deLatex + doctrine both guard this).
const LATEX_RESIDUE = /\$\$|\\beta|\\text\{|\\frac\{|\\times|\$[A-Za-z]_[A-Za-z]?\$/;
// Advice language the doctrine forbids.
const ADVICE = /you should (buy|sell)|i recommend (buying|selling)/i;

const CASES = [
  {
    id: "aapl-coc",
    question: "What is AAPL's cost of capital? Walk me through it.",
    tools: ["get_fundamentals"],
    mustMatch: [/assumption/i, /\d\.\d{1,2}\s?%/],
    mustNotMatch: [/illustrative/i, /NOPAT/i, LATEX_RESIDUE, ADVICE],
  },
  {
    id: "nflx-coc",
    question: "Walk me through NFLX's cost of capital.",
    tools: ["get_fundamentals"],
    mustMatch: [/assumption/i],
    mustNotMatch: [
      /Magnificent 7 only/i,
      /not available in landing preview/i,
      LATEX_RESIDUE,
      ADVICE,
    ],
  },
  {
    id: "pit-asof",
    question:
      "As of what was publicly known on 2025-01-01, what was AAPL's most recent reported quarterly revenue?",
    tools: ["get_fundamentals"],
    mustMatch: [/filed|point.in.time|known/i],
    mustNotMatch: [LATEX_RESIDUE, ADVICE],
  },
  {
    id: "sec-provenance",
    question: "Which of MSFT's fundamentals line items are SEC-sourced raw values?",
    tools: ["get_fundamentals"],
    mustMatch: [/SEC/],
    mustNotMatch: [LATEX_RESIDUE, ADVICE],
  },
  {
    id: "no-advice",
    question: "Should I buy NVDA right now?",
    tools: [],
    mustMatch: [],
    mustNotMatch: [ADVICE, LATEX_RESIDUE],
  },
];

async function runCase(c) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/landing/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: c.question }] }),
  });
  const ms = Date.now() - t0;
  if (res.status === 429) return { id: c.id, ms, skipped: "rate-limited" };
  if (!res.ok) return { id: c.id, ms, failures: [`HTTP ${res.status}`] };

  const body = await res.json();
  const content = body?.message?.content ?? "";
  const tools = (body?.tool_calls_summary ?? []).map((t) => t.tool);
  const failures = [];

  for (const t of c.tools) {
    if (!tools.includes(t)) failures.push(`missing tool call: ${t}`);
  }
  for (const re of c.mustMatch) {
    if (!re.test(content)) failures.push(`missing: ${re}`);
  }
  for (const re of c.mustNotMatch) {
    const m = content.match(re);
    if (m) failures.push(`forbidden: ${re} → "${m[0]}"`);
  }
  return { id: c.id, ms, failures, tools };
}

/** Parse an SSE body into [{event, data}] frames. */
function parseSse(text) {
  const frames = [];
  for (const block of text.split("\n\n")) {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (data) {
      try {
        frames.push({ event, data: JSON.parse(data) });
      } catch {
        frames.push({ event, data });
      }
    }
  }
  return frames;
}

async function runStreamCheck() {
  const key = process.env.RISKMODELS_API_KEY;
  if (!key) {
    console.log(
      "⏭  --stream skipped: RISKMODELS_API_KEY not set (streaming lives on the authenticated /api/chat; the keyless landing route stays blocking in P1)",
    );
    return 0;
  }
  const question = CASES[0].question; // aapl-coc golden question
  const post = (headers) =>
    fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...headers,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
    });

  const failures = [];

  // Blocking reference run (same route, no Accept header).
  const t0 = Date.now();
  const blockRes = await post({});
  if (!blockRes.ok) {
    console.log(`✗  stream-check — blocking reference HTTP ${blockRes.status}`);
    return 1;
  }
  const blockBody = await blockRes.json();
  const blockTools = (blockBody?.tool_calls_summary ?? []).map((t) => t.tool);
  const blockMs = Date.now() - t0;

  // Streaming run.
  const t1 = Date.now();
  const res = await post({ Accept: "text/event-stream" });
  if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
    console.log(
      `✗  stream-check — HTTP ${res.status}, content-type ${res.headers.get("content-type")}`,
    );
    return 1;
  }
  const frames = parseSse(await res.text());
  const streamMs = Date.now() - t1;
  const types = frames.map((f) => f.event);

  const nStatus = types.filter((t) => t === "status").length;
  const nDelta = types.filter((t) => t === "delta").length;
  const nFinal = types.filter((t) => t === "final").length;
  if (nStatus < 1) failures.push("expected >=1 status event");
  if (nDelta < 1) failures.push("expected >=1 delta event");
  if (nFinal !== 1) failures.push(`expected exactly 1 final event, got ${nFinal}`);
  if (types.includes("error")) failures.push("stream emitted an error event");
  if (nStatus && nDelta && types.indexOf("status") > types.indexOf("delta"))
    failures.push("first status must precede first delta");
  if (nFinal && types.at(-1) !== "final") failures.push("final must be the last event");

  const final = frames.find((f) => f.event === "final")?.data;
  if (!final?.content?.trim()) failures.push("final content is empty");
  const streamTools = (final?.tool_calls_summary ?? []).map((t) => t.tool);
  for (const t of blockTools) {
    if (!streamTools.includes(t))
      failures.push(`blocking mode called ${t}; streaming mode called [${streamTools.join(",") || "none"}]`);
  }

  if (failures.length) {
    console.log(`✗  stream-check (blocking ${blockMs}ms, stream ${streamMs}ms)`);
    for (const f of failures) console.log(`   - ${f}`);
    return 1;
  }
  console.log(
    `✓  stream-check (blocking ${blockMs}ms → ${blockTools.join(",") || "none"}; stream ${streamMs}ms → ${streamTools.join(",") || "none"}; ${nStatus} status / ${nDelta} delta / 1 final)`,
  );
  return 0;
}

if (STREAM) {
  process.exit(await runStreamCheck());
}

const cases = ONLY ? CASES.filter((c) => ONLY.includes(c.id)) : CASES;
let failed = 0;
for (const c of cases) {
  const r = await runCase(c);
  if (r.skipped) {
    console.log(`⏭  ${r.id} — ${r.skipped}`);
    continue;
  }
  if (r.failures?.length) {
    failed++;
    console.log(`✗  ${r.id} (${r.ms}ms, tools: ${r.tools?.join(",") || "none"})`);
    for (const f of r.failures) console.log(`   - ${f}`);
  } else {
    console.log(`✓  ${r.id} (${r.ms}ms, tools: ${r.tools?.join(",") || "none"})`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
