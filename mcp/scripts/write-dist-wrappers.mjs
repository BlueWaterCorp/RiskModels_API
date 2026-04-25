import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const distDir = join(process.cwd(), "dist");
mkdirSync(distDir, { recursive: true });

writeFileSync(
  join(distDir, "index.js"),
  "#!/usr/bin/env node\nimport './mcp/src/index.js';\n",
  "utf-8",
);

writeFileSync(
  join(distDir, "server.js"),
  "export * from './mcp/src/server.js';\n",
  "utf-8",
);

writeFileSync(
  join(distDir, "index.d.ts"),
  "export {};\n",
  "utf-8",
);

writeFileSync(
  join(distDir, "server.d.ts"),
  "export * from './mcp/src/server.js';\n",
  "utf-8",
);
