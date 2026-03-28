-- Daily macro factor returns (small surface: ~6 series × trading days).
-- Ingest via pipeline or script; API reads for on-demand correlation vs equity returns.

create table if not exists public.macro_factors (
  factor_key text not null,
  teo date not null,
  return_gross double precision,
  metadata jsonb not null default '{}'::jsonb,
  primary key (factor_key, teo)
);

create index if not exists idx_macro_factors_teo on public.macro_factors (teo);
create index if not exists idx_macro_factors_key on public.macro_factors (factor_key);

comment on table public.macro_factors is 'Daily macro factor total returns (e.g. bitcoin, vix); used for correlation vs stock return series.';
