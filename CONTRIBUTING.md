# Contributing to RiskModels API

We welcome contributions that improve the API specification, documentation, and examples.

## OpenAPI Spec Improvements

**We especially encourage pull requests to improve the OpenAPI specification.**

The canonical spec lives at [`OPENAPI_SPEC.yaml`](OPENAPI_SPEC.yaml). Contributions we value:

- **Clarify descriptions** — Better summaries for endpoints, parameters, and response schemas
- **Fix schema definitions** — Correct types, required fields, enums, examples
- **Add examples** — Request/response samples that match real API behavior
- **Improve error documentation** — Document error codes and recovery patterns
- **Suggest new endpoints** — Propose additions (we’ll evaluate and may implement)

### How to Submit a Spec PR

1. Fork the repo and create a branch
2. Edit `OPENAPI_SPEC.yaml` (or `mcp-server/data/schemas/*.json` for schema-only changes)
3. Run `npm run build:openapi` to regenerate `public/openapi.json`
4. Open a PR with a clear description of the change
5. We’ll review and merge; the portal will reflect updates on the next deploy

### Spec Validation

- The spec follows OpenAPI 3.0.3
- Use [Swagger Editor](https://editor.swagger.io/) or `npx @redocly/cli lint OPENAPI_SPEC.yaml` to validate before submitting

---

## Other Contributions

- **Examples** — New Python or TypeScript examples in `examples/`
- **Documentation** — Improvements to `content/docs/*.mdx` or markdown docs
- **Bug reports** — [Open an issue](https://github.com/Cerebellum-Archive/RiskModels_API/issues)

---

## Questions?

- **Email:** [contact@riskmodels.net](mailto:contact@riskmodels.net)
- **Issues:** [GitHub Issues](https://github.com/Cerebellum-Archive/RiskModels_API/issues)
