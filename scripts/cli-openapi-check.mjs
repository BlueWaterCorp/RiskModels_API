#!/usr/bin/env node
/**
 * Maintainer check: compares OpenAPI paths to a static list of CLI-covered routes.
 * Exit 1 if a tracked path is missing from OpenAPI (drift) or if you want strict mode.
 * Run: node scripts/cli-openapi-check.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const specPath = join(root, "OPENAPI_SPEC.yaml");
const text = readFileSync(specPath, "utf8");

/** Paths the CLI implements (relative to /api — spec lists without /api prefix). */
const CLI_COVERED = new Set([
  "/auth/token",
  "/balance",
  "/batch/analyze",
  "/cli/query",
  "/correlation",
  "/estimate",
  "/etf-returns",
  "/health",
  "/l3-decomposition",
  "/metrics/{ticker}",
  "/metrics/{ticker}/correlation",
  "/portfolio/risk-index",
  "/rankings/{ticker}",
  "/rankings/{ticker}/badge",
  "/rankings/top",
  "/returns",
  "/ticker-returns",
  "/tickers",
]);

const pathLines = text.match(/^\s{2}(\/[^:]+):$/gm) ?? [];
const openPaths = pathLines.map((line) => line.trim().replace(/:$/, ""));

const missingInOpenapi = [...CLI_COVERED].filter((p) => !openPaths.includes(p));
const extraCliHint = [...CLI_COVERED].filter((p) => openPaths.includes(p));

if (missingInOpenapi.length) {
  console.error("cli-openapi-check: these CLI-covered paths are not in OPENAPI_SPEC.yaml paths:");
  for (const p of missingInOpenapi) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `cli-openapi-check: OK — ${extraCliHint.length} OpenAPI paths match CLI coverage list (spec has ${openPaths.length} paths).`,
);
