-- Parity with RiskModels_API `POST /api/plaid/exchange-public-token` upsert
-- (Supabase `.upsert(..., { onConflict: 'user_id,item_id' })` requires a unique constraint
-- on those columns).
--
-- Safe alongside the historical `UNIQUE (item_id)` on plaid_items: Plaid item_ids are globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS plaid_items_user_id_item_id_key
  ON public.plaid_items (user_id, item_id);
