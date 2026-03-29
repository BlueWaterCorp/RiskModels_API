-- Denormalized ranking grain columns (index built manually — see RUN_MANUALLY).
-- "window" is quoted (reserved keyword).
-- Full index on ~313M rows times out via db push; run RUN_MANUALLY_security_history_rankings_index.sql in SQL Editor.

ALTER TABLE public.security_history
  ADD COLUMN IF NOT EXISTS "window" TEXT,
  ADD COLUMN IF NOT EXISTS cohort TEXT,
  ADD COLUMN IF NOT EXISTS metric TEXT;
