-- Add aum_erm3 column to funds_latest (Funds_DAG additive retrofit)
--
-- The Slice 5 ds_ph.zarr already carries `aum_erm3` (Σ adj_mv restricted
-- to positions in the ERM3 uni_mc_3000 universe — the apples-to-apples
-- AUM metric for cross-fund comparisons and the basis for weight_sum
-- diagnostic). Slice 11's writer was missing this column; this migration
-- adds it so the funds-side sync can surface it.
--
-- Purely additive — does NOT rename or alter the existing `total_adj_mv`
-- column (which API endpoints already read). The total_adj_mv field
-- equals aum_reported semantically (Σ adj_mv across all symbols);
-- the ERM3-filtered companion lands as a new column.
--
-- Pairs with Funds_DAG/src/funds_dag/sync/build_funds_rows.py:
--   FundsLatestRow gains an `aum_erm3` field, populated from
--   ds_ph.zarr.aum_erm3 at the latest teo.

BEGIN;

ALTER TABLE public.funds_latest
    ADD COLUMN IF NOT EXISTS aum_erm3 DOUBLE PRECISION;

COMMENT ON COLUMN public.funds_latest.aum_erm3 IS
    'AUM of positions in the ERM3 uni_mc_3000 universe (Σ adj_mv restricted to ERM3-mapped symbols). Apples-to-apples metric for cross-fund comparisons and the basis for weight_sum (= aum_erm3 / total_adj_mv). Source: ds_ph.zarr.aum_erm3.';

COMMIT;
