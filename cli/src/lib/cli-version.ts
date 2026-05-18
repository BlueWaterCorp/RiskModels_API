import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(fileURLToPath(import.meta.url));

let cachedVersion: string | null = null;

/** Resolved from sibling `cli/package.json` at runtime (`dist/` → repo `cli/`). */
export function getCliPackageVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const pkgPath = join(pkgDir, "..", "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    cachedVersion = (JSON.parse(raw) as { version: string }).version;
    return cachedVersion;
  } catch {
    cachedVersion = "0.0.0";
    return cachedVersion;
  }
}

/** e.g. `v2.0.2` for human-facing footers (package.json omits leading v). */
export function formatCliVersionLabel(): string {
  const v = getCliPackageVersion();
  return v.startsWith("v") ? v : `v${v}`;
}
