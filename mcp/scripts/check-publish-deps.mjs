// Refuses `npm publish` while any dependency points at a local path.
// @riskmodels/mcp 2.0.0 shipped with `file:../packages/riskmodels-sdk` and failed
// to start for every installer; swap to the published range first (see
// NPM_REPUBLISH_CHECKLIST.md).
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const local = Object.entries(pkg.dependencies ?? {}).filter(([, v]) => /^(file|link|workspace):/.test(v));
if (local.length) {
  console.error("Refusing to publish: local dependencies " + local.map(([k, v]) => `${k}=${v}`).join(", "));
  console.error("Run: npm pkg set 'dependencies.@riskmodels/sdk=^<published version>' and rebuild.");
  process.exit(1);
}
