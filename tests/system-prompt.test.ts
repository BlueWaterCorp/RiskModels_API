/**
 * `buildSystemPrompt` mechanics.
 *
 * This suite used to assert what the doctrine *says* — the non-advisor
 * boundary, the Aha-first shape, the negative-`l3_market_hr` warning — against
 * `tests/fixtures/analyst-doctrine-append.md`, a full copy of the doctrine
 * committed to this **public** repository since 2026-05-17 by the very change
 * that introduced the "thin public shell". The copy had also gone stale, which
 * is what made it visible: it was missing rules the SSOT had gained (H.153).
 *
 * Both problems have one fix. Content assertions belong next to the source, in
 * BWMACRO, where they cannot go stale and cannot be published. What belongs
 * here is the machinery: that a doctrine is loaded at all, that the
 * placeholder is substituted in place, which env var wins, and what happens
 * when neither is set.
 *
 * The fixture is therefore synthetic and says nothing. That is deliberate — a
 * mechanics test that needs real content is a mechanics test with a leak in it.
 */
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";

const syntheticDoctrinePath = path.join(
  process.cwd(),
  "tests/fixtures/synthetic-doctrine.md",
);

const savedEnv = {
  APPEND: process.env.ANALYST_SYSTEM_PROMPT_APPEND,
  PATH: process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH,
};

function clearEnv() {
  delete process.env.ANALYST_SYSTEM_PROMPT_APPEND;
  delete process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH;
}

afterAll(() => {
  clearEnv();
  if (savedEnv.APPEND !== undefined) {
    process.env.ANALYST_SYSTEM_PROMPT_APPEND = savedEnv.APPEND;
  }
  if (savedEnv.PATH !== undefined) {
    process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH = savedEnv.PATH;
  }
});

beforeEach(clearEnv);

describe("buildSystemPrompt — loading doctrine from a path", () => {
  const prompt = () => {
    process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH = syntheticDoctrinePath;
    return buildSystemPrompt("2026-05-12");
  };

  it("puts the loaded doctrine into the assembled prompt", () => {
    expect(prompt()).toContain("SYNTHETIC-DOCTRINE-MARKER-ALPHA");
    expect(prompt()).toContain("SYNTHETIC-RULE-ONE");
  });

  it("substitutes the tools placeholder rather than leaving the token", () => {
    const p = prompt();
    expect(p).not.toContain("{{TOOLS_AND_PERFORMANCE}}");
    expect(p).toMatch(/## Tools \(use them for live numbers\)/);
  });

  it("injects tools at the placeholder, not at the end", () => {
    // The synthetic fixture brackets the token with two markers, so position
    // is observable. Appending instead of substituting would put the tools
    // block after OMEGA and silently reorder a real doctrine.
    const p = prompt();
    const alpha = p.indexOf("SYNTHETIC-DOCTRINE-MARKER-ALPHA");
    const tools = p.indexOf("## Tools (use them for live numbers)");
    const omega = p.indexOf("SYNTHETIC-DOCTRINE-MARKER-OMEGA");
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(tools).toBeGreaterThan(alpha);
    expect(omega).toBeGreaterThan(tools);
  });

  it("does not fall back to the operational baseline", () => {
    expect(prompt()).not.toMatch(/Operational baseline/);
  });

  it("keeps the public shell identity line", () => {
    expect(prompt()).toMatch(/RiskModels AI Risk Analyst.*riskmodels\.app/s);
  });
});

describe("buildSystemPrompt — inline doctrine", () => {
  it("prefers the inline value over the path when both are set", () => {
    process.env.ANALYST_SYSTEM_PROMPT_APPEND = "## INLINE-DOCTRINE-MARKER\n\nbody";
    process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH = syntheticDoctrinePath;
    const p = buildSystemPrompt("2026-05-12");
    expect(p).toContain("INLINE-DOCTRINE-MARKER");
    expect(p).not.toContain("SYNTHETIC-DOCTRINE-MARKER-ALPHA");
  });

  it("treats a whitespace-only inline value as unset and reads the path", () => {
    process.env.ANALYST_SYSTEM_PROMPT_APPEND = "   \n  ";
    process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH = syntheticDoctrinePath;
    expect(buildSystemPrompt("2026-05-12")).toContain(
      "SYNTHETIC-DOCTRINE-MARKER-ALPHA",
    );
  });
});

describe("buildSystemPrompt — minimal doctrine fallback", () => {
  it("uses the operational baseline when neither env var is set", () => {
    const p = buildSystemPrompt("2026-05-12");
    expect(p).toMatch(
      /Operational baseline \(full institutional doctrine not loaded\)/,
    );
    expect(p).toMatch(/RiskModels AI Risk Analyst/s);
    expect(p).toMatch(/## Tools \(use them for live numbers\)/);
  });

  it("falls back rather than throwing when the path does not exist", () => {
    process.env.ANALYST_SYSTEM_PROMPT_APPEND_PATH = path.join(
      process.cwd(),
      "tests/fixtures/does-not-exist.md",
    );
    // A misconfigured path must degrade to the stated baseline, not 500 the
    // chat route.
    expect(buildSystemPrompt("2026-05-12")).toMatch(/Operational baseline/);
  });
});

describe("the doctrine is not committed here", () => {
  it("ships no fixture carrying the doctrine's own section headings", () => {
    // The leak this suite used to be built on. Fails here, in a developer's
    // own run, before the CI guard has to catch it.
    const dir = path.join(process.cwd(), "tests/fixtures");
    const doctrineHeadings = [
      "## You are an analyst, not an investment advisor",
      "## What you must NOT fabricate",
      "## Response shape — Aha first",
      "## ERM3 concepts",
    ];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const body = fs.readFileSync(path.join(dir, name), "utf8");
      for (const heading of doctrineHeadings) {
        expect(`${name}: ${body.includes(heading)}`).toBe(`${name}: false`);
      }
    }
  });
});
