# Historical leak: API key in git + remediation

## What happened

A **live-format** `RISKMODELS_API_KEY` value was committed in **`docs/ZARR_API_RECONCILIATION_STATE.md`** (test command section). The file is **redacted** on `main`, **`sdk/` defaults no longer embed a home-directory path**, and **`git filter-repo --replace-text`** was run so **`git rev-list main` contains no copy of the leaked token**.

**Still your responsibility:** rotate the key in the dashboard; **force-push** `main` (and any other **published** branches); delete or rewrite **local-only** branches that still point at pre-rewrite commits if you care about `git grep` across *all* refs.

## Immediate action (keys)

1. In the RiskModels dashboard, **revoke / rotate** any API key that may have been pasted into that doc (treat as exposed).
2. Prefer **short-lived** keys for local reconciliation scripts.

## Purge from git history (maintainers)

**Done on this clone (2026-04-09):** `git filter-repo` with `--replace-text` for the leaked literal → `rm_agent_live_...`; `origin` was re-added.

**You must still:**

```bash
git push --force-with-lease origin main
# If other branches were ever pushed and share the old history:
# git push --force-with-lease origin --all
# git push --force-with-lease origin --tags   # only if tags needed
```

After the remote updates, run `git fetch origin` so `refs/remotes/origin/*` match the new history.

**Stale local branches:** `git grep` across `$(git rev-list --all)` can still hit **old commits** via `refs/remotes/origin/main` (until you fetch after force-push) or **other local branches** (`backup/*`, `qa-*`, etc.). Delete or hard-reset those branches if they are disposable.

**If the repo was public** while the key was in history, assume compromise; mirrors/forks may retain old objects even after you force-push.

---

### Replay procedure (another machine / future leaks)

1. Install [git-filter-repo](https://github.com/newren/git-filter-repo) (`pip install git-filter-repo`).
2. `printf '%s\n' 'LEAKED_LITERAL==>rm_agent_live_REDACTED' > /tmp/git-replace.txt` (never commit that file).
3. `git filter-repo --replace-text /tmp/git-replace.txt --force` then `rm /tmp/git-replace.txt`
4. `git remote add origin <url>` if filter-repo removed it.
5. Force-push as above.

## Sanity checks for public docs

- No **home-directory paths** (`/Users/...`) in tracked markdown — use `<ERM3>` / repo-relative descriptions.
- **Placeholders** for examples: `rm_agent_live_abc123_xyz789_checksum`, not realistic-length tokens.
- **`internal/*`** is mostly gitignored except `internal/README.md`; do not commit operator guides with production URLs/secrets into public paths.

## SDK defaults

`sdk/riskmodels/snapshots/zarr_context.py` and `sdk/scripts/mag7_dd_zarr_vs_api.py` now default to **`ERM3_ROOT` / `ERM3_ZARR_ROOT` or sibling `../ERM3`** from the RiskModels_API repo root (no hardcoded home directory).
