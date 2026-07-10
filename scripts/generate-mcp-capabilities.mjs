// Regenerate mcp/data/capabilities.json from the source registry lib/agent/capabilities.ts.
// The MCP server (lib/mcp/server.ts) serves this static file; it must not drift from the source.
import { build } from "esbuild";
import { writeFileSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "mcp", "data", "capabilities.json");

// Bundle the TS registry to a temp CJS string and eval it to read CAPABILITIES.
const res = await build({
  entryPoints: [join(root, "lib/agent/capabilities.ts")],
  bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent",
});
const mod = { exports: {} };
new Function("module", "exports", "require", res.outputFiles[0].text)(mod, mod.exports, require);
const CAPS = mod.exports.CAPABILITIES;
if (!Array.isArray(CAPS)) throw new Error("CAPABILITIES not found / not an array");

// Serialize the public shape, matching the existing served entries exactly.
const PUBLIC = ["id", "name", "description", "endpoint", "method", "parameters",
                "pricing", "performance", "confidence", "tags", "examples"];
const json = CAPS.map((c) => {
  const o = {};
  for (const k of PUBLIC) if (c[k] !== undefined) o[k] = c[k];
  return o;
});
writeFileSync(out, JSON.stringify(json, null, 2) + "\n");

const before = JSON.parse(readFileSync(out, "utf8")).length; // = json.length now
console.log(`wrote ${json.length} capabilities → mcp/data/capabilities.json`);
console.log(`  fundamentals present: ${json.some((c) => c.id === "fundamentals")}`);
console.log(`  hedge-basket present: ${json.some((c) => c.id === "hedge-basket")}`);
