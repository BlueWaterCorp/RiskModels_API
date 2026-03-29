# Internal documentation

Files in this directory **except this `README.md`** are **gitignored** and are **not** part of the public repository.

## Webhook operator guide

Maintainers keep a local copy of the full webhook subscription, payload, and HMAC verification guide as:

- **`WEBHOOKS_GUIDE.md`** (gitignored)

Copy it from your team’s private documentation store, or create it from your deployment notes. Do not commit secrets or customer-specific URLs here.

Public repo references: implementation in [`lib/api/webhooks.ts`](../lib/api/webhooks.ts), routes in [`app/api/webhooks/subscribe/`](../app/api/webhooks/subscribe/), and [`DEPLOYMENT.md`](../DEPLOYMENT.md) (webhooks subsection).

## Git history hygiene

For removing sensitive or vendor-specific strings from **past** commits (`git filter-repo`, force-push, coordination), maintain a local copy of:

- **`git-history-hygiene.md`** (gitignored)

Same pattern as `WEBHOOKS_GUIDE.md`: create it locally from your private ops docs, or copy from a machine that already generated it after a cleanup. Do not commit secrets or legal advice into the public tree.
