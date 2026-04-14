-- Left-pane / UI: plain-text company snapshot (SEC + optional ERM3 addendum), from ERM3 company_profiles pipeline.
-- Sync: ERM3 scripts/python/sync_company_profile_snapshots_to_supabase.py
ALTER TABLE public.symbols
    ADD COLUMN IF NOT EXISTS company_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS company_snapshot_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS company_snapshot_content_hash TEXT;

COMMENT ON COLUMN public.symbols.company_snapshot IS
    'Plain-text blurb for UI (e.g. ticker sidebar): profile_summary + optional erm3_risk_addendum.';

CREATE INDEX IF NOT EXISTS idx_symbols_company_snapshot_present
    ON public.symbols (symbol)
    WHERE company_snapshot IS NOT NULL AND length(trim(company_snapshot)) > 0;
