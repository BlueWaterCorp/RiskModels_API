-- Workspace Registry — user-scoped saved outputs from Analyst chat / workspace (distinct from
-- immutable HTTP artifact slugs; see BWMACRO ARTIFACT_REGISTRY.md §17).

CREATE TABLE IF NOT EXISTS public.workspace_registry_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_key TEXT,
  title TEXT NOT NULL CHECK (char_length(title) >= 1 AND char_length(title) <= 500),
  output_type TEXT NOT NULL CHECK (char_length(output_type) >= 1 AND char_length(output_type) <= 128),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_url TEXT,
  registry_slug TEXT,
  registry_version TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_registry_entries_user_created
  ON public.workspace_registry_entries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_registry_entries_snapshot
  ON public.workspace_registry_entries(user_id, snapshot_key, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_registry_entries_metadata_gin
  ON public.workspace_registry_entries USING gin(metadata jsonb_path_ops);

COMMENT ON TABLE public.workspace_registry_entries IS
  'User-scoped Workspace Registry rows (chat saves, notes); not platform artifact slugs.';

DROP TRIGGER IF EXISTS trg_workspace_registry_entries_updated_at ON public.workspace_registry_entries;
CREATE TRIGGER trg_workspace_registry_entries_updated_at
  BEFORE UPDATE ON public.workspace_registry_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.workspace_registry_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own workspace registry rows"
  ON public.workspace_registry_entries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users insert own workspace registry rows"
  ON public.workspace_registry_entries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own workspace registry rows"
  ON public.workspace_registry_entries FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
