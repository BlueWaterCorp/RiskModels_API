-- Drop erm3_sync_state_v3 now that erm3_sync_state_v4 is live.
-- v4 tracks the tables actually written by the zarr-SSOT pipeline; v3 retained
-- stale rows for disabled security_history_* datasets that nothing consumes.
-- Run AFTER the v4 migration has seeded and writers are on v4.

BEGIN;

DROP TABLE IF EXISTS public.erm3_sync_state_v3;

COMMIT;
