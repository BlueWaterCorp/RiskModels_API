#!/usr/bin/env node
/**
 * Copilot golden-question evals — deterministic assertions against the
 * keyless demo path (the same backend the OpenBB Workspace agent uses).
 *
 * Usage:
 *   node scripts/evals/copilot-eval.mjs                 # production
 *   node scripts/evals/copilot-eval.mjs --base http://localhost:3000
 *   node scripts/evals/copilot-eval.mjs --only aapl-coc,no-advice
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
