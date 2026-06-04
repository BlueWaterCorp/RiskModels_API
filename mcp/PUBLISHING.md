# Publishing the RiskModels MCP server to the Official MCP Registry

Namespace: **`io.github.BlueWaterCorp/riskmodels`** (verified via GitHub org
membership — GitHub namespaces have **no remote-URL restriction**).
Manifest: [`server.json`](./server.json) (schema `2025-12-11`).

## What we list now: the hosted remote (no npm needed)

`server.json` currently declares **only the hosted `streamable-http` remote**
(`https://riskmodels.app/api/mcp/sse`). That endpoint already works in
production, so listing it requires **no npm publish, no build, no `mcpName`** —
just GitHub auth. The stdio npm package is a fast-follow (see below).

### Steps (require GitHub auth as a BlueWaterCorp org member)

1. **Install the publisher CLI** (`mcp-publisher`):
   download from https://github.com/modelcontextprotocol/registry/releases
   (or `brew install mcp-publisher` if available).

2. **Authenticate** as a member of the **BlueWaterCorp** GitHub org (this
   authorizes the `io.github.BlueWaterCorp/*` namespace):
   ```bash
   mcp-publisher login github
   ```

3. **Publish** from the dir holding `server.json`:
   ```bash
   cd mcp
   mcp-publisher publish
   ```

4. **Verify:** search https://registry.modelcontextprotocol.io for `riskmodels`.

## Fast-follow: re-add the stdio npm package (`@riskmodels/mcp`)

The `npx @riskmodels/mcp` stdio package was intentionally **left off this
listing** because its standalone build is broken and needs a small refactor
first. This is additive — adding `packages[]` back to `server.json` later does
not disturb the live remote listing.

**Why it's broken (since 2026-05-20, PR #99):** `lib/mcp/tools/riskmodels-tools.ts`
(compiled into the stdio bundle via `mcp/tsconfig.json`'s
`include: ["../lib/mcp/tools/**"]`) imports `@/lib/artifacts/render-client`,
which imports `@/lib/artifacts/gcp-id-token`. The standalone `tsc` build can't
resolve the `@/` alias, and `tsc` wouldn't rewrite it for runtime anyway.

**Why a tsconfig-paths patch is not enough:** the `riskmodels_render_artifact`
tool authenticates to **GCP Cloud Run** to render. A public `npx` user has no
GCP credentials, so that tool cannot function in the stdio context — it is
**hosted-only**. The fix is to keep the render tool (and its render-client /
gcp-id-token deps) out of the public stdio bundle, e.g. split the render-tool
registration into a hosted-only module that `mcp/src/server.ts` does not import.

**When fixed**, to re-enable the npm package:
1. Refactor so the stdio build (`cd mcp && npm run build`) compiles clean.
2. Add `"mcpName": "io.github.BlueWaterCorp/riskmodels"` to `mcp/package.json`
   (already added on this branch — keep it).
3. Publish npm `@riskmodels/mcp@1.0.4` (latest on npm is `1.0.2`). The `file:`
   SDK dep must become a published range at publish time:
   ```bash
   cd mcp
   npm whoami                                            # @riskmodels org member
   npm run build                                         # must succeed first
   npm pkg set 'dependencies.@riskmodels/sdk=^0.1.2'     # do NOT commit
   npm publish --dry-run                                 # confirm version/mcpName/^0.1.2/files
   npm publish
   npm pkg set 'dependencies.@riskmodels/sdk=file:../packages/riskmodels-sdk'  # restore
   npm view @riskmodels/mcp version mcpName dependencies
   ```
   Build with `cd mcp && npm run build` — **not** the repo-root `npm run build`
   (that runs `next build` and OOMs; irrelevant to the npm package).
4. Add the `packages[]` block back to `server.json` and re-run `mcp-publisher publish`.

## Next: aggregators (#2)
Once on the official registry, PulseMCP / Glama / Smithery / mcp.so largely
ingest from it. Glama also auto-indexes public GitHub MCP servers; the OSS
`mcp-submit` tool submits to 10+ directories at once.

## Known cosmetic follow-ups (not blockers)
- `.well-known/mcp.json` advertises `transport: "sse"` but the server is
  Streamable HTTP — reconcile to avoid confusing strict clients.
- `/api/health` reports `version` from `process.env.API_VERSION` (falls back to
  `2.0.0-agent`); set `API_VERSION=3.0.0-agent` in prod to match the OpenAPI spec.
