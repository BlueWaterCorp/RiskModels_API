import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Guard: `skipBilling: true` means PUBLIC, not "authenticated but free".
 *
 * In `withBilling` (lib/agent/billing-middleware.ts) the `skipBilling` branch
 * returns *before* key validation and invokes the handler with `userId: ""`.
 * So a route wrapped that way is reachable by anyone on the internet. The flag
 * reads like a billing concession, which is how `/api/funds/search` and
 * `/api/13f/filers/search` ended up unauthenticated, unthrottled, and
 * bulk-readable over licensed fund reference data — while a compliance document
 * claimed a per-IP limit across that surface.
 *
 * Every `skipBilling: true` route must therefore do one of two things:
 *
 *   1. Set `publicIpRateLimitPerMinute` — it is genuinely public, and the
 *      per-IP cap is the only control on it; or
 *   2. Authenticate inside the handler (e.g. `authenticateOrRespond`), which is
 *      how the Plaid routes get "authenticated but free" correctly.
 *
 * Anything else is an unauthenticated, unthrottled endpoint, and fails here.
 *
 * Why a test and not an ESLint rule: this repo is on ESLint 8 with a legacy
 * `.eslintrc.json`, so a custom rule needs a local plugin package and a new
 * dependency. CI already runs `npm test`, the condition needs real AST work to
 * avoid false positives (see the `runChatAgent({ skipBilling })` case below),
 * and a failing test can explain itself. Same posture as
 * `scripts/cli-openapi-check.mjs`.
 */

const API_DIR = path.join(process.cwd(), "app", "api");

/** Helpers that constitute authenticating inside the handler. */
const IN_HANDLER_AUTH = [
  "authenticateOrRespond",
  "authenticateRequest",
  "requireAuth",
  "validateApiKey",
  "resolveApiKey",
  "auth.getUser",
];

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(full, out);
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

type Finding = { file: string; hasThrottle: boolean; hasInHandlerAuth: boolean };

/**
 * Find `withBilling(handler, { ... })` calls whose options set
 * `skipBilling: true`, and report which guards that options object carries.
 *
 * AST rather than grep on purpose: `app/api/landing/chat/route.ts` passes
 * `skipBilling: true` to `runChatAgent()`, which is an unrelated option on a
 * different function. A textual match flags it and trains people to ignore
 * this check.
 */
function analyze(file: string): Finding | null {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  let finding: Finding | null = null;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "withBilling"
    ) {
      const opts = node.arguments.find(ts.isObjectLiteralExpression);
      if (opts) {
        const prop = (name: string) =>
          opts.properties.find(
            (p): p is ts.PropertyAssignment =>
              ts.isPropertyAssignment(p) &&
              (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
              p.name.text === name,
          );

        const skip = prop("skipBilling");
        if (skip && skip.initializer.kind === ts.SyntaxKind.TrueKeyword) {
          finding = {
            file: path.relative(process.cwd(), file),
            hasThrottle: prop("publicIpRateLimitPerMinute") !== undefined,
            hasInHandlerAuth: IN_HANDLER_AUTH.some((h) => text.includes(h)),
          };
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return finding;
}

describe("skipBilling routes are either throttled or authenticate in-handler", () => {
  const findings = routeFiles(API_DIR)
    .map(analyze)
    .filter((f): f is Finding => f !== null);

  it("finds the skipBilling routes at all (guards against a silently broken matcher)", () => {
    // If this drops to zero the check above has stopped matching anything and
    // would pass vacuously forever.
    expect(findings.length).toBeGreaterThan(0);
  });

  it("leaves no skipBilling route both unauthenticated and unthrottled", () => {
    const unguarded = findings.filter((f) => !f.hasThrottle && !f.hasInHandlerAuth);

    expect(
      unguarded.map((f) => f.file),
      unguarded.length
        ? `\n\nThese routes use withBilling({ skipBilling: true }), which skips key ` +
            `validation entirely — they are PUBLIC, not "authenticated but free":\n` +
            unguarded.map((f) => `  - ${f.file}`).join("\n") +
            `\n\nFix one of two ways:\n` +
            `  1. Public by design → add publicIpRateLimitPerMinute to the withBilling ` +
            `options (see app/api/rankings/[ticker]/badge/route.ts), and document the ` +
            `limit on the endpoint in OPENAPI_SPEC.yaml.\n` +
            `  2. Should require a key → authenticate in the handler with ` +
            `authenticateOrRespond (see app/api/plaid/link-token/route.ts), or drop ` +
            `skipBilling and keep cost_usd: 0 so the key is still validated.\n`
        : undefined,
    ).toEqual([]);
  });

  it("does not flag skipBilling options belonging to other functions", () => {
    // app/api/landing/chat/route.ts passes `skipBilling: true` to runChatAgent(),
    // not to withBilling(). A textual match reports it, the report is wrong, and
    // people learn to ignore this check. Keep the matcher on the AST.
    expect(findings.map((f) => f.file)).not.toContain("app/api/landing/chat/route.ts");
  });

  it("keeps the public discovery endpoints throttled", () => {
    // These serve licensed reference data in bulk and have no key requirement,
    // so the per-IP cap is the whole control surface.
    for (const f of ["app/api/funds/search/route.ts", "app/api/13f/filers/search/route.ts"]) {
      const found = findings.find((x) => x.file === f);
      expect(found, `${f} should still be a skipBilling route`).toBeDefined();
      expect(found!.hasThrottle, `${f} must set publicIpRateLimitPerMinute`).toBe(true);
    }
  });
});
