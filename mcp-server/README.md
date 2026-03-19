# RiskModels API MCP Server

MCP server that exposes **RiskModels API** visibility inside [Cursor](https://cursor.com) (and other [MCP](https://modelcontextprotocol.io) clients): discover endpoints, read the agent manifest, list capabilities, and fetch response schemas. No need to clone any other repo—everything runs from this (RiskModels_API) repo.

---

## Resources (read-only)

| URI | Description |
|-----|-------------|
| `riskmodels:///manifest` | Agent Protocol manifest. Fetches from `RISKMODELS_API_BASE` when set; otherwise returns static capabilities. |
| `riskmodels:///capabilities` | Full list of API capabilities (endpoints, parameters, pricing, examples). |
| `riskmodels:///schemas/list` | List of available response schema paths. |
| `riskmodels:///schemas/{path}` | JSON schema for a response (e.g. `ticker-returns-v2.json`). |
| `riskmodels:///openapi` | OpenAPI 3.x spec (`data/openapi.json`). |

## Tools

| Tool | Description |
|------|-------------|
| `riskmodels_list_endpoints` | List all public API capabilities (id, name, method, endpoint, short description). |
| `riskmodels_get_capability` | Get full capability by id (parameters, pricing, examples). |
| `riskmodels_get_schema` | Get JSON schema by path (e.g. `ticker-returns-v2.json`). |

---

## Setup

```bash
cd mcp-server
npm install
npm run build
```

Add the server to Cursor (e.g. `.cursor/mcp.json` in your project):

```json
{
  "mcpServers": {
    "riskmodels-api": {
      "command": "node",
      "args": ["/absolute/path/to/RiskModels_API/mcp-server/dist/index.js"]
    }
  }
}
```

If you use **RiskModels_API** as your Cursor workspace, you can use a relative path:

```json
"args": ["mcp-server/dist/index.js"]
```

Restart Cursor after editing the config.

**Optional:** Set `RISKMODELS_API_BASE=https://riskmodels.net` so the manifest resource fetches the live agent manifest from the API.

---

## Maintenance (for API / repo maintainers)

The MCP server serves static data from `mcp-server/data/`. When the live RiskModels API gains new endpoints, changes pricing, or updates response schemas, this data should be updated so Cursor and other MCP clients stay in sync.

### What gets updated

- **`data/capabilities.json`** — List of API capabilities (endpoints, methods, parameters, pricing, examples).
- **`data/schema-paths.json`** — List of response schema paths.
- **`data/schemas/*.json`** — JSON Schema files for each response type.
- **`data/openapi.json`** — Optional; can mirror or summarize the repo’s [OPENAPI_SPEC.yaml](../OPENAPI_SPEC.yaml).

### How to update

The **canonical API and capabilities** live in the [Risk_Models](https://github.com/Cerebellum-Archive/Risk_Models) platform repo. From that repo you can run `npm run generate-mcp-data` (in `riskmodels_com/`) to regenerate `capabilities.json`, `schema-paths.json`, and `schemas/*.json` from the app’s `lib/agent` registry; then copy the updated files into this repo’s `mcp-server/data/`. The `openapi.json` here is a subset of the full [OPENAPI_SPEC.yaml](../OPENAPI_SPEC.yaml) and should be updated when new public endpoints are added.

1. **Obtain updated data** from the canonical source (Risk_Models) or by hand from the API application’s capabilities and schema registry.
2. **Replace** the contents of `mcp-server/data/`:
   - `capabilities.json`
   - `schema-paths.json`
   - `schemas/*.json`
   - `openapi.json` (if used)
3. **If server code changed** (e.g. new resources or tools): update `mcp-server/src/index.ts` (and any other source files), then run `npm run build` inside `mcp-server/`.
4. **Commit and push** so users who clone RiskModels_API get the latest MCP behavior and data.

### When to update

- New public API endpoints or capabilities.
- Changes to existing endpoints (parameters, pricing, descriptions).
- New or changed response schemas.
- OpenAPI spec changes you want reflected in the `riskmodels:///openapi` resource.

Keeping `data/` in sync with the live API after releases or significant API changes ensures the MCP server remains a reliable reference for developers and tools.
