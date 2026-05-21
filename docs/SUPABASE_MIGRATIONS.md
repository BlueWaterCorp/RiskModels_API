# Supabase migrations

The Supabase project for this backend — CLI config (`config.toml`) and
**all SQL DDL migrations** — lives in **BWMACRO** (private) at
**`BWMACRO/supabase/`**.

RiskModels_API is a public repo, so committing SQL DDL here would
publish the database schema. The project was relocated to BWMACRO so the
migrations are properly version-controlled without that exposure.

## Adding / applying a migration

Work in `BWMACRO/supabase/`:

1. Add `migrations/YYYYMMDDHHMMSS_description.sql`.
2. Apply it — `./check-cli.sh db push` (Supabase CLI, project linked),
   or paste the file into the Supabase dashboard SQL editor for one-offs.
3. Commit the migration on a BWMACRO branch.

See `BWMACRO/supabase/README.md` for details.

## What stays in RiskModels_API

`lib/supabase/` — the app's runtime Supabase client — is application
code and remains in this repo.

## Git history note

SQL DDL appeared in this repo's earlier git history before the move;
migration files do not carry secrets, but rotate anything sensitive if
it ever did.

## Related

- Table reference (public): [SUPABASE_TABLES.md](../SUPABASE_TABLES.md)
- Cross-repo schema checklist: [AGENTS_CROSS_REPO.md](./AGENTS_CROSS_REPO.md)
