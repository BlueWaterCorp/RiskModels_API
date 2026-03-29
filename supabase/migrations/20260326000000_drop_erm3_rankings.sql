-- Drop erm3_rankings: rankings now served from security_history (V3)
-- See: docs/supabase/V3_DATA_CONTRACT.md, /api/rankings/[ticker]
-- V3 sync writes rank_ord_* and cohort_size_* metric keys to security_history.

DROP TABLE IF EXISTS public.erm3_rankings CASCADE;
