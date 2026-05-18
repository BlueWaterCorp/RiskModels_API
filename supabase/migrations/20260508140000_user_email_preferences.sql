-- J.12 — Monthly snapshot digest preferences (Phase 0).
-- One row per portal user (profiles.id). Cron reads via service role; users manage via authenticated RLS.

CREATE TABLE IF NOT EXISTS public.user_email_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  digest_enabled boolean NOT NULL DEFAULT true,
  watch_tickers text[] NOT NULL DEFAULT '{}'::text[],
  fund_company_slugs text[] NOT NULL DEFAULT '{}'::text[],
  frequency text NOT NULL DEFAULT 'monthly'::text
    CHECK (frequency IN ('monthly', 'biweekly')),
  last_digest_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_email_preferences_watch_tickers_max
    CHECK (COALESCE(cardinality(watch_tickers), 0) <= 5),
  CONSTRAINT user_email_preferences_fund_companies_max
    CHECK (COALESCE(cardinality(fund_company_slugs), 0) <= 2)
);

COMMENT ON TABLE public.user_email_preferences IS
  'J.12 snapshot digest: user watchlist (tickers + fund families) and send frequency. '
  'Application enforces non-empty watchlist before subscribe; DB caps array sizes.';

CREATE INDEX IF NOT EXISTS idx_user_email_preferences_digest_enabled
  ON public.user_email_preferences (digest_enabled)
  WHERE digest_enabled = true;

DROP TRIGGER IF EXISTS user_email_preferences_updated_at ON public.user_email_preferences;
CREATE TRIGGER user_email_preferences_updated_at
  BEFORE UPDATE ON public.user_email_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_email_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_email_preferences_select_own"
  ON public.user_email_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_email_preferences_insert_own"
  ON public.user_email_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_email_preferences_update_own"
  ON public.user_email_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_email_preferences_delete_own"
  ON public.user_email_preferences
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_email_preferences_service_role_all"
  ON public.user_email_preferences
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
