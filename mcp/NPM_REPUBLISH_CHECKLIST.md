# NPM Republish Checklist: @riskmodels/mcp

**Goal:** Re-enable the `npx @riskmodels/mcp` stdio install path by republishing to npm and updating the MCP Registry listing.

**Prerequisites:**
- [x] PR #124 merged (stdio build fixed — render tool split out)
- [ ] npm auth as @riskmodels org member
- [ ] SDK published at ^0.1.2 (or update version accordingly)

---

## Step 1: Pre-flight Checks

```bash
cd RiskModels_API/mcp

# Verify npm auth
npm whoami
# Should show: <your-npm-username> (with @riskmodels org access)

# Check current package.json
npm pkg get name version mcpName
# Expected: @riskmodels/mcp, 1.0.4, io.github.BlueWaterCorp/riskmodels

# Verify SDK is published
npm view @riskmodels/sdk version
# Should show: 0.1.2 (or higher)
```

---

## Step 2: Build

```bash
# Clean build
cd RiskModels_API/mcp
rm -rf dist node_modules
npm install

# Build (this must succeed cleanly)
npm run build

# Verify dist/ exists and has expected files
ls -la dist/
# Should see: index.js, index.d.ts, etc.
```

**If build fails:** Stop and fix. Do not proceed to publish.

---

## Step 3: Update Dependencies for Publish

```bash
cd RiskModels_API/mcp

# Temporarily swap file: dependency to published range
# DO NOT COMMIT THIS CHANGE
npm pkg set 'dependencies.@riskmodels/sdk=^0.1.2'

# Verify
npm pkg get dependencies.@riskmodels/sdk
# Should show: ^0.1.2 (not file:...)
```

---

## Step 4: Dry Run

```bash
cd RiskModels_API/mcp

# Verify package contents
npm publish --dry-run

# Check output for:
# - Correct version (1.0.4)
# - Correct name (@riskmodels/mcp)
# - Correct mcpName in metadata
# - Files included (dist/, README.md, etc.)
# - No file: dependencies
```

---

## Step 5: Publish

```bash
cd RiskModels_API/mcp

# Publish to npm
npm publish

# Verify on npm
npm view @riskmodels/mcp version mcpName dependencies
# Should show:
# - version: 1.0.4
# - mcpName: io.github.BlueWaterCorp/riskmodels
# - dependencies.@riskmodels/sdk: ^0.1.2
```

---

## Step 6: Restore Development Dependency

```bash
cd RiskModels_API/mcp

# Restore file: dependency for local development
npm pkg set 'dependencies.@riskmodels/sdk=file:../packages/riskmodels-sdk'

# Verify
npm pkg get dependencies.@riskmodels/sdk
# Should show: file:../packages/riskmodels-sdk

# Reinstall to restore symlink
npm install
```

---

## Step 7: Update MCP Registry Listing

Edit `RiskModels_API/mcp/server.json` to add the `packages` array:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.BlueWaterCorp/riskmodels",
  "title": "RiskModels",
  "description": "US equity risk: decompose any stock into market/sector/subsector/residual bets + ETF hedge ratios.",
  "websiteUrl": "https://riskmodels.app",
  "repository": {
    "url": "https://github.com/BlueWaterCorp/RiskModels_API",
    "source": "github"
  },
  "version": "1.0.4",
  "packages": [
    {
      "name": "@riskmodels/mcp",
      "registry": "npm"
    }
  ],
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://riskmodels.app/api/mcp/sse"
    }
  ]
}
```

---

## Step 8: Re-publish to MCP Registry

```bash
cd RiskModels_API/mcp

# Authenticate (if not already)
mcp-publisher login github

# Publish updated manifest
mcp-publisher publish

# Verify
open https://registry.modelcontextprotocol.io/servers/io.github.BlueWaterCorp/riskmodels
```

---

## Step 9: Test the npx Path

```bash
# Test that npx works (in a temp directory, no local install)
cd /tmp
mkdir mcp-test && cd mcp-test

# This should download and run the MCP server
npx @riskmodels/mcp

# Expected: Server starts, outputs stdio transport
# Ctrl+C to exit
```

---

## Verification Checklist

- [ ] `npm whoami` shows @riskmodels org member
- [ ] `npm run build` succeeds cleanly
- [ ] `npm publish --dry-run` shows correct files, no file: deps
- [ ] `npm publish` succeeds
- [ ] `npm view @riskmodels/mcp version` shows 1.0.4
- [ ] `server.json` has `packages[]` block added
- [ ] `mcp-publisher publish` succeeds
- [ ] Registry shows both remote and package options
- [ ] `npx @riskmodels/mcp` works in clean environment

---

## Rollback (if needed)

If something goes wrong:

```bash
# Unpublish (within 24h of publish)
npm unpublish @riskmodels/mcp@1.0.4

# Or deprecate
npm deprecate @riskmodels/mcp@1.0.4 "Deprecated due to issue X, use 1.0.5+"
```

---

## References

- Original runbook: `RiskModels_API/mcp/PUBLISHING.md`
- Build fix PR: #124
- Registry: https://registry.modelcontextprotocol.io
- npm package: https://www.npmjs.com/package/@riskmodels/mcp
