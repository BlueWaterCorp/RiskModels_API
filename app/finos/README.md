# FINOS Workspace qualification spike

This connector targets FINOS Workspace `v0.1.0-alpha.1` for the BrightQuery
bank proof of concept. It is not a general distribution commitment.

Connect the backend at `https://riskmodels.app/finos` with a RiskModels API
token. The first app is **Manager Skill Review**, using Berkshire Hathaway as
the default public 13F filer.

The first widget is descriptive and backward-looking. It shows filed holdings,
concentration, coverage, return attribution, risk decomposition and provenance.
It does not show a manager rank or forecast. Raw rows and Copilot retrieval are
disabled while licensed-data permissions are being reviewed.

For local FINOS Workspace, add its origin to:

```text
FINOS_WORKSPACE_ALLOWED_ORIGINS=http://localhost:3000
```

Additional origins are comma-separated. The connector never accepts API keys
as widget parameters; FINOS Workspace forwards the backend connection's
Authorization header.
