---
name: Bug Report
about: Incorrect data, unexpected errors, or broken endpoints
title: "[BUG] "
labels: bug
assignees: ''
---

## What happened?

<!-- A clear description of the bug. -->

## Endpoint

<!-- e.g. GET /api/metrics/NVDA, POST /api/batch/analyze -->

## Expected behaviour

<!-- What should have happened? -->

## Actual behaviour

<!-- What actually happened? Include the full response body or error message. -->

```json
// Paste response here
```

## Request details

| Field | Value |
|---|---|
| Ticker(s) | e.g. NVDA |
| Parameters | e.g. years=3 |
| Date of occurrence | e.g. 2026-02-22 |
| Request ID (`_agent.request_id`) | e.g. req_abc123 |

## Reproduction steps

1.
2.
3.

## Environment

- Language / SDK: <!-- Python / TypeScript / cURL -->
- API version: <!-- check `GET /api/health` → `version` field -->

---

**Support:** [service@riskmodels.app](mailto:service@riskmodels.app) — include your `request_id` for faster triage.
