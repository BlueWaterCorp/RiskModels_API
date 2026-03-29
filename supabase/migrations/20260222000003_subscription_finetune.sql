-- ...existing code...
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS tier text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS is_email_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_subscription_id uuid REFERENCES public.subscriptions(id);

CREATE TABLE IF NOT EXISTS public.fintech_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  admin_id uuid,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  label text,
  scopes jsonb DEFAULT '[]'::jsonb,
  enabled boolean DEFAULT true,
  issued_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.events_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  event_id text UNIQUE,
  payload jsonb NOT NULL,
  status text DEFAULT 'pending',
  processed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text,
  recipient text,
  template text,
  payload jsonb,
  status text DEFAULT 'queued',
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);
-- ...existing code...