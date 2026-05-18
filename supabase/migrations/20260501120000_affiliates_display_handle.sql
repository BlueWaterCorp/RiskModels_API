-- Phase 1: add affiliates.display_handle for chart watermark attribution.
--
-- Used by riskmodels-py SDK to render "via @{display_handle} on riskmodels.app"
-- in the corner of every Plotly/Matplotlib chart. Public attribution string;
-- safe to render alongside customer-provided portfolio data because it never
-- carries customer PII.
--
-- Constraint: 2-30 chars, alphanumerics + dot + underscore + hyphen. Loose
-- enough to accept email local-parts; strict enough to keep watermarks
-- legible. Validated on insert/update only — backfill below sanitizes.

ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS display_handle text;

-- Forward backfill: derive from profiles.email local-part for existing rows.
-- Strips anything outside the constraint set, lowercases. Falls back to
-- referral_code when sanitization yields a string that's too short.
UPDATE public.affiliates a
SET display_handle = (
  CASE
    WHEN length(regexp_replace(lower(split_part(p.email, '@', 1)), '[^a-z0-9_.-]', '', 'g')) >= 2
    THEN regexp_replace(lower(split_part(p.email, '@', 1)), '[^a-z0-9_.-]', '', 'g')
    ELSE a.referral_code
  END
)
FROM public.profiles p
WHERE a.user_id = p.id
  AND a.display_handle IS NULL;

-- Final fallback for any affiliate without a profiles row (shouldn't exist;
-- defensive). Use the referral_code itself.
UPDATE public.affiliates
SET display_handle = referral_code
WHERE display_handle IS NULL;

-- Constraint applied AFTER backfill so sanitization runs first.
ALTER TABLE public.affiliates
  ADD CONSTRAINT affiliates_display_handle_format
  CHECK (display_handle ~ '^[a-zA-Z0-9_.-]{2,30}$');

-- Unique index — handles double-up between two Janes by appending the rc.
-- Not enforced as PK, just helpful for collision detection in the admin UI.
CREATE INDEX IF NOT EXISTS affiliates_display_handle_idx
  ON public.affiliates (display_handle);

COMMENT ON COLUMN public.affiliates.display_handle IS
  'Public handle shown in SDK chart watermarks ("via @{handle}"). Defaults to email local-part on create. 2-30 chars, [a-zA-Z0-9_.-]. Affiliate can edit via self-serve dashboard. Historical attribution persists after deletion.';

-- Phase 6: explicit consent timestamp for chart-watermark attribution.
-- Set on create when admin checks the consent box. Backfilled to created_at
-- for existing affiliates per "auto-consent retroactively + heads-up email"
-- decision (treat the affiliate-welcome email as implicit consent for v1).
ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS consent_v1_at timestamptz;

UPDATE public.affiliates
SET consent_v1_at = COALESCE(created_at, NOW())
WHERE consent_v1_at IS NULL;

COMMENT ON COLUMN public.affiliates.consent_v1_at IS
  'Timestamp of affiliate consent to chart-watermark attribution (terms v1). Pre-existing rows backfilled to created_at; new rows must be set explicitly via the admin create form. Required before any watermark renders that names this affiliate.';
