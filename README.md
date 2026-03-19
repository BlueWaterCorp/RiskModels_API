RiskModels provides factor decompositions and ETF-executable hedge ratios for ~3,000 US equities, with history dating back to 2006. The API is AI-agent ready, including a built-in Model Context Protocol (MCP) server for seamless integration with LLMs.

# RiskModels API Developer Portal

[![CI](https://github.com/Cerebellum-Archive/RiskModels_API/actions/workflows/ci.yml/badge.svg)](https://github.com/Cerebellum-Archive/RiskModels_API/actions/workflows/ci.yml)
[![Live Docs](https://img.shields.io/badge/Live%20Docs-riskmodels.net%2Fdocs%2Fapi-6366f1)](https://riskmodels.net/docs/api/erm3)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0.3-85ea2d)](OPENAPI_SPEC.yaml)

This repository is the **authoritative public API reference** for the [RiskModels](https://riskmodels.net) equity risk model API, featuring:

- 📚 **Comprehensive API Documentation** — OpenAPI 3.0.3 specification, guides, and examples
- 🌐 **Developer Portal** — Beautiful Next.js site (this repo) deployed at **riskmodels.app**
- 🐍 **Python & TypeScript Examples** — Production-ready code in `examples/`
- 🤖 **AI Agent Integration** — MCP server, OAuth2, and agent manifest

---

## 🚀 Quick Links

- **Developer Portal:** [riskmodels.app](https://riskmodels.app)
- **Live API Docs:** [riskmodels.net/docs/api/erm3](https://riskmodels.net/docs/api/erm3)
- **Get API Key:** [riskmodels.app/get-key](https://riskmodels.app/get-key)
- **Issues:** [github.com/Cerebellum-Archive/RiskModels_API/issues](https://github.com/Cerebellum-Archive/RiskModels_API/issues)

---

## 📖 API Overview

The RiskModels API provides institutional-grade equity risk analysis:

- **Daily factor decompositions** — market, sector, subsector explained-risk fractions for ~3,000 US equities
- **Hedge ratios** — dollar-denominated ETF hedge amounts (L1/L2/L3)
- **Historical time series** — daily returns and rolling hedge ratios (2006–present)
- **AI-agent ready** — OAuth2, per-request billing, machine-readable manifests

**Data coverage:** Universe `uni_mc_3000` (~3,000 top US stocks), updated daily.

---

## 🤖 MCP Server

RiskModels includes a first-class [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server, enabling AI agents to directly query risk data and perform factor analysis.

See the [mcp-server/](./mcp-server/) directory for installation and usage instructions.

---

## 💻 Developer Portal (This Repo)

This repo now includes a **Next.js developer portal** with:

- ✨ Hero landing page with feature highlights
- 📚 MDX-powered documentation (README_API.md, AUTHENTICATION_GUIDE.md)
- 🔍 Interactive API reference (Redoc OpenAPI viewer)
- 💡 Code examples with syntax highlighting and copy buttons
- 🎯 Step-by-step quickstart guide

### Local Development

```bash
# Install dependencies
npm install

# Copy env template and fill in Supabase/Stripe keys
cp .env.example .env.local

# Generate OpenAPI JSON for Redoc
npm run build:openapi

# Run dev server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### Build & Deploy

```bash
# Build for production
npm run build

# Start production server
npm start
```

**Deployment:** See [DEPLOYMENT.md](DEPLOYMENT.md) for Vercel setup, env vars, and Supabase/Stripe config.

---

## 📂 Repository Structure

```
RiskModels_API/
├── app/                      # Next.js app (new)
│   ├── page.tsx              # Hero landing page
│   ├── layout.tsx            # Root layout with Navbar/Footer
│   ├── docs/[[...slug]]/     # MDX docs renderer
│   ├── api-reference/        # Redoc OpenAPI viewer
│   ├── examples/             # Code examples showcase
│   └── quickstart/           # Quickstart guide
├── components/               # React components (new)
│   ├── Navbar.tsx
│   ├── Footer.tsx
│   ├── Hero.tsx
│   ├── CodeBlock.tsx
│   └── Logo.tsx
├── content/docs/             # MDX content (new)
│   ├── api.mdx
│   └── authentication.mdx
├── examples/                 # Original examples
│   ├── python/
│   └── typescript/
├── mcp-server/               # MCP (Model Context Protocol) server
├── public/                   # Static assets (new)
│   ├── transparent_logo.svg
│   └── openapi.json          # Generated from OPENAPI_SPEC.yaml
├── styles/                   # Global styles (new)
├── lib/                      # Utilities (new)
├── OPENAPI_SPEC.yaml         # Canonical OpenAPI spec
├── README_API.md             # API reference (source for content/docs/api.mdx)
├── AUTHENTICATION_GUIDE.md   # Auth guide (source for content/docs/authentication.mdx)
├── SEMANTIC_ALIASES.md       # Field definitions
└── package.json              # Next.js deps (new)
```

---

## 🛠️ Tech Stack (Developer Portal)

- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS 3.4, dark mode default
- **MDX:** @next/mdx for documentation
- **API Reference:** Redoc (OpenAPI 3.0 viewer)
- **Code Highlighting:** Custom CodeBlock with copy button
- **Fonts:** Inter (system-ui fallback)
- **Colors:** Blue primary (`hsl(217, 91%, 60%)`), zinc/slate dark palette

Borrowed visual style from [Risk_Models](https://github.com/Cerebellum-Archive/Risk_Models) (logo, colors, typography).

---

## 📄 Documentation Files

| Document | Description |
|---|---|
| [README_API.md](README_API.md) | Complete API overview, endpoints, key concepts |
| [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md) | Bearer token, OAuth2, Supabase JWT, rate limits |
| [SEMANTIC_ALIASES.md](SEMANTIC_ALIASES.md) | Field definitions, units, formulas |
| [RESPONSE_METADATA.md](RESPONSE_METADATA.md) | `_agent` block, response headers, pricing |
| [ERROR_SCHEMA.md](ERROR_SCHEMA.md) | Error codes and recovery patterns |
| [OPENAPI_SPEC.yaml](OPENAPI_SPEC.yaml) | OpenAPI 3.0.3 specification |

---

## 🔗 Related Repositories

- **[Risk_Models](https://github.com/Cerebellum-Archive/Risk_Models)** — Next.js production app (riskmodels.net)
- **[ERM3](https://github.com/conradgann/ERM3)** — Python risk model computation engine
- **[BWMACRO](https://github.com/Cerebellum-Archive/BWMACRO)** — High-level docs and tracking

---

## 🤝 Contributing

We welcome pull requests, especially to improve the **OpenAPI spec** — clearer descriptions, better schemas, and more examples help everyone.

1. **OpenAPI spec:** [CONTRIBUTING.md](CONTRIBUTING.md) — PRs to `OPENAPI_SPEC.yaml` are encouraged
2. **Issues:** [Open an issue](https://github.com/Cerebellum-Archive/RiskModels_API/issues) for bugs or feature requests
3. **Examples:** Submit new examples via PR to `examples/`
4. **Docs:** Improve documentation by editing MDX files in `content/docs/`

---

## 📧 Support

- **API Support:** [contact@riskmodels.net](mailto:contact@riskmodels.net)
- **Issues:** [github.com/Cerebellum-Archive/RiskModels_API/issues](https://github.com/Cerebellum-Archive/RiskModels_API/issues)
- **Status:** [riskmodels.net/status](https://riskmodels.net/status)

---

## 📜 License

See [LICENSE](LICENSE) for details.

**© 2026 Blue Water Macro Corp. All rights reserved.**
