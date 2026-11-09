#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

const DEFAULT_TARGETS = ["lib/risk", "lib/portfolio", "lib/dal", "app/api"];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const ALLOW_COMMENT = /\/\/\s*allow-default:\s*\S.*$/;
const CHECKS = [
  { label: "Number(...) || 0", pattern: /Number\([^\n]*\)\s*\|\|\s*0(?![\d.])/ },
  { label: "?? 0/1", pattern: /\?\?\s*[01](?![\d.])/ },
  { label: "|| 0/1", pattern: /\|\|\s*[01](?![\d.])/ },
];

function sourceFiles(path) {
  const absolute = resolve(path);
  const stat = statSync(absolute);
  if (stat.isFile()) return SOURCE_EXTENSIONS.has(extname(absolute)) ? [absolute] : [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    sourceFiles(resolve(absolute, entry.name)),
  );
}

const targets = process.argv.slice(2);
const files = (targets.length ? targets : DEFAULT_TARGETS).flatMap(sourceFiles);
const violations = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const matched = CHECKS.find(({ pattern }) => pattern.test(line));
    if (!matched || ALLOW_COMMENT.test(line)) return;
    violations.push(`${file}:${index + 1}: ${matched.label}: ${line.trim()}`);
  });
}

if (violations.length) {
  console.error("Silent numeric defaults are not allowed in model-serving code.");
  console.error("Return null plus a data_quality flag, or add a trailing // allow-default: <reason> for a genuine control/count default.\n");
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Silent-default check passed (${files.length} files).`);
}
