#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import ts from "typescript";

const DEFAULT_TARGETS = [
  "lib/risk",
  "lib/portfolio",
  "lib/dal",
  "lib/api",
  "lib/fundamentals",
  "lib/chat",
  "app/api",
];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const ALLOW_CATEGORIES = new Set([
  "accumulator",
  "billing",
  "counter",
  "dimension",
  "exposure",
  "index",
  "length",
  "ordering",
  "pagination",
  "parameter",
  "score",
  "threshold",
]);
const ALLOW_COMMENT = /\/\/\s*allow-default:\s*([a-z-]+)\s+-\s+(.\S.*)$/m;

function sourceFiles(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) return [];
  const stat = statSync(absolute);
  if (stat.isFile()) return SOURCE_EXTENSIONS.has(extname(absolute)) ? [absolute] : [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    sourceFiles(resolve(absolute, entry.name)),
  );
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isNumericLiteral(expression, values) {
  const node = unwrap(expression);
  return ts.isNumericLiteral(node) && values.has(Number(node.text));
}

function isNullishLiteral(expression) {
  const node = unwrap(expression);
  return node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined");
}

function conditionChecksMissing(expression) {
  const node = unwrap(expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return conditionChecksMissing(node.operand);
  }
  if (ts.isBinaryExpression(node)) {
    const comparison = new Set([
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ]);
    if (
      comparison.has(node.operatorToken.kind) &&
      (isNullishLiteral(node.left) || isNullishLiteral(node.right))
    ) {
      return true;
    }
    if (
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      return conditionChecksMissing(node.left) || conditionChecksMissing(node.right);
    }
  }
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    return (ts.isIdentifier(callee) && /^(?:isFinite|finite|finiteNum)$/.test(callee.text)) ||
      (ts.isPropertyAccessExpression(callee) && callee.name.text === "isFinite");
  }
  return false;
}

function allowCommentFor(node, sourceFile, sourceText) {
  const lineEnd = sourceFile.getLineEndOfPosition(node.end);
  const sameLine = sourceText.slice(node.getStart(sourceFile), lineEnd);
  const match = sameLine.match(ALLOW_COMMENT);
  return Boolean(match && ALLOW_CATEGORIES.has(match[1]) && match[2].trim());
}

function compactNodeText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim();
}

const targets = process.argv.slice(2);
const files = [...new Set((targets.length ? targets : DEFAULT_TARGETS).flatMap(sourceFiles))];
const violations = [];

for (const file of files) {
  const sourceText = readFileSync(file, "utf8");
  const scriptKind = extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKind);

  function report(node, label) {
    if (allowCommentFor(node, sourceFile, sourceText)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push(`${file}:${line + 1}: ${label}: ${compactNodeText(node, sourceFile)}`);
  }

  function visit(node) {
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (
        (operator === ts.SyntaxKind.QuestionQuestionToken ||
          operator === ts.SyntaxKind.BarBarToken) &&
        isNumericLiteral(node.right, new Set([0, 1]))
      ) {
        report(node, operator === ts.SyntaxKind.QuestionQuestionToken ? "?? 0/1" : "|| 0/1");
      }
    } else if (
      ts.isConditionalExpression(node) &&
      conditionChecksMissing(node.condition) &&
      (isNumericLiteral(node.whenTrue, new Set([0])) ||
        isNumericLiteral(node.whenFalse, new Set([0])))
    ) {
      report(node, "missing-value ternary to 0");
    } else if (
      ts.isBindingElement(node) &&
      node.initializer &&
      isNumericLiteral(node.initializer, new Set([0]))
    ) {
      report(node, "destructuring default = 0");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (violations.length) {
  console.error("Silent numeric defaults are not allowed in model-serving code.");
  console.error(
    "Return null plus a data_quality flag, or use // allow-default: <category> - <reason> " +
      `for a genuine control/count default. Categories: ${[...ALLOW_CATEGORIES].join("|")}.\n`,
  );
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Silent-default check passed (${files.length} files).`);
}
