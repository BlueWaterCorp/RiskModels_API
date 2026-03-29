-- Add email holdings consent column for Plaid compliance (explicit consent for using holdings in email reports)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS email_holdings_consent BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.profiles.email_holdings_consent IS
  'User consent to include Plaid holdings data in email communications (e.g. personalized reports). Required for compliance.';
