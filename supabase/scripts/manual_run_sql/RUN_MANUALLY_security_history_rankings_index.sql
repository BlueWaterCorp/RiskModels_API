-- =====================================================
-- security_history rankings unique index (MANUAL)
-- =====================================================
-- Matches Supabase guidance: long timeout + CREATE INDEX CONCURRENTLY
-- (avoids blocking writes on a large table).
--
-- SQL Editor: turn OFF "Enable transaction" / use non-transaction mode for this
-- query only. CONCURRENTLY fails with SQLSTATE 25001 if the editor wraps the
-- script in BEGIN/COMMIT.
--
-- Alternative: run the same two statements from psql (session autocommit).

SET statement_timeout = '60min';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_security_history_upsert_logic
ON public.security_history (teo, symbol, "window", cohort, metric);

-- If you cannot disable the transaction wrapper, use non-CONCURRENTLY instead
-- (stronger locks on security_history until the build finishes):
--
-- SET statement_timeout = '60min';
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_security_history_upsert_logic
-- ON public.security_history (teo, symbol, "window", cohort, metric);
