-- Artifact Registry — Phase 1 spike
--
-- Tracks rendered artifact instances per
-- `docs/architecture/intelligence_runtime/ARTIFACT_REGISTRY.md` (BWMACRO).
-- The actual rendered bytes (JSON / PNG / SVG) live on GCS at
--   gs://rm_api_public/artifacts/{slug}@{version}/{subject_id}/{as_of}.{ext}
-- this table is the metadata index — what's rendered, when, at what
-- ontology version, in which render methods, with what input lineage.
--
-- Composite PK enforces the canonical-object render-once contract at the
-- artifact level: a given (slug, version, subject, as_of) resolves to
-- exactly one immutable byte sequence per render method.
--
-- v1 scope: index + reads only. Background renderer jobs upsert rows as
-- they produce GCS bytes; reads are by subject (workspace fetch) or by
-- (slug, version) for catalog / refresh planning.

CREATE TABLE IF NOT EXISTS public.artifact_registry (
    slug               TEXT        NOT NULL,
    version            TEXT        NOT NULL,        -- 'v1', 'v2', ...
    subject_id         TEXT        NOT NULL,        -- BW-FUND-* / BW-FILER-* / BW-ETF-* / BW-BENCH-* / BW-COHORT-*
    as_of              DATE        NOT NULL,        -- artifact's render anchor (`teo`)
    ontology_version   TEXT        NOT NULL,        -- e.g. '2.0' — CANONICAL_INTELLIGENCE_OBJECTS.md §5
    kind               TEXT        NOT NULL,        -- 'data' | 'narrative'
    render_methods     TEXT[]      NOT NULL,        -- {'json','png','svg'} subset
    bytes_total        BIGINT      NOT NULL DEFAULT 0,
    rendered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    methodology_url    TEXT        NULL,
    metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- per-render-method byte counts (for GCS storage accounting). Keys
    -- must be a subset of render_methods.
    bytes_per_method   JSONB       NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT artifact_registry_pkey PRIMARY KEY (slug, version, subject_id, as_of),
    CONSTRAINT artifact_registry_kind_check
        CHECK (kind IN ('data', 'narrative')),
    CONSTRAINT artifact_registry_render_methods_nonempty
        CHECK (array_length(render_methods, 1) >= 1)
);

COMMENT ON TABLE  public.artifact_registry              IS 'Per ARTIFACT_REGISTRY.md §7 — index of rendered artifact instances. Bytes live on GCS at gs://rm_api_public/artifacts/{slug}@{version}/{subject_id}/{as_of}.{ext}.';
COMMENT ON COLUMN public.artifact_registry.slug         IS 'Artifact slug — must match the registered renderer module (e.g. ''top_holdings_erm_stacked'').';
COMMENT ON COLUMN public.artifact_registry.version      IS 'Semantic version — major bump for breaking layout/metric/schema change; templates pin exact @vN.';
COMMENT ON COLUMN public.artifact_registry.subject_id   IS 'Canonical subject id — BW-FUND-* / BW-FILER-* / BW-ETF-* / BW-BENCH-* / BW-COHORT-*.';
COMMENT ON COLUMN public.artifact_registry.as_of        IS 'Render anchor (= `teo`). Combined with (slug, version, subject_id) forms the immutable instance key.';
COMMENT ON COLUMN public.artifact_registry.ontology_version IS 'Canonical-object ontology version this instance was rendered under. See CANONICAL_INTELLIGENCE_OBJECTS.md §5.';
COMMENT ON COLUMN public.artifact_registry.metadata     IS 'Artifact-specific bag: input lineage refs, n_holdings_rendered, n_traces, coverage_pct, etc.';
COMMENT ON COLUMN public.artifact_registry.bytes_per_method IS 'JSON like {"json": 1234, "png": 78901, "svg": 4567} — sum should equal bytes_total.';

-- Lookup by subject — workspace fetch (give me every artifact for AGTHX at as_of=...).
CREATE INDEX IF NOT EXISTS artifact_registry_subject_idx
    ON public.artifact_registry (subject_id, as_of DESC);

-- Lookup by slug+version — catalog page, refresh planning.
CREATE INDEX IF NOT EXISTS artifact_registry_slug_version_idx
    ON public.artifact_registry (slug, version);

-- Lookup by render time — operations dashboard (what got rendered in
-- the last 24h, how big, etc.).
CREATE INDEX IF NOT EXISTS artifact_registry_rendered_at_idx
    ON public.artifact_registry (rendered_at DESC);

-- RLS: open-read for now (artifacts are public per the canonical-object
-- contract). Writes are service-role only.
ALTER TABLE public.artifact_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artifact_registry_read_all ON public.artifact_registry;
CREATE POLICY artifact_registry_read_all
    ON public.artifact_registry
    FOR SELECT
    USING (true);

-- (No insert/update/delete policies — service role bypasses RLS for the
-- renderer jobs; ordinary users have read only.)
