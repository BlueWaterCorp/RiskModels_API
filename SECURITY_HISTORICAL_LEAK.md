# Historical leak: API key in git + remediation

## What happened

A **live-format** `RISKMODELS_API_KEY` value was committed in **`docs/ZARR_API_RECONCILIATION_STATE.md`** (test command section). The working tree has been **redacted**; the string may still exist in **older commits** until history is rewritten.

## Immediate action (keys)

1. In the RiskModels dashboard, **revoke / rotate** any API key that may have been pasted into that doc (treat as exposed).
2. Prefer **short-lived** keys for local reconciliation scripts.

## Purge from git history (maintainers)

Requires a **clean working tree** (commit or stash), coordination with anyone using `origin`, and a **force-push**.

1. Install [git-filter-repo](https://github.com/newren/git-filter-repo) (`pip install git-filter-repo`).
2. Create a one-line replace file **locally** (do **not** commit the file containing the real secret). Format: `oldliteral==>newliteral`  
   Example (replace `OLD` with the exact leaked token once, from `git show <commit>:docs/ZARR_API_RECONCILIATION_STATE.md`):

   ```bash
   printf '%s\n' 'OLD==>rm_agent_live_REDACTED' > /tmp/git-replace.txt
   ```

3. Verify occurrences: `git grep -l 'OLD' "$(git rev-list --all)"` → should list only paths/commits to fix.

4. Run:

   ```bash
   git filter-repo --replace-text /tmp/git-replace.txt --force
   rm /tmp/git-replace.txt
   ```

5. **Force-push** all updated branches and tags; have collaborators **re-clone** or reset to the new history.

6. If the repo was **public** while the key was in history, assume the key is compromised even after rewrite (mirrors/forks may retain old objects).

## Sanity checks for public docs

- No **home-directory paths** (`/Users/...`) in tracked markdown — use `<ERM3>` / repo-relative descriptions.
- **Placeholders** for examples: `rm_agent_live_abc123_xyz789_checksum`, not realistic-length tokens.
- **`internal/*`** is mostly gitignored except `internal/README.md`; do not commit operator guides with production URLs/secrets into public paths.

## SDK defaults (optional hardening)

Tracked Python under `sdk/` previously defaulted `ERM3_*` paths to a developer home directory. Prefer **env vars** or **sibling `../ERM3`** resolution from the repo root so clones are not tied to one machine. (Apply in Agent mode if not yet changed.)
