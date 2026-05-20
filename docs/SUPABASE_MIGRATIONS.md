# Supabase migrations (private)

SQL migration files are **not** in the public **RiskModels_API** GitHub repo. They are gitignored at `supabase/migrations/`.

## Canonical team copy (private)

**BWMACRO** (private): `private/riskmodels-supabase-migrations/`

When you add or change a migration:

1. Create `YYYYMMDDHHMMSS_description.sql` under your local **`RiskModels_API/supabase/migrations/`** (folder stays on disk; Git ignores it).
2. Copy the same file into **`BWMACRO/private/riskmodels-supabase-migrations/`** and commit on a BWMACRO branch (private repo only).
3. Apply to the shared Supabase project (one of):
   - **Supabase CLI** from `RiskModels_API`: `supabase db push` (with project linked locally)
   - **SQL Editor** in the Supabase dashboard (paste file contents; use for one-offs or if CLI times out)
   - **CI** (optional): private workflow with `SUPABASE_DB_URL` / service role — not documented here

## Local checkout

After clone, populate migrations from BWMACRO:

```bash
mkdir -p /path/to/RiskModels_API/supabase/migrations
cp /path/to/BWMACRO/private/riskmodels-supabase-migrations/*.sql \
   /path/to/RiskModels_API/supabase/migrations/
```

Or maintain your own gitignored copy; do not rely on the public API repo for migration history.

## Portal repo (Risk_Models)

**Do not** mirror migrations into `riskmodels_com/supabase/migrations/` on GitHub. Portal schema changes are applied via the same Supabase project; app code references table/column names in TypeScript and docs only.

## Git history note

Migrations were removed from the public repo in May 2026. Older commits may still contain SQL in history; rotate any secrets that ever appeared in migration files if concerned.

## Related

- Table reference (public): [SUPABASE_TABLES.md](../SUPABASE_TABLES.md)
- Cross-repo schema checklist: [AGENTS_CROSS_REPO.md](./AGENTS_CROSS_REPO.md)
